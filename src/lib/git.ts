import fs from "node:fs";
import { EOL } from "node:os";
import path from "node:path";
import { confirm } from "@inquirer/prompts";
import Process from "cli-progress";
import ora from "ora";
import { run } from "./cli.js";
import type {
  ConfigName,
  WorktreeListBaseEntry,
  WorktreeListEntry,
} from "./types.js";
import { strToNum } from "./utils.js";

export async function gitGetConfigValue(name: ConfigName) {
  try {
    return await run("git", ["config", `northguild.worktree.${name}`]);
  } catch {
    return "";
  }
}

// The value is an argv element, so a config value carrying quotes, backticks or
// semicolons is stored literally instead of being parsed as shell syntax.
export async function gitSetConfigValue(name: ConfigName, value: string) {
  await run("git", ["config", `northguild.worktree.${name}`, value]);
}

async function gitCmdShowTopLevel() {
  return run("git", ["rev-parse", "--show-toplevel"]);
}

async function gitCmdGitPath() {
  return run("git", ["rev-parse", "--absolute-git-dir"]);
}

export async function gitFetch() {
  return run("git", ["fetch", "--prune"]);
}

export async function gitGetRootPath() {
  try {
    const topLevelPath = await gitCmdShowTopLevel();
    if (!topLevelPath.includes(".worktrees/")) {
      return topLevelPath;
    }
    const gitPathResult = await gitCmdGitPath();
    const gitPath = gitPathResult.split("/.git")[0];
    return gitPath;
  } catch {
    throw new Error(
      `Git: Unable find the root path. Are you in a git repository?`,
    );
  }
}

function parseGetBranchesResult(result: string) {
  return result
    .split(EOL)
    .map((branch) => branch.trim())
    .filter(Boolean)
    .map((branch) => branch.replace(/^[*+]\s+/, ""))
    .filter((branch) => !branch.includes(" -> "));
}

export async function gitGetLocalBranches() {
  const res = await run("git", ["--no-pager", "branch"]);
  return parseGetBranchesResult(res);
}

export async function gitGetRemoteBranches() {
  await gitFetch();
  const res = await run("git", ["--no-pager", "branch", "-r"]);
  return parseGetBranchesResult(res);
}

export async function getCurrentBranchName() {
  return await run("git", ["branch", "--show-current"]);
}

export async function gitGetAbsoluteWorktreesPath() {
  const gitRootPath = await gitGetRootPath();
  return `${gitRootPath}.worktrees`;
}

export async function gitGetCommitsAheadCount(branchPath: string) {
  const countStr = await run("git", ["rev-list", "--count", "@{u}..HEAD"], {
    cwd: branchPath,
  });
  if (countStr) {
    return strToNum(countStr);
  }
}

export async function gitGetCommitsBehindCount(branchPath: string) {
  const countStr = await run("git", ["rev-list", "--count", "HEAD..@{u}"], {
    cwd: branchPath,
  });
  if (countStr) {
    return strToNum(countStr);
  }
}

export async function gitGetUncommittedChangesCount(branchPath: string) {
  const result = await run("git", ["status", "-s"], { cwd: branchPath });
  return result ? result.split(EOL).length : 0;
}

export async function gitGetLocalBranchesTracking() {
  // The format is one argv element, so the single quotes the shell form needed
  // around its spaces are gone rather than being passed on to git literally.
  const res = await run("git", [
    "for-each-ref",
    "--format=%(refname:short) <- %(upstream:short)",
    "refs/heads",
  ]);
  return res.split(EOL).map((branch) => {
    const [local, remote] = branch
      .trim()
      .split("<-")
      .map((b) => b.trim());

    return {
      local,
      remote,
    };
  });
}

interface GitGetWorktreesOptions {
  includeCurrent?: boolean;
}

