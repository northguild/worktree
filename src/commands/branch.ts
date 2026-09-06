import { confirm, input } from "@inquirer/prompts";
import { Args, Flags } from "@oclif/core";
import ora from "ora";
import { fetchGitHubIssue } from "../integrations/github.js";
import { getJiraBranchNameFromIssue } from "../integrations/jira.js";
import { BaseCommand } from "../lib/base-command.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import {
  gitCreateWorktree,
  gitGetConfigValue,
  gitGetLocalBranches,
  gitGetRemoteBranches,
} from "../lib/git.js";
import type { ConfigName } from "../lib/types.js";
import { sanitizeBranchName } from "../lib/utils.js";
import { isValidBranchName } from "../lib/validators.js";

export default class Branch extends BaseCommand {
  static override args = {
    branchName: Args.string({ description: "Name of the branch to create" }),
  };
  static override description = "Create a worktree branch";
  static override examples = [
    "<%= config.bin %> <%= command.id %> my-new-branch",
    "<%= config.bin %> <%= command.id %> my-new-branch --source origin/main",
    "<%= config.bin %> <%= command.id %> --github 42",
    "<%= config.bin %> <%= command.id %> --jira DEV-123",
    '<%= config.bin %> <%= command.id %> --github 42 --agent "implement the issue"',
  ];

  static override flags = {
    source: Flags.string({
      char: "s",
      description: "Source branch to create the worktree from",
    }),
    github: Flags.string({
      char: "g",
      description: "Create a branch from a GitHub issue (issue number)",
    }),
    jira: Flags.string({
      char: "j",
      description: "Create a branch from a Jira issue (issue ID)",
    }),
    agent: Flags.string({
      char: "a",
      description:
        "Start the configured coding agent in the new worktree with this prompt",
    }),
  };

  private confirmNonOriginSource() {
    const message =
      "The source branch does not start with 'origin/'. Are you sure you want to use a local source?";
    return confirm({ message });
  }

  private confirmRemoteNameConflict() {
    const message =
      "A remote branch with the same name exists. Do you want to use the remote branch instead?";
    return confirm({ message });
  }

  private async getSourceBranch(sourceFlag?: string) {
    if (sourceFlag) {
      const remoteBranches = await gitGetRemoteBranches();

      if (sourceFlag.startsWith("origin/")) {
        if (!remoteBranches.includes(sourceFlag)) {
          this.error(`Source branch doesn't exist: ${sourceFlag}`);
        }
        return sourceFlag;
      }

      if (await this.confirmNonOriginSource()) {
        const localBranches = await gitGetLocalBranches();
        if (!localBranches.includes(sourceFlag)) {
          this.error(`Source branch doesn't exist: ${sourceFlag}`);
        }
        if (remoteBranches.includes(`origin/${sourceFlag}`)) {
          if (await this.confirmRemoteNameConflict()) {
            return `origin/${sourceFlag}`;
          }
        }
        return sourceFlag;
      }
    }
    return (await gitGetConfigValue("defaultSourceBranch")) || "origin/main";
  }

  private validateBranchName(branchName: string) {
    const result = isValidBranchName(branchName);
    if (result !== true) {
      this.error(result);
    }
    return true;
  }

  private async getGitHubBranchPrefix(type?: string) {
    if (type === "Feature") {
      return (await gitGetConfigValue("branchPrefix.feature")) || "";
    }
    if (type === "Bug") {
      return (await gitGetConfigValue("branchPrefix.bugfix")) || "";
    }
    if (type === "Task") {
      return (await gitGetConfigValue("branchPrefix.chore")) || "";
    }
    return "";
  }

  private async getGithubIssueBranchName(issueNumberFlag: string) {
    const issueNumber = Number(
      issueNumberFlag.startsWith("#")
        ? issueNumberFlag.slice(1)
        : issueNumberFlag,
    );
    const spinner = ora(`Fetching GitHub issue #${issueNumber}`).start();
    try {
      const issue = await fetchGitHubIssue(issueNumber);
      const prefix = await this.getGitHubBranchPrefix(issue.type?.name);
      spinner.succeed();
      return `${prefix}${issue.number}-${sanitizeBranchName(issue.title) || "issue"}`;
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }

  private async getJiraIssueBranchName(issueKeyFlag: string) {
    const spinner = ora(
      `Fetching Jira issue ${issueKeyFlag.toUpperCase()}`,
    ).start();
    try {
      const branchName = await getJiraBranchNameFromIssue(issueKeyFlag);
      spinner.succeed();
      return branchName;
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }

  private async getBranchName(
    branchNameArg?: string,
    flags?: { github?: string; jira?: string },
  ) {
    if (
      !flags?.github &&
      !flags?.jira &&
      branchNameArg &&
      this.validateBranchName(branchNameArg)
    ) {
      return branchNameArg;
    }

    const defaultValue = flags?.github
      ? await this.getGithubIssueBranchName(flags.github)
      : flags?.jira
        ? await this.getJiraIssueBranchName(flags.jira)
        : "";

    return await input({
      message: "Branch name",
      default: defaultValue,
      prefill: "editable",
      validate: isValidBranchName,
    });
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Branch);
    if (flags.github && flags.jira) {
      this.error("Please provide either --github or --jira, not both.");
    }

    const configNames: ConfigName[] = !flags.source
      ? ["defaultSourceBranch"]
      : [];

    if (flags.jira) {
      configNames.push("jira.host", "jira.email", "jira.apiToken");
    }

    // If there is no source flag provided, make sure defaultSourceBranch is configured
    await this.verifyConfig(configNames);
    const branchName = await this.getBranchName(args.branchName, flags);
    const sourceBranch = await this.getSourceBranch(flags.source);
    const projectPath = await gitCreateWorktree(branchName, sourceBranch);
    // Env files first: the agent starts working immediately, so it has to find a
    // worktree that is already complete. The editor stays last so its "Worktree
    // created" fallback remains the final line.
    await copyEnvFilesFromRootPath(projectPath);
    if (flags.agent !== undefined) {
      await this.dispatchAgent(projectPath, flags.agent);
    }
    await this.openWorktreePath(projectPath);
  }
}
