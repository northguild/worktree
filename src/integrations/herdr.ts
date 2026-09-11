import { commandExists, runCapturing } from "../lib/cli.js";

const HERDR_EXECUTABLE = "herdr";

/** Herdr's cap on an agent name: `[a-z][a-z0-9_-]{0,31}` (§4.4). */
const AGENT_NAME_MAX_LENGTH = 32;

/**
 * How long Herdr waits for the agent to reach an interactive prompt.
 *
 * Herdr's own default is 30 s, and `AgentStartParams.timeout_ms` accepts
 * "greater than 3000 and at most 300000". The call is awaited, so whatever sits
 * here is time someone spends watching a spinner *after* the worktree exists
 * and its env files are copied — which is why the default is not good enough
 * (§5). Half of it is the trade: still room for an agent that has to boot cold,
 * but no longer half a minute when one never answers. Erring long is
 * deliberate — a start that times out on an agent which did come up warns about
 * an agent that is in fact running, and that is the more confusing failure.
 */
const AGENT_START_TIMEOUT_MS = 15_000;

/**
 * How long this process waits for `herdr` to answer one request before killing
 * it and reporting the failure.
 *
 * Every call here is awaited, so an unresponsive Herdr freezes the command that
 * spawned it — which findings.md F-041 records for `worktree open`, where the
 * worktree and its env files already exist by the time the spinner stops
 * moving. The removal path is strictly worse: the checkouts are deleted before
 * a space is closed, so there is nothing left to retry and nothing the user can
 * do but interrupt.
 *
 * Ten seconds is far more than a socket round-trip needs — a `workspace close`
 * answers in well under a second — and the slack is deliberate: a false timeout
 * warns about a space that may in fact have closed, which is the more confusing
 * failure of the two. It sits below AGENT_START_TIMEOUT_MS on purpose, that one
 * bounding Herdr's wait for an agent rather than an answer.
 */
const HERDR_REQUEST_TIMEOUT_MS = 10_000;

/**
 * What `agent start` gets instead, because it is the one request whose answer is
 * legitimately slow: Herdr holds it open for up to AGENT_START_TIMEOUT_MS while
 * the agent boots. Bounding it at HERDR_REQUEST_TIMEOUT_MS would kill the call
 * while Herdr was still doing exactly what it was asked to, so the local bound
 * is that wait plus the ordinary allowance for answering once it is over.
 */
const AGENT_START_REQUEST_TIMEOUT_MS =
  AGENT_START_TIMEOUT_MS + HERDR_REQUEST_TIMEOUT_MS;

/**
 * A worktree open, narrowed to the three fields this feature reads. Herdr's
 * socket-API doc tells clients to ignore unknown fields, so the parsing below
 * narrows the `worktree_opened` result rather than mirroring its schema.
 */
export interface HerdrWorktreeOpen {
  workspaceId: string;
  paneId: string;
  alreadyOpen: boolean;
}

export interface HerdrAgentStartOptions {
  /** Agent name, which Herdr requires to be unique among live agents. */
  name: string;
  /** The `herdr.agent` value, passed through unvalidated against any kind list
   *  so Herdr is the one that rejects an unknown kind (D10). */
  kind: string;
  /** The pane the space was built around, from the open's `root_pane`. */
  paneId: string;
}

export interface HerdrOpenOptions {
  /** Absolute path of the worktree checkout to adopt. */
  path: string;
  /** Absolute path of the git root, passed as `--cwd` so the open resolves
   *  against the repository the command ran in rather than the active
   *  workspace. */
  gitRootPath: string;
  /** Space label — the branch name, because Herdr labels every checkout of a
   *  repository with the repository name otherwise. */
  label: string;
  focus: boolean;
}

/**
 * One worktree in a `worktree list`, narrowed to the two fields the closer
 * reads. Herdr's socket-API doc tells clients to ignore unknown fields, so
 * `branch`, `label`, `is_bare`, `is_detached`, `is_linked_worktree` and
 * `is_prunable` are all dropped here rather than mirrored.
 */
export interface HerdrWorktreeEntry {
  /** Absolute checkout path — what a caller matches its own removals against. */
  path: string;
  /** The space this checkout is open in, absent when none is (D9). */
  workspaceId?: string;
}

