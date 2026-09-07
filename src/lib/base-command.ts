import { confirm } from "@inquirer/prompts";
import { Command } from "@oclif/core";
import type { CommandError } from "@oclif/core/interfaces";
import chalk from "chalk";
import ora from "ora";
import { runCommand } from "./cli.js";
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
      // The configured value may carry leading arguments — `code -n` and the
      // interim `herdr worktree open --focus --path` workaround are both in
      // use — so split it into an executable plus its arguments and append the
      // worktree path as its own argv element. Passing the path as an argument
      // rather than interpolating it into a shell string is what lets a path
      // containing a space open at all.
      const [executable, ...editorArgs] = codeEditor.trim().split(/\s+/);
      const spinner = ora(`Opening in ${codeEditor}`).start();

      // Deliberately not awaited: the previous implementation registered a
      // callback and returned, so the command does not stay open for the
      // lifetime of the editor process. Keep that timing.
      runCommand(executable, [...editorArgs, path])
        .then(({ stderr, exitCode }) => {
          if (exitCode === 0) {
            spinner.succeed();
            return;
          }
          spinner.fail(stderr || `${executable} exited with code ${exitCode}`);
        })
        .catch((error: unknown) => {
          spinner.fail(error instanceof Error ? error.message : String(error));
        });
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
