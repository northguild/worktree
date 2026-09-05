import { confirm } from "@inquirer/prompts";
import { Command } from "@oclif/core";
import type { CommandError } from "@oclif/core/interfaces";
import chalk from "chalk";
import ora from "ora";
import { run } from "./cli.js";
import { gitGetConfigValue } from "./git.js";
import type { ConfigName } from "./types.js";

export abstract class BaseCommand extends Command {
  private confirmFirstTimeConfig() {
    const message =
      "Looks like this is your first time running the CLI. Do you want to run the config command now?";
    return confirm({ message });
  }

  private confirmMissingConfig() {
    const message =
      "Some required configuration values are missing. Do you want to run the config command now?";
    return confirm({ message });
  }

  protected async verifyConfig(configNames: ConfigName[] = []) {
    if ((await gitGetConfigValue("has-called-config")) !== "true") {
      if (await this.confirmFirstTimeConfig()) {
        await this.config.runCommand("config");
        return;
      }
    }

    let isMissingConfig = false;
    for (const name of configNames) {
      if (!(await gitGetConfigValue(name))) {
        isMissingConfig = true;
        break;
      }
    }

    if (isMissingConfig) {
      if (await this.confirmMissingConfig()) {
        await this.config.runCommand("config", [
          "--missing",
          "--yes",
          "--names",
          configNames.join(","),
        ]);
      }
    }
  }

  protected async openWorktreePath(path: string) {
    const codeEditor = await gitGetConfigValue("codeEditor");

    if (codeEditor) {
      const spinner = ora(`Opening in ${codeEditor}`).start();
      // codeEditor is a command line, not a bare program name: the head is the
      // file to launch and the tail is leading arguments, with the worktree path
      // passed last as one argument however many spaces it contains. This is the
      // contract commandExists already validates by — it looks up the head alone
      // (cli.ts) — so validation and execution now agree. No shell parses this
      // value any more, which is why quoted arguments are not supported.
      const [editor, ...editorArgs] = codeEditor.trim().split(/\s+/);
      // Deliberately not awaited, exactly as the exec callback was not: the
      // editor outlives this command, and the spinner settles when it exits.
      run(editor, [...editorArgs, path]).then(
        () => spinner.succeed(),
        (error: Error) => spinner.fail(error.message),
      );
    } else {
      this.log(`${chalk.green("✔")} Worktree created in ${path}`);
    }
  }

  protected async catch(error: CommandError) {
    if (error instanceof Error) {
      if (error.name === "ExitPromptError") {
        // Silently exit
        return;
      }
      // Color the error message red for better visibility
      this.log(chalk.red(`Error: ${error.message}`));
      return;
    }
    return super.catch(error);
  }
}
