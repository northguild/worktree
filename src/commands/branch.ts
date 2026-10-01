import { Args, Flags } from "@oclif/core";
import { assignGitHubIssue, fetchGitHubIssue } from "../integrations/github.js";
import { getJiraBranchNameFromIssue } from "../integrations/jira.js";
import {
  BaseCommand,
  type OpenOutcome,
  readAgentBrief,
} from "../lib/base-command.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import {
  gitCreateWorktree,
  gitGetConfigValue,
  gitGetLocalBranches,
  gitGetRemoteBranches,
  gitSetConfigValue,
} from "../lib/git.js";
import { type InstallResult, runInstall } from "../lib/install.js";
import { isNonInteractive } from "../lib/interaction.js";
import { createSpinner } from "../lib/progress.js";
import { askConfirm, askInput } from "../lib/prompt.js";
import type { BranchDocument, BranchIssue, ConfigName } from "../lib/types.js";
import { slugifyBranchTitle } from "../lib/utils.js";
import { isValidBranchName } from "../lib/validators.js";

export default class Branch extends BaseCommand {
  static override args = {
    branchName: Args.string({ description: "Name of the branch to create" }),
  };
  static override description = "Create a worktree branch";
  // One JSON document on stdout, everything human on stderr (D6).
  static override enableJsonFlag = true;
  static override examples = [
    "<%= config.bin %> <%= command.id %> my-new-branch",
    "<%= config.bin %> <%= command.id %> my-new-branch --source origin/main",
    "<%= config.bin %> <%= command.id %> --github 42",
    "<%= config.bin %> <%= command.id %> --github 42 --assign",
    "<%= config.bin %> <%= command.id %> --jira DEV-123",
    '<%= config.bin %> <%= command.id %> --github 42 --agent "implement the issue"',
    "<%= config.bin %> <%= command.id %> --github 42 --agent-file brief.md",
    "<%= config.bin %> <%= command.id %> --github 42 --no-agent",
    "<%= config.bin %> <%= command.id %> my-new-branch --no-open",
    "<%= config.bin %> <%= command.id %> --github 42 --json",
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
    // The three brief sources are one choice (D13), and `--no-agent` says there
    // is no brief to deliver, so it excludes all of them.
    agent: Flags.string({
      char: "a",
      description:
        "Start the configured coding agent in the new worktree with this prompt",
      exclusive: ["agent-file", "agent-stdin", "no-agent"],
    }),
    "agent-file": Flags.string({
      description: "Like --agent, reading the prompt from this file",
      exclusive: ["agent", "agent-stdin", "no-agent"],
    }),
    "agent-stdin": Flags.boolean({
      description: "Like --agent, reading the prompt from stdin",
      exclusive: ["agent", "agent-file", "no-agent"],
    }),
    "no-agent": Flags.boolean({
      description: "Open the worktree but start no agent",
    }),
    "no-open": Flags.boolean({
      description:
        "Create the worktree and print its path, without opening it in Herdr or the editor",
    }),
    // Source-agnostic on purpose (D2). Jira has assignees too, and the
    // per-integration difference belongs in the config key rather than in the
    // flag name. `allowNo` gives `--no-assign` as the one-run override.
    assign: Flags.boolean({
      allowNo: true,
      description:
        "Assign the issue to you when creating a branch from --github",
    }),
    // Unset is meaningful: it defers to postCreate and the run's mode (D9), so
    // there is no `default`. `--no-install` is the one switch that wins over both.
    install: Flags.boolean({
      allowNo: true,
      description:
        "Install dependencies in the new worktree (on by default when non-interactive or postCreate is set)",
    }),
  };

  // Neither source question has a default: "no" quietly swaps in the
  // configured source branch, which is not what was asked for. A
  // non-interactive run names the source with an `origin/` flag instead.
  private confirmNonOriginSource(sourceFlag: string) {
    const message =
      "The source branch does not start with 'origin/'. Are you sure you want to use a local source?";
    return askConfirm(
      { message },
      {
        value: `whether to use the local source branch ${sourceFlag}`,
        flag: `--source origin/${sourceFlag}`,
      },
    );
  }

  private confirmRemoteNameConflict(sourceFlag: string) {
    const message =
      "A remote branch with the same name exists. Do you want to use the remote branch instead?";
    return askConfirm(
      { message },
      {
        value: `whether to use the remote branch origin/${sourceFlag}`,
        flag: `--source origin/${sourceFlag}`,
      },
    );
  }

