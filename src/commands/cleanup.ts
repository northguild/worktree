import { confirm } from "@inquirer/prompts";
import { Flags } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";
import { BaseCommand } from "../lib/base-command.js";
import {
  gitGetWorktreeList,
  gitRemoveWorktreesWithProgress,
  isSafeToRemove,
} from "../lib/git.js";
import type { WorktreeListEntry } from "../lib/types.js";
import { worktreeListEntryToListName } from "../lib/utils.js";

// A worktree cleanup would have swept but for the work sitting in it. Asking the
// predicate about a zeroed copy keeps the safety rule in one place rather than
// restating it here. See CLEANUP-DATA-LOSS-PLAN §3 D1 and D7.
function isSkippedForUncommittedChanges(wt: WorktreeListEntry): boolean {
  return (
    !!wt.uncommittedChanges && isSafeToRemove({ ...wt, uncommittedChanges: 0 })
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

  public async run(): Promise<void> {
    const { flags } = await this.parse(Cleanup);
    const spinner = ora("Gathering worktree branches").start();
    const allWorktrees = await gitGetWorktreeList();
    const worktrees = allWorktrees.filter((wt) => wt.safeToRemove === true);
    const skipped = allWorktrees.filter(isSkippedForUncommittedChanges);

    if (worktrees.length === 0 && skipped.length === 0) {
      spinner.succeed("No stale worktree branches found.");
      return;
    }

    // Nothing is removable, but something was held back. Reporting "none found"
    // here would hide exactly the worktrees this check exists to protect.
    if (worktrees.length === 0) {
      spinner.info("No stale worktree branches can be removed safely.");
      this.logSkipped(skipped);
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
    if (skipped.length > 0) {
      this.logSkipped(skipped);
    }

    if (!flags.force) {
      const message = `Are you sure you want to delete ${count === 1 ? "it" : "them"}?`;
      if (!(await confirm({ message, default: false }))) {
        return;
      }
    }

    await gitRemoveWorktreesWithProgress(worktrees);
  }
}
