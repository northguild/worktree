import { confirm } from "@inquirer/prompts";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";
import { BaseCommand } from "../lib/base-command.js";
import {
  gitGetWorktreeList,
  gitRemoveWorktreesWithProgress,
  hasLiveAgent,
  isSafeToRemove,
} from "../lib/git.js";
import type { WorktreeListEntry } from "../lib/types.js";
import { worktreeListEntryToListName } from "../lib/utils.js";

// A worktree cleanup would have swept but for the work sitting in it. Asking the
// predicate about a zeroed copy keeps the safety rule in one place rather than
// restating it here. See CLEANUP-DATA-LOSS-PLAN §3 D1 and D7.
//
// The `safeToRemove` guard in front is what keeps an entry out of both halves of
// the split: without it a worktree whose directory is already gone answers `true`
// to the zeroed probe — the first branch of the predicate never reaches the
// count — and would be reported as skipped and then removed anyway. See
// findings.md F-003.
function isSkippedForUncommittedChanges(wt: WorktreeListEntry): boolean {
  return (
    wt.safeToRemove !== true &&
    !!wt.uncommittedChanges &&
    isSafeToRemove({ ...wt, uncommittedChanges: 0 })
  );
}

// The same shape for a live session. The probe drops the uncommitted count as
// well as the agent, because a worktree an agent is working in usually holds
// both and each entry belongs under exactly one heading: this one claims it, and
// the uncommitted probe above declines it — that probe keeps the agent, so a
// live session makes it answer `false`. The agent wins because it is the reason
// a human cannot simply commit and re-run.
function isSkippedForLiveAgent(wt: WorktreeListEntry): boolean {
  return (
    wt.safeToRemove !== true &&
    hasLiveAgent(wt) &&
    isSafeToRemove({ ...wt, agent: undefined, uncommittedChanges: 0 })
  );
}

// F-059: whatever the two predicates above did not claim, where the reason
// they did not is that cleanup could not tell.
//
// Not every worktree belongs in a report. One tracking a live remote, or
// carrying commits it is meant to be carrying, is simply active work, and
// cleanup has never mentioned those. What must never happen is a worktree held
// back *because the count could not be taken* going unmentioned: that run is
// indistinguishable from one with nothing to do, which is the silence D5 exists
// to break. Before this, such a worktree reached none of the three sets — and a
// dirty one regressed out of the uncommitted-changes heading when Phase 3 began
// requiring a known count, so a worktree with work in it stopped being named.
function isHeldBackAsUncountable(wt: WorktreeListEntry): boolean {
  return wt.safeToRemove !== true && !!wt.aheadUnknownReason;
}

// D6: why this worktree qualified, in the order isSafeToRemove decides it.
//
// Every branch returns a non-empty string, which is the whole point. After
// Phase 3 the safe set is "no remote, or a remote that is gone, plus a counted
// zero ahead" — and `worktreeListEntryToListName` has no detail to show for the
// no-remote case, so it would print a bare `- feature/x`. That bare line is
// what the incident produced, and reading it as "no reason found" is what made
// it possible to approve. A reason is derived here rather than in that renderer
// because it describes a cleanup verdict, and `list` and `remove` render the
// same worktree without asserting one. See §4.4.
function removalReason(wt: WorktreeListEntry): string {
  if (!wt.pathExists) {
    // Returned before any count is consulted, so this says nothing about
    // commits — deliberately. See §9 Q5.
    return "Path does not exist";
  }
  const remoteReason = wt.remote ? "Remote removed" : "No tracked remote";
  // Two ways to carry nothing, and they are not the same finding. "No unpushed
  // commits" says the count was taken and came back zero; "merged into X" says
  // the count is non-zero and every commit in it is already applied in X. A
  // reader who sees the second one next to a branch they remember writing code
  // on can go and check that base, which a reason claiming the branch is empty
  // would have sent them looking for a bug instead.
  return `${remoteReason}, ${
    wt.mergedInto ? `merged into ${wt.mergedInto}` : "no unpushed commits"
  }`;
}

