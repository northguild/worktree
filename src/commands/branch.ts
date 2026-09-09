import { confirm, input } from "@inquirer/prompts";
import { Args, Flags } from "@oclif/core";
import ora from "ora";
import { assignGitHubIssue, fetchGitHubIssue } from "../integrations/github.js";
import { getJiraBranchNameFromIssue } from "../integrations/jira.js";
import { BaseCommand } from "../lib/base-command.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import {
  gitCreateWorktree,
  gitGetConfigValue,
  gitGetLocalBranches,
  gitGetRemoteBranches,
  gitSetConfigValue,
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
    "<%= config.bin %> <%= command.id %> --github 42 --assign",
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
    // Source-agnostic on purpose (D2). Jira has assignees too, and the
    // per-integration difference belongs in the config key rather than in the
    // flag name. `allowNo` gives `--no-assign` as the one-run override.
    assign: Flags.boolean({
      allowNo: true,
      description:
        "Assign the issue to you when creating a branch from --github",
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

  /**
   * One normalisation for both readers of `--github`. The branch-name path and
   * the assignment path derive the same number from the same flag, so a leading
   * `#` stripped in one place and not the other is a drift this exists to make
   * impossible.
   */
  private getGithubIssueNumber(issueNumberFlag: string) {
    return Number(
      issueNumberFlag.startsWith("#")
        ? issueNumberFlag.slice(1)
        : issueNumberFlag,
    );
  }

  private async getGithubIssueBranchName(issueNumberFlag: string) {
    const issueNumber = this.getGithubIssueNumber(issueNumberFlag);
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

  /**
   * Flag, then config, then prompt (D4). The key is tri-state through unset
   * (D3): `true` always assigns, `false` never does, and unset means ask.
   *
   * The prompt persists its own answer (D5) and its text names the key it
   * writes, because a declined answer is otherwise invisible and permanent —
   * the feature would simply stop offering itself with nothing to point at.
   */
  private async shouldAssignGithubIssue(assignFlag?: boolean) {
    if (assignFlag !== undefined) {
      return assignFlag;
    }

    const configured = await gitGetConfigValue("github.autoAssign");
    if (configured === "true") {
      return true;
    }
    if (configured === "false") {
      return false;
    }

    const answer = await confirm({
      message:
        "Assign this issue to you? (saved as github.autoAssign; change it later with `worktree config github.autoAssign <true|false>`)",
    });
    // The worktree is the deliverable (§2), and this write is only bookkeeping
    // about whether to assign. `gitSetConfigValue` does not swallow the way
    // `gitGetConfigValue` does, so an unwrapped failure here — a stale
    // `.git/config.lock` from a concurrent git process is the realistic one —
    // would reach BaseCommand.catch and cost the user the branch they asked
    // for, on a run they may well have answered "no" to.
    try {
      await gitSetConfigValue("github.autoAssign", String(answer));
    } catch {
      this.warn(
        "Could not save github.autoAssign, so you will be asked again next time.",
      );
    }

    return answer;
  }

  /**
   * The worktree is the deliverable (§2), so nothing here aborts `branch`. A
   * failed assignment warns and the command carries on, the way
   * `startConfiguredAgent` does — never `fail`, never a throw.
   *
   * Success is confirmed against the response rather than assumed (D6):
   * `assigned` is false when the login never appeared in the returned issue's
   * assignees, which is what a write without push access looks like.
   */
  private async assignGithubIssue(issueNumberFlag: string) {
    const issueNumber = this.getGithubIssueNumber(issueNumberFlag);
    const spinner = ora(`Assigning GitHub issue #${issueNumber}`).start();

    try {
      const { login, assigned } = await assignGitHubIssue(issueNumber);
      if (assigned) {
        spinner.succeed(`Assigned issue #${issueNumber} to ${login}`);
        return;
      }
      spinner.warn(
        `Issue #${issueNumber} was not assigned to ${login}. Assigning requires a token with push access to the repository.`,
      );
    } catch (error) {
      spinner.warn(
        `Could not assign issue #${issueNumber}. ${error instanceof Error ? error.message : String(error)}`,
      );
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

    // There is no issue to assign without one of them. Checked here rather than
    // beside the assignment itself so a malformed command line fails before the
    // issue fetch and the branch-name prompt, in the shape of the check above.
    if (flags.assign !== undefined && !flags.github && !flags.jira) {
      this.error("--assign/--no-assign requires either --github or --jira.");
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

    // Decided before the worktree exists (D7), so the prompt cannot appear
    // after the creation spinners or behind a launched editor. Being assigned
    // when creation then fails is bounded by the endpoint's own idempotency:
    // it does not replace existing assignees, so the retry is harmless.
    if (flags.jira && flags.assign) {
      this.warn("Assignment is not supported for Jira issues yet.");
    } else if (flags.github) {
      if (await this.shouldAssignGithubIssue(flags.assign)) {
        await this.assignGithubIssue(flags.github);
      }
    }

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
