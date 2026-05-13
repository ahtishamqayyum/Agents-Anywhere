import { existsSync } from "fs";
import { mkdir, readdir, rm } from "fs/promises";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { x as tarExtract } from "tar";
import type { ParsedRepo } from "./github-url";
import { repoDir } from "./paths";
import { assertPublicRepoOnGitHub } from "./github-repo-check";

const CLONE_TIMEOUT_MS = 120_000;

export async function ensureRepoCloned(
  sessionId: string,
  parsed: ParsedRepo
): Promise<string> {
  const dest = repoDir(sessionId, parsed.owner, parsed.repo);
  if (existsSync(dest)) {
    try {
      const entries = await readdir(dest);
      if (entries.length > 0) return dest;
    } catch {
      /* fall through to re-download */
    }
  }

  await assertPublicRepoOnGitHub(parsed.owner, parsed.repo);

  await mkdir(dest, { recursive: true });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLONE_TIMEOUT_MS);
  const tarballUrl = `https://api.github.com/repos/${encodeURIComponent(
    parsed.owner
  )}/${encodeURIComponent(parsed.repo)}/tarball`;

  try {
    const res = await fetch(tarballUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CodebaseInvestigator/1.0",
      },
      signal: ac.signal,
      cache: "no-store",
      redirect: "follow",
    });

    if (res.status === 404) {
      throw new Error(
        "Repository not found, or it is private. Use a public GitHub URL."
      );
    }
    if (!res.ok || !res.body) {
      throw new Error(
        `GitHub tarball download failed: HTTP ${res.status} ${res.statusText}`
      );
    }

    const nodeStream = Readable.fromWeb(res.body as never);
    await pipeline(nodeStream, tarExtract({ cwd: dest, strip: 1 }));
  } catch (err) {
    try {
      await rm(dest, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
    const raw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[clone:v3] tarball failed:", raw, err);
    throw new Error(`[v3] Clone failed: ${raw.slice(0, 400)}`);
  } finally {
    clearTimeout(timer);
  }

  return dest;
}
