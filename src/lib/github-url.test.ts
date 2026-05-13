import { describe, expect, it } from "vitest";
import { parseGitHubUrl } from "./github-url";

describe("parseGitHubUrl", () => {
  it("parses a standard github URL", () => {
    const out = parseGitHubUrl("https://github.com/anthropics/anthropic-sdk-python");
    expect(out.owner).toBe("anthropics");
    expect(out.repo).toBe("anthropic-sdk-python");
    expect(out.cloneUrl).toBe(
      "https://github.com/anthropics/anthropic-sdk-python.git"
    );
  });

  it("strips a trailing .git suffix from the repo segment", () => {
    const out = parseGitHubUrl("https://github.com/foo/bar.git");
    expect(out.repo).toBe("bar");
  });

  it("rejects non-github hosts", () => {
    expect(() => parseGitHubUrl("https://gitlab.com/foo/bar")).toThrow();
  });

  it("rejects URLs missing the repo segment", () => {
    expect(() => parseGitHubUrl("https://github.com/foo")).toThrow();
  });

  it("rejects owner names containing .. (path traversal)", () => {
    expect(() => parseGitHubUrl("https://github.com/../bar")).toThrow();
  });

  it("rejects repo names containing .. (path traversal)", () => {
    expect(() => parseGitHubUrl("https://github.com/foo/..")).toThrow();
  });

  it("rejects names starting with a dot or hyphen", () => {
    expect(() => parseGitHubUrl("https://github.com/.foo/bar")).toThrow();
    expect(() => parseGitHubUrl("https://github.com/-foo/bar")).toThrow();
  });

  it("rejects names containing slashes or shell metacharacters", () => {
    expect(() => parseGitHubUrl("https://github.com/foo;rm/bar")).toThrow();
    expect(() => parseGitHubUrl("https://github.com/foo/bar baz")).toThrow();
  });
});