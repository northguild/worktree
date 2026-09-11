import { checkbox, confirm, Separator } from "@inquirer/prompts";
import { Args, Flags } from "@oclif/core";
import chalk from "chalk";
import ora from "ora";
import { BaseCommand } from "../lib/base-command.js";
import {
  gitGetWorktreeList,
  gitRemoveWorktree,
  gitRemoveWorktreesWithProgress,
} from "../lib/git.js";
import type { WorktreeListEntry } from "../lib/types.js";
import { worktreeListEntryToListName } from "../lib/utils.js";

export default class Delete extends BaseCommand {
  static aliases = ["rm", "delete"];
  static override args = {
    branchName: Args.string({ description: "Name of the branch to remove" }),
  };
  static override description = "Remove worktree branches";
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> my-new-branch",
  ];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Force remove the branch without confirmation",
    }),
  };

  private getWorktreeChoices(worktrees: WorktreeListEntry[]) {
    const choices = worktrees.map((wt) => ({
      name: worktreeListEntryToListName(wt, "red"),
      value: wt,
    }));
    const safeToRemove = choices.filter(({ value }) => value.safeToRemove);
    const unsafeToRemove = choices.filter(({ value }) => !value.safeToRemove);

    if (safeToRemove.length > 0 && unsafeToRemove.length > 0) {
      return [
        new Separator(chalk.gray("─ Inactive branches (Safe to delete)")),
        ...safeToRemove,
        new Separator(chalk.gray("─ Active branches")),
        ...unsafeToRemove,
      ];
    }

    return [...safeToRemove, ...unsafeToRemove];
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Delete);
    const spinner = ora("Gathering worktree branches").start();
    const worktrees = await gitGetWorktreeList();
    spinner.stop();

    if (worktrees.length === 0) {
      this.log("No worktree branches found.");
      return;
    }

    if (args.branchName) {
      const wt = worktrees.find((wt) => wt.branchName === args.branchName);

      if (!wt) {
        this.error(`Branch "${args.branchName}" not found.`);
      }

      await gitRemoveWorktree(args.branchName, { force: flags.force });
      return;
    }

    const selected = await checkbox({
      message: "Select worktree branches to delete",
      choices: this.getWorktreeChoices(worktrees),
    });

    if (selected.length === 0) {
      return;
    }

    if (selected.some((wt) => !wt.safeToRemove) && !flags.force) {
      const confirmDelete = await confirm({
        message:
          "Some selected branches are not safe to delete. Are you sure you want to continue?",
        default: false,
      });
      if (!confirmDelete) {
        return;
      }
    }

    await gitRemoveWorktreesWithProgress(selected);
  }
}
