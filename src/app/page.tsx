"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { humanizeOutboundError } from "@/lib/network-errors";

async function readJsonBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {
      error: `Server returned non-JSON (HTTP ${res.status}). ${text.slice(0, 160)}`,
    };
  }
}

type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      audit?: string;
      citationChecks?: {
        path: string;
        startLine: number;
        endLine: number;
        ok: boolean;
        reason?: string;
      }[];
      models?: {
        investigator: string;
        audit: string;
        answerCredential?: string;
        auditCredential?: string;
        auditUsesSeparateKey?: boolean;
      };
      auditSkipped?: boolean;
      trustPercentReviewer?: number | null;
      citationValidityPercent?: number | null;
    };

type SessionApiMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      audit?: string;
      auditMeta?: {
        citationChecks: NonNullable<
          Extract<ChatMessage, { role: "assistant" }>["citationChecks"]
        >;
        answerModel: string;
        auditModel: string;
        answerCredential?: string;
        auditCredential?: string;
        auditUsesSeparateKey?: boolean;
        trustPercentReviewer?: number | null;
        citationValidityPercent?: number | null;
      };
    };

function citationPassFromChecks(
  checks: { ok: boolean }[] | undefined
): number | null {
  if (!checks?.length) return null;
  const ok = checks.filter((c) => c.ok).length;
  return Math.round((ok / checks.length) * 100);
}

function normalizeSessionMessages(raw: SessionApiMessage[]): ChatMessage[] {
  return raw.map((m) => {
    if (m.role === "user") return m;
    return {
      role: "assistant",
      content: m.content,
      audit: m.audit,
      citationChecks: m.auditMeta?.citationChecks,
      models: m.auditMeta
        ? {
            investigator: m.auditMeta.answerModel,
            audit: m.auditMeta.auditModel,
            answerCredential: m.auditMeta.answerCredential,
            auditCredential: m.auditMeta.auditCredential,
            auditUsesSeparateKey: m.auditMeta.auditUsesSeparateKey,
          }
        : undefined,
      trustPercentReviewer:
        (m.auditMeta as { trustPercentReviewer?: number | null } | undefined)
          ?.trustPercentReviewer ?? null,
      citationValidityPercent:
        typeof m.auditMeta?.citationValidityPercent === "number"
          ? m.auditMeta.citationValidityPercent
          : citationPassFromChecks(m.auditMeta?.citationChecks),
    };
  });
}

type TabKey = "answer" | "audit" | "citations";

function trustBarColor(percent: number): string {
  if (percent < 42) return "#e05555";
  if (percent < 72) return "#e6a23c";
  return "#3ecf8e";
}

function AuditMeters({
  reviewer,
  programmatic,
  auditSkipped,
}: {
  reviewer: number | null;
  programmatic: number | null;
  auditSkipped: boolean;
}) {
  return (
    <div className="mb-1 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] shadow-[0_8px_30px_rgba(0,0,0,0.35)] ring-1 ring-white/[0.07]">
      <div className="relative border-b border-[var(--border)] bg-gradient-to-br from-[#1a1f2e] via-[var(--panel)] to-[#12151c] px-4 py-4">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_80%_at_100%_0%,rgba(91,140,255,0.12),transparent_55%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg)] text-sm"
                aria-hidden
              >
                ◆
              </span>
              <div>
                <h3 className="text-[15px] font-semibold tracking-tight text-[var(--text)]">
                  Independent audit
                </h3>
                <p className="mt-0.5 max-w-xl text-[11px] leading-relaxed text-[var(--muted)]">
                  Reviewer score = alag LLM + prompt. Citations % = codebase se programmatic verify.
                </p>
              </div>
            </div>
          </div>
          {auditSkipped && (
            <span className="shrink-0 rounded-full border border-[var(--warn)]/35 bg-[var(--warn)]/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--warn)]">
              LLM skipped
            </span>
          )}
        </div>
        {auditSkipped && (
          <div className="relative mt-3 rounded-lg border border-[var(--warn)]/25 bg-[var(--warn)]/[0.06] px-3 py-2.5 text-[11px] leading-relaxed text-[#d4c4a8]">
            <span className="font-medium text-[var(--warn)]">Kyun?</span> Chhota jawab, citations
            nahi — is liye alag reviewer model call nahi hui (cost + noise kam).{" "}
            <span className="text-[var(--muted)]">
              Mazboot audit ke liye repo se <code className="rounded bg-black/30 px-1 font-mono text-[10px]">path#L10-L40</code>{" "}
              wale citations mangwao.
            </span>
          </div>
        )}
      </div>
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <MeterCard
          title="Reviewer trust"
          subtitle={auditSkipped ? "Is turn par run nahi hua" : "Alag audit model"}
          value={reviewer}
          emptyHint={auditSkipped ? "Skipped" : "Format missing"}
          accent={auditSkipped ? "muted" : "normal"}
        />
        <MeterCard
          title="Citations valid"
          subtitle="Disk par paths resolve"
          value={programmatic}
          emptyHint={programmatic == null ? "Koi citation parse nahi" : undefined}
          accent="normal"
        />
      </div>
    </div>
  );
}

