import { execFile, spawn } from "node:child_process";

interface ExecOptions {
  cwd?: string;
  /**
   * Milliseconds after which the child is killed with SIGTERM. A kill leaves no
   * exit code behind — `error.code` comes back `null`, not a number — so a
   * timed-out call always rejects, under both helpers below.
   *
   * Left unset the child is unbounded, which is what every git call here wants:
   * they talk to the filesystem and answer or fail on their own. It is a call
   * that waits on another process's socket that needs this.
   */
  timeout?: number;
}

interface RunOptions extends ExecOptions {
  /**
   * Trim the captured stdout. True is what almost every caller wants — git
   * answers a single value with a trailing newline. Pass false when the output
   * is a delimited stream rather than one value: `git ls-files -z` sorts a path
   * whose first component starts with a space ahead of every other, and
   * trimming would silently rename it to one that does not exist.
   *
   * This option is `run`'s alone. `runCapturing` below always trims, so it
   * takes the narrower ExecOptions rather than accepting a `trim` it ignores.
   */
  trim?: boolean;
}

interface SpawnDetachedOptions {
  cwd?: string;
  onError?: (error: Error) => void;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// execFile takes an argv array, so no value passed here is ever parsed as shell
// syntax, and cwd reaches the child directly instead of through a `cd` prefix.
export function run(
  file: string,
  args: string[] = [],
  { cwd, timeout, trim = true }: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      const output = stdout ?? "";
      resolve(trim ? output.trim() : output);
    });
  });
}

/**
 * Capturing sibling of run(): a non-zero exit resolves rather than rejects, so
 * the caller keeps `stderr` and the exit code together instead of scraping them
 * out of an error message. That is what a CLI which reports failure as a
 * structured envelope on stderr needs — Herdr answers `worktree open` with
 * `{"error":{"code":…,"message":…}}` and exit 1, and `run` would discard the
 * envelope and surface only Node's wrapper text.
 *
 * The argv array is the point here too: nothing is word-split or glob-expanded.
 * Rejection is reserved for the cases that produce no exit code at all — a
 * process that never ran, one killed by a signal, and a `maxBuffer` overflow.
 * A `timeout` that expires is the second of those: the child is killed, so the
 * caller's `catch` is where a hung command surfaces, never a resolved result
 * carrying some sentinel code.
 */
export function runCapturing(
  file: string,
  args: string[] = [],
  { cwd, timeout }: ExecOptions = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd, timeout }, (error, stdout, stderr) => {
      const output = { stdout: stdout.trim(), stderr: stderr.trim() };

      if (!error) {
        resolve({ ...output, exitCode: 0 });
        return;
      }
      if (typeof error.code === "number") {
        resolve({ ...output, exitCode: error.code });
        return;
      }
      reject(error);
    });
  });
}

/**
 * Looks up one program name, verbatim. It is not given a command line: every
 * caller splits first — the two validators through `splitCommandValue`, so a
 * quoted program path containing a space arrives here as one name rather than
 * truncated at its first space, which is what makes validation agree with
 * execution.
 */
export async function commandExists(command: string): Promise<boolean> {
  try {
    // Use 'which' on *nix, 'where' on Windows
    const checkCommand = process.platform === "win32" ? "where" : "which";
    await run(checkCommand, [command]);
    return true;
  } catch {
    return false;
  }
}

// Fire-and-forget sibling of run(): the child outlives this process, so it is
// detached, its stdio is ignored and it is unref'd — none of which execFile can
// express. The argv array is the point here too, so a prompt full of quotes is
// one argument rather than shell syntax. A failed launch arrives as an "error"
// event, and an unhandled one on a ChildProcess throws, so a handler is always
// attached even when the caller supplies none.
export function spawnDetached(
  file: string,
  args: string[] = [],
  { cwd, onError }: SpawnDetachedOptions = {},
): void {
  const child = spawn(file, args, { cwd, detached: true, stdio: "ignore" });
  child.on("error", (error: Error) => onError?.(error));
  child.unref();
}
