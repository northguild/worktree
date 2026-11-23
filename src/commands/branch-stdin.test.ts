import { Parser } from "@oclif/core";
import { afterEach, describe, expect, it } from "vitest";
import Branch from "./branch.js";

// The real oclif parse, not an injected `BriefStdin`: oclif fills a positional
// that was not given from piped stdin, which drained the pipe `--agent-stdin`
// reads its brief from (#359).
const realStdin = Object.getOwnPropertyDescriptor(process, "stdin");

async function parseWithPipedStdin(argv: string[], piped: string) {
  const { Readable } = await import("node:stream");
  const stdin = Object.assign(Readable.from([piped]), { isTTY: undefined });
  Object.defineProperty(process, "stdin", { value: stdin, configurable: true });
  const cache = globalThis as { oclif?: { stdinCache?: string } };
  if (cache.oclif) cache.oclif.stdinCache = undefined;

  const parsed = await Parser.parse(argv, {
    args: Branch.args,
    flags: Branch.flags,
    strict: Branch.strict,
  });

  return { parsed, remaining: await drain(process.stdin) };
}

async function drain(stream: NodeJS.ReadableStream): Promise<string> {
  let text = "";
  for await (const chunk of stream) text += chunk;
  return text;
}

afterEach(() => {
  if (realStdin) Object.defineProperty(process, "stdin", realStdin);
  const cache = globalThis as { oclif?: { stdinCache?: string } };
  if (cache.oclif) cache.oclif.stdinCache = undefined;
});

describe("branch parse with a piped brief", () => {
  it.each([
    "--linear",
    "--github",
    "--jira",
    "--clickup",
  ])("leaves the brief on stdin with %s and no branch name", async (flag) => {
    const { parsed, remaining } = await parseWithPipedStdin(
      [flag, "ABC-1", "--agent-stdin"],
      "Work on ABC-1.",
    );

    expect(parsed.args.branchName).toBeUndefined();
    expect(remaining).toBe("Work on ABC-1.");
  });

  it("leaves the brief on stdin with no issue flag and no branch name", async () => {
    const { parsed, remaining } = await parseWithPipedStdin(
      ["--agent-stdin"],
      "Work on ABC-1.",
    );

    expect(parsed.args.branchName).toBeUndefined();
    expect(remaining).toBe("Work on ABC-1.");
  });
});