export async function gitGetWorktrees({
  includeCurrent = false,
}: GitGetWorktreesOptions = {}): Promise<WorktreeListBaseEntry[]> {
  const currentBranch = await getCurrentBranchName();
  const worktreesRootPath = await gitGetAbsoluteWorktreesPath();
  const result = await run("git", ["worktree", "list"]);

  return (
    result
      .split(EOL)
      .map((line) => {
        const [path, _, branchStr] = line.replace(/\s\s+/g, " ").split(" ");
        const branchName = branchStr.slice(1, -1);
        const isCurrent = branchName === currentBranch;
        const pathExists = fs.existsSync(path);
        return { path, branchName, pathExists, isCurrent };
      })
      // Filter out any branches that are not worktree branches, and also skip the current branch
      .filter(
        ({ path, isCurrent }) =>
          path.startsWith(worktreesRootPath) && (includeCurrent || !isCurrent),
      )
  );
}

export function isSafeToRemove(wt: WorktreeListEntry): boolean {
  if (!wt.pathExists) {
    // Worktree is defined but doesn't exist in the filesystem.
    return true;
  }
  if (wt.uncommittedChanges) {
    // Uncommitted work disqualifies a worktree whatever its remote looks like.
    // See CLEANUP-DATA-LOSS-PLAN §3 D2.
    return false;
  }
  if (wt.remote && !wt.remoteExists) {
    // Worktree is tracking a remote branch that no longer exists.
    return true;
  }
  if (!wt.remote && !wt.ahead && !wt.behind) {
    // Worktree has no changes and it not tracking any remote branch.
    return true;
  }
  return false;
}

export async function gitGetWorktreeList({
  includeCurrent = false,
}: GitGetWorktreesOptions = {}) {
  const remoteBranches = await gitGetRemoteBranches();
  const tracking = await gitGetLocalBranchesTracking();
  const result = await gitGetWorktrees({ includeCurrent });

  const worktreeList: WorktreeListEntry[] = [];

  for (const { path, branchName, pathExists, isCurrent } of result) {
    const remote = tracking.find((t) => t.local === branchName)?.remote ?? "";
    const remoteExists = !!remote && remoteBranches.includes(remote);
    const ahead =
      pathExists && remoteExists
        ? await gitGetCommitsAheadCount(path)
        : undefined;
    const behind =
      pathExists && remoteExists
        ? await gitGetCommitsBehindCount(path)
        : undefined;
    const uncommittedChanges = pathExists
      ? await gitGetUncommittedChangesCount(path)
      : 0;

    const worktreeListEntry: WorktreeListEntry = {
      path,
      branchName,
      remote,
      remoteExists,
      ahead,
      behind,
      pathExists,
      uncommittedChanges,
      isCurrent,
    };

    worktreeList.push({
      ...worktreeListEntry,
      safeToRemove: isSafeToRemove(worktreeListEntry),
    });
  }

  return worktreeList;
}

interface GitCreateWorktreeOptions {
  isCheckout?: boolean;
}

export async function gitCreateWorktree(
  branchName: string,
  sourceBranch: string,
  { isCheckout = false }: GitCreateWorktreeOptions = {},
): Promise<string> {
  const spinner = ora(`Creating worktree ${branchName}`).start();
  try {
    const gitRootPath = await gitGetRootPath();
    const worktreesRootPath = `../${path.basename(gitRootPath)}.worktrees`;
    const worktreePath = `${worktreesRootPath}/${branchName}`;
    const absoluteWorktreePath = `${gitRootPath}.worktrees/${branchName}`;
    // Both calls run with the root path as their cwd, so `git worktree add` gets
    // a relative worktree path. This ensures that everything stays in sync in
    // case the project is moved in the filesystem. cwd is per-call and never
    // moves this process, so there is nothing to change back afterwards.
    // Fetch the latest changes from the remote
    await run("git", ["fetch"], { cwd: gitRootPath });
    // If checking out a remote branch, create a local tracking branch. Awaiting
    // in sequence keeps the short-circuit the `&&` chain had: a rejection here
    // is only reached once the fetch has resolved.
    await run(
      "git",
      [
        "worktree",
        "add",
        isCheckout ? "--track" : "--no-track",
        "-b",
        branchName,
        worktreePath,
        sourceBranch,
      ],
      { cwd: gitRootPath },
    );
    // Stop the spinner
    spinner.succeed();
    // Return the absolute path to the new worktree
    return absoluteWorktreePath;
  } catch (error) {
    spinner.fail(error instanceof Error ? error.message : String(error));
    throw error;
  }
}

