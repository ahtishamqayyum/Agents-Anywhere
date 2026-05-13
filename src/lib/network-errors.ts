function collectErrorText(err: unknown, depth = 0): string {
  if (depth > 5) return "";
  if (!err) return "";
  if (err instanceof Error) {
    const fromCause = err.cause ? collectErrorText(err.cause, depth + 1) : "";
    return `${err.message}\n${fromCause}`;
  }
  return String(err);
}

/**
 * Map low-level undici/Node "fetch failed" into actionable UI text.
 */
export function humanizeOutboundError(
  err: unknown,
  context: "openrouter" | "github-api" | "browser-to-app"
): string {
  const combined = collectErrorText(err);

  if (
    !/fetch failed|Failed to fetch|NetworkError|ECONNRESET|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|certificate|SSL|TLS|UNABLE_TO_VERIFY_LEAF_SIGNATURE/i.test(
      combined
    )
  ) {
    return err instanceof Error ? err.message : String(err);
  }

  if (context === "openrouter") {
    return [
      "OpenRouter HTTPS request failed (network, DNS, firewall, or SSL).",
      "Check: internet / VPN, valid keys in .env (OPENROUTER_API_KEY for answers, OPENROUTER_AUDIT_API_KEY for audit), then restart `npm run dev`.",
    ].join(" ");
  }

  if (context === "github-api") {
    return "Could not reach GitHub API (network/DNS/firewall). Clone will still be attempted.";
  }

  return "Could not reach the app server. Is `npm run dev` running? Check the URL (e.g. http://localhost:3000).";
}
