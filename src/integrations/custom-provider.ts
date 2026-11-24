import { z } from "zod";
import {
  type BranchMatch,
  type BranchNaming,
  evaluateBranchTypeRules,
  type IssueField,
  matchOfResult,
} from "../lib/branch-type.js";
import { runCapturing } from "../lib/cli.js";
import { showVisibly } from "../lib/config-keys.js";
import {
  type BranchKind,
  getBranchPrefix,
  getBranchTypeRules,
  renderBranchName,
} from "../lib/project-config.js";
import { InvalidValueError } from "../lib/prompt.js";
import { redactSecrets } from "../lib/redact.js";
import { slugifyBranchTitle } from "../lib/utils.js";

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
// With the u flag a pair is one code point, so this matches only a lone half.
const LONE_SURROGATE = /\p{Cs}/gu;

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

// The two optional operations (D8). One strict object per outcome, so a field a
// different outcome owns is refused rather than ignored.
const assignAnswer = z.union([
  z.strictObject({
    version: z.literal(PROTOCOL_VERSION),
    outcome: z.enum(["assigned", "already-yours"]),
  }),
  z.strictObject({
    version: z.literal(PROTOCOL_VERSION),
    outcome: z.literal("held-by-other"),
    heldBy: plainText.optional(),
  }),
]);

const startAnswer = z.union([
  z.strictObject({
    version: z.literal(PROTOCOL_VERSION),
    outcome: z.literal("started"),
    from: plainText,
    to: plainText,
  }),
  z.strictObject({
    version: z.literal(PROTOCOL_VERSION),
    outcome: z.enum(["already-started", "left-alone"]),
    state: plainText,
  }),
]);

export type CustomIssue = z.output<typeof issueSchema>;
export type AssignOutcome =
  | { outcome: "assigned" | "already-yours" }
  | { outcome: "held-by-other"; heldBy?: string };
export type StartOutcome =
  | { outcome: "started"; from: string; to: string }
  | { outcome: "already-started" | "left-alone"; state: string };

export interface FetchCustomIssueOptions {
  /** The provider's display name; every message names it. */
  name: string;
  /** The directory the command runs in (the repository's top level). */
  cwd?: string;
  /** Overrides the 15 s bound; for tests. */
  timeoutMs?: number;
}

/**
 * One free-text answer field of the provider's, as it may be shown in a line or
 * a `--json` warning: control characters written out, then cut to
 * `MAX_SHOWN_CHARS`. The schema keeps these fields free of control characters
 * already; this is the bound on length, which the schema does not give them.
 */
export function shownField(text: string): string {
  // A cut inside a surrogate pair, or a lone surrogate the provider sent,
  // becomes U+FFFD rather than half a character.
  return showVisibly(text)
    .slice(0, MAX_SHOWN_CHARS)
    .replace(LONE_SURROGATE, "\uFFFD");
}