interface GitNukeWorktreeCmdOptions {
  force?: boolean;
}

// Sequential awaits stand in for the `&&` chain: a rejection stops the sequence
// before the next command runs, which is what the shell operator did.
export async function gitNukeWorktreeCmd(
  branchName: string,
  { force = false }: GitNukeWorktreeCmdOptions = {},
) {
  await run("git", [
    "worktree",
    "remove",
    branchName,
    ...(force ? ["--force"] : []),
  ]);
  await run("git", ["worktree", "prune"]);
  await run("git", ["branch", "-D", branchName]);
}

export async function gitNukeWorktree(
  branchName: string,
  { force = false }: GitNukeWorktreeCmdOptions = {},
) {
  const spinner = ora(`Removing worktree ${branchName}`).start();
  try {
    await gitNukeWorktreeCmd(branchName, { force });
    spinner.succeed(`Worktree ${branchName} was removed.`);
  } catch {
    spinner.fail(
      `Failed to remove worktree ${branchName}. It may have already been removed.`,
    );
  }
}

export async function gitRemoveWorktree(
  branchName: string,
  { force = false }: GitNukeWorktreeCmdOptions = {},
) {
  const currentBranch = await getCurrentBranchName();
  if (branchName === currentBranch) {
    throw new Error(
      `Cannot remove current worktree ${branchName}. Go to another worktree or main repository first.`,
    );
  }
  const spinner = ora(`Gathering worktree info for ${branchName}`).start();
  const worktreeList = await gitGetWorktreeList();
  const worktree = worktreeList.find(
    (entry) => entry.branchName === branchName,
  );
  if (!worktree) {
    spinner.fail(`Worktree ${branchName} not found.`);
    return;
  }
  spinner.stop();

  async function promptRemoval(worktree: WorktreeListEntry) {
    if (worktree.ahead) {
      return await confirm({
        message: `This branch is ${worktree.ahead} commits ahead so you might lose some work. Are you sure you want to remove this worktree?`,
        default: false,
      });
    }
    if (worktree.uncommittedChanges) {
      return await confirm({
        message: `This branch has ${worktree.uncommittedChanges} uncommitted change${worktree.uncommittedChanges > 1 ? "s" : ""} so you might lose some work. Are you sure you want to remove this worktree?`,
        default: false,
      });
    }
    return await confirm({
      message: "Are you sure you want to remove this worktree?",
      default: false,
    });
  }

  if (force || (await promptRemoval(worktree))) {
    await gitNukeWorktree(branchName, {
      force: force || !!worktree.ahead || !!worktree.uncommittedChanges,
    });
  }
}

export async function gitRemoveWorktreesWithProgress(
  worktrees: WorktreeListEntry[],
) {
  const process = new Process.SingleBar(
    {
      format: "{bar} {percentage}% ({metaValue}/{metaTotal}) {description}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
      hideCursor: true,
    },
    Process.Presets.shades_classic,
  );

  process.start(worktrees.length * 10, 0, {
    metaTotal: worktrees.length,
  });

  let i = 0;

  for (const wt of worktrees) {
    const description = `Deleting ${wt.branchName}`;
    process.update({ metaValue: i, description });

    i++;

    await gitNukeWorktreeCmd(wt.branchName, { force: true });

    process.update(i * 10, {
      metaValue: i,
      description: i === worktrees.length ? "Done" : description,
    });
  }

  process.stop();
}
