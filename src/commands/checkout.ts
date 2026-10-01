import { Args, Flags } from "@oclif/core";
import { BaseCommand, readAgentBrief } from "../lib/base-command.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import {
  gitCreateWorktree,
  gitGetLocalBranches,
  gitGetRemoteBranches,
} from "../lib/git.js";
import { createSpinner } from "../lib/progress.js";
import { askSelect } from "../lib/prompt.js";

export default class Checkout extends BaseCommand {
  static override args = {
    branchName: Args.string({ description: "Name of the branch to checkout" }),
  };
  static override description = "Checkout worktree branches";
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> origin/feature/other-branch",
    '<%= config.bin %> <%= command.id %> feature/other-branch --agent "review this branch"',
  ];

  static override flags = {
    agent: Flags.string({
      char: "a",
      description:
        "Start the configured coding agent in the new worktree with this prompt",
    }),
  };

  private normalizeBranchNameArg(branchNameArg?: string) {
    if (branchNameArg) {
      return branchNameArg?.startsWith("origin/")
        ? branchNameArg
        : `origin/${branchNameArg}`;
    }
  }

  private selectRemoteBranch(remoteBranches: string[]) {
    return askSelect(
      {
        message: "Select a remote branch to checkout",
        choices: remoteBranches.map((branchName) => ({
          name: branchName,
          value: branchName,
        })),
      },
      { value: "the branch to check out", flag: "<branchName>" },
    );
  }

  private getBaseBranchName(branchNameArg: string) {
    return branchNameArg?.replace(/^origin\//, "");
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Checkout);

    // Before anything is created, as in branch: an empty or oversized prompt is
    // a usage error and should not leave a worktree behind.
    let brief: string | undefined;
    try {
      brief = await readAgentBrief({ agent: flags.agent });
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }

    const spinner = createSpinner("Fetching remote branches").start();
    const remoteBranches = await gitGetRemoteBranches();
    const localBranches = await gitGetLocalBranches();
    spinner.stop();

    const branchNameArg = this.normalizeBranchNameArg(args.branchName);
    const sourceBranchName =
      branchNameArg || (await this.selectRemoteBranch(remoteBranches));

    if (sourceBranchName) {
      if (!remoteBranches.includes(sourceBranchName)) {
        this.error(`Remote branch "${sourceBranchName}" not found`);
      }
      const baseBranchName = this.getBaseBranchName(sourceBranchName);

      if (localBranches.includes(baseBranchName)) {
        this.error(`Local branch "${baseBranchName}" already exists`);
      }

      const projectPath = await gitCreateWorktree(
        baseBranchName,
        sourceBranchName,
        { isCheckout: true },
      );
      // Same order as branch: env files complete the worktree before the agent
      // sees it.
      await copyEnvFilesFromRootPath(projectPath);
      // The brief rides on the open: with Herdr it goes to the agent Herdr
      // starts, and the detached launch happens only where Herdr did not open.
      await this.openWorktreePath(projectPath, { brief });
    }
  }
}
