import { Args, Flags } from "@oclif/core";
import {
  fetchClickUpTask,
  getClickUpBranchNaming,
} from "../integrations/clickup.js";
import {
  assignGitHubIssue,
  fetchGitHubIssue,
  getGitHubBranchNaming,
} from "../integrations/github.js";
import {
  assignJiraIssue,
  getJiraBranchNameFromIssue,
  getJiraBranchNaming,
} from "../integrations/jira.js";
import {
  fetchLinearIssue,
  getLinearBranchNaming,
} from "../integrations/linear.js";
import { BaseCommand, readAgentBrief } from "../lib/base-command.js";
import {
  type BranchNaming,
  formatBranchTypeRule,
  pasteReadyLine,
} from "../lib/branch-type.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import {
  gitCreateWorktree,
  gitFetch,
  gitFindBranchCheckout,
  gitGetConfigValue,
  gitGetLocalBranches,
  gitGetRemoteBranches,
  gitSetConfigValue,
} from "../lib/git.js";
import { type InstallResult, runInstall } from "../lib/install.js";
import { isNonInteractive } from "../lib/interaction.js";
import { createSpinner } from "../lib/progress.js";
import {
  ensurePostCreateApproved,
  getTeamConfigValue,
  loadProjectConfig,
  offerProjectConfig,
} from "../lib/project-config.js";
import {
  askConfirm,
  askInput,
  InvalidValueError,
  MissingValueError,
} from "../lib/prompt.js";
import type {
  BranchDocument,
  BranchDryRunDocument,
  BranchIssue,
  ConfigName,
  OpenOutcome,
} from "../lib/types.js";
import { isValidBranchName } from "../lib/validators.js";

/** A name derived from an issue; `naming` is set only on a dry run. */
interface DerivedName {
  branchName: string;
  issue: BranchIssue;
  naming?: BranchNaming;
}

