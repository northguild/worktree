import { commandExists, runCommand } from "../lib/cli.js";

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
 * Runs a `herdr` subcommand that answers with the socket-API envelope and
 * returns its `result` for narrowing.
 */
async function runHerdrRequest(args: string[]): Promise<unknown> {
  const { stdout, stderr, exitCode } = await runCommand(HERDR_EXECUTABLE, args);

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
 * (F-003): it spawned a second process on every open, and it collapsed whatever
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
  await runHerdrRequest([
    "agent",
    "start",
    name,
    "--kind",
    kind,
    "--pane",
    paneId,
    "--timeout",
    String(AGENT_START_TIMEOUT_MS),
  ]);
}
