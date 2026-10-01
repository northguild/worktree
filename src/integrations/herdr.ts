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
  /**
   * Arguments for the agent itself, passed after `--`. Herdr types them into
   * the pane's shell with each one quoted, so they travel as separate argv
   * elements. **Never the brief** (D11): the pane is at a shell prompt while
   * this runs, and the brief goes through `promptHerdrAgent` once the agent is
   * up.
   */
  args?: string[];
}

export interface HerdrAgentPromptOptions {
  /** The pane the agent runs in. */
  paneId: string;
  /** The brief, delivered as one submission with its newlines intact. */
  text: string;
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
 * One agent in `herdr agent list`, narrowed to what the join with the runtime's
 * listing reads (D14). Only `cwd` is required: it is the join key.
 */
export interface HerdrAgentEntry {
  /** The agent kind Herdr reports, e.g. `claude`. */
  kind: string;
  cwd: string;
  /** The pane the agent runs in. */
  paneId?: string;
  /**
   * Herdr's name for the agent, which it reports for the ones it started — the
   * `toHerdrAgentName` handle. Absent for an agent Herdr merely detected.
   */
  name?: string;
  /** `idle`, `working`, `blocked`, `done` or `unknown`; passed through as given. */
  status?: string;
  /** The runtime's session id (`agent_session.value`), when Herdr knows it. */
  sessionId?: string;
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

/**
 * The command as a message names it. The text of an `agent prompt` is the
 * brief — up to 128 KiB of whatever the caller wrote — and these descriptions
 * reach stderr and the `--json` `warnings`, so it is named by its size and
 * never quoted (#72). Done here rather than at each call so no error path can
 * forget: everything in this file that prints a command comes through it.
 */
function describeCommand(args: string[]): string {
  const [group, verb, target, text] = args;
  const printed =
    group === "agent" && verb === "prompt" && text !== undefined
      ? [
          group,
          verb,
          target,
          `<brief, ${Buffer.byteLength(text, "utf8")} bytes>`,
        ]
      : args;

  return `\`${HERDR_EXECUTABLE} ${printed.join(" ")}\``;
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
 * A kill is reworded, and so is a death on a signal this process did not send
 * (an OOM kill, a crash): Node words both `Command failed: <argv>`, which would
 * quote a brief (#72). Anything else — a `herdr` that is not on PATH, a
 * maxBuffer overflow — is already specific, carries no argv, and is passed
 * through untouched.
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
    // `code === null` with a signal and no kill of ours. No `cause`: it would
    // carry Node's argv-bearing message to anything that prints the chain.
    if (isRecord(error) && error.code === null && error.signal) {
      return new Error(
        `Herdr: ${describeCommand(args)} was killed by ${String(error.signal)}.`,
      );
    }

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
  args = [],
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
      ...(args.length > 0 ? ["--", ...args] : []),
    ],
    AGENT_START_REQUEST_TIMEOUT_MS,
  );
}

/**
 * Submits a brief to the agent in a pane. Without `--wait`, so it returns once
 * Herdr has delivered the text: verified on 0.9.0 to arrive as one bracketed
 * paste, submitted once, with its newlines intact. The text is the last
 * positional and `agent prompt` takes no `--`, which is safe because a value
 * that starts with `-` is still read as the text when it follows the target.
 *
 * Callers start the agent first — `agent start` already waits, bounded, for it
 * to reach an interactive prompt, so this does not wait again.
 */
export async function promptHerdrAgent({
  paneId,
  text,
}: HerdrAgentPromptOptions): Promise<void> {
  await runHerdrRequest(["agent", "prompt", paneId, text]);
}

/**
 * The name the runtime session carries: `<repo>-<branch>`, lowercased, with
 * every run of characters outside `[a-z0-9-]` turned into one `-` (D12).
 *
 * Never truncated, unlike `toHerdrAgentName`: Herdr's 32-character cap is its
 * own handle's, and cutting this one would make two long branches collide on
 * the name another session addresses.
 */
export function toAgentSessionName(repo: string, branch: string): string {
  return `${repo}-${branch}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
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
 * A path is required rather than skipped, and the trade is worth stating
 * exactly (F-056). A path-less entry is unclosable either way — the path is the
 * only thing a caller matches a removal against — so skipping it would not lose
 * that one space; what the throw changes is that the *whole listing* rejects,
 * and the seam then closes nothing for the entire run rather than everything
 * but one.
 *
 * That is still the right way round, because `path` is required by Herdr's own
 * schema (`WorktreeInfo.required`): an entry without one is a protocol
 * violation, not a shape to tolerate quietly. The consequence is bounded by D5
 * — `BaseCommand.resolveSpaceCloser` turns it into a single warning and the
 * command still exits 0.
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

function readOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Narrows one `agents[]` entry. An entry without a `cwd` cannot be joined to a
 * worktree, so it is dropped rather than failing the listing: this is a lookup
 * the caller treats as best-effort, and one odd entry should not hide the rest.
 * The id is read only from an `agent_session` whose `kind` is `id` — the one
 * form observed — so another form degrades to an unjoined entry.
 */
function readAgentEntry(entry: unknown): HerdrAgentEntry | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }

  const cwd = readOptionalString(entry, "cwd");
  if (!cwd) {
    return undefined;
  }

  const session = entry.agent_session;

  return {
    kind: readOptionalString(entry, "agent") ?? "agent",
    cwd,
    paneId: readOptionalString(entry, "pane_id"),
    name: readOptionalString(entry, "name"),
    status: readOptionalString(entry, "agent_status"),
    sessionId:
      isRecord(session) && session.kind === "id"
        ? readOptionalString(session, "value")
        : undefined,
  };
}

/**
 * Lists every agent Herdr knows, across all spaces. Not scoped to a repository:
 * `agent list` takes no `--cwd`, and the caller joins on the working directory
 * anyway. Bounded like every other request, and a throw means no answer.
 */
export async function listHerdrAgents(): Promise<HerdrAgentEntry[]> {
  const result = await runHerdrRequest(["agent", "list"]);

  if (!isRecord(result) || !Array.isArray(result.agents)) {
    throw new Error("Herdr: `agent list` returned no agents array.");
  }

  return result.agents
    .map(readAgentEntry)
    .filter((entry): entry is HerdrAgentEntry => entry !== undefined);
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
