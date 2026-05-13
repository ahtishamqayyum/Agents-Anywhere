import { NextResponse } from "next/server";
import { z } from "zod";
import { ensureRepoCloned } from "@/lib/clone";
import { parseGitHubUrl } from "@/lib/github-url";
import { ensureDataDirs } from "@/lib/paths";
import { loadSession, newSessionId, saveSession, type Session } from "@/lib/session-store";
import { humanizeOutboundError } from "@/lib/network-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  repoUrl: z.string().url().max(2048),
});

const idSchema = z.string().uuid();

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const idRaw = searchParams.get("id");
  if (!idRaw) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  const parsedId = idSchema.safeParse(idRaw);
  if (!parsedId.success) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }
  const session = await loadSession(parsedId.data);
  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({
    sessionId: session.id,
    repoUrl: session.repoUrl,
    repo: `${session.parsed.owner}/${session.parsed.repo}`,
    messages: session.messages,
  });
}

export async function POST(req: Request) {
  try {
    await ensureDataDirs();
    const { repoUrl } = bodySchema.parse(await req.json());
    const parsed = parseGitHubUrl(repoUrl);
    const id = newSessionId();
    const repoRoot = await ensureRepoCloned(id, parsed);

    const session: Session = {
      id,
      createdAt: new Date().toISOString(),
      repoUrl: repoUrl.trim(),
      parsed,
      repoRoot,
      messages: [],
    };
    await saveSession(session);

    return NextResponse.json({
      sessionId: session.id,
      repo: `${parsed.owner}/${parsed.repo}`,
      repoRoot: session.repoRoot,
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
    const isUser =
      msg.includes("github.com") ||
      msg.includes("Expected") ||
      msg.includes("Invalid") ||
      msg.includes("Only github") ||
      msg.includes("Repository not found") ||
      msg.includes("public GitHub") ||
      msg.includes("Clone failed") ||
      msg.includes("Could not reach GitHub") ||
      msg.includes("Disk is full") ||
      msg.includes("Git could not read");
    return NextResponse.json({ error: msg }, { status: isUser ? 400 : 500 });
  }
}
