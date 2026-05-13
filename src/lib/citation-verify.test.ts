import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCitationEvidence, verifyCitations } from "./citation-verify";

let repo: string;

beforeAll(async () => {
  repo = await mkdtemp(path.join(tmpdir(), "cite-verify-"));
  await mkdir(path.join(repo, "src", "lib"), { recursive: true });
  const sample = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
  await writeFile(path.join(repo, "src", "lib", "foo.ts"), sample, "utf-8");
  await writeFile(path.join(repo, "blank.ts"), "\n\n\n\n", "utf-8");
});

afterAll(async () => {
  await rm(repo, { recursive: true, force: true });
});

describe("verifyCitations", () => {
  it("marks a valid in-range citation as ok", async () => {
    const out = await verifyCitations(repo, [
      { path: "src/lib/foo.ts", startLine: 3, endLine: 7 },
    ]);
    expect(out[0]).toMatchObject({ ok: true });
    expect(out[0].reason).toBeUndefined();
  });

  it("flags a missing file with a non-empty reason", async () => {
    const out = await verifyCitations(repo, [
      { path: "src/lib/missing.ts", startLine: 1, endLine: 2 },
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].reason).toBeTruthy();
  });

  it("flags a start line past EOF as out of range", async () => {
    const out = await verifyCitations(repo, [
      { path: "src/lib/foo.ts", startLine: 999, endLine: 1000 },
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].reason).toMatch(/out of range/i);
  });

  it("rejects a citation whose range is entirely empty lines", async () => {
    const out = await verifyCitations(repo, [
      { path: "blank.ts", startLine: 1, endLine: 3 },
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].reason).toMatch(/empty/i);
  });

  it("accepts a large in-bounds range and clamps to EOF", async () => {
    const out = await verifyCitations(repo, [
      { path: "src/lib/foo.ts", startLine: 1, endLine: 5000 },
    ]);
    expect(out[0].ok).toBe(true);
  });

  it("rejects paths that escape the repo root with .. traversal", async () => {
    const out = await verifyCitations(repo, [
      { path: "../escape.ts", startLine: 1, endLine: 2 },
    ]);
    expect(out[0].ok).toBe(false);
    expect(out[0].reason).toMatch(/escape|repository/i);
  });
});

describe("loadCitationEvidence", () => {
  it("returns the exact line range content", async () => {
    const ev = await loadCitationEvidence(repo, {
      path: "src/lib/foo.ts",
      startLine: 2,
      endLine: 4,
    });
    expect(ev?.content).toBe("line 2\nline 3\nline 4");
  });

  it("returns null when the file does not exist", async () => {
    const ev = await loadCitationEvidence(repo, {
      path: "nope.ts",
      startLine: 1,
      endLine: 1,
    });
    expect(ev).toBeNull();
  });
});