export default class Branch extends BaseCommand {
  static override args = {
    branchName: Args.string({ description: "Name of the branch to create" }),
  };
  // The first line is the summary oclif lists in `worktree --help`; the rest is
  // the `--json` shape and exit codes, kept to key names and nullability.
  static override description = `Create a worktree branch

--assign (or github.autoAssign / jira.autoAssign) assigns a --github or --jira
issue to you; a Jira issue someone else holds is left alone.

--dry-run (with --github, --jira, --linear or --clickup) fetches the issue and
prints the branch name, the rule that chose its prefix and every field the issue
has a value for, with a paste-ready .worktree.yml line per value. It creates
nothing, assigns nothing, saves nothing and asks nothing.

--json prints one document on stdout:
path, branch, source, issue, assigned, envFilesCopied, installed, herdr,
agent, warnings
issue: {provider:"github", number, url|null}, {provider:"jira", key,
url|null}, {provider:"linear", key, url|null}, {provider:"clickup", key,
url|null} or null
assigned: true if the issue is yours after the run, false if it is not (held
by someone else, or the attempt failed), null if none was attempted
installed: {ran:true, command, steps[], from, inferred, ok, reason?} or
{ran:false, reason}
command is the step that failed, else the last that ran; steps are the ones
that ran, in order; from is "git-config", "project" or "lockfile"
herdr: {space, pane, agent|null}, or null if Herdr was not opened
agent: {name|null, kind|null, command[], prompted}, or null if none started
agent.prompted is the delivery receipt for a brief.
With --dry-run it prints one other document: dryRun, branch, issue, kind|null,
match, fields, warnings
match: {source:"rule", position, rule}, {source:"built-in"} or
{source:"none"}
fields: [{id, name, values:[{id|null, name|null, when}]}]
On failure: {error:{code, message, details?}} on stdout.

Exit codes:
0 success
1 failure, or the worktree was made but the install failed or the brief
was not delivered
2 usage: a value with no default is missing, a value is invalid, or the
--source branch does not exist, or the branch name is already taken (a
missing issue exits 1; declining to open an existing worktree exits 1)`;
  // One JSON document on stdout, everything human on stderr (D6).
  static override enableJsonFlag = true;
  static override examples = [
    "<%= config.bin %> <%= command.id %> my-new-branch",
    "<%= config.bin %> <%= command.id %> my-new-branch --source origin/main",
    "<%= config.bin %> <%= command.id %> --github 42",
    "<%= config.bin %> <%= command.id %> --github 42 --assign",
    "<%= config.bin %> <%= command.id %> --jira DEV-123",
    "<%= config.bin %> <%= command.id %> --jira DEV-123 --assign",
    "<%= config.bin %> <%= command.id %> --linear ENG-123",
    "<%= config.bin %> <%= command.id %> --clickup 9hx",
    "<%= config.bin %> <%= command.id %> --clickup DEV-123",
    '<%= config.bin %> <%= command.id %> --github 42 --agent "implement the issue"',
    "<%= config.bin %> <%= command.id %> --github 42 --agent-file brief.md",
    "<%= config.bin %> <%= command.id %> --github 42 --no-agent",
    "<%= config.bin %> <%= command.id %> my-new-branch --no-open",
    "<%= config.bin %> <%= command.id %> --github 42 --json",
    "<%= config.bin %> <%= command.id %> --jira DEV-123 --dry-run",
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
    linear: Flags.string({
      char: "l",
      description: "Create a branch from a Linear issue (issue identifier)",
    }),
    clickup: Flags.string({
      char: "c",
      description: "Create a branch from a ClickUp task (task id)",
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
        "Assign the issue to you when creating a branch from --github or --jira (not supported for --linear or --clickup yet)",
    }),
    // D13: the way to write branchType rules against a real issue. It is a
    // `branch` flag rather than a command so that the name it prints is the one
    // a real run would give.
    "dry-run": Flags.boolean({
      description:
        "With --github, --jira, --linear or --clickup: show the branch name, the rule that chose its prefix and the issue's fields, and create nothing",
    }),
    // Unset is meaningful: it defers to postCreate and the run's mode (D9), so
    // there is no `default`. `--no-install` is the one switch that wins over both.
    install: Flags.boolean({
      allowNo: true,
      description:
        "Install dependencies in the new worktree (on by default when non-interactive or postCreate is set; the project file's postCreate steps need your approval first, --no-install skips them)",
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
      // `run` fetched before it read the project file (D7).
      const remoteBranches = await gitGetRemoteBranches({ fetch: false });

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
    return (await getTeamConfigValue("defaultSourceBranch")) || "origin/main";
  }

  private validateBranchName(branchName: string) {
    const result = isValidBranchName(branchName);
    if (result !== true) {
      this.error(result);
    }
    return true;
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
  private async getGithubIssueBranchName(
    issueNumberFlag: string,
    dryRun: boolean,
  ): Promise<DerivedName> {
    const issueNumber = this.getGithubIssueNumber(issueNumberFlag);
    const spinner = createSpinner(
      `Fetching GitHub issue #${issueNumber}`,
    ).start();
    let fetched: {
      issue: Awaited<ReturnType<typeof fetchGitHubIssue>>;
      naming: BranchNaming;
    };
    try {
      const issue = await fetchGitHubIssue(issueNumber);
      if (issue.pullRequest) {
        // A pull request already has a branch; a new one named after its title
        // is never what was meant.
        // A ref name may hold `;`, `$` or a backtick, so only a name that
        // pastes as one shell word is put into the suggested command.
        const { headBranch } = issue.pullRequest;
        const suggestable = headBranch && /^[\w./-]+$/.test(headBranch);
        throw new InvalidValueError(
          `GitHub: #${issue.number} is a pull request, not an issue. ${
            suggestable
              ? `To work on its branch, run \`worktree checkout ${headBranch}\`.`
              : "To work on its branch, run `worktree checkout` and pick it."
          }`,
        );
      }
      const naming = await getGitHubBranchNaming(issue, (warning) =>
        this.warn(warning),
      );
      spinner.succeed();
      fetched = { issue, naming };
    } catch (error) {
      spinner.fail();
      throw error;
    }

    // After the spinner has settled, so a declined prompt is not reported as a
    // failed fetch as well.
    const { issue, naming } = fetched;
    if (issue.state === "closed") {
      await this.confirmClosedGithubIssue(issue, dryRun);
    }
    return {
      branchName: naming.branchName,
      naming,
      issue: {
        provider: "github",
        number: issue.number,
        url: issue.htmlUrl ?? null,
      },
    };
  }

  /**
   * Starting work on a closed issue is allowed but rarely meant. A run that
   * cannot ask carries on with the warning, so `--json` reports it in
   * `warnings`; declining ends the run before anything is created.
   */
  private async confirmClosedGithubIssue(
    issue: {
      number: number;
      stateReason: string | null;
    },
    dryRun: boolean,
  ) {
    const reason = issue.stateReason
      ? ` as ${issue.stateReason.replace(/_/g, " ")}`
      : "";
    const message = `Issue #${issue.number} is closed${reason}.`;
    // A dry run creates nothing, so there is nothing to confirm.
    if (dryRun || isNonInteractive()) {
      this.warn(message);
      return;
    }
    const proceed = await askConfirm(
      { message: `${message} Create a branch for it anyway?` },
      { value: "whether to branch from a closed issue", flag: "--github" },
    );
    if (!proceed) {
      // Not a usage error: the user answered, so it exits 1 rather than 2.
      this.error(`Not creating a branch for closed issue #${issue.number}.`, {
        exit: 1,
      });
    }
  }

  /**
   * A name that already exists cannot be created again, and git's own message
   * does not say which of four states it is in. The worktree list is asked
   * first because it answers an existing worktree, a checkout elsewhere and a
   * record whose directory is gone; the branch list only answers a branch with
   * no worktree. Returns true when an existing worktree was reopened.
   */
  private async reopenOrRefuseTakenBranch(
    branchName: string,
    flags: { "no-open"?: boolean; "no-agent"?: boolean },
    brief: string | undefined,
  ): Promise<boolean> {
    const checkout = await gitFindBranchCheckout(branchName);

    if (!checkout) {
      if ((await gitGetLocalBranches()).includes(branchName)) {
        throw new InvalidValueError(
          `Branch "${branchName}" already exists but has no worktree. Choose another branch name, or delete the branch with \`git branch -d ${branchName}\`.`,
        );
      }
      return false;
    }

    if (!checkout.inWorktreesRoot) {
      throw new InvalidValueError(
        `Branch "${branchName}" is already checked out at ${checkout.path}, outside the worktrees directory. Choose another branch name.`,
      );
    }
    if (!checkout.pathExists) {
      throw new InvalidValueError(
        `Branch "${branchName}" has a worktree record at ${checkout.path}, but that directory no longer exists. Run \`git worktree prune\` to clear it, then re-run.`,
      );
    }

    const exists = `Branch "${branchName}" already has a worktree at ${checkout.path}.`;
    // Opening unasked would start a second agent on a retried --agent run, and
    // a non-interactive run cannot ask (D2, D3).
    if (isNonInteractive()) {
      throw new InvalidValueError(
        `${exists} Run \`worktree open ${branchName}\` to open it, or choose another branch name.`,
      );
    }
    const reopen = await askConfirm(
      { message: `${exists} Open it instead?` },
      { value: "whether to open the existing worktree", flag: "worktree open" },
    );
    if (!reopen) {
      // Not a usage error: the user answered, so it exits 1 rather than 2.
      this.error(
        `Not opening the existing worktree for "${branchName}"; nothing was created.`,
        { exit: 1 },
      );
    }
    await this.openWorktreePath(checkout.path, {
      open: !flags["no-open"],
      agent: !flags["no-agent"],
      brief,
    });
    return true;
  }

  private async getJiraIssueBranchName(
    issueKeyFlag: string,
    dryRun: boolean,
  ): Promise<DerivedName> {
    const key = issueKeyFlag.trim().toUpperCase();
    const spinner = createSpinner(`Fetching Jira issue ${key}`).start();
    try {
      const onWarning = (warning: string) => this.warn(warning);
      const naming = dryRun
        ? await getJiraBranchNaming(issueKeyFlag, { onWarning, dryRun })
        : undefined;
      const branchName =
        naming?.branchName ??
        (await getJiraBranchNameFromIssue(issueKeyFlag, onWarning));
      spinner.succeed();
      // Built from the configured host, never from the credentials beside it.
      const host = (await getTeamConfigValue("jira.host"))
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/\/+$/, "");
      return {
        branchName,
        naming,
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

  private async getLinearIssueBranchName(
    issueIdFlag: string,
    dryRun: boolean,
  ): Promise<DerivedName> {
    const key = issueIdFlag.trim().toUpperCase();
    const spinner = createSpinner(`Fetching Linear issue ${key}`).start();
    try {
      // One fetch gives both the name and the url the API reports (D9).
      const issue = dryRun
        ? await fetchLinearIssue(issueIdFlag, { labelIds: true })
        : await fetchLinearIssue(issueIdFlag);
      const naming = await getLinearBranchNaming(issue, (warning) =>
        this.warn(warning),
      );
      spinner.succeed();
      return {
        branchName: naming.branchName,
        naming,
        issue: { provider: "linear", key: issue.identifier, url: issue.url },
      };
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }

  private async getClickUpTaskBranchName(
    taskIdFlag: string,
  ): Promise<DerivedName> {
    const typedId = taskIdFlag.trim();
    const spinner = createSpinner(`Fetching ClickUp task ${typedId}`).start();
    try {
      // One fetch gives both the name and the url the API reports (D9).
      const task = await fetchClickUpTask(taskIdFlag);
      const naming = await getClickUpBranchNaming(task, taskIdFlag, (warning) =>
        this.warn(warning),
      );
      spinner.succeed();
      return {
        branchName: naming.branchName,
        naming,
        issue: {
          provider: "clickup",
          key: task.customId ?? task.id,
          url: task.url,
        },
      };
    } catch (error) {
      spinner.fail();
      throw error;
    }
  }

  /**
   * Flag, then `configKey`, then true when non-interactive, then prompt. Each
   * provider has its own key (`github.autoAssign`, `jira.autoAssign`), tri-state
   * through unset: `true` always assigns, `false` never does, and unset means ask.
   *
   * The prompt persists its own answer and its text names the key it
   * writes, because a declined answer is otherwise invisible and permanent —
   * the feature would simply stop offering itself with nothing to point at.
   *
   * A non-interactive run that reaches this point assigns, and does not save
   * anything: an agent that named an issue asked for it to be worked, and
   * assigning is what says so. An explicit `false` never gets here, so it still
   * wins. The default is not persisted because one unattended run must not
   * settle the key for the human who runs this later.
   */
  private async shouldAssignIssue(configKey: ConfigName, assignFlag?: boolean) {
    return this.decideIssueAction(configKey, assignFlag, {
      question: "Assign this issue to you?",
      value: "whether to assign the issue",
      flag: "--assign or --no-assign",
    });
  }

  /**
   * Same precedence as `shouldAssignIssue`, for moving an issue to started:
   * `--start`/`--no-start`, then `configKey`, then true when non-interactive
   * (nothing saved), then a prompt that saves its answer under `configKey`.
   */
  private async shouldStartIssue(configKey: ConfigName, startFlag?: boolean) {
    return this.decideIssueAction(configKey, startFlag, {
      question: "Move this issue to started?",
      value: "whether to move the issue to started",
      flag: "--start or --no-start",
    });
  }

  private async decideIssueAction(
    configKey: ConfigName,
    flagValue: boolean | undefined,
    prompt: { question: string; value: string; flag: string },
  ) {
    if (flagValue !== undefined) {
      return flagValue;
    }

    const configured = await gitGetConfigValue(configKey);
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
        message: `${prompt.question} (saved as ${configKey}; change it later with \`worktree config ${configKey} <true|false>\`)`,
      },
      { value: prompt.value, flag: prompt.flag },
    );
    // The worktree is the deliverable (§2), and this write is only bookkeeping
    // about whether to assign or start. `gitSetConfigValue` does not swallow the way
    // `gitGetConfigValue` does, so an unwrapped failure here — a stale
    // `.git/config.lock` from a concurrent git process is the realistic one —
    // would reach BaseCommand.catch and cost the user the branch they asked
    // for, on a run they may well have answered "no" to.
    try {
      await gitSetConfigValue(configKey, String(answer));
    } catch (error) {
      this.warn(
        `Could not save ${configKey}, so you will be asked again next time. ${error instanceof Error ? error.message : String(error)}`,
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
   * assignees, which is what GitHub documents a write from an account without
   * push access to look like (not observed: #61 never ran that case).
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
      const message = `Issue #${issueNumber} was not assigned to ${login}. Assigning needs a token whose account has push access to the repository.`;
      spinner.warn(message);
      this.recordWarning(message);
    } catch (error) {
      const message = `Could not assign issue #${issueNumber}. ${error instanceof Error ? error.message : String(error)}`;
      spinner.warn(message);
      this.recordWarning(message);
    }
    return false;
  }

  /**
   * Same contract as `assignGithubIssue`: nothing here aborts `branch`. Jira
   * holds one assignee, so `assignJiraIssue` never writes over a colleague's
   * (D1); that outcome warns and reports `false`, as does every failure (D6).
   * Errors from the integration carry the API's own text and never a header.
   */
  private async assignJiraIssue(issueIdFlag: string): Promise<boolean> {
    const issueKey = issueIdFlag.trim().toUpperCase();
    const spinner = createSpinner(`Assigning Jira issue ${issueKey}`).start();

    try {
      const result = await assignJiraIssue(issueIdFlag);
      if (result.outcome !== "held-by-other") {
        spinner.succeed(
          result.outcome === "assigned"
            ? `Assigned ${issueKey} to ${result.displayName}`
            : `${issueKey} is already assigned to you`,
        );
        return true;
      }
      const message = `${issueKey} is already assigned to ${result.heldBy}, so it was left alone. Reassign it in Jira if it should be yours.`;
      spinner.warn(message);
      this.recordWarning(message);
    } catch (error) {
      const message = `Could not assign ${issueKey}. ${error instanceof Error ? error.message : String(error)}`;
      spinner.warn(message);
      this.recordWarning(message);
    }
    return false;
  }

  /** The name for whichever issue flag was given; `undefined` when none was. */
  private async deriveFromIssue(
    flags: {
      github?: string;
      jira?: string;
      linear?: string;
      clickup?: string;
    },
    dryRun: boolean,
  ): Promise<DerivedName | undefined> {
    if (flags.github) {
      return this.getGithubIssueBranchName(flags.github, dryRun);
    }
    if (flags.jira) {
      return this.getJiraIssueBranchName(flags.jira, dryRun);
    }
    if (flags.linear) {
      return this.getLinearIssueBranchName(flags.linear, dryRun);
    }
    if (flags.clickup) {
      return this.getClickUpTaskBranchName(flags.clickup);
    }
    return undefined;
  }

  /**
   * D13: the name, the rule behind its prefix and every field the issue has a
   * value for, with a line per value to paste into `.worktree.yml`. Everything
   * is said in words (`Rule:`, `id`), so none of it depends on colour.
   */
  private reportDryRun(derived: DerivedName): void {
    const { branchName, issue } = derived;
    const naming = derived.naming;
    if (!naming) {
      // deriveFromIssue returns a naming for every provider on a dry run.
      throw new Error("A dry run needs the naming the integration computed.");
    }
    const listName = `${issue.provider}.branchType`;
    const fields = naming.fields
      .filter((field) => field.values.length > 0)
      .map((field) => ({
        id: field.id,
        name: field.name,
        values: field.values.map((value) => ({
          id: value.id ?? null,
          name: value.name ?? null,
          when: pasteReadyLine(field, value),
        })),
      }));
    const match: BranchDryRunDocument["match"] =
      naming.match.source === "rule"
        ? {
            source: "rule",
            position: naming.match.position,
            rule: formatBranchTypeRule(naming.match.rule),
          }
        : naming.match;

    this.log("Dry run: nothing was created, assigned or saved.");
    this.log(`Branch name: ${branchName}`);
    this.log(
      match.source === "rule"
        ? `Rule: rule ${match.position} of ${listName}: ${match.rule}`
        : match.source === "built-in"
          ? `Rule: built-in mapping (the project file has no ${listName})`
          : `Rule: none matched in ${listName}, so the name has no prefix`,
    );
    this.log(
      fields.length > 0
        ? `Fields with a value (${fields.length}), each with a line to paste into ${listName}:`
        : "The issue has no field with a value.",
    );
    for (const field of fields) {
      this.log(`  ${field.name} (id ${field.id})`);
      for (const value of field.values) {
        const label = value.name ?? "(no name)";
        this.log(
          `    ${value.id === null ? label : `${label} (id ${value.id})`}`,
        );
        this.log(`      ${value.when}`);
      }
    }

    // Printed here rather than returned: `run` returns the `branch` document,
    // and a dry run's is another shape. `log` is silent under --json, so this
    // is the only thing on stdout.
    if (this.jsonEnabled()) {
      const document: BranchDryRunDocument = {
        dryRun: true,
        branch: branchName,
        issue,
        kind: naming.kind ?? null,
        match,
        fields,
        warnings: this.warnings,
      };
      this.logJson(document);
    }
  }

  private async getBranchName(
    branchNameArg?: string,
    flags?: {
      github?: string;
      jira?: string;
      linear?: string;
      clickup?: string;
    },
  ): Promise<{ branchName: string; issue: BranchIssue | null }> {
    if (
      !flags?.github &&
      !flags?.jira &&
      !flags?.linear &&
      !flags?.clickup &&
      branchNameArg &&
      this.validateBranchName(branchNameArg)
    ) {
      return { branchName: branchNameArg, issue: null };
    }

    const derived = await this.deriveFromIssue(flags ?? {}, false);
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

  // `undefined` is the interactive reopen of a worktree that already exists: it
  // creates nothing, so there is no document, and `--json` never reaches it
  // because that run is non-interactive and refuses instead (D3, D6).
  public async run(): Promise<BranchDocument | undefined> {
    const { args, flags } = await this.parse(Branch);
    if (
      [flags.github, flags.jira, flags.linear, flags.clickup].filter(Boolean)
        .length > 1
    ) {
      this.error(
        "Please provide only one of --github, --jira, --linear or --clickup, not several.",
      );
    }

    // There is no issue to assign without one of them. Checked here rather than
    // beside the assignment itself so a malformed command line fails before the
    // issue fetch and the branch-name prompt, in the shape of the check above.
    if (
      flags.assign !== undefined &&
      !flags.github &&
      !flags.jira &&
      !flags.linear &&
      !flags.clickup
    ) {
      this.error(
        "--assign/--no-assign requires one of --github, --jira, --linear or --clickup.",
      );
    }

    // D13: a dry run looks at one issue's name; with none there is nothing to
    // evaluate the rules against.
    const dryRun = flags["dry-run"] === true;
    if (
      dryRun &&
      !flags.github &&
      !flags.jira &&
      !flags.linear &&
      !flags.clickup
    ) {
      this.error(
        "--dry-run requires one of --github, --jira, --linear or --clickup.",
      );
    }

    // Read before anything is created: an empty or oversized brief is a usage
    // error, and it should not leave a worktree behind. A dry run starts no
    // agent, so the agent flags are ignored there.
    let brief: string | undefined;
    if (!dryRun) {
      try {
        brief = await readAgentBrief({
          agent: flags.agent,
          agentFile: flags["agent-file"],
          agentStdin: flags["agent-stdin"],
        });
      } catch (error) {
        this.error(error instanceof Error ? error.message : String(error));
      }

      // Also before anything is created (#75): a brief with no agent configured
      // to take it is a missing value, and finding that out after the tree exists
      // would leave an exit 0 with `agent: null`, or an error with no `path`.
      await this.assertBriefHasAnAgent({
        open: !flags["no-open"],
        agent: !flags["no-agent"],
        brief,
      });
    }

    // D7: the one fetch of this run, before the project file is read from
    // origin/HEAD, so a team change merged an hour ago applies to this branch.
    // Creation and the --source listing are told not to fetch again.
    // No spinner of its own: a non-interactive run's stderr is a contract
    // (agent-mode.test.ts), and this fetch used to sit under "Creating worktree".
    await gitFetch();

    // A file that cannot be used stops the run here (D4), before anything is
    // assigned, saved or created.
    const project = await loadProjectConfig();
    for (const warning of project.warnings) {
      this.warn(warning);
    }

    const configNames: ConfigName[] = !flags.source
      ? ["defaultSourceBranch"]
      : [];

    if (flags.jira) {
      configNames.push("jira.host", "jira.email", "jira.apiToken");
    }

    if (flags.linear) {
      configNames.push("linear.apiKey");
    }

    if (flags.clickup) {
      configNames.push("clickup.apiToken");
    }

    // If there is no source flag provided, make sure defaultSourceBranch is configured
    // A dry run asks nothing, and `verifyConfig` offers to run `config`.
    if (!dryRun) {
      await this.verifyConfig(configNames);
    }

    // The key has no default and the fetch needs it, so a run still without one
    // after the offer is a missing value, and it ends before a tree exists.
    if (flags.linear && !(await gitGetConfigValue("linear.apiKey"))) {
      throw new MissingValueError(
        "the Linear API key",
        "`worktree config linear.apiKey <key>`",
      );
    }
    if (flags.clickup && !(await gitGetConfigValue("clickup.apiToken"))) {
      throw new MissingValueError(
        "the ClickUp API token",
        "`worktree config clickup.apiToken <token>`",
      );
    }
    // Stops after naming (§4): no assignment, source, worktree or opener.
    if (dryRun) {
      const derived = await this.deriveFromIssue(flags, true);
      if (!derived) {
        throw new Error("--dry-run reached the fetch without an issue flag.");
      }
      this.reportDryRun(derived);
      return undefined;
    }

    const { branchName, issue } = await this.getBranchName(
      args.branchName,
      flags,
    );

    // After the final name is known (the prompt may have edited it) and before
    // anything is assigned, saved, fetched for a source or created (D1).
    if (await this.reopenOrRefuseTakenBranch(branchName, flags, brief)) {
      return undefined;
    }

    // D16: the file's postCreate steps are approved by this person, or the run
    // ends here, before an issue is assigned or a tree made. After the reopen
    // check, which runs no steps, so a taken name gets its own guidance rather
    // than an approval it would not use. A dry run runs nothing, so it
    // returned above without asking (D13).
    await ensurePostCreateApproved({ install: flags.install });

    // Decided before the worktree exists (D7), so the prompt cannot appear
    // after the creation spinners or behind a launched editor. Being assigned
    // when creation then fails is bounded by the endpoint's own idempotency:
    // it does not replace existing assignees, so the retry is harmless.
    // `null` until an assignment is attempted: "not attempted" and "failed"
    // are different facts for the document.
    let assigned: boolean | null = null;
    if (flags.linear && flags.assign) {
      this.warn("Assignment is not supported for Linear issues yet.");
    } else if (flags.clickup && flags.assign) {
      this.warn("Assignment is not supported for ClickUp tasks yet.");
    } else if (flags.github) {
      if (await this.shouldAssignIssue("github.autoAssign", flags.assign)) {
        assigned = await this.assignGithubIssue(flags.github);
      }
    } else if (flags.jira) {
      if (await this.shouldAssignIssue("jira.autoAssign", flags.assign)) {
        assigned = await this.assignJiraIssue(flags.jira);
      }
    }

    const sourceBranch = await this.getSourceBranch(flags.source);
    const projectPath = await gitCreateWorktree(branchName, sourceBranch, {
      fetch: false,
    });
    // Env files first: the agent starts working immediately, so it has to find a
    // worktree that is already complete. The editor stays last so its "Worktree
    // created" fallback remains the final line.
    // The report goes to stderr under `--json`, so stdout stays the document.
    // The file's `copy` patterns ride in the same call (D14), so what they
    // select is copied and listed with the env files, under the same selection.
    const envFilesCopied = await copyEnvFilesFromRootPath(projectPath, {
      report: this.jsonEnabled() ? "stderr" : "stdout",
      copy: project.status === "loaded" ? project.config.copy : undefined,
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

    // D21: after the worktree is open, so the offers never sit between the
    // person and their tree. The worktree is the deliverable (§2): nothing
    // here can fail the run.
    try {
      await offerProjectConfig();
    } catch (error) {
      this.warn(
        `Could not make the .worktree.yml offer. ${error instanceof Error ? error.message : String(error)}`,
      );
    }

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
