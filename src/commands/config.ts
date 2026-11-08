import { EOL } from "node:os";
import { Args, Flags } from "@oclif/core";
import { isRexInstalled } from "../integrations/rex.js";
import { BaseCommand } from "../lib/base-command.js";
import { commandExists } from "../lib/cli.js";
import {
  getConfigValue,
  gitGetConfigValue,
  gitSetConfigValue,
} from "../lib/config.js";
import {
  isJiraDataCenter,
  type WizardContext,
} from "../lib/config-wizard/context.js";
import { getStoredOpener } from "../lib/config-wizard/opening.js";
import { runWizard } from "../lib/config-wizard/run.js";
import {
  CONFIG_NAMES,
  HERDR_CONFIG_NAMES,
  REX_CONFIG_NAMES,
  SECRET_CONFIG_NAMES,
  UNPROMPTED_CONFIG_NAMES,
} from "../lib/constants.js";
import { gitGetTopLevelPath } from "../lib/git.js";
import { isNonInteractive } from "../lib/interaction.js";
import {
  approvePostCreate,
  isProjectFileKey,
  loadProjectConfig,
  markProjectConfigUnusable,
  offerProjectConfig,
  PROJECT_CONFIG_FILE,
  type ProjectConfig,
  ProjectConfigError,
  projectFileKeys,
  projectFileValue,
  resetProjectConfigCache,
  showVisibly,
  summariseProjectFile,
  writeProjectFile,
} from "../lib/project-config.js";
import { askConfirm } from "../lib/prompt.js";
import type { ConfigName } from "../lib/types.js";
import {
  assertUserFileKey,
  loadUserConfigForRepair,
  resetUserConfigCache,
  type UserConfig,
  userConfigLabel,
  userFileKeys,
  userFileValue,
  writeUserConfigValue,
} from "../lib/user-config.js";
import { conjoin } from "../lib/utils.js";
import {
  validateConfigValue,
  validateUserConfigValue,
} from "../lib/validators.js";

/** The origin `--list` gives a value read from the user file (#281 D11). */
const USER_CONFIG_ORIGIN = "user config";

