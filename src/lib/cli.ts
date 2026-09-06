import { execFile, spawn } from "node:child_process";

interface RunOptions {
  cwd?: string;
}

interface SpawnDetachedOptions {
  cwd?: string;
  onError?: (error: Error) => void;
}

// execFile takes an argv array, so no value passed here is ever parsed as shell
// syntax, and cwd reaches the child directly instead of through a `cd` prefix.
export function run(
  file: string,
  args: string[] = [],
  { cwd }: RunOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { cwd }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout?.trim() ?? "");
    });
  });
}

export async function commandExists(command: string): Promise<boolean> {
  try {
    // Extract the base command
    const baseCommand = command.split(" ")[0];

    // Use 'which' on *nix, 'where' on Windows
    const checkCommand = process.platform === "win32" ? "where" : "which";
    await run(checkCommand, [baseCommand]);
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
