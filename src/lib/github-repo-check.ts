/**
 * Cheap check before git clone: public repos return 200; missing or private → 404 (unauthenticated).
 * If the GitHub API cannot be reached (network/DNS/firewall), we skip this check and let `git clone` decide.
 */
export async function assertPublicRepoOnGitHub(
  owner: string,
  repo: string
): Promise<void> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "CodebaseInvestigator/1.0",
      },
      cache: "no-store",
      signal: ac.signal,
    });

    if (res.status === 404) {
      throw new Error(
        "Repository not found, or it is private. This tool only works with public GitHub repositories (no login). Check the owner and repo name in the URL, open the repo in a browser to confirm it exists, or make it public."
      );
    }

    if (res.status === 403) {
      return;
    }

    if (!res.ok) {
      return;
    }
  } catch (err) {
    if (err instanceof Error && /Repository not found|private/i.test(err.message)) {
      throw err;
    }
    return;
  } finally {
    clearTimeout(timer);
  }
}

function execErrorText(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const o = err as { message?: string; stderr?: Buffer | string };
  const stderr =
    typeof o.stderr === "string"
      ? o.stderr
      : o.stderr
        ? o.stderr.toString("utf8")
        : "";
  return `${stderr}\n${o.message ?? ""}`;
}

export function friendlyCloneError(err: unknown): string {
  const text = execErrorText(err);

  if (/repository not found|not found\.|fatal: repository/i.test(text)) {
    return "Repository not found, or it is private. Use a public GitHub URL and check owner/repo spelling.";
  }
  if (/authentication failed|could not read from remote repository/i.test(text)) {
    return "Git could not read from GitHub (authentication or access). Public repos should work without tokens; if this persists, check network or VPN.";
  }
  if (/Could not resolve host|getaddrinfo|ENOTFOUND|ECONNREFUSED|timed out|ETIMEDOUT/i.test(text)) {
    return "Could not reach GitHub. Check your internet connection and try again.";
  }
  if (/No space left on device/i.test(text)) {
    return "Disk is full; free some space and try again.";
  }

  return "Clone failed. Confirm the repo is public, the URL is correct, and try again.";
}
