import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { repoGrep } from "./repo-search";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOOL_OUTPUT_CHARS = 400_000;
const NUL = String.fromCharCode(0);

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

function safeResolve(repoRoot: string, rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(repoRoot, normalized);
  const relToRoot = path.relative(path.resolve(repoRoot), abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error("Path escapes repository root");
  }
  return abs;
}

export async function toolListDirectory(
  repoRoot: string,
  relPath: string
): Promise<string> {
  const abs = safeResolve(repoRoot, relPath || ".");
  const st = await stat(abs);
  if (!st.isDirectory()) {
    return `Not a directory: ${relPath || "."}`;
  }
  const names = await readdir(abs);
  const lines: string[] = [];
  for (const n of names.sort()) {
    if (IGNORE_DIRS.has(n)) continue;
    const p = path.join(abs, n);
    try {
      const s = await stat(p);
      lines.push(s.isDirectory() ? `${n}/` : n);
    } catch {
      lines.push(n);
    }
  }
  return lines.length ? lines.join("\n") : "(empty)";
}

export async function toolReadFile(
  repoRoot: string,
  relPath: string,
  startLine?: number,
  endLine?: number
): Promise<string> {
  const abs = safeResolve(repoRoot, relPath);
  const st = await stat(abs);
  if (!st.isFile()) return `Not a file: ${relPath}`;
  if (st.size > MAX_FILE_BYTES) {
    return `[file too large to read in one shot: ${st.size} bytes; ask for a specific line range]`;
  }
  const raw = await readFile(abs, "utf-8");
  if (raw.includes(NUL)) {
    return "[binary or non-text file]";
  }
  const lines = raw.split(/\r?\n/);
  if (startLine != null && endLine != null) {
    const s = Math.max(1, startLine);
    const e = Math.max(s, endLine);
    const slice = lines.slice(s - 1, e);
    return slice
      .map((text, i) => `${String(s + i).padStart(5, " ")}| ${text}`)
      .join("\n");
  }
  const numbered = lines
    .map((text, i) => `${String(i + 1).padStart(5, " ")}| ${text}`)
    .join("\n");
  if (numbered.length > MAX_TOOL_OUTPUT_CHARS) {
    return (
      numbered.slice(0, MAX_TOOL_OUTPUT_CHARS) +
      `\n... truncated (${lines.length} lines total, ` +
      `output capped at ${MAX_TOOL_OUTPUT_CHARS} chars; ask for a specific line range)`
    );
  }
  return numbered;
}

export async function toolGrep(
  repoRoot: string,
  pattern: string,
  glob?: string,
  caseSensitive?: boolean
): Promise<string> {
  const hits = await repoGrep(repoRoot, pattern, { glob, caseSensitive });
  if (!hits.length) return "(no matches)";
  return hits
    .map((h) => `${h.path}:${h.line}: ${h.preview}`)
    .join("\n");
}