export interface HerdrWorktreeList {
  /**
   * The space the repository's own checkout is open in. Absent when Herdr has
   * never opened this repository — verified 2026-09-11 against 0.8.2, where a
   * fresh `git init` listed successfully with no `source_workspace_id` at all.
   * It is what D7 guards against closing.
   */
  sourceWorkspaceId?: string;
  worktrees: HerdrWorktreeEntry[];
}

export interface HerdrListOptions {
  /** Absolute path of the git root, passed as `--cwd` for the same reason the
   *  open passes it: without it Herdr resolves against the *focused*
   *  workspace's repository, which on a machine with several repos open is
   *  whichever space was last clicked. */
  gitRootPath: string;
}

/**
 * An error Herdr itself reported, carrying its machine-readable `code`. Callers
 * branch on `code`, never on `message`: the codes are part of the protocol and
 * the messages are not.
 */
export class HerdrError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(`Herdr: ${message} (${code})`, options);
    this.name = "HerdrError";
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Herdr: could not parse response as JSON: ${raw}`, {
      cause: error,
    });
  }
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

interface HerdrErrorBody {
  code: string;
  message: string;
}

function readErrorBody(envelope: unknown): HerdrErrorBody | undefined {
  if (!isRecord(envelope)) {
    return undefined;
  }

  const { error } = envelope;

  if (!isRecord(error)) {
    return undefined;
  }

  const { code, message } = error;

  if (typeof code !== "string" || typeof message !== "string") {
    return undefined;
  }

  return { code, message };
}

function describeCommand(args: string[]): string {
  return `\`${HERDR_EXECUTABLE} ${args.join(" ")}\``;
}

/**
 * Turns a non-zero exit into an error. Herdr writes its error envelope to
 * stderr and exits 1, so that is the documented path; anything else — notably
 * whatever a stopped server produces, which is unverified — is surfaced
 * verbatim rather than collapsed into a generic message.
 */
function toHerdrError(args: string[], stderr: string, exitCode: number): Error {
  const envelope = tryParseJson(stderr);
  const errorBody = readErrorBody(envelope);

  if (errorBody) {
    return new HerdrError(errorBody.code, errorBody.message, {
      cause: envelope,
    });
  }

  return new Error(
    `Herdr: ${describeCommand(args)} exited with code ${exitCode}${
      stderr ? `: ${stderr}` : ""
    }`,
  );
}

/**
 * Turns a rejection from the runner into something worth printing.
 *
 * A bounded call that expires arrives here as a killed child, and Node's own
 * message for one is `Command failed: <argv>` — which names neither the timeout
 * nor how long it was. The seam prints `error.message` verbatim
 * (`src/lib/base-command.ts`), so leaving it alone would report a hang as an
 * unexplained failure, and an unexplained failure is the signal F-041 says is
 * missing in the first place.
 *
 * Only the kill is reworded. Anything else — a `herdr` that is not on PATH, a
 * maxBuffer overflow — is already specific and is passed through untouched.
 */
function toRunnerError(
  args: string[],
  timeoutMs: number,
  error: unknown,
): Error {
  // A signal kill reports no exit code at all; maxBuffer reports a string one,
  // which is why `code === null` rather than a falsy check separates them.
  const timedOut =
    isRecord(error) && error.killed === true && error.code === null;

  if (!timedOut) {
    return error instanceof Error ? error : new Error(String(error));
  }

  return new Error(
    `Herdr: ${describeCommand(args)} did not answer within ${
      timeoutMs / 1000
    }s.`,
    { cause: error },
  );
}

/**
 * Runs a `herdr` subcommand that answers with the socket-API envelope and
 * returns its `result` for narrowing.
 *
 * Every request is bounded. A child killed on timeout leaves no exit code, so
 * `runCapturing` rejects rather than resolving — callers already treat a throw
 * as the failure case, and a hang is one. `toRunnerError` is what makes that
 * throw say so.
 */
