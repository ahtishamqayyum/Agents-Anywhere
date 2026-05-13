import { existsSync } from "fs";
import { mkdir, rm } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import type { ParsedRepo } from "./github-url";
import { repoDir } from "./paths";
import {
  assertPublicRepoOnGitHub,
  friendlyCloneError,
} from "./github-repo-check";

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 120_000;

export async function ensureRepoCloned(
  sessionId: string,
  parsed: ParsedRepo
): Promise<string> {
  const dest = repoDir(sessionId, parsed.owner, parsed.repo);
  if (existsSync(path.join(dest, ".git"))) {
    return dest;
  }

  await assertPublicRepoOnGitHub(parsed.owner, parsed.repo);

  await mkdir(path.dirname(dest), { recursive: true });

  try {
    await execFileAsync(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--single-branch",
        "--",
        parsed.cloneUrl,
        dest,
      ],
      {
        timeout: CLONE_TIMEOUT_MS,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
  } catch (err) {
    try {
      await rm(dest, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
    throw new Error(friendlyCloneError(err));
  }

  return dest;
}
