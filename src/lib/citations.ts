/**
 * Expected citation format in model answers:
 *   src/app/page.tsx#L12-L48
 * Paths are repo-relative, forward slashes, no leading slash.
 */
const CITATION_RE = /([^\s`'"#]+)#L(\d+)(?:-L?(\d+))?/g;

export type CitationSpan = {
  path: string;
  startLine: number;
  endLine: number;
};

export function extractCitations(text: string): CitationSpan[] {
  const out: CitationSpan[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(CITATION_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    const p = normalizePath(m[1]);
    const start = Math.max(1, parseInt(m[2], 10));
    const endRaw = m[3] ? parseInt(m[3], 10) : start;
    const end = Math.max(start, endRaw);
    const key = `${p}:${start}:${end}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: p, startLine: start, endLine: end });
  }
  return out;
}

function normalizePath(p: string): string {
  let s = p.trim();
  s = s.replace(/^[`'"(\[]+/, "").replace(/[`'")\]]+$/, "");
  s = s.replace(/^\.\//, "");
  s = s.replace(/^\/+/, "");
  return s;
}
