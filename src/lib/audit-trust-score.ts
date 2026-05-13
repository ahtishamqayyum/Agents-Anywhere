/**
 * Parse reviewer trust score from audit markdown (separate LLM pass — not answer self-rating).
 * Expected substring: `Trust score: **72%**` (case-insensitive, NN 0–100).
 */
export function parseAuditTrustPercent(markdown: string): number | null {
  const m = markdown.match(/Trust score:\s*\*\*(\d{1,3})%\*\*/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (Number.isNaN(n)) return null;
  return Math.min(100, Math.max(0, n));
}

export function citationValidityPercent(
  checks: { ok: boolean }[]
): number | null {
  if (!checks.length) return null;
  const ok = checks.filter((c) => c.ok).length;
  return Math.round((ok / checks.length) * 100);
}
