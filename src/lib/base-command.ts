import { basename } from "node:path";
import { confirm } from "@inquirer/prompts";
import { Command } from "@oclif/core";
import type { CommandError } from "@oclif/core/interfaces";
import chalk from "chalk";
import ora from "ora";
// `lib/` importing `integrations/` inverts the layering in
// context/standards/architecture/dependency-boundaries.md. It is a deliberate
// deviation, recorded in §4.2 of the plan: BaseCommand is the composition point
// every command inherits — it already reaches for `./git.js` and
// `@inquirer/prompts` — not a leaf utility. Satisfying the boundary strictly
// means moving this file out of `lib/`, a wider refactor than this feature buys.
import {
  isHerdrInstalled,
  openHerdrWorktree,
  startHerdrAgent,
  toHerdrAgentName,
} from "../integrations/herdr.js";
import { run, spawnDetached } from "./cli.js";
import {
  gitGetAbsoluteWorktreesPath,
  gitGetConfigValue,
  gitGetRootPath,
} from "./git.js";
import type { ConfigName } from "./types.js";
import { splitCommandValue } from "./utils.js";

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
    const opener = await gitGetConfigValue("opener");

    if (opener === "herdr") {
      await this.openHerdrSpace(path);
      return;
    }

    await this.openCodeEditor(path);
  }

  /**
   * The label Herdr puts on the space, which is the branch name recovered from
   * the worktree's own path — every caller's path sits under
   * `<root>.worktrees/`, and what follows that prefix is the branch, slashes
   * and all, because `feature/thing` is a directory here. `basename` covers a
   * path laid out some other way: an unlabelled space is unusable in Herdr's
   * sidebar (D7), so this never answers with an empty string.
   */
  private async resolveSpaceLabel(worktreePath: string) {
    const worktreesRootPath = `${await gitGetAbsoluteWorktreesPath()}/`;

    return worktreePath.startsWith(worktreesRootPath)
      ? worktreePath.slice(worktreesRootPath.length)
      : basename(worktreePath);
  }

  /**
   * Awaited, unlike the editor branch: the open answers with the pane the space
   * was built around, which is what an agent start hangs off later.
   */
  private async openHerdrSpace(path: string) {
    const spinner = ora("Opening in Herdr").start();

    try {
      if (!(await isHerdrInstalled())) {
        throw new Error("Herdr: `herdr` was not found on your PATH.");
      }

      const [gitRootPath, label, focus] = await Promise.all([
        gitGetRootPath(),
        this.resolveSpaceLabel(path),
        gitGetConfigValue("herdr.focus"),
      ]);

      const { alreadyOpen, paneId } = await openHerdrWorktree({
        path,
        gitRootPath,
        label,
        // Focus is on unless it is turned off: all three callers are someone
        // asking to be taken to this worktree, so a space that does not come to
        // the front reads as a failed open (D6).
        focus: focus !== "false",
      });

      spinner.succeed(
        alreadyOpen
          ? `Herdr space ${label} was already open`
          : `Opened Herdr space ${label}`,
      );

      // Only for a space this command just built. Re-opening a worktree is how
      // someone returns to work already in progress, and the agent they left
      // running is still in that pane — a second start would collide with it.
      if (!alreadyOpen) {
        await this.startConfiguredAgent(label, paneId);
      }
    } catch (error) {
      // D5 — no editor as a consolation prize. Someone who set `opener=herdr`
      // gets told what Herdr said and where the worktree is, and that is all.
      // The command still exits 0: by the time the opener runs the worktree
      // exists and its env files are copied, so failing here would misreport
      // what actually happened.
      spinner.fail(error instanceof Error ? error.message : String(error));
      this.log(`The worktree is at ${path}`);
    }
  }

  /**
   * Starts the agent kind named by `herdr.agent` in the pane the new space was
   * built around. Opt-in, and unset means no agent at all (D9): there are 22
   * kinds and no canonical one, and `agent start` blocks until the agent
   * answers, so nobody pays for this who did not ask for it.
   *
   * Never throws. By the time it runs the space is open and correct, so a name
   * that collides with a live agent from another repo, or an agent that does not
   * reach its prompt in time, is a warning about the agent and not a failure of
   * the open (§5).
   */
  private async startConfiguredAgent(label: string, paneId: string) {
    const kind = await gitGetConfigValue("herdr.agent");

    if (!kind) {
      return;
    }

    const name = toHerdrAgentName(label);
    const spinner = ora(`Starting ${kind} in ${label}`).start();

    try {
      await startHerdrAgent({ name, kind, paneId });
      spinner.succeed(`Started ${kind} as ${name}`);
    } catch (error) {
      spinner.warn(error instanceof Error ? error.message : String(error));
    }
  }

  private async openCodeEditor(path: string) {
    const codeEditor = await gitGetConfigValue("codeEditor");
    // codeEditor is a command line, not a bare program name: the head is the
    // file to launch and the tail is leading arguments, with the worktree path
    // passed last as one argument however many spaces it contains. This is the
    // contract commandExists already validates by — it looks up the head alone
    // (cli.ts) — so validation and execution now agree. No shell parses this
    // value; quotes group an argument that contains spaces and are not passed
    // through, so `~` and `$VAR` still reach the program unexpanded.
    const [editor, ...editorArgs] = splitCommandValue(codeEditor);

    // Unset, whitespace-only and quote-only are the same fact: nothing to
    // launch. The head is what execFile would receive, so it is what decides.
    if (editor) {
      const spinner = ora(`Opening in ${codeEditor}`).start();
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

  protected async dispatchAgent(path: string, prompt: string) {
    const agentCommand = await gitGetConfigValue("agent.command");
    // Split exactly as openWorktreePath splits codeEditor: the head is the
    // program to launch and the tail is leading arguments, with quotes grouping
    // an argument that contains spaces. The prompt is appended as one argument
    // however many quotes or spaces it contains — no shell parses any of this,
    // which is what keeps arbitrary prompt text out of command position.
    // See AGENT-MODE-PLAN §3 D2.
    const [agent, ...agentArgs] = splitCommandValue(agentCommand);

    // Unset and whitespace-only are the same fact: no agent to run. The head is
    // what spawn would receive, so it is what decides — an empty one makes spawn
    // throw synchronously, which would take the editor launch down with it. The
    // command named here has to be one that works: `worktree config <name>` with
    // no value reads the key and discards the result (config.ts:273-274).
    if (!agent) {
      this.log(
        `No agent configured. Run ${chalk.cyan('worktree config agent.command "<command>"')} to set one.`,
      );
      return;
    }

    // Fire-and-forget: the agent outlives this command, so there is no exit
    // status to report and no spinner that could ever settle.
    spawnDetached(agent, [...agentArgs, prompt], {
      cwd: path,
      onError: (error: Error) => this.log(chalk.red(`Error: ${error.message}`)),
    });
    this.log(`${chalk.green("✔")} Agent started in ${path}`);
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
