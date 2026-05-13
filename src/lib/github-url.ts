import { z } from "zod";

const githubRepoSchema = z
  .string()
  .url()
  .refine((u) => {
    try {
      const url = new URL(u);
      return url.hostname === "github.com" || url.hostname === "www.github.com";
    } catch {
      return false;
    }
  }, "Only github.com URLs are allowed");

export type ParsedRepo = {
  owner: string;
  repo: string;
  cloneUrl: string;
};

export function parseGitHubUrl(input: string): ParsedRepo {
  const trimmed = input.trim();
  githubRepoSchema.parse(trimmed);

  const url = new URL(trimmed);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("Expected URL like https://github.com/owner/repo");
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/, "");

  const SAFE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/;
  if (!SAFE.test(owner) || !SAFE.test(repo)) {
    throw new Error("Invalid owner or repository name");
  }
  if (owner.includes("..") || repo.includes("..")) {
    throw new Error("Invalid owner or repository name");
  }
  if (owner.endsWith(".") || repo.endsWith(".")) {
    throw new Error("Invalid owner or repository name");
  }

  const cloneUrl = `https://github.com/${owner}/${repo}.git`;
  return { owner, repo, cloneUrl };
}
