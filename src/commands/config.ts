import { EOL } from "node:os";
import { confirm, input } from "@inquirer/prompts";
import { Args, Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../lib/base-command.js";
import { commandExists } from "../lib/cli.js";
import {
  CONFIG_NAMES,
  HERDR_CONFIG_NAMES,
  OPENER_KINDS,
} from "../lib/constants.js";
import { gitGetConfigValue, gitSetConfigValue } from "../lib/git.js";
import type { ConfigName } from "../lib/types.js";
import { conjoin } from "../lib/utils.js";
import {
  isValidAgentKind,
  isValidBoolean,
  isValidBranch,
  isValidCommand,
  isValidCommandLine,
  isValidEmail,
  isValidOpener,
  validateConfigValue,
} from "../lib/validators.js";

export default class Config extends BaseCommand {
  static override description = "Configure worktree CLI settings";
  static override examples = ["<%= config.bin %> <%= command.id %>"];
  static override args = {
    name: Args.string(),
    value: Args.string(),
  };
  static override flags = {
    list: Flags.boolean({
      char: "l",
      description: "List all available variables",
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Answer yes to all prompts",
    }),
    missing: Flags.boolean({
      char: "m",
      description: "Only prompt missing variables",
    }),
    names: Flags.string({
      char: "n",
      description: "Comma-separated list of variable names to prompt",
    }),
  };

  /**
   * The Herdr keys to keep out of sight. Someone without the `herdr` binary has
   * no use for any of them, and listing or prompting for them is the whole of
   * what this feature would otherwise cost them.
   *
   * A key that already holds a value is never hidden: a machine that configured
   * Herdr and later lost the binary should still be told what it set.
   */
  private async getHiddenConfigNames(): Promise<Set<ConfigName>> {
    // An explicit `opener=herdr` is an opt-in, and it governs the other two, so
    // it un-hides all of them. A shell that has not picked up `herdr` on PATH
    // yet should not make the keys of someone who plainly uses it disappear.
    if ((await gitGetConfigValue("opener")) === "herdr") {
      return new Set();
    }

    if (await commandExists("herdr")) {
      return new Set();
    }

    const hidden = new Set<ConfigName>();
    for (const name of HERDR_CONFIG_NAMES) {
      if (!(await gitGetConfigValue(name))) {
        hidden.add(name);
      }
    }
    return hidden;
  }

  private async renderList(missing: boolean) {
    let count = 0;
    const hidden = await this.getHiddenConfigNames();

    for (const variable of CONFIG_NAMES) {
      if (hidden.has(variable)) {
        continue;
      }

      const value = await gitGetConfigValue(variable);

      if (missing && value) {
        continue;
      }

      this.log(value ? `${variable}=${value}` : variable);
      count++;
    }

    if (missing && count === 0) {
      this.log("No variables have missing values");
    }
  }

  private getApplicableConfigNames(
    names?: string,
    hidden?: Set<ConfigName>,
  ): ConfigName[] {
    // Naming a key is asking for it. Someone configuring ahead of installing
    // Herdr has said what they want, so an explicit --names is never filtered.
    if (names) {
      return names
        .split(",")
        .filter((name) => CONFIG_NAMES.includes(name.trim() as ConfigName))
        .map((name) => name.trim() as ConfigName);
    }

    return CONFIG_NAMES.filter((name) => !hidden?.has(name));
  }

  private async getPromptConfigNames(flags: {
    missing: boolean;
    yes: boolean;
    names?: string;
  }): Promise<ConfigName[]> {
    // Not computed for a --names run: that path returns before the filter, and
    // `branch` delegates to exactly that form (base-command.ts), so probing
    // there would put a `which herdr` behind a plain `worktree branch`.
    const applicableConfigNames = flags.names
      ? this.getApplicableConfigNames(flags.names)
      : this.getApplicableConfigNames(
          undefined,
          await this.getHiddenConfigNames(),
        );

    if (flags.missing) {
      const configNames: ConfigName[] = [];
      for (const name of applicableConfigNames) {
        if (!(await gitGetConfigValue(name))) {
          configNames.push(name);
        }
      }
      return configNames;
    }

    return applicableConfigNames;
  }

  private maybePrompt(message: string, alwaysYes = false) {
    if (alwaysYes) {
      return true;
    }
    return confirm({ message });
  }

  private async getInputConfig(name: ConfigName, fallback: string = "") {
    const value = await gitGetConfigValue(name);
    return {
      default: value || fallback,
      prefill: value ? "editable" : "tab",
    } as const;
  }

  private async renderInput(flags: {
    missing: boolean;
    yes: boolean;
    names?: string;
  }) {
    const configNames = await this.getPromptConfigNames(flags);
    const hasJiraPrompt = configNames.some((name) => name.startsWith("jira"));
    const hasBranchPrefixPrompt = configNames.some((name) =>
      name.startsWith("branchPrefix"),
    );
    const hasHerdrPrompt = configNames.some((name) =>
      name.startsWith("herdr."),
    );
    const hasGithubPrompt = configNames.some((name) =>
      name.startsWith("github."),
    );

    // First check if there is anything to prompt
    if (configNames.length === 0) {
      this.log("No missing config found.");
      return;
    }

    function shouldPrompt(name: ConfigName) {
      return configNames.includes(name);
    }

    if (
      hasJiraPrompt &&
      (await this.maybePrompt(
        "Do you want to configure Jira integration?",
        flags.yes,
      ))
    ) {
      if (shouldPrompt("jira.host")) {
        const jiraHost = await input({
          message: "Jira host",
          default: "example.atlassian.com",
        });
        await gitSetConfigValue("jira.host", jiraHost);
      }

      if (shouldPrompt("jira.email")) {
        const jiraEmail = await input({
          message: "Jira email",
          ...(await this.getInputConfig("jira.email")),
          validate: isValidEmail,
        });
        await gitSetConfigValue("jira.email", jiraEmail);
      }

      if (shouldPrompt("jira.apiToken")) {
        const jiraTokenInstructions = [
          "To find or create your token, follow these steps:",
          " - Go to https://id.atlassian.com/manage-profile/security/api-tokens",
          " - Click 'Create Classic API token'",
          " - Give your token a name and expiration date.",
          " - Copy your new token",
        ];

        this.log(jiraTokenInstructions.join(EOL) + EOL);
        const jiraApiToken = await input({
          message: "Jira API token",
        });
        await gitSetConfigValue("jira.apiToken", jiraApiToken);
      }
    }

    // Both GitHub keys sit behind one confirm, in the shape the Jira and Herdr
    // groups use. `github.token` had no block at all until this group existed:
    // it was in CONFIG_NAMES, so `--missing` listed it as missing and then
    // prompted nothing. A key without a block is a key that cannot be answered
    // here, which is the dead shape `github.autoAssign` would have inherited.
    if (
      hasGithubPrompt &&
      (await this.maybePrompt(
        "Do you want to configure GitHub issue options?",
        flags.yes,
      ))
    ) {
      if (shouldPrompt("github.token")) {
        const githubTokenInstructions = [
          "To find or create your token, follow these steps:",
          " - Go to https://github.com/settings/personal-access-tokens/new",
          " - Give the token access to the repositories you use worktree with",
          " - Copy your new token",
          "Leave this empty to let `gh auth token` supply one instead.",
        ];

        this.log(githubTokenInstructions.join(EOL) + EOL);
        // No default and no prefill, exactly as `jira.apiToken` is asked: a
        // token is not echoed back as a prompt default.
        const githubToken = await input({
          message: "GitHub personal access token",
        });
        // Only a real answer is written. The instruction line above invites an
        // empty one — it is how you say "use `gh auth token` instead" — and an
        // unconditional write would make taking that invitation clear a stored
        // PAT, on a bare `worktree config` that prompts every key whatever it
        // already holds.
        if (githubToken) {
          await gitSetConfigValue("github.token", githubToken);
        }
      }

      if (shouldPrompt("github.autoAssign")) {
        const githubAutoAssign = await input({
          message:
            "Should `branch --github` assign the issue to you? (leave unset to be asked each time)",
          ...(await this.getInputConfig("github.autoAssign")),
          // Empty is a valid answer as well as a valid state: the key is
          // tri-state through unset (D3), so this prompt has to be the way to
          // keep being asked at branch time, not only the way to settle it.
          validate: (value: string) =>
            value.trim() === "" || isValidBoolean(value.trim()),
        });
        await gitSetConfigValue("github.autoAssign", githubAutoAssign.trim());
      }
    }

    if (shouldPrompt("defaultSourceBranch")) {
      const defaultBranchName = await input({
        message: "Which branch should new worktrees be based on?",
        ...(await this.getInputConfig("defaultSourceBranch", "origin/main")),
        validate: isValidBranch,
      });
      await gitSetConfigValue("defaultSourceBranch", defaultBranchName);
    }

    if (
      hasBranchPrefixPrompt &&
      (await this.maybePrompt(
        "Do you want to configure branch name prefixes?",
        flags.yes,
      ))
    ) {
      if (shouldPrompt("branchPrefix.feature")) {
        const featurePrefix = await input({
          message: "Prefix for feature branches",
          ...(await this.getInputConfig("branchPrefix.feature", "feature/")),
        });
        await gitSetConfigValue("branchPrefix.feature", featurePrefix);
      }

      if (shouldPrompt("branchPrefix.bugfix")) {
        const bugfixPrefix = await input({
          message: "Prefix for bugfix branches",
          ...(await this.getInputConfig("branchPrefix.bugfix", "fix/")),
        });
        await gitSetConfigValue("branchPrefix.bugfix", bugfixPrefix);
      }

      if (shouldPrompt("branchPrefix.chore")) {
        const chorePrefix = await input({
          message: "Prefix for chore branches",
          ...(await this.getInputConfig("branchPrefix.chore", "chore/")),
        });
        await gitSetConfigValue("branchPrefix.chore", chorePrefix);
      }
    }

    if (
      shouldPrompt("opener") &&
      (await this.maybePrompt(
        "Do you want to choose where new worktrees are opened?",
        flags.yes,
      ))
    ) {
      const opener = await input({
        message: `Which opener should new worktrees use? (${conjoin(OPENER_KINDS, "or")})`,
        ...(await this.getInputConfig("opener", "editor")),
        validate: isValidOpener,
      });
      await gitSetConfigValue("opener", opener);
    }

    if (
      shouldPrompt("codeEditor") &&
      (await this.maybePrompt(
        "Do you want to automatically open the worktree in a code editor?",
        flags.yes,
      ))
    ) {
      const codeEditor = await input({
        message: "Command to open code editor?",
        ...(await this.getInputConfig("codeEditor", "code")),
        validate: isValidCommand,
      });
      await gitSetConfigValue("codeEditor", codeEditor);
    }

    if (
      hasHerdrPrompt &&
      (await this.maybePrompt(
        "Do you want to configure Herdr space options?",
        flags.yes,
      ))
    ) {
      if (shouldPrompt("herdr.focus")) {
        const herdrFocus = await input({
          message: "Should opening a worktree focus its Herdr space?",
          ...(await this.getInputConfig("herdr.focus", "true")),
          validate: isValidBoolean,
        });
        await gitSetConfigValue("herdr.focus", herdrFocus);
      }

      if (shouldPrompt("herdr.agent")) {
        const herdrAgent = await input({
          message:
            "Which agent should start in a new Herdr space? (empty for none)",
          ...(await this.getInputConfig("herdr.agent")),
          // Empty is not a valid kind, but it is a valid answer: the key is
          // opt-in (D9), so this prompt has to be the way to decline as well as
          // the way to choose, or a `--missing` run would force an agent on
          // someone who does not want one.
          validate: (value: string) =>
            value.trim() === "" || isValidAgentKind(value.trim()),
        });
        await gitSetConfigValue("herdr.agent", herdrAgent.trim());
      }
    }

    if (
      shouldPrompt("agent.command") &&
      (await this.maybePrompt(
        "Do you want to hand new worktrees to a coding agent?",
        flags.yes,
      ))
    ) {
      // No fallback default: the agent runtime is deliberately not named here.
      // Suggesting one would make this tool depend on a particular CLI, which
      // AGENT-MODE-PLAN §2 rules out.
      const agentCommand = await input({
        message: "Command to start the coding agent?",
        ...(await this.getInputConfig("agent.command")),
        validate: isValidCommandLine,
      });
      await gitSetConfigValue("agent.command", agentCommand);
    }

    this.log(`${chalk.green("✔")} Configuration complete!${EOL}`);
  }

  private isValidArgName(name: string): name is ConfigName {
    return CONFIG_NAMES.includes(name as ConfigName);
  }

  public async run(): Promise<void> {
    const { args, flags } = await this.parse(Config);

    // Mark that config has been called at least once
    await gitSetConfigValue("has-called-config", "true");

    if (args.name) {
      if (!this.isValidArgName(args.name)) {
        // Offer only what this machine can use: naming the Herdr keys here is
        // the last place the feature would show itself to someone without it.
        const hidden = await this.getHiddenConfigNames();
        const available = CONFIG_NAMES.filter((name) => !hidden.has(name));

        this.error(
          [
            `Unknown config name: ${args.name}`,
            `Available variables: ${conjoin(available)}`,
          ].join(EOL),
        );
      }

      if (args.value) {
        await validateConfigValue(args.name, args.value);
        await gitSetConfigValue(args.name, args.value);
        return;
      }
      await gitGetConfigValue(args.name);
      return;
    }

    if (flags.list) {
      return this.renderList(flags.missing);
    }

    return this.renderInput(flags);
  }
}
