import { constants } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join, relative } from "node:path";
import { runCapturing } from "../lib/cli.js";

const REX_EXECUTABLE = "rex";

/** Where Rex Beta puts the CLI inside the app bundle, below `/Applications/Rex*.app`. */
const BUNDLE_CLI_PATH = "Contents/Helpers/Rex Server.rex/Contents/MacOS/rex";
const APPLICATIONS_DIR = "/Applications";

/**
 * How long this process waits for one `rex` call before killing it and
 * reporting the failure (#270 §2: every call is bounded).
 *
 * Rex bounds its own connection and non-streaming requests at 10 s
 * (`--timeout`, default 10s on 0.1.0), and says so in its own words when that
 * fires. This is the backstop beneath it, set a little higher on purpose so
 * Rex's message is the one that arrives when Rex is merely slow, and ours only
 * when the process itself hangs. Observed on 0.1.0 (1829): `ls`, `block ls`,
 * `block call` and `kill` each answer in about 40 ms, so the slack is for a
 * server that is busy, not for a call that is expected to be slow. A false
 * timeout warns about a space that may in fact have closed, the more confusing
 * failure of the two.
 */
const REX_REQUEST_TIMEOUT_MS = 15_000;

/** How many sessions a lookup asks about at once. Small: it is a local socket. */
const LOOKUP_CONCURRENCY = 4;

/** The block creator that makes a terminal; any other block has no shell to ask. */
const TERMINAL_CREATOR = "com.superlogical.terminal";

/**
 * An error Rex itself reported, or the reason a call to it did not finish.
 * Callers branch on `timedOut` and `exitCode`, never on `message`: a timed-out
 * `new` may have succeeded (D4), which is a different thing to do next than a
 * refusal.
 */
export class RexError extends Error {
  /** The CLI's exit code, absent when the call never produced one. */
  readonly exitCode?: number;
  /** True when this process killed the call for taking too long. */
  readonly timedOut: boolean;

