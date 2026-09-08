import { commandExists, runCommand } from "../lib/cli.js";

const HERDR_EXECUTABLE = "herdr";

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