export default class Cleanup extends BaseCommand {
  static override description =
    "Cleanup worktree branches by removing stale ones";
  static override examples = ["<%= config.bin %> <%= command.id %>"];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Force cleanup without confirmation",
    }),
    // No short alias, deliberately: this one overrules a safety verdict rather
    // than a prompt, and having to spell it out is the point. `--force` is not
    // it — that means "do not ask me", which is a different question.
    "ignore-agents": Flags.boolean({
      description:
        "Remove worktrees even when an agent session is living in them",
    }),
  };

  private logSkipped(skipped: WorktreeListEntry[]) {
    const count = skipped.length;
    this.log(
      `Skipped ${chalk.bold(count)} worktree ${count === 1 ? "branch that has" : "branches that have"} uncommitted changes:`,
    );
    skipped.forEach((wt) => {
      this.log(`- ${worktreeListEntryToListName(wt, "yellow")}`);
    });
  }

  // Rendered with the agent detail on, unlike the report above: the session's
  // name is the whole point here, because it is what tells a human which agent
  // to go and look at before insisting.
  private logSkippedForAgents(skipped: WorktreeListEntry[]) {
    const count = skipped.length;
    this.log(
      `Skipped ${chalk.bold(count)} worktree ${count === 1 ? "branch" : "branches"} with a live agent session:`,
    );
    skipped.forEach((wt) => {
      this.log(
        `- ${worktreeListEntryToListName(wt, "yellow", { agents: true })}`,
      );
    });
  }

  // Held back because the ahead count could not be taken, so cleanup cannot say
  // whether there is anything to lose. Rendered with the ordinary detail list,
  // which carries both the reason the count failed and any uncommitted change
  // count — a worktree can be uncountable and dirty at once, and the run that
  // mentions neither is the one F-059 records.
  private logUncountable(uncountable: WorktreeListEntry[]) {
    const count = uncountable.length;
    this.log(
      `Skipped ${chalk.bold(count)} worktree ${count === 1 ? "branch whose unpushed commits could not be counted" : "branches whose unpushed commits could not be counted"}:`,
    );
    uncountable.forEach((wt) => {
      // Agents on, like the session report below and unlike the uncommitted
      // one. An uncountable worktree an agent is living in lands here rather
      // than under that heading — the agent probe zeroes the change count but
      // keeps the uncounted `ahead`, so it declines the entry — and the whole
      // reason that heading names the session is that it tells a human which
      // agent to go and look at. Losing the name on the way through this
      // heading would drop the more actionable of the two facts.
      this.log(
        `- ${worktreeListEntryToListName(wt, "yellow", { agents: true })}`,
      );
    });
  }

  // Each section is guarded here rather than at the call sites, which carry one
  // kind of hold-back far more often than all three at once. An unguarded
  // heading would read "Skipped 0 worktree branches …".
  private logHeldBack(
    skipped: WorktreeListEntry[],
    agentSkipped: WorktreeListEntry[],
    uncountable: WorktreeListEntry[],
  ) {
    if (skipped.length > 0) {
      this.logSkipped(skipped);
    }
    if (uncountable.length > 0) {
      this.logUncountable(uncountable);
    }
    if (agentSkipped.length > 0) {
      this.logSkippedForAgents(agentSkipped);
    }
  }

  public async run(): Promise<void> {
    const { flags } = await this.parse(Cleanup);
    const spinner = ora("Gathering worktree branches").start();
    // The override is "do not look", not "look and then ignore": with no
    // sessions gathered there is no agent for isSafeToRemove to weigh, and the
    // run costs exactly what it did before this flag existed. See
    // AGENT-MODE-PLAN §4.
    const allWorktrees = await gitGetWorktreeList({
      includeAgents: !flags["ignore-agents"],
    });
    const worktrees = allWorktrees.filter((wt) => wt.safeToRemove === true);
    const skipped = allWorktrees.filter(isSkippedForUncommittedChanges);
    const agentSkipped = allWorktrees.filter(isSkippedForLiveAgent);
    // Last, and explicitly minus the two above, so no worktree can be counted
    // twice. Neither of them can currently claim an uncountable entry — both
    // probe `isSafeToRemove` on a zeroed copy, which an uncounted `ahead` still
    // fails — but making that exclusion structural means a change to either
    // predicate cannot silently produce a double report. See F-059.
    const uncountable = allWorktrees.filter(
      (wt) =>
        isHeldBackAsUncountable(wt) &&
        !skipped.includes(wt) &&
        !agentSkipped.includes(wt),
    );

    if (
      worktrees.length === 0 &&
      skipped.length === 0 &&
      agentSkipped.length === 0 &&
      uncountable.length === 0
    ) {
      spinner.succeed("No stale worktree branches found.");
      return;
    }

    // Nothing is removable, but something was held back. Reporting "none found"
    // here would hide exactly the worktrees this check exists to protect — and
    // a run that held everything back for want of a comparison base used to
    // reach the success line above and look identical to a clean sweep.
    if (worktrees.length === 0) {
      spinner.info("No stale worktree branches can be removed safely.");
      this.logHeldBack(skipped, agentSkipped, uncountable);
      return;
    }

    const count = worktrees.length;
    if (flags.force) {
      spinner.stop();
    } else {
      spinner.info(
        `Found ${chalk.bold(count)} worktree ${count === 1 ? "branch that is" : "branches that are"} marked safe to remove.`,
      );
      worktrees.forEach((wt) => {
        this.log(`- ${wt.branchName} ${chalk.gray(`(${removalReason(wt)})`)}`);
      });
    }

    // Reported in both paths: --force means "do not ask me", not "do not tell
    // me". See CLEANUP-DATA-LOSS-PLAN §4.2.
    this.logHeldBack(skipped, agentSkipped, uncountable);

    if (!flags.force) {
      const message = `Are you sure you want to delete ${count === 1 ? "it" : "them"}?`;
      if (!(await confirm({ message, default: false }))) {
        return;
      }
    }

    // After the confirmation, so a declined run spawns no lookup — and before
    // the removal, because `git worktree prune` takes these entries out of
    // Herdr's listing (D2).
    const closeSpaces = await this.resolveSpaceCloser();
    const removed = await gitRemoveWorktreesWithProgress(worktrees);

    // Only the entries the helper got through, never everything selected: a
    // worktree held back or one whose removal failed still has its checkout on
    // disk, and closing its space would be worse than leaving it open (D4).
    await closeSpaces(removed.map((worktree) => worktree.path));
  }
}
