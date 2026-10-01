import fs from "node:fs";
import path from "node:path";
import { commandExists, runStreaming } from "./cli.js";
import { gitGetConfigValue } from "./git.js";
import { isNonInteractive } from "./interaction.js";
import { splitCommandValue } from "./utils.js";

/** D5: an install can legitimately take minutes, but not unboundedly long. */
export const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Lockfile to command, first match wins. The commands are the reproducible
 * form where the tool has one. `yarn install` carries no lock flag because
 * classic and berry disagree on it, and `bun.lockb` (the old binary lockfile)
 * is deliberately not recognised.
 */
const LOCKFILE_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["pnpm-lock.yaml", "pnpm install --frozen-lockfile"],
  ["package-lock.json", "npm ci"],
  ["yarn.lock", "yarn install"],
  ["bun.lock", "bun install --frozen-lockfile"],
];

/**
 * What the install step did, in the shape `branch --json` reports as
 * `installed`. `reason` on a failed run says why the command did not succeed.
 */
export type InstallResult =
  | {
      ran: true;
      command: string;
      inferred: boolean;
      ok: boolean;
      reason?: string;
    }
  | { ran: false; reason: string };

function inferCommand(worktreePath: string) {
  return LOCKFILE_COMMANDS.find(([lockfile]) =>
    fs.existsSync(path.join(worktreePath, lockfile)),
  )?.[1];
}

/**
 * Decides whether to install in a new worktree and, if so, runs it (D9).
 *
 * `install` is the `--[no-]install` flag. `false` always switches the step off.
 * Otherwise it runs when asked for (`true`), when the run is non-interactive, or
 * when `postCreate` is set — an interactive run with none of those leaves the
 * tree alone, as every run did before this step existed.
 *
 * The command is `postCreate` when set, else inferred from the lockfile in the
 * new tree. It runs by argv in that tree, never through a shell, with its output
 * on stderr and a 10 minute bound. It never throws: a command that fails or
 * times out is `ok: false`, and the caller decides what that stops.
 */
export async function runInstall(
  worktreePath: string,
  install?: boolean,
): Promise<InstallResult> {
  if (install === false) {
    return { ran: false, reason: "--no-install was given" };
  }

  const postCreate = (await gitGetConfigValue("postCreate")).trim();
  if (install !== true && !isNonInteractive() && !postCreate) {
    return {
      ran: false,
      reason: "not requested: pass --install or set postCreate",
    };
  }

  const command = postCreate || inferCommand(worktreePath);
  if (!command) {
    return skipped(
      "no postCreate command is set and no lockfile was found to infer one from",
    );
  }

  const [program, ...args] = splitCommandValue(command);
  if (!program) {
    return skipped("postCreate holds no command");
  }
  if (!(await commandExists(program))) {
    return skipped(`${program} is not on PATH`);
  }

  const inferred = !postCreate;
  console.error(`Running ${command} in ${worktreePath}`);
  try {
    const { exitCode } = await runStreaming(program, args, {
      cwd: worktreePath,
      timeout: INSTALL_TIMEOUT_MS,
    });
    return exitCode === 0
      ? { ran: true, command, inferred, ok: true }
      : {
          ran: true,
          command,
          inferred,
          ok: false,
          reason: `exited with code ${exitCode}`,
        };
  } catch (error) {
    return {
      ran: true,
      command,
      inferred,
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

// An install that was asked for and could not start is said out loud, on
// stderr, so a run that quietly skipped it is not mistaken for one that ran.
function skipped(reason: string): InstallResult {
  console.error(`Install skipped: ${reason}`);
  return { ran: false, reason };
}