/** Whether the current directory is inside a git work tree. */
async function isInsideRepository() {
  return gitGetTopLevelPath().then(
    () => true,
    () => false,
  );
}

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
    user: Flags.boolean({
      description:
        "With a key and a value, write it to your user config file, which holds personal defaults for every repository",
    }),
    // Passed by the commands that delegate to this one mid-run (`branch`, via
    // verifyConfig), so the project-config step of D21 (the silent removal and
    // the offer) does not run before a worktree exists.
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
        markProjectConfigUnusable();
        this.projectUnusable = true;
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The user config file, when there is a usable one. Like the project file, a
   * file that cannot be used is said so and treated as absent for the rest of
   * the run, because `config` is how a person gets past it.
   */
  private loadUser() {
    this.userFile ??= this.readUser();
    return this.userFile;
  }

  // Set where a file is treated as absent for this run, so `run` undoes it.
  private userUnusable = false;
  private projectUnusable = false;

  private userFile?: Promise<{ config?: UserConfig; path: string }>;

  /**
   * Not up front, and not throwing: this is the command that repairs a file
   * every other command stops on (#281 §5). `readUser` reads it the forgiving
   * way, and says what is wrong with it, when the run first needs it.
   */
  protected override async loadUserConfigUpFront() {}

  private async readUser(): Promise<{ config?: UserConfig; path: string }> {
    const { result, error } = await loadUserConfigForRepair();
    if (error) {
      this.userUnusable = true;
      this.warn(
        `${error.message}\nIgnoring the user config file until it is fixed. Edit ${showVisibly(userConfigLabel(result.path))} by hand.`,
      );
      return { path: result.path };
    }
    for (const warning of result.warnings) {
      this.warn(warning);
    }
    return {
      config: result.status === "loaded" ? result.config : undefined,
      path: result.path,
    };
  }

  /**
   * The resolved value of a key: git config, the project file, then the user
   * file. A project file that cannot be used is said so and passed over.
   */
  private async resolve(name: ConfigName) {
    try {
      return await getConfigValue(name);
    } catch (error) {
      if (!(error instanceof ProjectConfigError)) {
        throw error;
      }
      this.warn(error.message);
      markProjectConfigUnusable();
      this.projectUnusable = true;
      return getConfigValue(name);
    }
  }

  /**
   * The Herdr and Rex keys to keep out of sight. Someone without the `herdr`
   * binary has no use for the first group, nor someone who cannot run the `rex`
   * CLI for the second, and listing or prompting for them is the whole of what
   * these features would otherwise cost them.
   *
   * A key that already holds a value is never hidden: a machine that configured
   * Herdr and later lost the binary should still be told what it set.
   */
  private async getHiddenConfigNames(): Promise<Set<ConfigName>> {
    const opener = (await this.resolve("opener")).value;
    const hidden = new Set<ConfigName>();

    // An explicit `opener=herdr` is an opt-in, and it governs the other two, so
    // it un-hides all of them. A shell that has not picked up `herdr` on PATH
    // yet should not make the keys of someone who plainly uses it disappear.
    // `opener=rex` does the same for the Rex keys.
    const groups: [readonly ConfigName[], boolean][] = [
      [
        HERDR_CONFIG_NAMES,
        opener === "herdr" || (await commandExists("herdr")),
      ],
      [REX_CONFIG_NAMES, opener === "rex" || (await isRexInstalled())],
    ];

    for (const [names, shown] of groups) {
      if (shown) {
        continue;
      }
      for (const name of names) {
        if (!(await this.resolve(name)).value) {
          hidden.add(name);
        }
      }
    }
    return hidden;
  }

  private async renderList(missing: boolean) {
    let count = 0;
    const hidden = await this.getHiddenConfigNames();
    const file = await this.loadFile();
    const { config: user } = await this.loadUser();
    // Data Center has no email, so `--missing` does not report one (#126 D4).
    const skipEmail = missing && (await isJiraDataCenter());

    for (const variable of CONFIG_NAMES) {
      if (hidden.has(variable) || (skipEmail && variable === "jira.email")) {
        continue;
      }

      // git-only: the list shows git config's own value, to say what it overrides
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
      const fromUser = user ? userFileValue(user, variable) : undefined;
      if (missing && (value || fromFile || fromUser)) {
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
      // The project file outranks the user file, so where both set a key only
      // the project file is named (D11, D2).
      let source = "";
      if (value && fromFile) {
        source =
          value === fromFile
            ? ` (${PROJECT_CONFIG_FILE})`
            : ` (overrides ${PROJECT_CONFIG_FILE}: ${showVisibly(fromFile)})`;
      } else if (value && fromUser) {
        source =
          value === fromUser
            ? ` (${USER_CONFIG_ORIGIN})`
            : ` (overrides ${USER_CONFIG_ORIGIN}: ${showVisibly(fromUser)})`;
      }
      if (!value && fromUser) {
        this.log(
          `${variable}=${showVisibly(fromUser)} (${USER_CONFIG_ORIGIN})`,
        );
        count++;
        continue;
      }
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
    skipKeys: readonly ConfigName[],
    hidden?: Set<ConfigName>,
  ): Promise<ConfigName[]> {
    // `hidden` is not computed for a --names run: that path returns before the
    // filter, and `branch` delegates to exactly that form (base-command.ts), so
    // probing there would put a `which herdr` behind a plain `worktree branch`.
    const applicableConfigNames = flags.names
      ? this.getApplicableConfigNames(flags.names)
      : this.getApplicableConfigNames(undefined, hidden);

    // Naming a key with --names is asking for it, but a key the file supplies
    // is not missing, so --missing never asks for one (D19). A bare run never
    // asks what the file answers.
    if (flags.missing) {
      const configNames: ConfigName[] = [];
      const dropEmail = await isJiraDataCenter();
      for (const name of applicableConfigNames) {
        if (dropEmail && name === "jira.email") {
          continue;
        }
        if (!skipKeys.includes(name) && !(await this.resolve(name)).value) {
          configNames.push(name);
        }
      }
      return configNames;
    }

    if (flags.names) {
      return applicableConfigNames;
    }

    // Data Center has no email (#126 D4), so a bare run does not ask for one.
    // Naming it with --names is still asking for it.
    const dropEmail = await isJiraDataCenter();
    return applicableConfigNames.filter(
      (name) =>
        !skipKeys.includes(name) && !(dropEmail && name === "jira.email"),
    );
  }
  /**
   * What the bare or named wizard run is to ask, or undefined when there is
   * nothing to ask (already said).
   */
  private async createWizardContext(flags: {
    missing: boolean;
    names?: string;
  }): Promise<WizardContext | undefined> {
    const file = await this.loadFile();
    const fileKeys = file ? projectFileKeys(file) : [];
    if (fileKeys.length > 0 && !flags.names) {
      this.log(
        `${PROJECT_CONFIG_FILE} sets ${fileKeys.join(", ")}, so the wizard does not ask for them. Change one for yourself with \`worktree config <key> <value>\`.`,
      );
    }
    const { config: user, path: userPath } = await this.loadUser();
    const hidden = flags.names ? undefined : await this.getHiddenConfigNames();
    // A key the user file sets is already set, as one the project file sets is
    // (D11): asking would offer to store "" or a copy in git config over it.
    const userKeys = user
      ? userFileKeys(user).filter(
          (name) =>
            !(fileKeys as readonly string[]).includes(name) &&
            this.getApplicableConfigNames(undefined, hidden).includes(name),
        )
      : [];
    if (userKeys.length > 0 && !flags.names) {
      this.log(
        `Your user config (${showVisibly(userConfigLabel(userPath))}) sets ${userKeys.join(", ")}, so the wizard does not ask for them. Change one with \`worktree config --user <key> <value>\`, or for this repository only with \`worktree config <key> <value>\`.`,
      );
    }
    let configNames = await this.getPromptConfigNames(
      flags,
      [...fileKeys, ...userKeys],
      hidden,
    );

    // A bare run that does not ask `opener` (`--missing` found it set) lets the
    // stored one decide the follow-ups (D3), so a key it would not ask is not
    // "left to ask": the item is not listed on its account, and a run with
    // nothing else says so below.
    if (!flags.names && !configNames.includes("opener")) {
      const opener = await getStoredOpener();
      configNames = configNames.filter(
        (name) =>
          !(
            (name === "codeEditor" &&
              opener !== "editor" &&
              opener !== "auto") ||
            ((HERDR_CONFIG_NAMES as readonly string[]).includes(name) &&
              opener !== "herdr" &&
              // `auto` asks only herdr.focus; herdr.agent is the agent item's.
              !(opener === "auto" && name === "herdr.focus")) ||
            ((REX_CONFIG_NAMES as readonly string[]).includes(name) &&
              opener !== "rex" &&
              opener !== "auto")
          ),
      );
    }

    // First check if there is anything to prompt
    if (configNames.length === 0) {
      this.log("No missing config found.");
      return undefined;
    }

    return {
      configNames,
      names: flags.names,
      // Offered where the hiding rule would show a Herdr key (D3); the same
      // test, not a second one. Naming `opener` is asking for every choice.
      herdrOffered:
        !hidden || HERDR_CONFIG_NAMES.some((name) => !hidden.has(name)),
      rexOffered: !hidden || REX_CONFIG_NAMES.some((name) => !hidden.has(name)),
      hiddenNames: hidden ?? new Set(),
      log: (message) => this.log(message),
    };
  }

  private isValidArgName(name: string): name is ConfigName {
    return CONFIG_NAMES.includes(name as ConfigName);
  }

  public async run(): Promise<void> {
    try {
      await this.runConfig();
    } finally {
      // A file treated as absent for this run (loadUser, loadFile) must not stay
      // so for whatever runs next in this process (`branch` runs `config` first).
      // Only what was marked: a good read stays cached, as in every other command.
      if (this.userUnusable) {
        resetUserConfigCache();
      }
      if (this.projectUnusable) {
        resetProjectConfigCache();
      }
    }
  }

  private async runConfig(): Promise<void> {
    const { args, flags } = await this.parse(Config);

    // Mark that config has been called at least once. `--user` touches no
    // repository, so it is run from anywhere, `~` included (#308): outside a
    // repository there is no git config to mark, so the marker is skipped
    // there. Inside one, a failed write still fails the command.
    if (!flags.user || (await isInsideRepository())) {
      await gitSetConfigValue("has-called-config", "true");
    }

    if (flags.approve) {
      if (
        args.name ||
        flags.list ||
        flags.missing ||
        flags.names ||
        flags.project ||
        flags.user
      ) {
        this.error(
          "--approve cannot be combined with other arguments or flags.",
        );
      }
      await approvePostCreate();
      return;
    }

    if (flags.project) {
      if (
        args.name ||
        flags.list ||
        flags.missing ||
        flags.names ||
        flags.user
      ) {
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

    if (flags.user) {
      // The only form: a key and a value (D7).
      if (
        !args.name ||
        !args.value ||
        flags.list ||
        flags.missing ||
        flags.names
      ) {
        this.error(
          "--user takes a key and a value (worktree config --user <key> <value>) and cannot be combined with --list, --missing or --names.",
        );
      }
      if (!this.isValidArgName(args.name)) {
        this.error(`Unknown config name: ${args.name}`);
      }
      // Secrets and keys the file cannot hold are refused before the value is
      // looked at, so no validator can echo a token.
      assertUserFileKey(args.name);
      await validateUserConfigValue(args.name, args.value);
      const written = writeUserConfigValue(args.name, args.value);
      const where = showVisibly(userConfigLabel(written.path));
      this.log(
        written.changed
          ? `Set ${args.name} in ${where}.`
          : `${args.name} is already set to that in ${where}.`,
      );
      return;
    }

    // First, so every read below sees a file that cannot be used as absent.
    await this.loadUser();

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
      const current = (await this.resolve(args.name)).value;
      if (current) {
        this.log(current);
      }
      return;
    }

    if (flags.list) {
      return this.renderList(flags.missing);
    }

    const wizard = await this.createWizardContext(flags);
    if (wizard) {
      await runWizard(wizard);
    }
    // The project-config step: silently removes the local keys the team's
    // .worktree.yml covers, and on a terminal offers to write the file. Not for
    // a run another command delegated (`branch` before a worktree exists), and
    // not for one that named its keys (D21). The wizard has saved its values by
    // now, so a failure here warns, as it does in `branch`, rather than failing
    // the run; a quit (Ctrl+C at the offer) still ends it quietly.
    if (!flags.names && !flags["skip-offers"]) {
      try {
        await offerProjectConfig();
      } catch (error) {
        if (error instanceof Error && error.name === "ExitPromptError") {
          throw error;
        }
        this.warn(
          `Could not update the project configuration from .worktree.yml. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