async function runHerdrRequest(
  args: string[],
  timeoutMs: number = HERDR_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
  let stdout: string;
  let stderr: string;
  let exitCode: number;

  try {
    ({ stdout, stderr, exitCode } = await runCapturing(HERDR_EXECUTABLE, args, {
      timeout: timeoutMs,
    }));
  } catch (error) {
    throw toRunnerError(args, timeoutMs, error);
  }

  if (exitCode !== 0) {
    throw toHerdrError(args, stderr, exitCode);
  }

  const envelope = parseJson(stdout);

  if (!isRecord(envelope) || !isRecord(envelope.result)) {
    throw new Error(
      `Herdr: ${describeCommand(args)} returned no result object: ${stdout}`,
    );
  }

  return envelope.result;
}

/**
 * Whether the `herdr` binary is on PATH. That is the whole check, and the name
 * says so: it proves Herdr is installed and nothing about whether its server is
 * up.
 *
 * A `herdr status server --json` probe used to run here as well. It was dropped
 * (F-040): it spawned a second process on every open, and it collapsed whatever
 * Herdr said about a dead server into a bare `false`, so the seam could only
 * print a generic line for exactly the case a reader most needs the detail.
 * Liveness is `openHerdrWorktree`'s business instead — a stopped server fails
 * the open, and that failure arrives carrying Herdr's own `code` and `message`
 * through `toHerdrError`, which is what D5 asks the seam to print.
 */
export async function isHerdrInstalled(): Promise<boolean> {
  return commandExists(HERDR_EXECUTABLE);
}

function readWorktreeOpen(result: unknown): HerdrWorktreeOpen {
  if (!isRecord(result)) {
    throw new Error("Herdr: `worktree open` returned no result object.");
  }

  const { workspace, root_pane: rootPane, already_open: alreadyOpen } = result;

  if (!isRecord(workspace) || typeof workspace.workspace_id !== "string") {
    throw new Error("Herdr: `worktree open` returned no workspace id.");
  }

  if (!isRecord(rootPane) || typeof rootPane.pane_id !== "string") {
    throw new Error("Herdr: `worktree open` returned no root pane id.");
  }

  if (typeof alreadyOpen !== "boolean") {
    throw new Error(
      "Herdr: `worktree open` did not report whether the space was already open.",
    );
  }

  return {
    workspaceId: workspace.workspace_id,
    paneId: rootPane.pane_id,
    alreadyOpen,
  };
}

/**
 * Opens a worktree that already exists on disk as a Herdr space.
 *
 * `--path` and `--branch` are mutually exclusive and the callers all hold an
 * absolute path, so this always passes `--path`. Focus is explicit in both
 * directions rather than relying on the schema default, which is `false`.
 */
export async function openHerdrWorktree({
  path,
  gitRootPath,
  label,
  focus,
}: HerdrOpenOptions): Promise<HerdrWorktreeOpen> {
  const result = await runHerdrRequest([
    "worktree",
    "open",
    "--path",
    path,
    "--cwd",
    gitRootPath,
    "--label",
    label,
    focus ? "--focus" : "--no-focus",
  ]);

  return readWorktreeOpen(result);
}

/**
 * Turns a branch name into an agent name Herdr will accept — `[a-z][a-z0-9_-]`
 * up to 32 characters (§4.4).
 *
 * `sanitizeBranchName` in `src/lib/utils.ts` is deliberately not reused: its
 * `/[^\w\s-]/g` strip drops a `/` without putting a separator in its place, so
 * `feature/add-agent-mode` collapses to `featureadd-agent-mode`, and it leaves a
 * leading digit alone, so `178-automate-publishing` comes out invalid.
 *
 * A leading digit is prefixed rather than stripped: the ticket number is
 * usually the part that distinguishes one branch from the next, and dropping it
 * turns `178-automate` and `179-automate` into the same name — a collision, and
 * §5 already names collisions as the thing that goes wrong here.
 */
export function toHerdrAgentName(branchName: string): string {
  const slug = branchName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

  if (!slug) {
    return "worktree";
  }

  // Only the first character is constrained, so this is the whole of the fix.
  const named = /^[a-z]/.test(slug) ? slug : `wt-${slug}`;

  // Trailing separators are legal, but truncation is what tends to leave one,
  // and a name ending in `-` reads as though it were cut off — which it was.
  return named.slice(0, AGENT_NAME_MAX_LENGTH).replace(/[-_]+$/, "");
}

