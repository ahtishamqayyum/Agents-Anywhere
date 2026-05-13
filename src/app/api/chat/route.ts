import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureDataDirs } from "@/lib/paths";
import { buildPriorTurns, loadSession, saveSession } from "@/lib/session-store";
import { auditModelLabel, runExternalAudit } from "@/lib/auditor";
import { extractCitations } from "@/lib/citations";
import { verifyCitations } from "@/lib/citation-verify";
import { investigatorModelLabel, runInvestigator } from "@/lib/investigator";
import { getLlmCredentialSummary } from "@/lib/llm-client";
import { humanizeOutboundError } from "@/lib/network-errors";
import { citationValidityPercent } from "@/lib/audit-trust-score";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({
  sessionId: z.string().uuid(),
  message: z.string().min(1).max(16_000),
});

export async function POST(req: Request) {
  try {
    await ensureDataDirs();
    const json = await req.json();
    const { sessionId, message } = bodySchema.parse(json);

    const session = await loadSession(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    session.messages.push({ role: "user", content: message });
    const priorTurns = buildPriorTurns(session.messages.slice(0, -1));

    const answer = await runInvestigator({
      repoRoot: session.repoRoot,
      priorTurns,
      question: message,
    });

    const spans = extractCitations(answer);
    const citationChecks = await verifyCitations(session.repoRoot, spans);

    const audit = await runExternalAudit({
      question: message,
      answer,
      priorTurns,
      repoRoot: session.repoRoot,
      citationChecks,
    });

    const cred = getLlmCredentialSummary();
    const citePct = citationValidityPercent(citationChecks);

    session.messages.push({
      role: "assistant",
      content: answer,
      audit: audit.markdown,
      auditMeta: {
        citationChecks,
        answerModel: investigatorModelLabel(),
        auditModel: audit.skippedLlm ? "(skipped)" : auditModelLabel(),
        answerCredential: cred.answerCredential,
        auditCredential: cred.auditCredential,
        auditUsesSeparateKey: cred.auditUsesSeparateKey,
        trustPercentReviewer: audit.trustPercent,
        citationValidityPercent: citePct,
      },
    });

    await saveSession(session);

    return NextResponse.json({
      answer,
      audit: audit.markdown,
      auditSkipped: audit.skippedLlm,
      auditSkipReason: audit.skipReason,
      citationChecks,
      trustPercentReviewer: audit.trustPercent,
      citationValidityPercent: citePct,
      models: {
        investigator: investigatorModelLabel(),
        audit: audit.skippedLlm ? "(skipped)" : auditModelLabel(),
        answerCredential: cred.answerCredential,
        auditCredential: cred.auditCredential,
        auditUsesSeparateKey: cred.auditUsesSeparateKey,
      },
    });
  } catch (e) {
    let msg = e instanceof Error ? e.message : "Unknown error";
    if (
      /fetch failed|failed to fetch|econnreset|etimedout|enotfound|network|certificate|ssl|tls/i.test(
        msg
      )
    ) {
      msg = humanizeOutboundError(e, "openrouter");
    }
    const status = msg.includes("parse") || msg.includes("Expected") ? 400 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
