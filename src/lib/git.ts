import fs from "node:fs";
import { EOL } from "node:os";
import path from "node:path";
import { confirm } from "@inquirer/prompts";
import Process from "cli-progress";
import ora from "ora";
import {
  findSessionForPath,
  getAgentSessions,
  isSessionInteractive,
  isSessionLive,
  isSessionWaiting,
} from "./agent.js";
import { run } from "./cli.js";
import type {
  AgentSession,
  ConfigName,
  WorktreeAgent,
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

// The ref an ahead count is taken against when a worktree has no upstream to
// count against. `origin/HEAD` is the repository's own answer to "what is the
// default branch", so it is asked first; `defaultSourceBranch` answers for a
// clone made before git started recording that ref, and gitGetConfigValue
// already returns "" when the key is unset. An empty result means no base
// resolved — which callers must read as "not counted", never as zero. See
// UNPUSHED-COMMIT-GUARD-PLAN §3 D2, GitHub issue #63.
//
// Deliberately not the config key first: it answers a different question —
// where to branch from — so someone who sets it to `origin/develop` would
// otherwise silently change what counts as unpushed work.
export async function gitGetComparisonBase() {
  try {
    const originHead = await run("git", [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    if (originHead) {
      return originHead;
    }
  } catch {
    // Unset, or no origin at all. Either way the config key answers next.
  }
  return await gitGetConfigValue("defaultSourceBranch");
}

// The base defaults to `@{u}`, which is what every caller wanted while an
// upstream was the only thing ever counted against. It is a parameter so
// gitGetWorktreeList can pass gitGetComparisonBase()'s answer for a worktree
// that has no upstream — `@{u}` does not resolve there and run() rejects.
export async function gitGetCommitsAheadCount(
  branchPath: string,
  base = "@{u}",
) {
  // An empty base is gitGetComparisonBase() saying nothing resolved, and git
  // does not refuse it: `rev-list --count ..HEAD` exits 0 and prints 0. That
  // zero is indistinguishable from a real count, which is the fabricated zero
  // D1 rejects — worse than undefined, because a predicate can be taught to
  // see a hole and cannot see a lie. Not counted stays undefined.
  if (!base) {
    return undefined;
  }
  const countStr = await run("git", ["rev-list", "--count", `${base}..HEAD`], {
    cwd: branchPath,
  });
  if (countStr) {
    return strToNum(countStr);
  }
}

export async function gitGetCommitsBehindCount(
  branchPath: string,
  base = "@{u}",
) {
  // Same trap in the other direction: `rev-list --count HEAD..` is also 0 at
  // exit 0.
  if (!base) {
    return undefined;
  }
  const countStr = await run("git", ["rev-list", "--count", `HEAD..${base}`], {
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

// Somebody is working in this worktree — a dispatched agent or a human's own
// terminal, which D5 treats alike. Fails safe on an absent marker: an entry that
// records a session without saying whether it finished counts as live, so a
// hand-built entry and a runtime that renamed its state field both block removal
// rather than being waved through. See AGENT-MODE-PLAN §3 D5/D6.
export function hasLiveAgent(wt: WorktreeListEntry): boolean {
  return !!wt.agent && wt.agent.live !== false;
}

// The distinction this whole feature rests on: a count of zero is not the same
// fact as a count that was never taken, and only the first one makes a worktree
// disposable. `ahead === undefined` means nobody ever asked, so it answers
// false — unknown is never safe. See UNPUSHED-COMMIT-GUARD-PLAN §3 D1, #63.
//
// Both remove-permitting clauses below close over this, so the rule exists once
// rather than being spelled out twice and drifting.
//
// `behind` is deliberately not consulted. It is undefined for every worktree
// without an upstream (D4), so requiring it to be falsy would be trusting the
// very unknown this function refuses to trust — and being behind loses nothing
// on removal: it is staleness, not work at risk.
function carriesNoKnownWork(wt: WorktreeListEntry): boolean {
  return wt.ahead === 0;
}

export function isSafeToRemove(wt: WorktreeListEntry): boolean {
  if (!wt.pathExists) {
    // Worktree is defined but doesn't exist in the filesystem. Tested first, and
    // before the agent clause too: a directory that is already gone holds
    // nothing to lose, whoever the session listing still believes is in it.
    return true;
  }
  if (hasLiveAgent(wt)) {
    // Deleting a directory somebody is working in is the worst failure mode in
    // this flow, so it outranks every reason below — including uncommitted work,
    // which is the same judgement made about a smaller loss.
    return false;
  }
  if (wt.uncommittedChanges) {
    // Uncommitted work disqualifies a worktree whatever its remote looks like.
    // See CLEANUP-DATA-LOSS-PLAN §3 D2.
    return false;
  }
  if (wt.remote && !wt.remoteExists) {
    // Tracking a remote branch that no longer exists. Disposable only if
    // nothing local outlives the branch that is gone.
    return carriesNoKnownWork(wt);
  }
  if (!wt.remote) {
    // Not tracking anything. This clause used to read
    // `!wt.remote && !wt.ahead && !wt.behind`, and its last two conjuncts could
    // never be anything but true when the first one was: no remote forced
    // `remoteExists` false, which is what left both counts uncounted. It read
    // as "no remote and no work" and meant "no remote". That is the incident.
    return carriesNoKnownWork(wt);
  }
  return false;
}

interface GitGetWorktreeListOptions extends GitGetWorktreesOptions {
  includeAgents?: boolean;
}

// The session's own name and pid, plus the liveness `cleanup` weighs and the two
// markers `list` renders — all three derived by agent.ts's predicates, so no raw
// `kind`, `state` or `status` value crosses this boundary. See AGENT-MODE-PLAN
// §4.
//
// One session, not a set: an entry carries a single `agent`, so a worktree
// holding both a human's terminal and a dispatched agent is described by
// whichever findSessionForPath picked. Naming it in the output is what keeps
// that honest — the marker describes the session it names, not the worktree.
function toWorktreeAgent(
  sessions: AgentSession[],
  worktreePath: string,
): WorktreeAgent | undefined {
  const session = findSessionForPath(sessions, worktreePath);
  if (!session) {
    return undefined;
  }

  return {
    name: session.name,
    pid: session.pid,
    live: isSessionLive(session),
    interactive: isSessionInteractive(session),
    waiting: isSessionWaiting(session),
  };
}

interface AheadCount {
  ahead?: number;
  aheadUnknownReason?: string;
}

// The one count that can legitimately fail to take, so every exit says which
// happened: a number, or a reason it is missing. Never a zero standing in for a
// count that was never taken — that substitution is the whole defect this
// feature exists to remove. See UNPUSHED-COMMIT-GUARD-PLAN §3 D1, issue #63.
async function countAhead(
  worktreePath: string,
  pathExists: boolean | undefined,
  remoteExists: boolean,
  comparisonBase: string,
): Promise<AheadCount> {
  if (!pathExists) {
    // No directory to run in. `pathExists` already carries this and the
    // listing already prints "Path does not exist", so a second detail saying
    // the same thing would only be noise. What such a worktree's verdict
    // should be is §9 Q5, left open by this plan and by CLEANUP-DATA-LOSS.
    return {};
  }

  // The upstream where the branch has one that still exists — that is the
  // count `list` has always shown, and it is the more precise question. The
  // run's comparison base is for the branch nobody ever pushed, which is
  // exactly the worktree this feature exists to stop losing.
  const base = remoteExists ? "@{u}" : comparisonBase;
  if (!base) {
    return {
      aheadUnknownReason:
        "no comparison base; set defaultSourceBranch or run git remote set-head origin --auto",
    };
  }

  try {
    return { ahead: await gitGetCommitsAheadCount(worktreePath, base) };
  } catch {
    // D5: failing closed loses nothing, but failing closed *silently* makes a
    // cleanup that cannot classify anything look like a cleanup with nothing
    // to do. The reason rides the entry to whoever is reading.
    return { aheadUnknownReason: `${base} could not be resolved` };
  }
}

export async function gitGetWorktreeList({
  includeCurrent = false,
  includeAgents = false,
}: GitGetWorktreeListOptions = {}) {
  const remoteBranches = await gitGetRemoteBranches();
  const tracking = await gitGetLocalBranchesTracking();
  const result = await gitGetWorktrees({ includeCurrent });
  // One lookup for the whole run, joined in-process below, and only when a
  // caller asks for it. Both halves matter: the loop underneath is serial and
  // already spends three subprocesses per worktree, so a per-worktree session
  // call would be a fourth, and a caller that never renders agents must not pay
  // for the one. See AGENT-MODE-PLAN §3 D4 and §5 R4.
  const sessions = includeAgents ? await getAgentSessions() : [];
  // Once for the whole run, not once per worktree — the loop below is serial
  // and this gather has four callers, so a per-worktree resolution would be
  // paid four ways for an answer that cannot differ between them. Same
  // reasoning as the session lookup above. See §4.1 and §5 R1.
  const comparisonBase = await gitGetComparisonBase();

  const worktreeList: WorktreeListEntry[] = [];

  for (const { path, branchName, pathExists, isCurrent } of result) {
    const remote = tracking.find((t) => t.local === branchName)?.remote ?? "";
    const remoteExists = !!remote && remoteBranches.includes(remote);
    // `ahead` is now counted for every worktree whose directory is there, not
    // only for those with an upstream. The old `remoteExists` guard was an
    // error-dodge — `@{u}` does not resolve without an upstream and run()
    // rejects — and leaving the count untaken is what let a branch carrying
    // unpushed commits read as empty.
    const { ahead, aheadUnknownReason } = await countAhead(
      path,
      pathExists,
      remoteExists,
      comparisonBase,
    );
    // `behind` keeps that guard, deliberately. Against the default branch it
    // would mean "commits on main this branch does not have", non-zero for
    // almost every worktree the moment main advances — and it is a conjunct of
    // a safety clause, so cleanup would stop removing anything at all. Being
    // behind also loses nothing on removal: it is staleness, not work at risk.
    // See §3 D4.
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
      aheadUnknownReason,
      pathExists,
      uncommittedChanges,
      isCurrent,
      // Empty without includeAgents, so this is undefined for every caller that
      // did not ask — no separate branch needed to keep the field off.
      agent: toWorktreeAgent(sessions, path),
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

/**
 * Removes a worktree, reporting whether it actually went.
 *
 * The `catch` swallows the failure deliberately — it is already reported on the
 * spinner — so the boolean is the only thing left that can tell a caller a
 * removal did not happen. Without it a caller cannot distinguish this from a
 * success, which is how a space outlives the checkout it was built around.
 */
export async function gitNukeWorktree(
  branchName: string,
  { force = false }: GitNukeWorktreeCmdOptions = {},
): Promise<boolean> {
  const spinner = ora(`Removing worktree ${branchName}`).start();
  try {
    await gitNukeWorktreeCmd(branchName, { force });
    spinner.succeed(`Worktree ${branchName} was removed.`);
    return true;
  } catch {
    spinner.fail(
      `Failed to remove worktree ${branchName}. It may have already been removed.`,
    );
    return false;
  }
}

/**
 * Removes one worktree by branch name, answering with the entry it removed.
 *
 * `undefined` covers all three ways this ends without removing anything: the
 * branch was not found, the confirmation was declined, or the removal itself
 * failed. A caller acting on the removal — closing the Herdr space built around
 * the checkout, say — must be able to tell those apart from a success, and the
 * entry is also the only place the caller can read the path back from, since
 * this takes a branch name.
 */
export async function gitRemoveWorktree(
  branchName: string,
  { force = false }: GitNukeWorktreeCmdOptions = {},
): Promise<WorktreeListEntry | undefined> {
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
    return undefined;
  }
  spinner.stop();

  async function promptRemoval(worktree: WorktreeListEntry) {
    if (worktree.ahead) {
      return await confirm({
        message: `This branch is ${worktree.ahead} commit${worktree.ahead > 1 ? "s" : ""} ahead so you might lose some work. Are you sure you want to remove this worktree?`,
        default: false,
      });
    }
    // The count could not be taken, so this worktree may be carrying anything.
    // The generic prompt below would imply there is nothing to weigh, which is
    // the disclosure half of the incident: the decision and the warning failed
    // from the same undefined. Naming the reason is what lets someone check
    // before answering. See §3 D1 and D5.
    if (worktree.aheadUnknownReason) {
      return await confirm({
        message: `Unpushed commits could not be counted for this branch (${worktree.aheadUnknownReason}), so it may carry work that exists nowhere else. Are you sure you want to remove this worktree?`,
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
    const wasRemoved = await gitNukeWorktree(branchName, {
      // An uncountable branch is forced too. Not because the removal would
      // otherwise fail — a dirty tree already sets this through
      // `uncommittedChanges`, and `git worktree remove` does not refuse a tree
      // `git status -s` reports as clean. `force` governs only whether that
      // command tolerates state git status cannot see, and it costs nothing
      // here: gitNukeWorktreeCmd runs `git branch -D` unconditionally either
      // way. The user has been told what they might be losing and said yes.
      force:
        force ||
        !!worktree.ahead ||
        !!worktree.aheadUnknownReason ||
        !!worktree.uncommittedChanges,
    });

    return wasRemoved ? worktree : undefined;
  }

  // The confirmation was declined, so nothing was touched.
  return undefined;
}

/**
 * Removes a set of worktrees behind a progress bar, answering with the ones it
 * got through.
 *
 * "Got through" means `gitNukeWorktreeCmd` did not throw on it. A throw still
 * aborts the loop and still leaves the bar unstopped — pre-existing behaviour,
 * deliberately unchanged here, and the entries already completed are lost with
 * the exception rather than returned. That gap is recorded against this plan's
 * §9 and is adjacent to findings.md F-011; this function's contract is only
 * that what it *returns* was really removed.
 */
export async function gitRemoveWorktreesWithProgress(
  worktrees: WorktreeListEntry[],
): Promise<WorktreeListEntry[]> {
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
  const removed: WorktreeListEntry[] = [];

  for (const wt of worktrees) {
    const description = `Deleting ${wt.branchName}`;
    process.update({ metaValue: i, description });

    i++;

    await gitNukeWorktreeCmd(wt.branchName, { force: true });
    removed.push(wt);

    process.update(i * 10, {
      metaValue: i,
      description: i === worktrees.length ? "Done" : description,
    });
  }

  process.stop();

  return removed;
}
