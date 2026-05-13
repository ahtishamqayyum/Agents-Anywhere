import OpenAI from "openai";

export type LlmRole = "investigator" | "audit";

function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer":
      process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost:3000",
    "X-Title":
      process.env.OPENROUTER_APP_TITLE?.trim() || "Codebase Investigator",
  };
}

/**
 * Investigator (answers): `OPENROUTER_API_KEY` or `OPENAI_API_KEY`.
 * Audit (separate verify call): `OPENROUTER_AUDIT_API_KEY` or `OPENAI_AUDIT_API_KEY`; if unset, falls back to the same key as investigator (old behaviour).
 *
 * OpenRouter base URL is used whenever the chosen key is an OpenRouter key (set explicitly via env for that role).
 */
export function getOpenAIClient(role: LlmRole): OpenAI {
  const explicitBase = process.env.OPENAI_BASE_URL?.trim();

  if (role === "investigator") {
    const orKey = process.env.OPENROUTER_API_KEY?.trim();
    const oaiKey = process.env.OPENAI_API_KEY?.trim();
    if (orKey) {
      return new OpenAI({
        apiKey: orKey,
        baseURL: explicitBase || "https://openrouter.ai/api/v1",
        defaultHeaders: openRouterHeaders(),
        timeout: 120_000,
      });
    }
    if (oaiKey) {
      return new OpenAI({
        apiKey: oaiKey,
        baseURL: explicitBase || undefined,
        timeout: 120_000,
      });
    }
    throw new Error(
      "Set OPENROUTER_API_KEY or OPENAI_API_KEY for the investigator (answers)."
    );
  }

  const auditOr = process.env.OPENROUTER_AUDIT_API_KEY?.trim();
  const auditOai = process.env.OPENAI_AUDIT_API_KEY?.trim();
  if (auditOr) {
    return new OpenAI({
      apiKey: auditOr,
      baseURL: explicitBase || "https://openrouter.ai/api/v1",
      defaultHeaders: openRouterHeaders(),
      timeout: 120_000,
    });
  }
  if (auditOai) {
    return new OpenAI({
      apiKey: auditOai,
      baseURL: explicitBase || undefined,
      timeout: 120_000,
    });
  }

  return getOpenAIClient("investigator");
}

/** Human-readable labels for UI (no secrets). */
export type LlmCredentialSummary = {
  answerCredential: string;
  auditCredential: string;
  auditUsesSeparateKey: boolean;
};

export function getLlmCredentialSummary(): LlmCredentialSummary {
  const hasOrAns = !!process.env.OPENROUTER_API_KEY?.trim();
  const hasOaiAns = !!process.env.OPENAI_API_KEY?.trim();
  const hasOrAud = !!process.env.OPENROUTER_AUDIT_API_KEY?.trim();
  const hasOaiAud = !!process.env.OPENAI_AUDIT_API_KEY?.trim();
  const auditUsesSeparateKey = hasOrAud || hasOaiAud;

  const answerCredential = hasOrAns
    ? "OpenRouter · primary API key (OPENROUTER_API_KEY)"
    : hasOaiAns
      ? "OpenAI · primary API key (OPENAI_API_KEY)"
      : "—";

  const auditCredential = hasOrAud
    ? "OpenRouter · audit API key (OPENROUTER_AUDIT_API_KEY)"
    : hasOaiAud
      ? "OpenAI · audit API key (OPENAI_AUDIT_API_KEY)"
      : hasOrAns || hasOaiAns
        ? "Same credential as answer (set OPENROUTER_AUDIT_API_KEY for a separate key)"
        : "—";

  return {
    answerCredential,
    auditCredential,
    auditUsesSeparateKey,
  };
}
