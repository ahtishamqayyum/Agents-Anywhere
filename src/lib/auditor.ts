import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { extractCitations } from "./citations";
import { loadFullFile } from "./citation-verify";
import type { CitationCheck } from "./session-store";
import { getOpenAIClient } from "./llm-client";
import { parseAuditTrustPercent } from "./audit-trust-score";

const AUDIT_EVIDENCE_BUDGET_CHARS = 320_000;
const AUDIT_MAX_FILES = 12;

const AUDIT_MODEL =
  process.env.AUDIT_MODEL ||
  (process.env.OPENROUTER_API_KEY?.trim()
    ? "openai/gpt-4o-mini"
    : "gpt-4o-mini");

const AUDITOR_SYSTEM = `You are an independent audit reviewer for another assistant's codebase answer.

You did NOT inspect the repository yourself in this request. You only see:
- The user's question
- The other assistant's answer text
- The FULL TEXT of each cited file (verbatim from disk; may be character-truncated for very large files, marked with fullFileTruncated=true)
- The citedSnippet field for each citation — the exact line range the answer pointed to
- Programmatic citation validation results from the tool pipeline

Use the full file content to check whether the answer's claims hold up beyond the cited lines — e.g. whether the cited snippet is misleading in isolation, whether neighbouring code contradicts the claim, or whether the answer missed an obviously relevant nearby block.

Your job is to help a human decide how much to trust the answer. Be direct and specific.

IMPORTANT — Trust score (this is YOUR reviewer score of the OTHER assistant's answer, not the assistant self-rating; that satisfies independent review):
Output markdown with these sections (use the headings exactly and IN THIS ORDER):

## Trust score (independent reviewer)
- First line after the heading MUST be exactly this pattern (NN = integer 0–100): Trust score: **NN%**
- Second line: one short sentence explaining the main reason for that score (evidence strength, citation problems, speculation, gaps, etc.).

## Verdict
One short paragraph: overall trustworthiness and why.

## Citation alignment
Compare claims near each citation to the excerpt text. Flag mismatches, stretched interpretations, or citations that do not support the sentence.

## Overconfidence and hedging
Call out language that is too certain given the evidence, or missing caveats.

## Risk of collateral damage
If the answer suggests refactors or behavior changes, what could break or what was not checked?

## Gaps and contradictions
Note missing evidence, unanswered angles, or internal inconsistencies in the answer (and inconsistencies vs prior_turns if provided).

## Follow-ups
2–6 concrete next checks a human or agent should run in the repo.

Do not invent repository facts beyond the excerpts and validation metadata. If excerpts are missing because citations were invalid, say so.`;

export type AuditInput = {
  question: string;
  answer: string;
  priorTurns: { user: string; assistantAnswer: string }[];
  repoRoot: string;
  citationChecks: CitationCheck[];
};

export type AuditResult = {
  markdown: string;
  model: string;
  skippedLlm: boolean;
  skipReason?: string;
  /** Parsed from reviewer markdown; null if missing or skipped */
  trustPercent: number | null;
};

export async function runExternalAudit(input: AuditInput): Promise<AuditResult> {
  const trivial =
    input.answer.length < 140 &&
    extractCitations(input.answer).length === 0 &&
    !/\b(refactor|security|auth|async|delete|breaking)\b/i.test(input.answer);

  if (trivial) {
    return {
      markdown:
        "## Trust score (independent reviewer)\nTrust score: **—**\n\n(No LLM audit run for trivial replies.)\n\n## Verdict\n\nAudit LLM skipped: short reply with no file citations and low risk keywords. Treat as conversational unless you rely on it for code facts.\n\n## Follow-ups\n\nIf this should be evidence-based, ask for citations (`path#Lstart-Lend`).",
      model: "(none)",
      skippedLlm: true,
      skipReason: "trivial_answer_no_citations",
      trustPercent: null,
    };
  }

  const spans = extractCitations(input.answer);

  const checkByKey = new Map(
    input.citationChecks.map((c) => [
      `${c.path}:${c.startLine}:${c.endLine}`,
      c,
    ])
  );

  const uniquePaths: string[] = [];
  for (const s of spans) {
    if (!uniquePaths.includes(s.path)) uniquePaths.push(s.path);
    if (uniquePaths.length >= AUDIT_MAX_FILES) break;
  }

  const perFileBudget = Math.max(
    8_000,
    Math.floor(AUDIT_EVIDENCE_BUDGET_CHARS / Math.max(1, uniquePaths.length))
  );

  const fileContents = new Map<string, {
    content: string;
    totalLines: number;
    truncated: boolean;
  } | null>();
  for (const p of uniquePaths) {
    fileContents.set(p, await loadFullFile(input.repoRoot, p, perFileBudget));
  }

  const evidence: {
    path: string;
    startLine: number;
    endLine: number;
    citedSnippet: string | null;
    fullFile: string | null;
    fullFileTotalLines: number | null;
    fullFileTruncated: boolean;
    programmaticOk: boolean;
    programmaticReason?: string;
  }[] = [];

  for (const s of spans.slice(0, 24)) {
    const key = `${s.path}:${s.startLine}:${s.endLine}`;
    const chk = checkByKey.get(key);
    const file = fileContents.get(s.path) ?? null;
    let citedSnippet: string | null = null;
    if (file && chk?.ok) {
      const lines = file.content.split(/\r?\n/);
      const startIdx = s.startLine - 1;
      const endIdx = Math.min(s.endLine, lines.length);
      if (startIdx >= 0 && startIdx < lines.length) {
        const sl = lines.slice(startIdx, endIdx).join("\n");
        citedSnippet = sl.trim() ? sl : null;
      }
    }
    evidence.push({
      path: s.path,
      startLine: s.startLine,
      endLine: s.endLine,
      citedSnippet,
      fullFile: file?.content ?? null,
      fullFileTotalLines: file?.totalLines ?? null,
      fullFileTruncated: file?.truncated ?? false,
      programmaticOk: chk?.ok ?? false,
      programmaticReason: chk?.reason,
    });
  }

  const openai = getOpenAIClient("audit");

  const userPayload = {
    question: input.question,
    answer: input.answer,
    prior_turns: input.priorTurns,
    programmatic_citation_checks: input.citationChecks,
    evidence_excerpts: evidence,
  };

  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: AUDITOR_SYSTEM },
    {
      role: "user",
      content: JSON.stringify(userPayload),
    },
  ];

  const completion = await openai.chat.completions.create({
    model: AUDIT_MODEL,
    messages,
    temperature: 0.1,
    max_tokens: 2400,
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Audit model returned empty content");
  }

  const trustPercent = parseAuditTrustPercent(text);

  return {
    markdown: text,
    model: AUDIT_MODEL,
    skippedLlm: false,
    trustPercent,
  };
}

export function auditModelLabel(): string {
  return AUDIT_MODEL;
}
