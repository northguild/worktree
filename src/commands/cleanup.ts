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

  // Both halves are guarded here rather than at the call sites, which each have
  // one kind of hold-back or the other far more often than both. An unguarded
  // heading would read "Skipped 0 worktree branches …".
  private logHeldBack(
    skipped: WorktreeListEntry[],
    agentSkipped: WorktreeListEntry[],
  ) {
    if (skipped.length > 0) {
      this.logSkipped(skipped);
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

    if (
      worktrees.length === 0 &&
      skipped.length === 0 &&
      agentSkipped.length === 0
    ) {
      spinner.succeed("No stale worktree branches found.");
      return;
    }

    // Nothing is removable, but something was held back. Reporting "none found"
    // here would hide exactly the worktrees this check exists to protect.
    if (worktrees.length === 0) {
      spinner.info("No stale worktree branches can be removed safely.");
      this.logHeldBack(skipped, agentSkipped);
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
        this.log(`- ${worktreeListEntryToListName(wt, "gray")}`);
      });
    }

    // Reported in both paths: --force means "do not ask me", not "do not tell
    // me". See CLEANUP-DATA-LOSS-PLAN §4.2.
    this.logHeldBack(skipped, agentSkipped);

    if (!flags.force) {
      const message = `Are you sure you want to delete ${count === 1 ? "it" : "them"}?`;
      if (!(await confirm({ message, default: false }))) {
        return;
      }
    }

    await gitRemoveWorktreesWithProgress(worktrees);
  }
}
