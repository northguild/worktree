import fs from "node:fs";
import path from "node:path";
import { commandExists, runStreaming } from "./cli.js";
import { gitGetConfigValue } from "./git.js";
import { isNonInteractive } from "./interaction.js";
import { getProjectPostCreateSteps } from "./project-config.js";
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

export type InstallSource = "git-config" | "project" | "lockfile";

/**
 * What the install step did, in the shape `branch --json` reports as
 * `installed`. `reason` on a failed run says why the command did not succeed.
 */
export type InstallResult =
  | {
      ran: true;
      /** The step that failed, else the last one that ran (D18). */
      command: string;
      /** Every step that ran, in order, the failing one included. */
      steps: string[];
      /** Where the steps came from: git config, the project file or a lockfile. */
      from: InstallSource;
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
 * Decides whether to install in a new worktree and, if so, runs it (D9, D15).
 *
 * `install` is the `--[no-]install` flag. `false` always switches the step off.
 * Otherwise it runs when asked for (`true`), when the run is non-interactive, or
 * when a `postCreate` is set — an interactive run with none of those leaves the
 * tree alone, as every run did before this step existed.
 *
 * The steps are the personal `postCreate` (one command) when set, else the
 * project file's list, else one command inferred from the lockfile in the new
 * tree. Each runs by argv in that tree, never through a shell, with its output
 * on stderr and a 10 minute bound, and the first failure stops the rest. The
 * file's steps are approved by the caller before anything is created (D16); this
 * function does not ask. It never throws: a step that fails or times out is
 * `ok: false`, and the caller decides what that stops.
 */
export async function runInstall(
  worktreePath: string,
  install?: boolean,
): Promise<InstallResult> {
  if (install === false) {
    return { ran: false, reason: "--no-install was given" };
  }

  const personal = (await gitGetConfigValue("postCreate")).trim();
  const fromFile = personal ? [] : await getProjectPostCreateSteps();
  const configured = personal !== "" || fromFile.length > 0;
  if (install !== true && !isNonInteractive() && !configured) {
    return {
      ran: false,
      reason: "not requested: pass --install or set postCreate",
    };
  }

  let from: InstallSource;
  let steps: string[];
  if (personal) {
    from = "git-config";
    steps = [personal];
  } else if (fromFile.length > 0) {
    from = "project";
    steps = fromFile;
  } else {
    from = "lockfile";
    const inferred = inferCommand(worktreePath);
    steps = inferred ? [inferred] : [];
  }

  if (steps.length === 0) {
    return skipped(
      "no postCreate command is set and no lockfile was found to infer one from",
    );
  }

  // A single command that cannot start is a skipped install, as it always was.
  // In a list, one that cannot start is a failed step: the person asked for it.
  if (from !== "project") {
    const [program] = splitCommandValue(steps[0] ?? "");
    if (!program) {
      return skipped("postCreate holds no command");
    }
    if (!(await commandExists(program))) {
      return skipped(`${program} is not on PATH`);
    }
  }

  const ran: string[] = [];
  const inferred = from === "lockfile";
  for (const step of steps) {
    ran.push(step);
    const failure = await runStep(step, worktreePath);
    if (failure !== undefined) {
      return {
        ran: true,
        command: step,
        steps: ran,
        from,
        inferred,
        ok: false,
        reason: failure,
      };
    }
  }
  return {
    ran: true,
    command: ran[ran.length - 1] ?? "",
    steps: ran,
    from,
    inferred,
    ok: true,
  };
}

/** Runs one step; the reason it failed, or `undefined` when it succeeded. */
async function runStep(step: string, worktreePath: string) {
  const [program, ...args] = splitCommandValue(step);
  if (!program) {
    return "the step holds no command";
  }
  if (!(await commandExists(program))) {
    return `${program} is not on PATH`;
  }
  console.error(`Running ${step} in ${worktreePath}`);
  try {
    const { exitCode } = await runStreaming(program, args, {
      cwd: worktreePath,
      timeout: INSTALL_TIMEOUT_MS,
    });
    return exitCode === 0 ? undefined : `exited with code ${exitCode}`;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

// An install that was asked for and could not start is said out loud, on
// stderr, so a run that quietly skipped it is not mistaken for one that ran.
function skipped(reason: string): InstallResult {
  console.error(`Install skipped: ${reason}`);
  return { ran: false, reason };
}
