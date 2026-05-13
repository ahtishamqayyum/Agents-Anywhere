import type {
  ChatCompletionAssistantMessageParam,
  ChatCompletionMessageParam,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { toolGrep, toolListDirectory, toolReadFile } from "./tools-impl";
import { getOpenAIClient } from "./llm-client";

const INVESTIGATOR_MODEL =
  process.env.INVESTIGATOR_MODEL ||
  (process.env.OPENROUTER_API_KEY?.trim()
    ? "openai/gpt-4o-mini"
    : "gpt-4o-mini");

const MAX_TOOL_ROUNDS = 18;

const SYSTEM = `You are a senior codebase investigator. The user linked a Git repository that is cloned on disk at the path given in the first system message as REPO_ROOT.

Rules:
- Use tools to inspect the repository. Never invent file paths or APIs.
- Ground every substantive claim in a citation using this exact format on its own or inline:
  path/relative/to/repo.tsx#L10-L40
  (forward slashes, repo-relative path, #L start line, optional -L end line; end must be >= start.)
- If you speculate (design opinion, security guess, "probably"), prefix clearly with words like "Speculation:" and still cite what you saw when possible.
- When the user references earlier turns, reconcile with them: if you changed your mind, say so explicitly.
- Prefer reading exact definitions over guessing from filenames.
- Keep the final user-visible answer structured with short headings where helpful.`;

export async function runInvestigator(params: {
  repoRoot: string;
  /** Prior conversation: alternating user questions and your prior final answers (plain text). */
  priorTurns: { user: string; assistantAnswer: string }[];
  question: string;
}): Promise<string> {
  const openai = getOpenAIClient("investigator");

  const messages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${SYSTEM}\n\nREPO_ROOT (informational): ${params.repoRoot}`,
    },
  ];

  for (const t of params.priorTurns) {
    messages.push({ role: "user", content: t.user });
    messages.push({
      role: "assistant",
      content: t.assistantAnswer,
    });
  }

  messages.push({ role: "user", content: params.question });

  const tools = [
    {
      type: "function" as const,
      function: {
        name: "list_directory",
        description:
          "List files and subdirectories in a repo-relative directory (omit or use . for root).",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repo-relative directory path" },
          },
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "read_file",
        description:
          "Read a text file from the repo. Optionally request a 1-based inclusive line range.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Repo-relative file path" },
            start_line: { type: "integer", description: "Optional start line (1-based)" },
            end_line: { type: "integer", description: "Optional end line (1-based, inclusive)" },
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function" as const,
      function: {
        name: "search_repo",
        description:
          "Search file contents for a literal or regex pattern across text files (skips large/binary).",
        parameters: {
          type: "object",
          properties: {
            pattern: { type: "string" },
            glob: {
              type: "string",
              description: "Optional path filter like *.ts or src/**/*.tsx",
            },
            case_sensitive: { type: "boolean", default: true },
          },
          required: ["pattern"],
        },
      },
    },
  ];

  let rounds = 0;
  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    const completion = await openai.chat.completions.create({
      model: INVESTIGATOR_MODEL,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.2,
    });

    const choice = completion.choices[0]?.message;
    if (!choice) {
      throw new Error("Empty completion from investigator model");
    }

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      const text = choice.content?.trim();
      if (!text) throw new Error("Investigator returned no text");
      return text;
    }

    const assistantMsg: ChatCompletionAssistantMessageParam = {
      role: "assistant",
      content: choice.content ?? null,
      tool_calls: toolCalls,
    };
    messages.push(assistantMsg);

    for (const tc of toolCalls) {
      const name = tc.function.name;
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      let result = "";
      try {
        if (name === "list_directory") {
          result = await toolListDirectory(
            params.repoRoot,
            typeof args.path === "string" ? args.path : "."
          );
        } else if (name === "read_file") {
          const p = String(args.path ?? "");
          const s =
            typeof args.start_line === "number" ? args.start_line : undefined;
          const e =
            typeof args.end_line === "number" ? args.end_line : undefined;
          result = await toolReadFile(params.repoRoot, p, s, e);
        } else if (name === "search_repo") {
          result = await toolGrep(
            params.repoRoot,
            String(args.pattern ?? ""),
            typeof args.glob === "string" ? args.glob : undefined,
            args.case_sensitive === false ? false : true
          );
        } else {
          result = `Unknown tool: ${name}`;
        }
      } catch (err) {
        result = `Tool error (${name}): ${
          err instanceof Error ? err.message : String(err)
        }`;
      }

      const toolMsg: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: tc.id,
        content: result.slice(0, 120_000),
      };
      messages.push(toolMsg);
    }
  }

  throw new Error("Investigator exceeded tool round budget");
}

export function investigatorModelLabel(): string {
  return INVESTIGATOR_MODEL;
}
