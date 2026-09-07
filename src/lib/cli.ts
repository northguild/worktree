import { exec, execFile } from "node:child_process";

interface CmdOptions {
  debug?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function cmd(
  cmd: string,
  { debug = false }: CmdOptions = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (debug) {
      console.log(`DEBUG: ${cmd}`);
      resolve("");
      return;
    }
    exec(cmd, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout?.trim() ?? "");
    });
  });
}

/**
 * Runs an executable with an explicit argument vector. No shell is involved, so
 * nothing in `args` is word-split, glob-expanded or interpreted — a path
 * containing a space, a quote or a `;` arrives at the executable intact.
 *
 * Unlike `cmd`, a non-zero exit resolves rather than rejects, so the caller
 * keeps `stderr` and the exit code together instead of scraping them out of an
 * error message. Rejection is reserved for the cases that produce no exit code
 * at all: a process that never ran, one killed by a signal, and a `maxBuffer`
 * overflow.
 */
export function runCommand(
  executable: string,
  args: string[] = [],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, (error, stdout, stderr) => {
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

export async function commandExists(command: string): Promise<boolean> {
  try {
    // Extract the base command
    const baseCommand = command.split(" ")[0];

    // Use 'which' on *nix, 'where' on Windows
    const checkCommand = process.platform === "win32" ? "where" : "which";
    await cmd(`${checkCommand} ${baseCommand}`);
    return true;
  } catch {
    return false;
  }
}
