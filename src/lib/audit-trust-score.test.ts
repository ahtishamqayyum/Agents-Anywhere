import { describe, expect, it } from "vitest";
import {
  citationValidityPercent,
  parseAuditTrustPercent,
} from "./audit-trust-score";

describe("parseAuditTrustPercent", () => {
  it("parses the canonical reviewer line", () => {
    expect(parseAuditTrustPercent("Trust score: **72%**")).toBe(72);
  });

  it("is case-insensitive on the label", () => {
    expect(parseAuditTrustPercent("trust SCORE: **40%**")).toBe(40);
  });

  it("clamps absurd values into the 0–100 range", () => {
    expect(parseAuditTrustPercent("Trust score: **250%**")).toBe(100);
  });

  it("returns null when the audit markdown has no score line", () => {
    expect(parseAuditTrustPercent("## Verdict\nLooks fine.")).toBeNull();
  });

  it("returns null on a malformed line missing the bold markers", () => {
    expect(parseAuditTrustPercent("Trust score: 72%")).toBeNull();
  });
});

describe("citationValidityPercent", () => {
  it("returns null when there are no parsed citations", () => {
    expect(citationValidityPercent([])).toBeNull();
  });

  it("rounds the share of ok-checks", () => {
    expect(
      citationValidityPercent([
        { ok: true },
        { ok: true },
        { ok: false },
      ])
    ).toBe(67);
  });

  it("returns 100 when every citation resolved", () => {
    expect(citationValidityPercent([{ ok: true }, { ok: true }])).toBe(100);
  });

  it("returns 0 when no citation resolved", () => {
    expect(citationValidityPercent([{ ok: false }, { ok: false }])).toBe(0);
  });
});