import { z } from "zod";
import { runCapturing } from "../lib/cli.js";
import { showVisibly } from "../lib/config-keys.js";
import { InvalidValueError } from "../lib/prompt.js";
import { redactSecrets } from "../lib/redact.js";

// A custom issue provider is a configured command that prints JSON in the shape
// below (version 1). It runs through `runCapturing`, so it is bounded, killed on
// overrun and never sees a shell, and whatever it prints is untrusted input:
// validated here, at the boundary, before anything else reads it (D6). The zod
// schemas are the contract's source; the guide is its reference.
//
// This module imports no integration and no caller: it knows a command, a
// reference and a name, and nothing tracker-shaped.

/** Per call (D6). A provider that has not answered by then is killed. */
export const PROVIDER_TIMEOUT_MS = 15_000;

/** Stdout cap, in bytes (D6); `maxBuffer` ends the child that passes it. */
const MAX_STDOUT_BYTES = 1024 * 1024;

/** The longest stretch of the provider's own words shown to a person. */
const MAX_SHOWN_CHARS = 200;

const PROTOCOL_VERSION = 1;

// `key` becomes `{id}` in a ref and a directory name, so it can hold none of
// what git-check-ref-format refuses: no `/`, `.`, space, control character, or
// a leading, trailing or doubled separator.
const KEY_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)*$/;
const MAX_KEY_LENGTH = 64;

// The same rule as the approval prompt's `step` (config-keys.ts): a control or
// formatting character could redraw the terminal or reorder what is printed.
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

const plainText = z.string().refine((value) => !CONTROL_OR_FORMAT.test(value), {
  message: "must not contain control or formatting characters",
});

const key = plainText
  .max(MAX_KEY_LENGTH)
  .regex(KEY_PATTERN, "must be letters and digits joined by - or _");

const url = plainText
  .refine((value) => /^https?:$/.test(URL.parse(value)?.protocol ?? ""), {
    message: "must be an http or https URL",
  })
  .nullable()
  .default(null);

const fieldValue = z.strictObject({
  id: plainText.optional(),
  name: plainText.optional(),
});

// `IssueField`-shaped (branch-type.ts), so the rules engine takes it unchanged.
const field = z.strictObject({
  id: plainText,
  name: plainText,
  values: z.array(fieldValue),
});

const issueSchema = z.strictObject({
  key,
  // Only `slugifyBranchTitle` reads it, and that keeps `[a-z0-9_-]`; the rule
  // above does not apply, so a title is not refused for what it cannot do.
  title: z.string(),
  url,
  type: plainText.nullable().default(null),
  labels: z.array(plainText).default([]),
  fields: z.array(field).default([]),
  kind: z.enum(["feature", "bugfix", "chore"]).nullable().default(null),
  can: z.array(z.enum(["assign", "start"])).default([]),
});

const ERROR_CODES = ["invalid_reference", "not_found", "failed"] as const;

const fetchAnswer = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  issue: issueSchema,
});

const errorAnswer = z.strictObject({
  version: z.literal(PROTOCOL_VERSION),
  error: z.strictObject({ code: z.enum(ERROR_CODES), message: z.string() }),
});

export type CustomIssue = z.output<typeof issueSchema>;

export interface FetchCustomIssueOptions {
  /** The provider's display name; every message names it. */
  name: string;
  /** The directory the command runs in (the repository's top level). */
  cwd?: string;
  /** Overrides the 15 s bound; for tests. */
  timeoutMs?: number;
}

/** Text the provider wrote, as it may be shown: no secret, no escape, cut. */
function shown(text: string): string {
  return showVisibly(redactSecrets(text)).slice(0, MAX_SHOWN_CHARS);
}

function lastLine(stderr: string): string {
  const lines = stderr.split("\n").filter((line) => line.trim() !== "");
  return lines.at(-1) ?? "";
}

/** A failure that is the provider's, with the tail of its stderr when it has one. */
function failure(name: string, what: string, stderr = ""): Error {
  const tail = lastLine(stderr);
  return new Error(
    tail
      ? `${name}: ${what} Its stderr ended: ${shown(tail)}`
      : `${name}: ${what}`,
  );
}

function describeIssue(error: z.ZodError): string {
  const first = error.issues[0];
  const path = first?.path.join(".") ?? "";
  return shown(`${path ? `${path}: ` : ""}${first?.message ?? "invalid"}`);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Runs `argv` (the configured command line, unchanged) with a `fetch` request
 * for `reference` on its stdin (D2) and returns the validated answer.
 *
 * Throws `InvalidValueError` (exit 2) for the provider's `invalid_reference`,
 * and a plain `Error` (exit 1) for everything else: `not_found`, `failed`, a
 * non-zero exit, a program that cannot be run, a timeout, and an answer that
 * breaks the contract. Every message starts with the provider's name.
 */
export async function fetchCustomIssue(
  argv: string[],
  reference: string,
  { name, cwd, timeoutMs = PROVIDER_TIMEOUT_MS }: FetchCustomIssueOptions,
): Promise<CustomIssue> {
  const [file, ...args] = argv;
  if (file === undefined) {
    throw new Error(`${name}: issueProvider.command is empty.`);
  }

  const request = JSON.stringify({
    version: PROTOCOL_VERSION,
    operation: "fetch",
    reference,
  });

  let result: Awaited<ReturnType<typeof runCapturing>>;
  try {
    result = await runCapturing(file, args, {
      cwd,
      timeout: timeoutMs,
      input: request,
      maxBuffer: MAX_STDOUT_BYTES,
    });
  } catch (error) {
    throw describeRunFailure(name, error, timeoutMs);
  }

  const document = parseJson(result.stdout);

  // The provider's own error report is honoured whatever it exited with.
  if (isObject(document) && "error" in document) {
    const parsed = errorAnswer.safeParse(document);
    if (parsed.success) {
      const { code, message } = parsed.data.error;
      const text = `${name}: ${shown(message)}`;
      throw code === "invalid_reference"
        ? new InvalidValueError(text)
        : new Error(text);
    }
  }

  // A non-zero exit is a failure even beside a well-formed answer: the exit is
  // the provider's own statement that it did not succeed.
  if (result.exitCode !== 0) {
    throw failure(
      name,
      `issueProvider.command exited with code ${result.exitCode}.`,
      result.stderr,
    );
  }

  if (document === undefined) {
    throw failure(
      name,
      "the issue provider did not print valid JSON.",
      result.stderr,
    );
  }
  if (!isObject(document) || document.version !== PROTOCOL_VERSION) {
    throw failure(
      name,
      `the issue provider's answer has a missing or unsupported "version" (this worktree speaks version ${PROTOCOL_VERSION}).`,
      result.stderr,
    );
  }

  const parsed = fetchAnswer.safeParse(document);
  if (!parsed.success) {
    throw failure(
      name,
      `the issue provider's answer is not valid (${describeIssue(parsed.error)}).`,
      result.stderr,
    );
  }
  return parsed.data.issue;
}

/** `runCapturing` rejects when no exit code exists: overrun, kill, or no program. */
function describeRunFailure(
  name: string,
  error: unknown,
  timeoutMs: number,
): Error {
  const { code, killed } = error as { code?: unknown; killed?: unknown };
  if (code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
    return new Error(
      `${name}: the issue provider printed more than ${MAX_STDOUT_BYTES / 1024 / 1024} MiB.`,
    );
  }
  if (killed === true) {
    return new Error(
      `${name}: the issue provider did not answer within ${Math.round(timeoutMs / 1000)}s.`,
    );
  }
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `${name}: issueProvider.command could not be run (${shown(reason)}).`,
  );
}
