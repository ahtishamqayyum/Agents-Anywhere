import { mkdir } from "fs/promises";
import path from "path";

const ROOT = process.cwd();

export function dataDir(): string {
  return path.join(ROOT, "data");
}

export async function ensureDataDirs(): Promise<void> {
  await mkdir(path.join(dataDir(), "repos"), { recursive: true });
  await mkdir(path.join(dataDir(), "sessions"), { recursive: true });
}

export function sessionFile(sessionId: string): string {
  return path.join(dataDir(), "sessions", `${sessionId}.json`);
}

export function repoDir(sessionId: string, owner: string, repo: string): string {
  return path.join(dataDir(), "repos", sessionId, `${owner}__${repo}`);
}
