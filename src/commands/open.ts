import { select } from "@inquirer/prompts";
import { Args } from "@oclif/core";
import { BaseCommand } from "../lib/base-command.js";
import { gitGetWorktrees } from "../lib/git.js";
import { createSpinner } from "../lib/progress.js";
import type { WorktreeListBaseEntry } from "../lib/types.js";

export default class OpenCmd extends BaseCommand {
  static override args = {
    branchName: Args.string({ description: "Name of the branch to open" }),
  };
  static override description = "Open worktree branch in code editor";
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> feature/my-branch",
  ];

  private selectBranch(worktrees: WorktreeListBaseEntry[]) {
    return select({
      message: "Select a branch to open",
      choices: worktrees.map((wt) => ({ name: wt.branchName, value: wt })),
    });
  }

  public async run(): Promise<void> {
    const { args } = await this.parse(OpenCmd);
    const spinner = createSpinner("Gathering worktree list").start();
    const allWorktrees = await gitGetWorktrees();
    spinner.stop();
    // Filter out non existing paths
    const worktrees = allWorktrees.filter((wt) => !!wt.pathExists);
    const wt = args.branchName
      ? worktrees.find((wt) => wt.branchName === args.branchName)
      : await this.selectBranch(worktrees);

    if (!wt) {
      // Name arg was provided, give an error
      if (args.branchName) {
        this.error(`Worktree "${args.branchName}" doesn't exist`);
      }
      // Silently exit
      return;
    }

    // Handle opening the worktree
    await this.openWorktreePath(wt.path);
  }
}
