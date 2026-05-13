import { describe, expect, it } from "vitest";
import { extractCitations } from "./citations";

describe("extractCitations", () => {
  it("parses a single citation with start and end lines", () => {
    const out = extractCitations("see src/lib/foo.ts#L10-L40 for details");
    expect(out).toEqual([{ path: "src/lib/foo.ts", startLine: 10, endLine: 40 }]);
  });

  it("treats a single-line citation as start == end", () => {
    const out = extractCitations("look at src/app/page.tsx#L12");
    expect(out).toEqual([{ path: "src/app/page.tsx", startLine: 12, endLine: 12 }]);
  });

  it("deduplicates identical citations in the same answer", () => {
    const out = extractCitations(
      "src/lib/foo.ts#L1-L5 explains it; later src/lib/foo.ts#L1-L5 repeats it."
    );
    expect(out).toHaveLength(1);
  });

  it("keeps different ranges of the same file as separate spans", () => {
    const out = extractCitations("src/lib/foo.ts#L1-L5 and src/lib/foo.ts#L10-L20");
    expect(out).toHaveLength(2);
    expect(out[0].endLine).toBe(5);
    expect(out[1].startLine).toBe(10);
  });

  it("strips leading ./ and / from paths", () => {
    const out = extractCitations("./src/lib/foo.ts#L1 and /src/lib/bar.ts#L2");
    expect(out.map((c) => c.path)).toEqual(["src/lib/foo.ts", "src/lib/bar.ts"]);
  });

  it("strips wrapping backticks/quotes/brackets", () => {
    const out = extractCitations("`src/lib/foo.ts#L7-L9` and [src/lib/bar.ts#L1]");
    expect(out.map((c) => c.path).sort()).toEqual([
      "src/lib/bar.ts",
      "src/lib/foo.ts",
    ]);
  });

  it("clamps an inverted range so end >= start", () => {
    const out = extractCitations("weird src/lib/foo.ts#L50-L10");
    expect(out[0]).toMatchObject({ startLine: 50, endLine: 50 });
  });

  it("returns an empty array when no citation is present", () => {
    expect(extractCitations("just a sentence, no citations.")).toEqual([]);
  });

  it("accepts a bare end-line variant without the trailing L (path#L10-40)", () => {
    const out = extractCitations("src/lib/foo.ts#L10-40");
    expect(out).toEqual([{ path: "src/lib/foo.ts", startLine: 10, endLine: 40 }]);
  });
});