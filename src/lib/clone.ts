import { existsSync } from "fs";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import path from "path";
import { extract as tarExtract } from "tar";
import type { ParsedRepo } from "./github-url";
import { repoDir, dataDir } from "./paths";
import { assertPublicRepoOnGitHub } from "./github-repo-check";

const CLONE_TIMEOUT_MS = 90_000;

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
      /* fall through */
    }
  }

  await assertPublicRepoOnGitHub(parsed.owner, parsed.repo);
  await mkdir(dest, { recursive: true });

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CLONE_TIMEOUT_MS);
  const tarballUrl = `https://api.github.com/repos/${encodeURIComponent(
    parsed.owner
  )}/${encodeURIComponent(parsed.repo)}/tarball`;

  const tmpTar = path.join(dataDir(), `${sessionId}.tar.gz`);

  try {
    const res = await fetch(tarballUrl, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CodebaseInvestigator/1.0",
      },
      signal: ac.signal,
      redirect: "follow",
    });

    if (res.status === 404) {
      throw new Error("Repository not found, or it is private.");
    }
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(tmpTar, buf);
    await tarExtract({ file: tmpTar, cwd: dest, strip: 1 });
  } catch (err) {
    try {
      await rm(dest, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    const raw =
      err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error("[clone:v4] failed:", raw);
    throw new Error(`[v4] Clone failed: ${raw.slice(0, 400)}`);
  } finally {
    clearTimeout(timer);
    try {
      await rm(tmpTar, { force: true });
    } catch {
      /* ignore */
    }
  }

  return dest;
}
