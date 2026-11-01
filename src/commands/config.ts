import { EOL } from "node:os";
import { Args, Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../lib/base-command.js";
import { commandExists } from "../lib/cli.js";
import { gitGetConfigValue, gitSetConfigValue } from "../lib/config.js";
import {
  CONFIG_NAMES,
  HERDR_CONFIG_NAMES,
  OPENER_KINDS,
  SECRET_CONFIG_NAMES,
  UNPROMPTED_CONFIG_NAMES,
} from "../lib/constants.js";
import { isNonInteractive } from "../lib/interaction.js";
import {
  approvePostCreate,
  isProjectFileKey,
  loadProjectConfig,
  offerProjectConfig,
  PROJECT_CONFIG_FILE,
  type ProjectConfig,
  ProjectConfigError,
  projectFileKeys,
  projectFileValue,
  showVisibly,
  summariseProjectFile,
  writeProjectFile,
} from "../lib/project-config.js";
import { askConfirm, askInput, askSelect } from "../lib/prompt.js";
import type { ConfigName, OpenerKind } from "../lib/types.js";
import { conjoin } from "../lib/utils.js";
import {
  isValidAgentKind,
  isValidBranch,
  isValidCommand,
  isValidCommandLine,
  isValidEmail,
  isValidWorkspaceId,
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
    approve: Flags.boolean({
      description:
        "Review and approve the postCreate steps in the project's .worktree.yml (terminal only)",
    }),
    list: Flags.boolean({
      char: "l",
      description: "List all available variables",
    }),
    missing: Flags.boolean({
      char: "m",
      description: "Only prompt missing variables",
    }),
    names: Flags.string({
      char: "n",
      description: "Comma-separated list of variable names to prompt",
    }),
    project: Flags.boolean({
      description:
        "Write a commented .worktree.yml from the team settings in your git config (never a personal or secret one), uncommitted",
    }),
    // Passed by the commands that delegate to this one mid-run (`branch`, via
    // verifyConfig), so the offers of D21 are not made before a worktree exists.
    "skip-offers": Flags.boolean({ hidden: true }),
  };

  /**
   * The project file, when there is a usable one. A file that cannot be used
   * is said so and treated as absent: `config` is how a person works around a
   * wrong team value, so it must keep working.
   */
  private async loadFile(): Promise<ProjectConfig | undefined> {
    try {
      const project = await loadProjectConfig();
      for (const warning of project.warnings) {
        this.warn(warning);
      }
      return project.status === "loaded" ? project.config : undefined;
    } catch (error) {
      if (error instanceof ProjectConfigError) {
        this.warn(error.message);
        return undefined;
      }
      throw error;
    }
  }

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
    const file = await this.loadFile();

    for (const variable of CONFIG_NAMES) {
      if (hidden.has(variable)) {
        continue;
      }

      const value = await gitGetConfigValue(variable);
      // File-derived text is shown with its control characters escaped (D16).
      const fromFile =
        file && isProjectFileKey(variable)
          ? projectFileValue(file, variable)
          : undefined;

      // The file's steps have their own summary line below; a bare name here
      // would read as unset.
      if (variable === "postCreate" && fromFile && !value) {
        continue;
      }
      if (missing && (value || fromFile)) {
        continue;
      }
      // Nothing prompts for it, so a `--missing` run has nothing to say (D7).
      if (
        missing &&
        (UNPROMPTED_CONFIG_NAMES as readonly string[]).includes(variable)
      ) {
        continue;
      }

      if (!value && fromFile) {
        this.log(
          `${variable}=${showVisibly(fromFile)} (${PROJECT_CONFIG_FILE})`,
        );
        count++;
        continue;
      }

      // A secret is listed as set and never shown: `worktree config <name>` is
      // the way to read one, by name.
      const shown = SECRET_CONFIG_NAMES.some((name) => name === variable)
        ? "***"
        : value;
      const source =
        value && fromFile
          ? value === fromFile
            ? ` (${PROJECT_CONFIG_FILE})`
            : ` (overrides ${PROJECT_CONFIG_FILE}: ${showVisibly(fromFile)})`
          : "";
      this.log(value ? `${variable}=${shown}${source}` : variable);
      count++;
    }

    if (missing && count === 0) {
      this.log("No variables have missing values");
    }

    if (file && !missing) {
      for (const line of summariseProjectFile(file)) {
        this.log(line);
      }
    }
  }

  /**
   * `worktree config <key> <value>` for a key the file sets (D19): says so,
   * shows both values and asks. Non-interactive, naming the key and value is
   * asking for it, so it proceeds and warns.
   */
  private async confirmOverride(name: ConfigName, value: string) {
    if (!isProjectFileKey(name)) {
      return true;
    }
    const file = await this.loadFile();
    const fromFile = file && projectFileValue(file, name);
    if (!fromFile) {
      return true;
    }
    const said = `${PROJECT_CONFIG_FILE} sets ${name} to ${showVisibly(fromFile)}. You are setting it to ${value}, which overrides the file for you only.`;
    if (isNonInteractive()) {
      this.warn(said);
      return true;
    }
    this.log(said);
    return askConfirm(
      { message: `Override ${name} for yourself?` },
      { value: `whether to override ${name}`, flag: "worktree config" },
    );
  }

  private getApplicableConfigNames(
    names?: string,
    hidden?: Set<ConfigName>,
  ): ConfigName[] {
    // Naming a key is asking for it. Someone configuring ahead of installing
    // Herdr has said what they want, so an explicit --names is never filtered.
    // A key with no prompt is not offered even by name: the group it would
    // open has nothing to ask for it (D7).
    const asked = (name: ConfigName) =>
      !(UNPROMPTED_CONFIG_NAMES as readonly string[]).includes(name);
    if (names) {
      return names
        .split(",")
        .filter((name) => CONFIG_NAMES.includes(name.trim() as ConfigName))
        .map((name) => name.trim() as ConfigName)
        .filter(asked);
    }

    return CONFIG_NAMES.filter((name) => asked(name) && !hidden?.has(name));
  }

  private async getPromptConfigNames(
    flags: { missing: boolean; names?: string },
    fileKeys: readonly ConfigName[],
  ): Promise<ConfigName[]> {
    // Not computed for a --names run: that path returns before the filter, and
    // `branch` delegates to exactly that form (base-command.ts), so probing
    // there would put a `which herdr` behind a plain `worktree branch`.
    const applicableConfigNames = flags.names
      ? this.getApplicableConfigNames(flags.names)
      : this.getApplicableConfigNames(
          undefined,
          await this.getHiddenConfigNames(),
        );

    // Naming a key with --names is asking for it, but a key the file supplies
    // is not missing, so --missing never asks for one (D19). A bare run never
    // asks what the file answers.
    if (flags.missing) {
      const configNames: ConfigName[] = [];
      for (const name of applicableConfigNames) {
        if (!fileKeys.includes(name) && !(await gitGetConfigValue(name))) {
          configNames.push(name);
        }
      }
      return configNames;
    }

    return flags.names
      ? applicableConfigNames
      : applicableConfigNames.filter((name) => !fileKeys.includes(name));
  }

  /**
   * The group question. Naming keys with `--names` is asking for them (R4), so
   * it is answered yes without asking, in both modes. A bare run walks every
   * key, so it asks, and a non-interactive one has no default.
   */
  private confirmGroup(message: string, group: string, names?: string) {
    if (names) {
      return true;
    }
    return askConfirm(
      { message },
      {
        value: `whether to configure ${group}`,
        flag: "--names <keys>",
      },
    );
  }

  private async getInputConfig(name: ConfigName, fallback: string = "") {
    const value = await gitGetConfigValue(name);
    return {
      default: value || fallback,
      prefill: value ? "editable" : "tab",
    } as const;
  }

  /**
   * One config question. A non-interactive run takes what the prompt would have
   * offered as its default, and fails naming `worktree config <name> <value>`
   * where that is empty and the validator rejects empty. Keys that hold a
   * secret are asked with `askInput` directly, because an empty default there
   * would write an empty token.
   */
  private async askConfigInput(
    name: ConfigName,
    config: Parameters<typeof askInput>[0],
    defaultValue?: string,
  ) {
    const offered = await this.getInputConfig(name, defaultValue);
    return askInput(
      { ...config, ...offered },
      {
        value: name,
        flag: `worktree config ${name} <value>`,
        fallback: offered.default,
      },
    );
  }

  private async renderInput(flags: { missing: boolean; names?: string }) {
    const file = await this.loadFile();
    const fileKeys = file ? projectFileKeys(file) : [];
    if (fileKeys.length > 0 && !flags.names) {
      this.log(
        `${PROJECT_CONFIG_FILE} sets ${fileKeys.join(", ")}, so the wizard does not ask for them. Change one for yourself with \`worktree config <key> <value>\`.`,
      );
    }
    const configNames = await this.getPromptConfigNames(flags, fileKeys);
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

    const hasLinearPrompt = configNames.some((name) =>
      name.startsWith("linear."),
    );

    const hasClickUpPrompt = configNames.some((name) =>
      name.startsWith("clickup."),
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
      (await this.confirmGroup(
        "Do you want to configure Jira integration?",
        "Jira",
        flags.names,
      ))
    ) {
      if (shouldPrompt("jira.host")) {
        // The stored host is the editable default; with none stored there is
        // no default, so Enter cannot write the example host. It stays in the
        // message as a hint only. A non-interactive run takes the stored host
        // and fails on none, because the validator rejects an empty one.
        const jiraHost = await this.askConfigInput("jira.host", {
          message: "Jira host (for example https://your-domain.atlassian.net)",
          validate: (value) =>
            value.trim() ? true : "Jira host cannot be empty",
        });
        await gitSetConfigValue("jira.host", jiraHost);
      }

      if (shouldPrompt("jira.email")) {
        const jiraEmail = await this.askConfigInput("jira.email", {
          message: "Jira email",
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
        const jiraApiToken = await askInput(
          { message: "Jira API token" },
          {
            value: "jira.apiToken",
            flag: "worktree config jira.apiToken <token>",
            // The stored token if there is one, never an empty one.
            fallback: (await gitGetConfigValue("jira.apiToken")) || undefined,
          },
        );
        // Only a real answer is written, as with `github.token`: a bare
        // `worktree config` prompts every key whatever it already holds, so an
        // empty (or whitespace-only) answer keeps the stored token instead of
        // clearing it.
        if (jiraApiToken.trim()) {
          await gitSetConfigValue("jira.apiToken", jiraApiToken.trim());
        }
      }

      if (shouldPrompt("jira.autoAssign")) {
        // Same shape as `github.autoAssign` (D7): anything but an explicit
        // "true" or "false" is normalised to the "ask me" choice.
        const storedJiraAutoAssign = await gitGetConfigValue("jira.autoAssign");
        const jiraAutoAssignDefault =
          storedJiraAutoAssign === "true" || storedJiraAutoAssign === "false"
            ? storedJiraAutoAssign
            : "";
        const jiraAutoAssign = await askSelect<"true" | "false" | "">(
          {
            message: "Should `branch --jira` assign the issue to you?",
            choices: [
              { name: "Yes, always", value: "true" },
              { name: "No, never", value: "false" },
              // Tri-state through unset (D3): this is also the way to keep
              // being asked at branch time.
              { name: "Ask me each time", value: "" },
            ],
            default: jiraAutoAssignDefault,
          },
          {
            value: "jira.autoAssign",
            flag: "worktree config jira.autoAssign <true|false>",
            fallback: jiraAutoAssignDefault,
          },
        );
        await gitSetConfigValue("jira.autoAssign", jiraAutoAssign);
      }
    }

    // Both GitHub keys sit behind one confirm, in the shape the Jira and Herdr
    // groups use. `github.token` had no block at all until this group existed:
    // it was in CONFIG_NAMES, so `--missing` listed it as missing and then
    // prompted nothing. A key without a block is a key that cannot be answered
    // here, which is the dead shape `github.autoAssign` would have inherited.
    if (
      hasGithubPrompt &&
      (await this.confirmGroup(
        "Do you want to configure GitHub issue options?",
        "GitHub",
        flags.names,
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
        const githubToken = await askInput(
          { message: "GitHub personal access token" },
          {
            value: "github.token",
            flag: "worktree config github.token <token>",
            fallback: (await gitGetConfigValue("github.token")) || undefined,
          },
        );
        // Only a real answer is written. The instruction line above invites an
        // empty one — it is how you say "use `gh auth token` instead" — and an
        // unconditional write would make taking that invitation clear a stored
        // PAT, on a bare `worktree config` that prompts every key whatever it
        // already holds. An answer of only spaces is that same answer: the
        // prompt does not trim, and a stored whitespace token reads back as
        // unset, so it is judged and written trimmed.
        if (githubToken.trim()) {
          await gitSetConfigValue("github.token", githubToken.trim());
        }
      }

      if (shouldPrompt("github.autoAssign")) {
        // Select values are compared with `===`, so anything but an explicit
        // "true" or "false" (unset, empty, a hand-edited oddity) is normalised
        // to the "ask me" choice before it becomes the default or the fallback.
        const storedAutoAssign = await gitGetConfigValue("github.autoAssign");
        const autoAssignDefault =
          storedAutoAssign === "true" || storedAutoAssign === "false"
            ? storedAutoAssign
            : "";
        const githubAutoAssign = await askSelect<"true" | "false" | "">(
          {
            message: "Should `branch --github` assign the issue to you?",
            choices: [
              { name: "Yes, always", value: "true" },
              { name: "No, never", value: "false" },
              // Empty is a valid answer as well as a valid state: the key is
              // tri-state through unset (D3), so this prompt has to be the way
              // to keep being asked at branch time, not only the way to settle it.
              { name: "Ask me each time", value: "" },
            ],
            default: autoAssignDefault,
          },
          {
            value: "github.autoAssign",
            flag: "worktree config github.autoAssign <true|false>",
            fallback: autoAssignDefault,
          },
        );
        await gitSetConfigValue("github.autoAssign", githubAutoAssign);
      }
    }

    // One confirm for the group, then the key and the start select. Like the
    // Jira group, nothing is validated against Linear here: the key is checked when
    // `branch --linear` first uses it.
    if (
      hasLinearPrompt &&
      (await this.confirmGroup(
        "Do you want to configure Linear integration?",
        "Linear",
        flags.names,
      ))
    ) {
      if (shouldPrompt("linear.apiKey")) {
        const linearKeyInstructions = [
          "To find or create your key, follow these steps:",
          " - Go to Linear -> Settings -> Security & access -> Personal API keys",
          " - Click 'New API key' and give it a label",
          " - Copy your new key",
        ];

        this.log(linearKeyInstructions.join(EOL) + EOL);
        // No default and no prefill, exactly as `jira.apiToken` is asked: a
        // key is not echoed back as a prompt default.
        const linearApiKey = await askInput(
          { message: "Linear API key" },
          {
            value: "linear.apiKey",
            flag: "worktree config linear.apiKey <key>",
            // The stored key if there is one, never an empty one.
            fallback: (await gitGetConfigValue("linear.apiKey")) || undefined,
          },
        );
        // Only a real answer is written, as with `github.token`: a bare
        // `worktree config` prompts every key whatever it already holds, so an
        // empty answer keeps the stored key instead of clearing it.
        if (linearApiKey.trim()) {
          await gitSetConfigValue("linear.apiKey", linearApiKey.trim());
        }
      }

      if (shouldPrompt("linear.autoStart")) {
        // Same shape as `github.autoAssign` (D10): anything but an explicit
        // "true" or "false" is normalised to the "ask me" choice.
        const storedLinearAutoStart =
          await gitGetConfigValue("linear.autoStart");
        const linearAutoStartDefault =
          storedLinearAutoStart === "true" || storedLinearAutoStart === "false"
            ? storedLinearAutoStart
            : "";
        const linearAutoStart = await askSelect<"true" | "false" | "">(
          {
            message:
              "Should `branch --linear` move the issue to started once the worktree exists?",
            choices: [
              { name: "Yes, always", value: "true" },
              { name: "No, never", value: "false" },
              // Tri-state through unset (D4): also the way to keep being asked.
              { name: "Ask me each time", value: "" },
            ],
            default: linearAutoStartDefault,
          },
          {
            value: "linear.autoStart",
            flag: "worktree config linear.autoStart <true|false>",
            fallback: linearAutoStartDefault,
          },
        );
        await gitSetConfigValue("linear.autoStart", linearAutoStart);
      }
    }

    // Three keys, one confirm. The token is required and secret, so it is asked
    // like `linear.apiKey`; the workspace id matters only to a custom task id
    // and most Workspaces have those off, so an empty answer skips it (as
    // `herdr.agent` and `postCreate` accept empty) and a non-interactive run
    // takes that empty default instead of failing. The start select comes last,
    // shaped like Linear's. Nothing is validated against ClickUp here: the
    // token is checked when `branch --clickup` first uses it.
    if (
      hasClickUpPrompt &&
      (await this.confirmGroup(
        "Do you want to configure ClickUp integration?",
        "ClickUp",
        flags.names,
      ))
    ) {
      if (shouldPrompt("clickup.apiToken")) {
        const clickUpTokenInstructions = [
          "To find your personal API token, follow these steps:",
          " - Go to ClickUp -> your avatar -> Settings -> Apps -> API Token",
          " - Click 'Generate' (or 'Regenerate') and copy the token",
        ];

        this.log(clickUpTokenInstructions.join(EOL) + EOL);
        // No default and no prefill, exactly as `jira.apiToken` is asked: a
        // token is not echoed back as a prompt default.
        const clickUpApiToken = await askInput(
          { message: "ClickUp API token" },
          {
            value: "clickup.apiToken",
            flag: "worktree config clickup.apiToken <token>",
            // The stored token if there is one, never an empty one.
            fallback:
              (await gitGetConfigValue("clickup.apiToken")) || undefined,
          },
        );
        // Only a real answer is written: an empty answer keeps the stored
        // token instead of clearing it.
        if (clickUpApiToken.trim()) {
          await gitSetConfigValue("clickup.apiToken", clickUpApiToken.trim());
        }
      }

      if (shouldPrompt("clickup.workspaceId")) {
        const clickUpWorkspaceId = await this.askConfigInput(
          "clickup.workspaceId",
          {
            message:
              "ClickUp workspace id (only for custom task ids like DEV-123; empty to skip)",
            validate: (value: string) =>
              value.trim() === "" || isValidWorkspaceId(value.trim()),
          },
        );
        // Empty skips the key rather than writing an empty value.
        if (clickUpWorkspaceId.trim()) {
          await gitSetConfigValue(
            "clickup.workspaceId",
            clickUpWorkspaceId.trim(),
          );
        }
      }

      if (shouldPrompt("clickup.autoStart")) {
        // Same shape as `linear.autoStart` (D10): anything but an explicit
        // "true" or "false" is normalised to the "ask me" choice.
        const storedClickUpAutoStart =
          await gitGetConfigValue("clickup.autoStart");
        const clickUpAutoStartDefault =
          storedClickUpAutoStart === "true" ||
          storedClickUpAutoStart === "false"
            ? storedClickUpAutoStart
            : "";
        const clickUpAutoStart = await askSelect<"true" | "false" | "">(
          {
            message:
              "Should `branch --clickup` move the task to in progress once the worktree exists?",
            choices: [
              { name: "Yes, always", value: "true" },
              { name: "No, never", value: "false" },
              // Tri-state through unset (D4): also the way to keep being asked.
              { name: "Ask me each time", value: "" },
            ],
            default: clickUpAutoStartDefault,
          },
          {
            value: "clickup.autoStart",
            flag: "worktree config clickup.autoStart <true|false>",
            fallback: clickUpAutoStartDefault,
          },
        );
        await gitSetConfigValue("clickup.autoStart", clickUpAutoStart);
      }
    }

    if (shouldPrompt("defaultSourceBranch")) {
      const defaultBranchName = await this.askConfigInput(
        "defaultSourceBranch",
        {
          message: "Which branch should new worktrees be based on?",
          validate: isValidBranch,
        },
        "origin/main",
      );
      await gitSetConfigValue("defaultSourceBranch", defaultBranchName);
    }

    if (
      hasBranchPrefixPrompt &&
      (await this.confirmGroup(
        "Do you want to configure branch name prefixes?",
        "branch name prefixes",
        flags.names,
      ))
    ) {
      if (shouldPrompt("branchPrefix.feature")) {
        const featurePrefix = await this.askConfigInput(
          "branchPrefix.feature",
          {
            message: "Prefix for feature branches",
          },
          "feature/",
        );
        await gitSetConfigValue("branchPrefix.feature", featurePrefix);
      }

      if (shouldPrompt("branchPrefix.bugfix")) {
        const bugfixPrefix = await this.askConfigInput(
          "branchPrefix.bugfix",
          {
            message: "Prefix for bugfix branches",
          },
          "fix/",
        );
        await gitSetConfigValue("branchPrefix.bugfix", bugfixPrefix);
      }

      if (shouldPrompt("branchPrefix.chore")) {
        const chorePrefix = await this.askConfigInput(
          "branchPrefix.chore",
          {
            message: "Prefix for chore branches",
          },
          "chore/",
        );
        await gitSetConfigValue("branchPrefix.chore", chorePrefix);
      }
    }

    if (
      shouldPrompt("opener") &&
      (await this.confirmGroup(
        "Do you want to choose where new worktrees are opened?",
        "the opener",
        flags.names,
      ))
    ) {
      // Select values are compared with `===`, so anything that is not one of
      // the three kinds (unset, empty, a hand-edited oddity) is normalised to
      // "editor" before it becomes the default or the non-interactive fallback.
      const storedOpener = await gitGetConfigValue("opener");
      const openerDefault =
        OPENER_KINDS.find((kind) => kind === storedOpener) ?? "editor";
      const opener = await askSelect<OpenerKind>(
        {
          message: "Which opener should new worktrees use?",
          choices: OPENER_KINDS.map((kind) => ({ name: kind, value: kind })),
          default: openerDefault,
        },
        {
          value: "opener",
          flag: "worktree config opener <editor|herdr|none>",
          fallback: openerDefault,
        },
      );
      await gitSetConfigValue("opener", opener);
    }

    if (
      shouldPrompt("codeEditor") &&
      (await this.confirmGroup(
        "Do you want to automatically open the worktree in a code editor?",
        "the code editor",
        flags.names,
      ))
    ) {
      const codeEditor = await this.askConfigInput(
        "codeEditor",
        {
          message: "Command to open code editor?",
          validate: isValidCommand,
        },
        "code",
      );
      await gitSetConfigValue("codeEditor", codeEditor);
    }

    if (
      hasHerdrPrompt &&
      (await this.confirmGroup(
        "Do you want to configure Herdr space options?",
        "Herdr",
        flags.names,
      ))
    ) {
      if (shouldPrompt("herdr.focus")) {
        // Only an explicit "false" means no: unset or empty is the documented
        // default of true. A non-interactive run takes that same answer.
        const focusDefault =
          (await gitGetConfigValue("herdr.focus")) !== "false";
        const herdrFocus = await askConfirm(
          {
            message: "Should opening a worktree focus its Herdr space?",
            default: focusDefault,
          },
          {
            value: "herdr.focus",
            flag: "worktree config herdr.focus <true|false>",
            fallback: focusDefault,
          },
        );
        await gitSetConfigValue("herdr.focus", String(herdrFocus));
      }

      if (shouldPrompt("herdr.agent")) {
        const herdrAgent = await this.askConfigInput("herdr.agent", {
          message:
            "Which agent kind should start in every new Herdr space? (empty: none, or with `--agent` the program `agent.command` names)",
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
      (await this.confirmGroup(
        "Do you want to set the command that `--agent` runs to start a coding agent?",
        "the coding agent",
        flags.names,
      ))
    ) {
      // No fallback default: the agent runtime is deliberately not named here.
      // Suggesting one would make this tool depend on a particular CLI, which
      // AGENT-MODE-PLAN §2 rules out.
      const agentCommand = await this.askConfigInput("agent.command", {
        message:
          "Command that `--agent` runs to start the coding agent (for example `claude --bg`)",
        validate: isValidCommandLine,
      });
      await gitSetConfigValue("agent.command", agentCommand);
    }

    if (
      shouldPrompt("postCreate") &&
      (await this.confirmGroup(
        "Do you want to run a command in new worktrees after they are created?",
        "the post-create command",
        flags.names,
      ))
    ) {
      const postCreate = await this.askConfigInput("postCreate", {
        message:
          "Command to run in each new worktree, for example `pnpm install` (empty to infer one from the lockfile)",
        // Empty is a valid answer, as it is for `herdr.agent`: `branch` infers
        // the command from the lockfile, so this prompt has to be the way to
        // decline a fixed one as well as to set one.
        validate: async (value: string) =>
          value.trim() === "" || (await isValidCommandLine(value.trim())),
      });
      await gitSetConfigValue("postCreate", postCreate.trim());
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

    if (flags.approve) {
      if (
        args.name ||
        flags.list ||
        flags.missing ||
        flags.names ||
        flags.project
      ) {
        this.error(
          "--approve cannot be combined with other arguments or flags.",
        );
      }
      await approvePostCreate();
      return;
    }

    if (flags.project) {
      if (args.name || flags.list || flags.missing || flags.names) {
        this.error(
          "--project cannot be combined with other arguments or flags.",
        );
      }
      const written = await writeProjectFile();
      this.log(
        `Wrote ${written.path} from ${written.keys.join(", ")}. It is not committed; review it, then commit it to the default branch.`,
      );
      return;
    }

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
        if (await this.confirmOverride(args.name, args.value)) {
          await gitSetConfigValue(args.name, args.value);
        }
        return;
      }
      // The value alone, secrets included (unlike `--list`, which masks them),
      // so `$(worktree config <name>)` is usable in a script. An unset key prints nothing and
      // exits 0, the same empty answer the rest of the CLI reads it as.
      const current = await gitGetConfigValue(args.name);
      if (current) {
        this.log(current);
      }
      return;
    }

    if (flags.list) {
      return this.renderList(flags.missing);
    }

    await this.renderInput(flags);
    // Not for a run another command delegated (`branch` before a worktree
    // exists), and not for one that named its keys (D21).
    if (!flags.names && !flags["skip-offers"]) {
      await offerProjectConfig();
    }
  }
}