/** Text the provider wrote, as it may be shown: no secret, no escape, cut. */
function shown(text: string): string {
  return shownField(redactSecrets(text));
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
 * Runs `argv` (the configured command line, unchanged) with `request` on its
 * stdin (D2) and returns the answer `schema` accepts. Every operation goes
 * through here, so the bound, the error mapping and what is shown of the
 * provider's own words are one rule (D6).
 *
 * Throws `InvalidValueError` (exit 2) for the provider's `invalid_reference`,
 * and a plain `Error` (exit 1) for everything else: `not_found`, `failed`, a
 * non-zero exit, a program that cannot be run, a timeout, and an answer that
 * breaks the contract. Every message starts with the provider's name.
 */
async function callProvider<T>(
  argv: string[],
  request: Record<string, string>,
  schema: z.ZodType<T>,
  { name, cwd, timeoutMs = PROVIDER_TIMEOUT_MS }: FetchCustomIssueOptions,
): Promise<T> {
  const [file, ...args] = argv;
  if (file === undefined) {
    throw new Error(`${name}: issueProvider.command is empty.`);
  }

  let result: Awaited<ReturnType<typeof runCapturing>>;
  try {
    result = await runCapturing(file, args, {
      cwd,
      timeout: timeoutMs,
      input: JSON.stringify({ version: PROTOCOL_VERSION, ...request }),
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

  const parsed = schema.safeParse(document);
  if (!parsed.success) {
    throw failure(
      name,
      `the issue provider's answer is not valid (${describeIssue(parsed.error)}).`,
      result.stderr,
    );
  }
  return parsed.data;
}

/** The `fetch` operation: the issue `reference` names, validated. */
export async function fetchCustomIssue(
  argv: string[],
  reference: string,
  options: FetchCustomIssueOptions,
): Promise<CustomIssue> {
  const answer = await callProvider(
    argv,
    { operation: "fetch", reference },
    fetchAnswer,
    options,
  );
  return answer.issue;
}

/** The `assign` operation (D8): makes the issue `key` the person's. */
export async function assignCustomIssue(
  argv: string[],
  key: string,
  options: FetchCustomIssueOptions,
): Promise<AssignOutcome> {
  const { version: _version, ...outcome } = await callProvider(
    argv,
    { operation: "assign", key },
    assignAnswer,
    options,
  );
  return outcome;
}

/** The `start` operation (D8): moves the issue `key` to started. */
export async function startCustomIssue(
  argv: string[],
  key: string,
  options: FetchCustomIssueOptions,
): Promise<StartOutcome> {
  const { version: _version, ...outcome } = await callProvider(
    argv,
    { operation: "start", key },
    startAnswer,
    options,
  );
  return outcome;
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

/**
 * The fields the rules compare (D7): the portable `Type` and `Labels` made from
 * the answer's `type` and `labels`, then the provider's own `fields`. A field
 * of the provider's that answers to `Type` or `Labels` is dropped, because two
 * fields under one name make a rule ambiguous, and the portable one is what a
 * shared `branchType` list is written against.
 */
export function getCustomIssueFields(issue: CustomIssue): IssueField[] {
  const portable: IssueField[] = [
    {
      id: "Type",
      name: "Type",
      values: issue.type === null ? [] : [{ name: issue.type }],
    },
    {
      id: "Labels",
      name: "Labels",
      values: issue.labels.map((name) => ({ name })),
    },
  ];
  const taken = new Set(portable.map((entry) => entry.id.toLowerCase()));
  const own = issue.fields.filter(
    (entry) =>
      !taken.has(entry.id.toLowerCase()) &&
      !taken.has(entry.name.toLowerCase()),
  );
  return [...portable, ...own];
}

/**
 * The branch name for a fetched issue (D7). The kind comes from
 * `issueProvider.branchType`, else the shared `branchType` (the rules engine,
 * where a list that matches nothing gives no prefix, as for every provider),
 * else the answer's own `kind`, else no prefix. Rule warnings go to
 * `onWarning`.
 */
export async function getCustomBranchNaming(
  issue: CustomIssue,
  onWarning: (warning: string) => void = () => {},
  dryRun = false,
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("issueProvider");
  const fields = getCustomIssueFields(issue);

  let kind: BranchKind | undefined;
  let match: BranchMatch;
  if (list) {
    const result = evaluateBranchTypeRules(list.rules, fields, list.listName, {
      shared: list.shared,
      dryRun,
    });
    for (const warning of result.warnings) {
      onWarning(warning);
    }
    kind = result.kind;
    match = matchOfResult(result);
  } else {
    // No list was written, so nothing "matched" or failed to: the answer's own
    // `kind` (or none) is the provider's built-in mapping, as for the others.
    kind = issue.kind ?? undefined;
    match = { source: "built-in" };
  }

  const branchName = await renderBranchName({
    prefix: await getBranchPrefix(kind),
    id: issue.key,
    slug: slugifyBranchTitle(issue.title),
  });
  return { branchName, kind, fields, match };
}
