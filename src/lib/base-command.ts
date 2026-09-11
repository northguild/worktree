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
  closeHerdrWorkspace,
  isHerdrInstalled,
  listHerdrWorktrees,
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

/**
 * Closes the Herdr spaces of the worktrees whose paths it is given.
 *
 * The seam hands one of these back rather than exposing a close method,
 * because the lookup it closes over has to happen *before* the worktrees are
 * removed and the closing has to happen after. A closure makes that ordering
 * structural — there is no way to reach the close without having resolved
 * first — where two methods would leave a caller free to get it backwards and
 * find the spaces already gone from Herdr's listing.
 */
type SpaceCloser = (worktreePaths: string[]) => Promise<void>;

/** Does nothing, for every path where there is nothing to close. */
async function closeNothing() {}

/**
 * The label Herdr puts on the space, which is the branch name recovered from
 * the worktree's own path — every caller's path sits under
 * `<root>.worktrees/`, and what follows that prefix is the branch, slashes
 * and all, because `feature/thing` is a directory here. `basename` covers a
 * path laid out some other way: an unlabelled space is unusable in Herdr's
 * sidebar (opener plan D7), so this never answers with an empty string.
 *
 * Takes the root rather than looking it up, so the closer can label a whole set
 * of worktrees from one `gitGetAbsoluteWorktreesPath` call instead of one per
 * space.
 */
function toSpaceLabel(worktreePath: string, worktreesRootPath: string) {
  return worktreePath.startsWith(worktreesRootPath)
    ? worktreePath.slice(worktreesRootPath.length)
    : basename(worktreePath);
}

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

  /** One worktree's label, for the open. `toSpaceLabel` holds the rule. */
  private async resolveSpaceLabel(worktreePath: string) {
    return toSpaceLabel(
      worktreePath,
      `${await gitGetAbsoluteWorktreesPath()}/`,
    );
  }

  /**
   * Reads which Herdr space each of this repository's worktrees is open in, and
   * answers with the function that closes them once they have been removed.
   *
   * **Call this before removing anything.** The listing is derived from git's
   * own worktrees, so `git worktree remove` and `git worktree prune` take the
   * entry out of Herdr's answer too — look it up afterwards and every space is
   * already unfindable (D2). One call answers for a whole run, because
   * `cleanup` removes a set and a lookup per worktree would be N subprocesses
   * where one does.
   *
   * Everything that means "there is nothing to close" answers with the same
   * no-op, and none of them spawns a Herdr process: an `opener` that is not
   * `herdr`, no `herdr` on PATH, or a repository with no open spaces. The
   * second of those is deliberately silent rather than a warning — someone
   * whose `opener` says `herdr` but who has no Herdr installed was already told
   * so, loudly, when the open failed, and a warning on every `remove`
   * afterwards is noise about something they cannot act on here.
   */
  protected async resolveSpaceCloser(): Promise<SpaceCloser> {
    if ((await gitGetConfigValue("opener")) !== "herdr") {
      return closeNothing;
    }

    if (!(await isHerdrInstalled())) {
      return closeNothing;
    }

    const spinner = ora("Finding Herdr spaces").start();
    let spaces: Map<string, string>;
    let worktreesRootPath: string;

    try {
      const [{ worktrees, sourceWorkspaceId }, worktreesPath] =
        await Promise.all([
          listHerdrWorktrees({ gitRootPath: await gitGetRootPath() }),
          gitGetAbsoluteWorktreesPath(),
        ]);

      worktreesRootPath = `${worktreesPath}/`;
      // flatMap rather than filter-then-map so the narrowing is the compiler's:
      // `workspaceId` is `string | undefined`, and inside this branch it is a
      // string. A filter needs an assertion to say the same thing, and an
      // assertion keeps compiling if the first guard below is ever dropped —
      // which is exactly the regression these two guards exist to prevent.
      spaces = new Map(
        worktrees.flatMap((worktree) =>
          // #52 D9 — a worktree with no space open is not an error and is
          // nothing to close.
          worktree.workspaceId !== undefined &&
          // #52 D7 — the repository's own checkout is in this listing like any
          // other, and closing it would take down the window the user is
          // sitting in. Both removal paths already exclude the current
          // worktree, so this guards a future caller rather than a live defect.
          worktree.workspaceId !== sourceWorkspaceId
            ? [[worktree.path, worktree.workspaceId] as const]
            : [],
        ),
      );
      spinner.stop();
    } catch (error) {
      // Deliberately wider than the Herdr call: the two git lookups above share
      // this catch, so nothing this seam needs can cost the user the removal
      // they actually asked for. Every message it can print names its own
      // source — Herdr's are prefixed `Herdr: `, and gitGetRootPath's says it
      // cannot find the root — so the breadth costs no diagnostic detail.
      //
      // The lookup itself is all-or-nothing by construction: without it there
      // is no path-to-space mapping, so there is nothing any number of closes
      // could act on. Decided here deliberately rather than inherited (F-056) —
      // the run continues and the removals still happen, because by the time a
      // caller holds this closure the user has already asked for them.
      spinner.warn(error instanceof Error ? error.message : String(error));
      return closeNothing;
    }

    if (spaces.size === 0) {
      return closeNothing;
    }

    return async (worktreePaths: string[]) => {
      for (const worktreePath of worktreePaths) {
        const workspaceId = spaces.get(worktreePath);

        // Three ways to get here, and none of them says anything. Two were
        // settled when the map was built: the worktree had no space open (D9),
        // or it is one this run must not touch (D7). The third is a path Herdr
        // never listed, or listed in a different string form — which is the
        // orphan this feature exists to prevent, passing silently. Both sides
        // of the comparison come from git's own worktree records and were
        // verified byte-identical, so it stays silent rather than warning on
        // every worktree that legitimately has no space.
        if (!workspaceId) {
          continue;
        }

        await this.closeSpace(
          workspaceId,
          toSpaceLabel(worktreePath, worktreesRootPath),
        );
      }
    };
  }

  /**
   * Closes one space, and never lets that failure reach the command.
   *
   * By the time this runs the worktree is deleted, the branch is gone and
   * `git worktree prune` has run — there is nothing left to retry and nothing
   * the user can do about it, so a non-zero exit would misreport what actually
   * happened (D5). Each space gets its own `catch` so one failure does not take
   * the rest of the run with it.
   */
  private async closeSpace(workspaceId: string, label: string) {
    const spinner = ora(`Closing Herdr space ${label}`).start();

    try {
      await closeHerdrWorkspace(workspaceId);
      spinner.succeed(`Closed Herdr space ${label}`);
    } catch (error) {
      spinner.warn(error instanceof Error ? error.message : String(error));
    }
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
