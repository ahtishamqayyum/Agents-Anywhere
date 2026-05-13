import { readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import { sessionFile } from "./paths";
import type { ParsedRepo } from "./github-url";

export type ChatRole = "user" | "assistant";

export type Message = {
  role: ChatRole;
  content: string;
  /** Present for assistant turns after investigation */
  audit?: string;
  /** Structured audit metadata from programmatic checks */
  auditMeta?: AuditMeta;
};

export type AuditMeta = {
  citationChecks: CitationCheck[];
  answerModel: string;
  auditModel: string;
  answerCredential: string;
  auditCredential: string;
  auditUsesSeparateKey: boolean;
  /** Independent reviewer 0–100 from audit LLM markdown */
  trustPercentReviewer: number | null;
  /** Programmatic: share of parsed citations that resolved in repo */
  citationValidityPercent: number | null;
};

export type CitationCheck = {
  path: string;
  startLine: number;
  endLine: number;
  ok: boolean;
  reason?: string;
};

export type Session = {
  id: string;
  createdAt: string;
  repoUrl: string;
  parsed: ParsedRepo;
  repoRoot: string;
  messages: Message[];
};

export function newSessionId(): string {
  return randomUUID();
}

export async function loadSession(id: string): Promise<Session | null> {
  try {
    const raw = await readFile(sessionFile(id), "utf-8");
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

export async function saveSession(session: Session): Promise<void> {
  await writeFile(sessionFile(session.id), JSON.stringify(session, null, 2), "utf-8");
}

export function buildPriorTurns(messages: Message[]): {
  user: string;
  assistantAnswer: string;
}[] {
  const out: { user: string; assistantAnswer: string }[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const a = messages[i];
    const b = messages[i + 1];
    if (a.role === "user" && b.role === "assistant") {
      out.push({ user: a.content, assistantAnswer: b.content });
      i++;
    }
  }
  return out;
}
