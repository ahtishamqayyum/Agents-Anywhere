import { readFile, stat } from "fs/promises";
import path from "path";
import type { CitationSpan } from "./citations";
import type { CitationCheck } from "./session-store";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const NUL = String.fromCharCode(0);

function safeResolve(repoRoot: string, rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const abs = path.resolve(repoRoot, normalized);
  const relToRoot = path.relative(path.resolve(repoRoot), abs);
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    throw new Error("Path escapes repository root");
  }
  return abs;
}

export async function verifyCitations(
  repoRoot: string,
  spans: CitationSpan[]
): Promise<CitationCheck[]> {
  const results: CitationCheck[] = [];
  for (const span of spans) {
    const check: CitationCheck = {
      path: span.path,
      startLine: span.startLine,
      endLine: span.endLine,
      ok: false,
    };
    let abs: string;
    try {
      abs = safeResolve(repoRoot, span.path);
    } catch (e) {
      check.reason = e instanceof Error ? e.message : "unsafe path";
      results.push(check);
      continue;
    }
    try {
      const st = await stat(abs);
      if (!st.isFile()) {
        check.reason = "not a regular file";
        results.push(check);
        continue;
      }
      if (st.size > MAX_FILE_BYTES) {
        check.reason = `file exceeds ${MAX_FILE_BYTES} bytes`;
        results.push(check);
        continue;
      }
      const raw = await readFile(abs, "utf-8");
      if (raw.includes(NUL)) {
        check.reason = "binary or non-text file";
        results.push(check);
        continue;
      }
      const lines = raw.split(/\r?\n/);
      const startIdx = span.startLine - 1;
      const endIdx = Math.min(span.endLine, lines.length);
      if (startIdx < 0 || startIdx >= lines.length) {
        check.reason = "start line out of range";
        results.push(check);
        continue;
      }
      const slice = lines.slice(startIdx, endIdx).join("\n");
      if (!slice.trim()) {
        check.reason = "cited range is empty";
        results.push(check);
        continue;
      }
      check.ok = true;
      results.push(check);
    } catch (e) {
      check.reason = e instanceof Error ? e.message : "read failed";
      results.push(check);
    }
  }
  return results;
}

export async function loadCitationEvidence(
  repoRoot: string,
  span: CitationSpan
): Promise<{ path: string; startLine: number; endLine: number; content: string } | null> {
  let abs: string;
  try {
    abs = safeResolve(repoRoot, span.path);
  } catch {
    return null;
  }
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const raw = await readFile(abs, "utf-8");
    if (raw.includes(NUL)) return null;
    const lines = raw.split(/\r?\n/);
    const startIdx = span.startLine - 1;
    const endIdx = Math.min(span.endLine, lines.length);
    if (startIdx < 0 || startIdx >= lines.length) return null;
    const content = lines.slice(startIdx, endIdx).join("\n");
    return {
      path: span.path,
      startLine: span.startLine,
      endLine: span.endLine,
      content,
    };
  } catch {
    return null;
  }
}

export async function loadFullFile(
  repoRoot: string,
  relPath: string,
  maxChars = 80_000
): Promise<{ path: string; totalLines: number; content: string; truncated: boolean } | null> {
  let abs: string;
  try {
    abs = safeResolve(repoRoot, relPath);
  } catch {
    return null;
  }
  try {
    const st = await stat(abs);
    if (!st.isFile() || st.size > MAX_FILE_BYTES) return null;
    const raw = await readFile(abs, "utf-8");
    if (raw.includes(NUL)) return null;
    const lines = raw.split(/\r?\n/);
    const truncated = raw.length > maxChars;
    const content = truncated ? raw.slice(0, maxChars) : raw;
    return { path: relPath, totalLines: lines.length, content, truncated };
  } catch {
    return null;
  }
}