/**
 * Starts an agent in a pane Herdr has already opened. Resolves when Herdr
 * reports the agent interactive-ready, and rejects with what Herdr said
 * otherwise — the caller decides how loud that is, and the seam treats it as a
 * warning because the space is already open by then (§5).
 *
 * Nothing is read from the response: `agent_started` answers with the pane's
 * `AgentInfo` and the `argv` it ran, and this feature needs neither.
 */
export async function startHerdrAgent({
  name,
  kind,
  paneId,
}: HerdrAgentStartOptions): Promise<void> {
  await runHerdrRequest(
    [
      "agent",
      "start",
      name,
      "--kind",
      kind,
      "--pane",
      paneId,
      "--timeout",
      String(AGENT_START_TIMEOUT_MS),
    ],
    AGENT_START_REQUEST_TIMEOUT_MS,
  );
}

/**
 * A workspace id, or `undefined` when the field names no space.
 *
 * D9 assumed Herdr reports `null` for a checkout with no space open. Verified
 * 2026-09-11 against 0.8.2, it is stronger than that: the key is **omitted
 * entirely**. Both land here, and so does an empty string, which names nothing
 * closable. A missing space is not an error and prints nothing (D9).
 */
function readOptionalWorkspaceId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Narrows one `worktrees[]` entry.
 *
 * A path is required rather than skipped: the path is the only thing a caller
 * can match a removal against, so an entry without one would be dropped
 * silently and take its space with it — the orphan this feature exists to
 * prevent, with no signal that it happened. A throw is a warning at the seam
 * (D5), which is the louder of the two and still exits 0.
 */
function readWorktreeEntry(entry: unknown, index: number): HerdrWorktreeEntry {
  if (!isRecord(entry)) {
    throw new Error(
      `Herdr: \`worktree list\` returned a worktree that is not an object at index ${index}.`,
    );
  }

  const { path, open_workspace_id: openWorkspaceId } = entry;

  if (typeof path !== "string") {
    throw new Error(
      `Herdr: \`worktree list\` returned a worktree with no path at index ${index}.`,
    );
  }

  return { path, workspaceId: readOptionalWorkspaceId(openWorkspaceId) };
}

function readWorktreeList(result: unknown): HerdrWorktreeList {
  if (!isRecord(result)) {
    throw new Error("Herdr: `worktree list` returned no result object.");
  }

  const { worktrees, source } = result;

  if (!Array.isArray(worktrees)) {
    throw new Error("Herdr: `worktree list` returned no worktrees array.");
  }

  return {
    sourceWorkspaceId: isRecord(source)
      ? readOptionalWorkspaceId(source.source_workspace_id)
      : undefined,
    worktrees: worktrees.map(readWorktreeEntry),
  };
}

/**
 * Lists the repository's git worktrees as Herdr sees them, each with the space
 * it is open in.
 *
 * One call answers for a whole run, which is why it is a list rather than a
 * lookup per worktree: `cleanup` removes a set, and that would be N subprocesses
 * where one does (D2). The listing is repo-scoped and derived from git's own
 * worktrees, so it has to be read **before** the removal — `git worktree remove`
 * and `git worktree prune` take the entry out of this answer too.
 */
export async function listHerdrWorktrees({
  gitRootPath,
}: HerdrListOptions): Promise<HerdrWorktreeList> {
  const result = await runHerdrRequest([
    "worktree",
    "list",
    "--cwd",
    gitRootPath,
  ]);

  return readWorktreeList(result);
}

/**
 * Closes one Herdr space by id.
 *
 * `herdr workspace close <workspace_id>` takes a bare positional and no options
 * (verified 2026-09-11 on 0.8.2). *Not* `herdr worktree remove --workspace`,
 * whose own help calls it *Remove a worktree checkout* — by the time this runs
 * the checkout is already gone, so that would ask Herdr to redo finished work
 * against a path that no longer exists (D1).
 *
 * Nothing is read from the response. `workspace.close` has no result variant of
 * its own in the bundled API schema and answers with the generic `{"type":"ok"}`
 * — a `result` object all the same, which is what `runHerdrRequest` requires.
 */
export async function closeHerdrWorkspace(workspaceId: string): Promise<void> {
  await runHerdrRequest(["workspace", "close", workspaceId]);
}