function MeterCard({
  title,
  subtitle,
  value,
  emptyHint,
  accent,
}: {
  title: string;
  subtitle: string;
  value: number | null;
  emptyHint?: string;
  accent?: "normal" | "muted";
}) {
  const borderAccent =
    accent === "muted" ? "border-[var(--border)]/80" : "border-[var(--border)]";
  return (
    <div
      className={`relative overflow-hidden rounded-xl border ${borderAccent} bg-gradient-to-b from-[var(--panel)] to-[#14161c] p-4 shadow-inner`}
    >
      <div
        className={`absolute left-0 top-0 h-full w-1 rounded-l-xl ${
          value != null ? "" : "bg-[var(--border)]"
        }`}
        style={
          value != null
            ? { background: `linear-gradient(180deg, ${trustBarColor(value)}, transparent)` }
            : undefined
        }
      />
      <div className="pl-2">
        <div className="flex items-baseline justify-between gap-2">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
            {title}
          </div>
        </div>
        <div className="mt-1 text-[11px] text-[var(--muted)]">{subtitle}</div>
        {value == null ? (
          <div className="mt-4 space-y-1">
            <div className="text-3xl font-light text-[var(--muted)]">—</div>
            {emptyHint && (
              <p className="text-[10px] leading-snug text-[var(--muted)]/90">{emptyHint}</p>
            )}
          </div>
        ) : (
          <>
            <div
              className="mt-3 flex items-end gap-1 tabular-nums tracking-tight"
              style={{ color: trustBarColor(value) }}
            >
              <span className="text-4xl font-bold leading-none">{value}</span>
              <span className="pb-1 text-xl font-semibold leading-none opacity-90">%</span>
            </div>
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-black/40 ring-1 ring-inset ring-white/[0.06]">
              <div
                className="h-full rounded-full transition-all duration-700 ease-out"
                style={{
                  width: `${Math.max(4, value)}%`,
                  background: `linear-gradient(90deg, ${trustBarColor(value)}, ${trustBarColor(value)}cc)`,
                  boxShadow: `0 0 20px ${trustBarColor(value)}66`,
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function HomePage() {
  const [repoUrl, setRepoUrl] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [repoLabel, setRepoLabel] = useState<string>("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [busy, setBusy] = useState<"clone" | "chat" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [tabByMsg, setTabByMsg] = useState<Record<number, TabKey>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const storageKey = "codebase-investigator-session-v1";

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    (async () => {
      try {
        const res = await fetch(`/api/session?id=${encodeURIComponent(saved)}`);
        if (!res.ok) {
          localStorage.removeItem(storageKey);
          return;
        }
        const data = (await res.json()) as {
          sessionId: string;
          repo: string;
          messages: SessionApiMessage[];
        };
        setSessionId(data.sessionId);
        setRepoLabel(data.repo);
        setMessages(normalizeSessionMessages(data.messages));
      } catch {
        localStorage.removeItem(storageKey);
      }
    })();
  }, [storageKey]);

  const startSession = async () => {
    setError(null);
    setBusy("clone");
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl }),
      });
      const data = await readJsonBody(res);
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Failed to start session");
      const sid = data.sessionId;
      const repo = data.repo;
      if (typeof sid !== "string" || typeof repo !== "string") {
        throw new Error("Invalid response from server");
      }
      setSessionId(sid);
      setRepoLabel(repo);
      setMessages([]);
      localStorage.setItem(storageKey, sid);
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Clone failed";
      if (/failed to fetch|fetch failed|networkerror/i.test(msg)) {
        msg = humanizeOutboundError(e, "browser-to-app");
      }
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const send = async () => {
    if (!sessionId || !input.trim() || busy) return;
    const text = input.trim();
    setInput("");
    setError(null);
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((m) => [...m, userMsg]);
    setBusy("chat");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, message: text }),
      });
      const data = (await readJsonBody(res)) as {
        error?: string;
        answer?: string;
        audit?: string;
        citationChecks?: Extract<ChatMessage, { role: "assistant" }>["citationChecks"];
        models?: Extract<ChatMessage, { role: "assistant" }>["models"];
        auditSkipped?: boolean;
        trustPercentReviewer?: number | null;
        citationValidityPercent?: number | null;
      };
      if (!res.ok) throw new Error(data.error || "Chat failed");
      if (typeof data.answer !== "string") {
        throw new Error(typeof data.error === "string" ? data.error : "Invalid chat response");
      }
      const assistant: ChatMessage = {
        role: "assistant",
        content: data.answer,
        audit: typeof data.audit === "string" ? data.audit : undefined,
        citationChecks: data.citationChecks,
        models: data.models,
        auditSkipped: data.auditSkipped,
        trustPercentReviewer:
          typeof data.trustPercentReviewer === "number"
            ? data.trustPercentReviewer
            : null,
        citationValidityPercent:
          typeof data.citationValidityPercent === "number"
            ? data.citationValidityPercent
            : citationPassFromChecks(data.citationChecks),
      };
      setMessages((prev) => {
        const next = [...prev, assistant];
        const assistantIdx = next.length - 1;
        setTabByMsg((tabs) => ({
          ...tabs,
          [assistantIdx]: data.auditSkipped ? "answer" : "audit",
        }));
        return next;
      });
    } catch (e) {
      let msg = e instanceof Error ? e.message : "Chat failed";
      if (/failed to fetch|fetch failed|networkerror/i.test(msg)) {
        msg = humanizeOutboundError(e, "browser-to-app");
      }
      setError(msg);
      setMessages((m) => m.slice(0, -1));
    } finally {
      setBusy(null);
    }
  };

  const resetSession = () => {
    localStorage.removeItem(storageKey);
    setSessionId(null);
    setRepoLabel("");
    setMessages([]);
    setTabByMsg({});
    setError(null);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-4 py-8 pb-16">
      <header className="space-y-2 border-b border-[var(--border)] pb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Codebase Investigator</h1>
        <p className="max-w-3xl text-sm text-[var(--muted)]">
          Paste a public GitHub URL, clone it locally, then ask plain-English questions. Each answer
          includes an <span className="text-[var(--text)]">independent audit</span> (separate API
          call, prompt, and optional second API key; plus programmatic citation checks). Conversation history is kept on the
          server for multi-turn investigations.
        </p>
      </header>

      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 space-y-1 text-sm">
            <span className="text-[var(--muted)]">Public GitHub URL</span>
            <input
              className="w-full rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm outline-none ring-[var(--accent)] focus:ring-2"
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              disabled={busy === "clone"}
              placeholder="https://github.com/owner/repo"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={startSession}
              disabled={busy === "clone" || !repoUrl.trim()}
              className="rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {busy === "clone" ? "Cloning…" : "Start session"}
            </button>
            <button
              type="button"
              onClick={resetSession}
              className="rounded border border-[var(--border)] px-4 py-2 text-sm text-[var(--muted)] hover:border-[var(--accent-dim)] hover:text-[var(--text)]"
            >
              Clear
            </button>
          </div>
        </div>
        {sessionId && (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Active session: <span className="font-mono text-[var(--text)]">{sessionId}</span>
            {repoLabel && (
              <>
                {" "}
                · repo <span className="text-[var(--text)]">{repoLabel}</span>
              </>
            )}
          </p>
        )}
        {error && (
          <p className="mt-3 rounded border border-[var(--bad)]/40 bg-[var(--bad)]/10 px-3 py-2 text-sm text-[var(--bad)]">
            {error}
          </p>
        )}
      </section>

      <section className="flex min-h-[420px] flex-1 flex-col rounded-lg border border-[var(--border)] bg-[var(--panel)]">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!sessionId && (
            <p className="text-sm text-[var(--muted)]">
              Start a session to index a shallow clone, then ask retrieval, review, or opinion
              questions. Citations should look like{" "}
              <code className="rounded bg-[var(--bg)] px-1 py-0.5 font-mono text-xs">
                src/lib/foo.ts#L10-L40
              </code>
              .
            </p>
          )}
          {messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={i} className="ml-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                  <div className="text-xs uppercase tracking-wide text-[var(--muted)]">You</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{m.content}</div>
                </div>
              );
            }
            const tab = tabByMsg[i] ?? "answer";
            const reviewerPct =
              typeof m.trustPercentReviewer === "number" ? m.trustPercentReviewer : null;
            const citePct =
              typeof m.citationValidityPercent === "number"
                ? m.citationValidityPercent
                : citationPassFromChecks(m.citationChecks);
            return (
              <div key={i} className="mr-8 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-[var(--muted)]">Investigator</div>
                </div>
                <div className="mt-2 flex gap-2 text-xs">
                  {(
                    [
                      ["answer", "Answer"],
                      ["audit", "Audit"],
                      ["citations", "Citations"],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setTabByMsg((t) => ({ ...t, [i]: key }))}
                      className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                        tab === key
                          ? "bg-[var(--accent)] text-white shadow-md shadow-[var(--accent)]/25"
                          : "bg-[var(--panel)] text-[var(--muted)] ring-1 ring-[var(--border)] hover:bg-[var(--bg)] hover:text-[var(--text)]"
                      }`}
                    >
                      {label}
                      {key === "audit" && reviewerPct != null && (
                        <span
                          className={`rounded-md px-1.5 py-px font-mono text-[10px] font-semibold ${
                            tab === key ? "bg-white/20 text-white" : "bg-[var(--border)] text-[var(--text)]"
                          }`}
                          style={
                            tab !== key
                              ? { color: trustBarColor(reviewerPct) }
                              : undefined
                          }
                        >
                          {reviewerPct}%
                        </span>
                      )}
                      {key === "audit" && reviewerPct == null && m.auditSkipped && (
                        <span
                          className={`rounded-md px-1.5 py-px text-[9px] font-semibold uppercase ${
                            tab === key ? "bg-white/15 text-[var(--warn)]" : "bg-[var(--warn)]/15 text-[var(--warn)]"
                          }`}
                        >
                          skip
                        </span>
                      )}
                      {key === "audit" &&
                        reviewerPct == null &&
                        !m.auditSkipped &&
                        citePct != null && (
                          <span
                            className={`rounded-md px-1.5 py-px font-mono text-[10px] ${
                              tab === key ? "bg-white/15 text-white/90" : "bg-[var(--border)]"
                            }`}
                            style={tab !== key ? { color: trustBarColor(citePct) } : undefined}
                          >
                            {citePct}% cite
                          </span>
                        )}
                    </button>
                  ))}
                </div>
                <div className="mt-3 text-sm">
                  {tab === "answer" && (
                    <div className="whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-sans leading-relaxed">
                      {m.content}
                    </div>
                  )}
                  {tab === "audit" && (
                    <div className="space-y-4">
                      <AuditMeters
                        reviewer={reviewerPct}
                        programmatic={citePct}
                        auditSkipped={!!m.auditSkipped}
                      />
                      <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[#0c0e12] shadow-inner ring-1 ring-white/[0.04]">
                        <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-[var(--accent)] via-[var(--accent-dim)] to-transparent opacity-90" />
                        <div className="border-b border-[var(--border)]/80 bg-[#10131a]/90 px-4 py-3 pl-5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
                              Narrative (markdown)
                            </span>
                            <span className="rounded-full bg-[var(--panel)] px-2.5 py-0.5 font-mono text-[10px] text-[var(--muted)]">
                              {m.auditSkipped ? "stub + tips" : "full review"}
                            </span>
                          </div>
                        </div>
                        <div className="max-h-[min(70vh,520px)] overflow-y-auto px-4 py-4 pl-5">
                          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.65] text-[#b8bfd0] selection:bg-[var(--accent)]/30">
                            {m.audit ?? "No audit text."}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                  {tab === "citations" && (
                    <div className="space-y-2">
                      {!m.citationChecks?.length && (
                        <p className="text-[var(--muted)]">No parsed citations in the answer text.</p>
                      )}
                      {m.citationChecks?.map((c, j) => (
                        <div
                          key={`${c.path}-${j}`}
                          className={`rounded border px-3 py-2 font-mono text-xs ${
                            c.ok
                              ? "border-[var(--good)]/40 bg-[var(--good)]/5"
                              : "border-[var(--bad)]/40 bg-[var(--bad)]/5"
                          }`}
                        >
                          <div className="text-[var(--text)]">
                            {c.path}#L{c.startLine}-L{c.endLine}
                          </div>
                          {!c.ok && (
                            <div className="mt-1 text-[var(--bad)]">{c.reason ?? "invalid"}</div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <div className="border-t border-[var(--border)] p-3">
          <div className="flex gap-2">
            <textarea
              className="min-h-[72px] flex-1 resize-y rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2"
              placeholder={
                sessionId
                  ? "Ask about auth, async usage, dead code, error handling, or anything else…"
                  : "Start a session first."
              }
              value={input}
              disabled={!sessionId || busy !== null}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!sessionId || busy !== null || !input.trim()}
              className="self-end rounded bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {busy === "chat" ? "…" : "Send"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
