import { exec, execFile } from "node:child_process";

interface CmdOptions {
  debug?: boolean;
}

interface RunOptions {
  cwd?: string;
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

// Replaces cmd(): execFile takes an argv array, so no value passed here is ever
// parsed as shell syntax, and cwd reaches the child directly instead of through
// a `cd` prefix. Call sites migrate over in batches; cmd() goes when the last
// one is gone.
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
    await cmd(`${checkCommand} ${baseCommand}`);
    return true;
  } catch {
    return false;
  }
}