  constructor(
    message: string,
    options: ErrorOptions & { exitCode?: number; timedOut?: boolean } = {},
  ) {
    super(`Rex: ${message}`, options);
    this.name = "RexError";
    this.exitCode = options.exitCode;
    this.timedOut = options.timedOut ?? false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// --- Finding the CLI (D3) ----------------------------------------------------

async function isExecutableFile(file: string): Promise<boolean> {
  try {
    if (!(await stat(file)).isFile()) {
      return false;
    }
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export interface LocateOptions {
  env?: Record<string, string | undefined>;
  /** Where to look for `Rex*.app`. Only a test changes it. */
  applicationsDir?: string;
}

/**
 * The CLI's path, in D3's order: `rex` on PATH, then `$REX_BIN_DIR/rex` (set
 * inside a Rex terminal), then the macOS app bundle by glob. The first that is
 * an executable file wins. Not cached; `findRexExecutable` is the cached one.
 *
 * The bundle layout is a beta-layout guess (#270 §9): a different layout makes
 * the CLI "not installed", which hides the opener rather than breaking it.
 */
export async function locateRexExecutable({
  env = process.env,
  applicationsDir = APPLICATIONS_DIR,
}: LocateOptions = {}): Promise<string | undefined> {
  const candidates: string[] = (env.PATH ?? "")
    .split(delimiter)
    .filter((dir) => dir.length > 0)
    .map((dir) => join(dir, REX_EXECUTABLE));

  if (env.REX_BIN_DIR) {
    candidates.push(join(env.REX_BIN_DIR, REX_EXECUTABLE));
  }

  for (const candidate of candidates) {
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  let entries: string[];
  try {
    entries = await readdir(applicationsDir);
  } catch {
    // No such directory (not macOS, or not readable): nothing to glob.
    return undefined;
  }

  for (const entry of entries
    .filter((name) => /^Rex.*\.app$/.test(name))
    .sort()) {
    const candidate = join(applicationsDir, entry, BUNDLE_CLI_PATH);
    if (await isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

let cachedExecutable: Promise<string | undefined> | undefined;

/** `locateRexExecutable` once per process (D3). */
export function findRexExecutable(): Promise<string | undefined> {
  cachedExecutable ??= locateRexExecutable();
  return cachedExecutable;
}

/**
 * Whether the Rex CLI can be found. Proves the binary exists and nothing about
 * whether the server is up: a stopped server fails the first call, carrying
 * Rex's own message (the same split `isHerdrInstalled` draws).
 */
export async function isRexInstalled(): Promise<boolean> {
  return (await findRexExecutable()) !== undefined;
}

// --- Running it --------------------------------------------------------------

/**
 * The command as a message names it. Everything after `--` is a program to run,
 * and its last argument is the brief (D7): up to 128 KiB of whatever the caller
 * wrote, on its way to stderr and the `--json` `warnings`. So only the program
 * is named, and the rest by count and size, never quoted (#72). Done here so no
 * error path can forget: everything in this file that prints a command comes
 * through it.
 */
function describeCommand(args: string[]): string {
  const separator = args.indexOf("--");
  if (separator === -1) {
    return `\`${REX_EXECUTABLE} ${args.join(" ")}\``;
  }

  const [program, ...rest] = args.slice(separator + 1);
  const bytes = rest.reduce(
    (sum, arg) => sum + Buffer.byteLength(arg, "utf8"),
    0,
  );
  const tail =
    rest.length > 0 ? ` <${rest.length} arguments, ${bytes} bytes>` : "";

  return `\`${REX_EXECUTABLE} ${args.slice(0, separator + 1).join(" ")} ${program ?? ""}${tail}\``;
}

/**
 * Rex's own words, with the brief taken out in case it echoes its argv. The
 * brief is the last argument after `--` and comes after the program, so a
 * single trailing argument is a program's, not a brief.
 */
function redactBrief(args: string[], text: string): string {
  const separator = args.indexOf("--");
  const command = separator === -1 ? [] : args.slice(separator + 1);
  const brief = command.length > 1 ? command[command.length - 1] : undefined;

  return brief ? text.replaceAll(brief, "<brief>") : text;
}

/**
 * Turns a rejection from the runner into something worth printing: a killed
 * child is reworded with the timeout, and a death on a signal this process did
 * not send is named without Node's `Command failed: <argv>`, which would quote
 * a brief. None of these keeps Node's error as a `cause`, for the same reason.
 */
function toRunnerError(
  args: string[],
  timeoutMs: number,
  error: unknown,
): Error {
  if (isRecord(error) && error.code === null) {
    if (error.killed === true) {
      return new RexError(
        `${describeCommand(args)} did not answer within ${timeoutMs / 1000}s.`,
        // No `cause`: it is Node's error, whose message and `cmd` carry the argv.
        { timedOut: true },
      );
    }

    if (error.signal) {
      return new RexError(
        `${describeCommand(args)} was killed by ${String(error.signal)}.`,
      );
    }
  }

  // Node's own error (no such file, a maxBuffer overflow) carries the argv in
  // its message and `cmd`, so it is named by its code and not passed on.
  const code =
    isRecord(error) && nonEmptyString(error.code)
      ? error.code
      : "an unknown error";

  return new RexError(`${describeCommand(args)} failed: ${code}.`);
}

async function runRex(args: string[]): Promise<string> {
  const executable = await findRexExecutable();

  if (!executable) {
    throw new RexError("the `rex` command was not found.");
  }

  let result: Awaited<ReturnType<typeof runCapturing>>;
  try {
    result = await runCapturing(executable, args, {
      timeout: REX_REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    throw toRunnerError(args, REX_REQUEST_TIMEOUT_MS, error);
  }

  if (result.exitCode !== 0) {
    const detail = result.stderr ? `: ${redactBrief(args, result.stderr)}` : "";

    throw new RexError(
      `${describeCommand(args)} exited with code ${result.exitCode}${detail}`,
      { exitCode: result.exitCode },
    );
  }

  return result.stdout;
}

async function runRexJson(args: string[]): Promise<unknown> {
  const stdout = await runRex(args);

  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new RexError(
      `${describeCommand(args)} did not answer with JSON (${stdout.length} characters).`,
      { cause: error },
    );
  }
}

// --- Opening, selecting, closing ---------------------------------------------

export interface RexOpenOptions {
  /** Absolute path of the worktree checkout, the session's working directory. */
  path: string;
  /** Session label — the branch name, as for Herdr. */
  label: string;
  /**
   * The program the session runs instead of a shell, then its arguments, the
   * brief last (D7). Each element travels as one argv element after `--`;
   * absent, the session is a plain shell.
   */
  command?: string[];
}

export interface RexOpenedSession {
  sessionId: string;
  /** The session's first terminal, from `initial_windows[0].block_ids[0]`. */
  blockId: string;
}

/**
 * Narrows `rex new --json` to the two ids this feature reads. Rex is beta and
 * its guide names no schema beyond these fields, so everything else is ignored.
 */
function readNewSession(result: unknown): RexOpenedSession {
  if (!isRecord(result)) {
    throw new RexError("`rex new` returned no result object.");
  }

  const { session_id: sessionId, initial_windows: windows } = result;

  if (!nonEmptyString(sessionId)) {
    throw new RexError("`rex new` returned no session id.");
  }

  const firstWindow = Array.isArray(windows) ? windows[0] : undefined;
  const blockIds = isRecord(firstWindow) ? firstWindow.block_ids : undefined;
  const blockId = Array.isArray(blockIds) ? blockIds[0] : undefined;

  if (!nonEmptyString(blockId)) {
    throw new RexError("`rex new` returned no block id for the first window.");
  }

  return { sessionId, blockId };
}

/**
 * Opens a session at the worktree: `rex new <label> -c <path> --json`, with
 * `-- <command…>` when an agent is to start with it (D4, D7).
 *
 * **A timeout is not retried** and is not turned into an answer: Rex's guide
 * says a timed-out `new` may have succeeded, so the caller looks the session up
 * (`findRexSessions`) before reporting anything. The error says it timed out
 * through `timedOut`.
 *
 * The login shell wrapper is left on (no `--shell=none`): the program has to be
 * found through the user's own PATH, and the live probe of 2026-11-06 showed it
 * preserves every argument byte for byte.
 */
export async function openRexSession({
  path,
  label,
  command,
}: RexOpenOptions): Promise<RexOpenedSession> {
  // Rex puts the label where an option could be, and a branch cannot start with
  // `-` but this function is not given a branch.
  if (label.length === 0 || label.startsWith("-")) {
    throw new RexError("a session label must not be empty or start with `-`.");
  }

  const args = ["new", label, "-c", path, "--json"];
  if (command && command.length > 0) {
    args.push("--", ...command);
  }

  return readNewSession(await runRexJson(args));
}

/**
 * Asks the Rex app to show the session. `rex new` alone does not (the guide
 * says so). D5: `-C $REX_CLIENT` is passed when that variable is set (inside a
 * Rex terminal it names the client), and no `-C` otherwise, when Rex picks the
 * app if exactly one is connected and says so in its own words when several
 * are, which reaches the caller as this call's error.
 */
export async function selectRexSession(sessionId: string): Promise<void> {
  const client = process.env.REX_CLIENT;

  await runRex([
    ...(client ? ["-C", client] : []),
    "do",
    "session.select",
    `session_id=${sessionId}`,
  ]);
}

/**
 * Kills one session by the id `findRexSessions` gave. Closing cannot be
 * retried (the checkout is gone by then), so a rejection is the caller's to
 * warn about.
 */
export async function closeRexSession(sessionId: string): Promise<void> {
  if (!nonEmptyString(sessionId) || sessionId.startsWith("-")) {
    throw new RexError("a session id must not be empty or start with `-`.");
  }

  await runRex(["kill", sessionId]);
}

// --- Finding a worktree's session (D6) ---------------------------------------

function readSessionIds(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.sessions)) {
    throw new RexError("`rex ls` returned no sessions array.");
  }

  return result.sessions.map((session, index) => {
    if (!isRecord(session) || !nonEmptyString(session.session_id)) {
      throw new RexError(
        `\`rex ls\` returned a session with no id at index ${index}.`,
      );
    }
    return session.session_id;
  });
}

/** The ids of a session's terminal blocks; any other kind of block has no shell. */
function readTerminalBlockIds(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result.blocks)) {
    throw new RexError("`rex block ls` returned no blocks array.");
  }

  return result.blocks.flatMap((block, index) => {
    if (!isRecord(block) || !nonEmptyString(block.block_id)) {
      throw new RexError(
        `\`rex block ls\` returned a block with no id at index ${index}.`,
      );
    }
    return block.creator_name === TERMINAL_CREATOR ? [block.block_id] : [];
  });
}

/**
 * The directory of the foreground process, when `block call process` reports
 * one. Absent is legitimate (a terminal whose program has exited has none), a
 * non-object answer is not.
 */
function readProcessDirectory(result: unknown): string | undefined {
  if (!isRecord(result)) {
    throw new RexError("`rex block call process` returned no result object.");
  }

  const { foreground } = result;

  return isRecord(foreground) &&
    nonEmptyString(foreground.cwd) &&
    isAbsolute(foreground.cwd)
    ? foreground.cwd
    : undefined;
}

/**
 * The shell's own directory from `block call pwd`, which Rex reports as a file
 * URL (`file://<host>/<percent-encoded path>`, observed on 0.1.0).
 */
function readPwdDirectory(result: unknown): string {
  if (!isRecord(result) || !nonEmptyString(result.pwd)) {
    throw new RexError("`rex block call pwd` returned no pwd.");
  }

  // `fileURLToPath` refuses a host that is not empty or `localhost`, and Rex
  // puts the machine's own name there, so the URL is read by hand.
  try {
    const url = new URL(result.pwd);
    if (
      url.protocol === "file:" &&
      isAbsolute(decodeURIComponent(url.pathname))
    ) {
      return decodeURIComponent(url.pathname);
    }
  } catch (error) {
    throw new RexError("`rex block call pwd` did not return a file URL.", {
      cause: error,
    });
  }

  throw new RexError("`rex block call pwd` did not return a file URL.");
}

/**
 * A call Rex refused for one session or block — it vanished between the
 * listing and the question, say — is no answer for that one, which leaves it
 * unmatched and so open. A timeout is not: that is Rex not answering at all.
 */
function isRefusal(error: unknown): boolean {
  return (
    error instanceof RexError && !error.timedOut && error.exitCode !== undefined
  );
}

async function realPathOrSelf(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

/** Whether `directory` is `root` or below it, by path components, not by prefix. */
function isInside(directory: string, root: string): boolean {
  const rel = relative(root, directory);
  return (
    rel === "" || (rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel))
  );
}

async function readBlockDirectory(
  sessionId: string,
  blockId: string,
): Promise<string | undefined> {
  const target = ["block", "call", "-s", sessionId, "-b", blockId];

  try {
    const fromProcess = readProcessDirectory(
      await runRexJson([...target, "process"]),
    );

    return (
      fromProcess ?? readPwdDirectory(await runRexJson([...target, "pwd"]))
    );
  } catch (error) {
    if (isRefusal(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The worktrees (by their entry in `roots`) a session's shells are in. One
 * entry per shell that is inside one; a shell elsewhere adds none.
 */
async function worktreesOfSession(
  sessionId: string,
  roots: Array<{ path: string; real: string }>,
): Promise<{ matched: Set<string>; outside: boolean }> {
  let blockIds: string[];
  try {
    blockIds = readTerminalBlockIds(
      await runRexJson(["block", "ls", "-s", sessionId, "--json"]),
    );
  } catch (error) {
    if (isRefusal(error)) {
      return { matched: new Set(), outside: false };
    }
    throw error;
  }

  const directories = await Promise.all(
    blockIds.map((blockId) => readBlockDirectory(sessionId, blockId)),
  );

  const found = new Set<string>();
  let outside = false;
  for (const directory of directories) {
    // A shell whose directory could not be read is not known to be inside.
    if (directory === undefined) {
      outside = true;
      continue;
    }

    const real = await realPathOrSelf(directory);
    // The deepest root wins, so a worktree nested inside another is not read as
    // the outer one's.
    const match = roots
      .filter((root) => isInside(real, root.real))
      .sort((a, b) => b.real.length - a.real.length)[0];

    if (match) {
      found.add(match.path);
    } else {
      outside = true;
    }
  }

  return { matched: found, outside };
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );

  return results;
}

export interface RexFindOptions {
  /** Absolute worktree paths to look for. */
  paths: string[];
  /**
   * Closing (D11): also leave out a session with any shell outside every given
   * root, in a directory nothing asked about or one that could not be read.
   * Off for "is it open?", which a single shell in the worktree answers.
   */
  everyShellInside?: boolean;
}

/**
 * Maps each worktree path to the session that is its own (D6): list sessions,
 * list each one's terminal blocks, read each block's working directory, and
 * match real paths **inside** the worktree. A label is not an identity
 * (`rex ls` carries no directory, and two repositories can share a branch), a
 * working directory is.
 *
 * What is left out is deliberate, because the caller closes what this returns:
 * - a session none of whose shells is inside a worktree (they all moved away,
 *   or the session never was one's): not found, left open rather than guessed
 *   at;
 * - a session with shells in two different worktrees, which closing for one
 *   would take the other's with it;
 * - a second session in the same worktree: the first listed wins, since the
 *   seam maps a path to one id.
 *
 * Rejects when Rex does not answer or answers in a shape it does not
 * recognise. It does **not** exclude the session the CLI itself runs in: that
 * session is a fine answer to "is this worktree open?", and only the closer
 * has to skip it (D8).
 */
export async function findRexSessions({
  paths,
  everyShellInside = false,
}: RexFindOptions): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  if (paths.length === 0) {
    return found;
  }

  const roots = await Promise.all(
    paths.map(async (path) => ({ path, real: await realPathOrSelf(path) })),
  );
  const sessionIds = readSessionIds(await runRexJson(["ls", "--json"]));

  const perSession = await mapWithLimit(sessionIds, LOOKUP_CONCURRENCY, (id) =>
    worktreesOfSession(id, roots),
  );

  sessionIds.forEach((sessionId, index) => {
    const { matched: worktrees, outside } = perSession[index] ?? {
      matched: new Set<string>(),
      outside: false,
    };
    const [only] = worktrees;

    if (everyShellInside && outside) {
      return;
    }

    if (worktrees.size === 1 && only !== undefined && !found.has(only)) {
      found.set(only, sessionId);
    }
  });

  return found;
}