  private async getSourceBranch(sourceFlag?: string) {
    if (sourceFlag) {
      const remoteBranches = await gitGetRemoteBranches();

      if (sourceFlag.startsWith("origin/")) {
        if (!remoteBranches.includes(sourceFlag)) {
          this.error(`Source branch doesn't exist: ${sourceFlag}`, {
            code: "not_found",
          });
        }
        return sourceFlag;
      }

      if (await this.confirmNonOriginSource(sourceFlag)) {
        const localBranches = await gitGetLocalBranches();
        if (!localBranches.includes(sourceFlag)) {
          this.error(`Source branch doesn't exist: ${sourceFlag}`, {
            code: "not_found",
          });
        }
        if (remoteBranches.includes(`origin/${sourceFlag}`)) {
          if (await this.confirmRemoteNameConflict(sourceFlag)) {
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

  /** The name derived from the issue, and the issue the document reports. */
  private async getGithubIssueBranchName(issueNumberFlag: string): Promise<{
    branchName: string;
    issue: BranchIssue;
  }> {
    const issueNumber = this.getGithubIssueNumber(issueNumberFlag);
    const spinner = createSpinner(
      `Fetching GitHub issue #${issueNumber}`,
    ).start();
    try {
      const issue = await fetchGitHubIssue(issueNumber);
      const prefix = await this.getGitHubBranchPrefix(issue.type?.name);
      spinner.succeed();
      return {
        branchName: `${prefix}${issue.number}-${slugifyBranchTitle(issue.title)}`,
        issue: {
          provider: "github",
          number: issue.number,
          url: issue.htmlUrl ?? null,
        },
      };
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }

  private async getJiraIssueBranchName(issueKeyFlag: string): Promise<{
    branchName: string;
    issue: BranchIssue;
  }> {
    const key = issueKeyFlag.trim().toUpperCase();
    const spinner = createSpinner(`Fetching Jira issue ${key}`).start();
    try {
      const branchName = await getJiraBranchNameFromIssue(issueKeyFlag);
      spinner.succeed();
      // Built from the configured host, never from the credentials beside it.
      const host = (await gitGetConfigValue("jira.host"))
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
      return {
        branchName,
        issue: {
          provider: "jira",
          key,
          url: host ? `https://${host}/browse/${key}` : null,
        },
      };
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }

  /**
   * Flag, then config, then true when non-interactive, then prompt (D4, D8). The key is tri-state through unset
   * (D3): `true` always assigns, `false` never does, and unset means ask.
   *
   * The prompt persists its own answer (D5) and its text names the key it
   * writes, because a declined answer is otherwise invisible and permanent —
   * the feature would simply stop offering itself with nothing to point at.
   *
   * A non-interactive run that reaches this point assigns, and does not save
   * anything (D8): an agent that named an issue asked for it to be worked, and
   * assigning is what says so. An explicit `false` never gets here, so it still
   * wins. The default is not persisted because one unattended run must not
   * settle the key for the human who runs this later.
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

    if (isNonInteractive()) {
      return true;
    }

    const answer = await askConfirm(
      {
        message:
          "Assign this issue to you? (saved as github.autoAssign; change it later with `worktree config github.autoAssign <true|false>`)",
      },
      {
        value: "whether to assign the issue",
        flag: "--assign or --no-assign",
      },
    );
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
  private async assignGithubIssue(issueNumberFlag: string): Promise<boolean> {
    const issueNumber = this.getGithubIssueNumber(issueNumberFlag);
    const spinner = createSpinner(
      `Assigning GitHub issue #${issueNumber}`,
    ).start();

    try {
      const { login, assigned } = await assignGitHubIssue(issueNumber);
      if (assigned) {
        spinner.succeed(`Assigned issue #${issueNumber} to ${login}`);
        return true;
      }
      const message = `Issue #${issueNumber} was not assigned to ${login}. Assigning requires a token with push access to the repository.`;
      spinner.warn(message);
      this.recordWarning(message);
    } catch (error) {
      const message = `Could not assign issue #${issueNumber}. ${error instanceof Error ? error.message : String(error)}`;
      spinner.warn(message);
      this.recordWarning(message);
    }
    return false;
  }

  private async getBranchName(
    branchNameArg?: string,
    flags?: { github?: string; jira?: string },
  ): Promise<{ branchName: string; issue: BranchIssue | null }> {
    if (
      !flags?.github &&
      !flags?.jira &&
      branchNameArg &&
      this.validateBranchName(branchNameArg)
    ) {
      return { branchName: branchNameArg, issue: null };
    }

    const derived = flags?.github
      ? await this.getGithubIssueBranchName(flags.github)
      : flags?.jira
        ? await this.getJiraIssueBranchName(flags.jira)
        : undefined;
    const defaultValue = derived?.branchName ?? "";

    const branchName = await askInput(
      {
        message: "Branch name",
        default: defaultValue,
        prefill: "editable",
        validate: isValidBranchName,
      },
      {
        value: "the branch name",
        flag: "<branchName>",
        // The pre-filled name is the default; with no issue there is none.
        fallback: defaultValue || undefined,
      },
    );

    return { branchName, issue: derived?.issue ?? null };
  }

  public async run(): Promise<BranchDocument> {
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

    // Read before anything is created: an empty or oversized brief is a usage
    // error, and it should not leave a worktree behind.
    let brief: string | undefined;
    try {
      brief = await readAgentBrief({
        agent: flags.agent,
        agentFile: flags["agent-file"],
        agentStdin: flags["agent-stdin"],
      });
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }

    // Also before anything is created (#75): with a brief and Herdr as the
    // opener, no agent kind is a usage error, and finding that out after the
    // tree exists would leave `--json` an error document with no `path`.
    await this.assertAgentKindForBrief({
      open: !flags["no-open"],
      agent: !flags["no-agent"],
      brief,
    });

    const configNames: ConfigName[] = !flags.source
      ? ["defaultSourceBranch"]
      : [];

    if (flags.jira) {
      configNames.push("jira.host", "jira.email", "jira.apiToken");
    }

    // If there is no source flag provided, make sure defaultSourceBranch is configured
    await this.verifyConfig(configNames);
    const { branchName, issue } = await this.getBranchName(
      args.branchName,
      flags,
    );

    // Decided before the worktree exists (D7), so the prompt cannot appear
    // after the creation spinners or behind a launched editor. Being assigned
    // when creation then fails is bounded by the endpoint's own idempotency:
    // it does not replace existing assignees, so the retry is harmless.
    // `null` until an assignment is attempted: "not attempted" and "failed"
    // are different facts for the document.
    let assigned: boolean | null = null;
    if (flags.jira && flags.assign) {
      this.warn("Assignment is not supported for Jira issues yet.");
    } else if (flags.github) {
      if (await this.shouldAssignGithubIssue(flags.assign)) {
        assigned = await this.assignGithubIssue(flags.github);
      }
    }

    const sourceBranch = await this.getSourceBranch(flags.source);
    const projectPath = await gitCreateWorktree(branchName, sourceBranch);
    // Env files first: the agent starts working immediately, so it has to find a
    // worktree that is already complete. The editor stays last so its "Worktree
    // created" fallback remains the final line.
    // The report goes to stderr under `--json`, so stdout stays the document.
    const envFilesCopied = await copyEnvFilesFromRootPath(projectPath, {
      report: this.jsonEnabled() ? "stderr" : "stdout",
    });

    // Before the agent and before any opener: both start working in the tree at
    // once, and one dropped into a tree without its dependencies is worse than
    // none. A failure keeps the tree (§2, the worktree is the deliverable) and
    // stops here, so the handoff never starts in a broken one.
    const installed = await runInstall(projectPath, flags.install);
    if (installed.ran && !installed.ok) {
      const message = `\`${installed.command}\` failed (${installed.reason}). The worktree was created at ${projectPath}, but nothing was opened and no agent was started. Fix the install there and run \`worktree open ${branchName}\`, or run \`worktree remove ${branchName} -f\` and re-run with --no-install.`;

      if (!this.jsonEnabled()) {
        this.error(message, { exit: 1 });
      }

      // The document is the report of a tree that exists, so it is still
      // printed — with `installed.ok: false`, the message in `warnings` and
      // exit 1 — rather than an error document that would leave out the path.
      this.warn(message);
      process.exitCode = 1;
      return this.toDocument({
        projectPath,
        branchName,
        sourceBranch,
        issue,
        assigned,
        envFilesCopied,
        installed,
      });
    }

    const outcome = await this.openWorktreePath(projectPath, {
      open: !flags["no-open"],
      agent: !flags["no-agent"],
      brief,
    });

    return this.toDocument({
      projectPath,
      branchName,
      sourceBranch,
      issue,
      assigned,
      envFilesCopied,
      installed,
      outcome,
    });
  }

  private toDocument({
    projectPath,
    branchName,
    sourceBranch,
    issue,
    assigned,
    envFilesCopied,
    installed,
    outcome,
  }: {
    projectPath: string;
    branchName: string;
    sourceBranch: string;
    issue: BranchIssue | null;
    assigned: boolean | null;
    envFilesCopied: string[];
    installed: InstallResult;
    outcome?: OpenOutcome;
  }): BranchDocument {
    return {
      path: projectPath,
      branch: branchName,
      source: sourceBranch,
      issue,
      assigned,
      envFilesCopied,
      installed,
      herdr: outcome?.herdr ?? null,
      agent: outcome?.agent ?? null,
      warnings: this.warnings,
    };
  }
}
