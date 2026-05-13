import { readdir, readFile, stat } from "fs/promises";
import path from "path";

const IGNORE_DIRS = new Set([
  ".git",
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  "vendor",
  "__pycache__",
  ".venv",
  "target",
]);

const MAX_FILES = 6000;
const MAX_DEPTH = 8;
const MAX_MATCHES = 40;
const MAX_LINE_CHARS = 400;

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".scss",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".rs",
  ".go",
  ".py",
  ".java",
  ".kt",
  ".rb",
  ".php",
  ".cs",
  ".swift",
  ".vue",
  ".svelte",
  ".sql",
  ".sh",
  ".env",
  ".gitignore",
]);

function looksTextFile(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  if (TEXT_EXT.has(ext)) return true;
  if (!ext && /^[A-Z][a-z]+file$/i.test(path.basename(file))) return true;
  return false;
}

export type GrepHit = {
  path: string;
  line: number;
  preview: string;
};

export async function repoGrep(
  repoRoot: string,
  pattern: string,
  options?: { glob?: string; caseSensitive?: boolean }
): Promise<GrepHit[]> {
  const hits: GrepHit[] = [];
  let filesVisited = 0;

  const glob = options?.glob?.trim();
  const caseSens = options?.caseSensitive ?? true;
  let needle: string | RegExp;
  try {
    // Non-global so `.test` per line does not mutate `lastIndex` awkwardly
    needle = caseSens ? new RegExp(pattern) : new RegExp(pattern, "i");
  } catch {
    needle = caseSens ? pattern : pattern.toLowerCase();
  }

  async function walk(dir: string, depth: number): Promise<void> {
    if (hits.length >= MAX_MATCHES || filesVisited >= MAX_FILES || depth > MAX_DEPTH) {
      return;
    }
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (hits.length >= MAX_MATCHES || filesVisited >= MAX_FILES) break;
      if (IGNORE_DIRS.has(name)) continue;
      const full = path.join(dir, name);
      const rel = path.relative(repoRoot, full).split(path.sep).join("/");
      if (glob) {
        if (!minimatchSimple(rel, glob)) continue;
      }
      let st;
      try {
        st = await stat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        await walk(full, depth + 1);
      } else if (st.isFile() && st.size < 1_500_000 && looksTextFile(full)) {
        filesVisited++;
        await scanFile(full, rel);
      }
    }
  }

  async function scanFile(abs: string, rel: string): Promise<void> {
    let content: string;
    try {
      content = await readFile(abs, "utf-8");
    } catch {
      return;
    }
    if (content.includes("\u0000")) return;
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= MAX_MATCHES) break;
      const line = lines[i];
      const matched =
        typeof needle === "string"
          ? caseSens
            ? line.includes(needle)
            : line.toLowerCase().includes(needle.toLowerCase())
          : line.search(needle) >= 0;
      if (matched) {
        hits.push({
          path: rel,
          line: i + 1,
          preview: line.slice(0, MAX_LINE_CHARS),
        });
      }
    }
  }

  await walk(repoRoot, 0);
  return hits;
}

/** Tiny glob: only `*` segments, compared against forward-slash path */
function minimatchSimple(rel: string, globPat: string): boolean {
  const norm = rel.replace(/\\/g, "/");
  const parts = globPat.split("/").filter(Boolean);
  const segs = norm.split("/");
  return matchParts(segs, parts, 0, 0);
}

function matchParts(segs: string[], pat: string[], si: number, pi: number): boolean {
  if (pi === pat.length) return si === segs.length;
  const p = pat[pi];
  if (p === "**") {
    for (let j = si; j <= segs.length; j++) {
      if (matchParts(segs, pat, j, pi + 1)) return true;
    }
    return false;
  }
  if (si >= segs.length) return false;
  if (p === "*") return matchParts(segs, pat, si + 1, pi + 1);
  if (p.includes("*")) {
    const [pre, post] = p.split("*");
    const s = segs[si];
    if (!s.startsWith(pre) || !s.endsWith(post)) return false;
    return matchParts(segs, pat, si + 1, pi + 1);
  }
  if (segs[si] !== p) return false;
  return matchParts(segs, pat, si + 1, pi + 1);
}
