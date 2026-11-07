import path from "node:path";
import { Args, Flags } from "@oclif/core";
import chalk from "chalk";
import {
  findSessionForPath,
  getAgentSessions,
  isSessionBlocking,
  isSessionLive,
  toRealPath,
} from "../lib/agent.js";
import { BaseCommand } from "../lib/base-command.js";
import {
  findWorktreeByTarget,
  gitGetLocalBranches,
  gitGetRootPath,
  gitGetWorktrees,
  gitPlanWorktreeRename,
  gitRenameWorktree,
  hasLiveAgent,
} from "../lib/git.js";
import { isNonInteractive } from "../lib/interaction.js";
import {
  askConfirm,
  askInput,
  askSelect,
  MissingValueError,
} from "../lib/prompt.js";
import type { RenameDocument, WorktreeListBaseEntry } from "../lib/types.js";
import { isValidBranchName } from "../lib/validators.js";

const WORKTREE_TO_RENAME = {
  value: "the worktree to rename",
  flag: "<branchName> <newName>",
};
const NEW_NAME = { value: "the new branch name", flag: "<newName>" };

export default class Rename extends BaseCommand {
  static override args = {
    branchName: Args.string({
      description:
        "Branch of the worktree to rename, or its path. With one argument this is the new name, for the worktree you are in",
    }),
    newName: Args.string({
      description: "The new branch name; the worktree directory follows it",
    }),
  };
  // The first line is the summary oclif lists in `worktree --help`; the rest is
  // the `--json` shape and exit codes, kept to key names and nullability.
  static override description = `Rename a worktree and its branch together

The directory moves to <repo>.worktrees/<newName> and the branch is renamed, locally only: the remote branch is left alone, and the branch still tracks it under its old name.
Without <branchName> the worktree you are in is renamed.

--json prints one document on stdout:
{from: {branch, path}, to: {branch, path}, upstream: string|null, herdrSpacesRenamed: [string], rexSessionsRenamed: [string], warnings: [string]}
An open Herdr space or Rex session (whichever the opener setting names; under auto, either installed tool's) is relabelled to the new name; a failure there is a warning, not an error.
On failure: {error:{code, message, details?}} on stdout.
A non-interactive run needs <newName>, and --force when an agent session is working in the worktree.

Exit codes:
0 success
1 failure, such as git refusing the move
2 usage: an argument is missing, the worktree was not found, or the new name is refused`;
  // One JSON document on stdout, everything human on stderr (D11).
  static override enableJsonFlag = true;
  static override examples = [
    "<%= config.bin %> <%= command.id %> feature/x bugfix/y",
    "<%= config.bin %> <%= command.id %> bugfix/y",
    "<%= config.bin %> <%= command.id %> feature/x bugfix/y --force --json",
  ];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Rename without asking, even while an agent session is working in the worktree",
    }),
  };

  public async run(): Promise<RenameDocument | undefined> {
    const { args, flags } = await this.parse(Rename);
    // No fetch (D9): the rename is local, so it works offline.
    const worktrees = await gitGetWorktrees({ includeCurrent: true });
    const current = worktrees.find((wt) => wt.isCurrent);
    // Resolved before anything moves, and every git call after it runs from
    // here (D8): the process may be standing in the directory that moves.
    const repoRoot = await gitGetRootPath();
    const worktreesRoot = `${repoRoot}.worktrees`;

    const { target, newName } = await this.resolveTarget(
      args,
      worktrees,
      current,
      worktreesRoot,
    );

    const plan = await gitPlanWorktreeRename(
      target,
      newName,
      await gitGetLocalBranches(),
      worktreesRoot,
      isValidBranchName,
    );

    if (!flags.force && !(await this.confirmLiveSession(target))) {
      this.log(`Left ${plan.fromBranch} as it was.`);
      return undefined;
    }

    const startedInside = await isInside(target.path, process.cwd());
    // D12: looked up before the move, because the tool's listing comes from
    // git's worktrees and the old path is not in them afterwards.
    const renameSpace = await this.resolveSpaceRenamer();
    const result = await gitRenameWorktree(plan, repoRoot);

    this.log(
      `${chalk.green("✔")} Renamed ${result.from.branch} to ${result.to.branch}; the worktree is at ${result.to.path}`,
    );
    if (result.upstream && result.oldNameRemote) {
      this.log(
        pushHint(
          result.upstream,
          result.oldNameRemote,
          result.from.branch,
          result.to.branch,
        ),
      );
    }
    // D4: only reached once both git steps have succeeded. A failure inside is
    // a recorded warning, so the rename stays a success. Reported after the
    // rename and its push hint, and before `cd`, which stays last (§4.3).
    const renamedSpaces = await renameSpace(result.from.path, result.to.path);
    if (startedInside) {
      this.log(`cd ${result.to.path}`);
    }

    return {
      from: result.from,
      to: result.to,
      upstream: result.upstream,
      herdrSpacesRenamed: renamedSpaces.herdr,
      rexSessionsRenamed: renamedSpaces.rex,
      warnings: this.warnings,
    };
  }

  /**
   * D1: two arguments name the worktree and the new name; one is the new name
   * for the worktree the command runs in; none asks, which a non-interactive
   * run cannot answer.
   */
  private async resolveTarget(
    args: { branchName?: string; newName?: string },
    worktrees: WorktreeListBaseEntry[],
    current: WorktreeListBaseEntry | undefined,
    worktreesRoot: string,
  ): Promise<{ target: WorktreeListBaseEntry; newName: string }> {
    if (args.branchName && args.newName) {
      const target = findWorktreeByTarget(worktrees, args.branchName);
      if (!target) {
        this.error(
          `No worktree for "${args.branchName}" under ${worktreesRoot}/.`,
          {
            code: "not_found",
          },
        );
      }
      return { target, newName: args.newName };
    }

    if (args.branchName) {
      if (!current) {
        // Worded as a prompt would have been: a terminal is asked to pick.
        return {
          target: await this.pickWorktree(worktrees, worktreesRoot),
          newName: args.branchName,
        };
      }
      return { target: current, newName: args.branchName };
    }

    // Inside a worktree an agent is one argument short of a rename; say which.
    if (isNonInteractive() && current) {
      throw new MissingValueError(NEW_NAME.value, NEW_NAME.flag);
    }
    const target = await this.pickWorktree(worktrees, worktreesRoot);
    const newName = await askInput(
      {
        message: `New name for ${target.branchName}`,
        validate: isValidBranchName,
      },
      NEW_NAME,
    );
    return { target, newName };
  }

  private async pickWorktree(
    worktrees: WorktreeListBaseEntry[],
    worktreesRoot: string,
  ): Promise<WorktreeListBaseEntry> {
    if (worktrees.length === 0 && !isNonInteractive()) {
      this.error(`No worktrees under ${worktreesRoot}/.`, {
        code: "not_found",
      });
    }
    return askSelect(
      {
        message: "Select the worktree to rename",
        choices: worktrees.map((wt) => ({
          name: wt.isCurrent ? `${wt.branchName} (Current)` : wt.branchName,
          value: wt,
        })),
      },
      WORKTREE_TO_RENAME,
    );
  }

  /**
   * D7: a running agent holds absolute paths to the old directory, so a rename
   * asks first. The session is found the way `remove` finds one, by real-path
   * containment, and counts by the same `hasLiveAgent` rule. Answers whether to
   * go on; `--force` never reaches here.
   */
  private async confirmLiveSession(
    target: WorktreeListBaseEntry,
  ): Promise<boolean> {
    const sessions = await getAgentSessions();
    const session = findSessionForPath(sessions, await toRealPath(target.path));
    if (
      !session ||
      !hasLiveAgent({
        ...target,
        remote: "",
        agent: {
          name: session.name,
          live: isSessionLive(session),
          blocks: isSessionBlocking(session),
        },
      })
    ) {
      return true;
    }

    return askConfirm(
      {
        message: `An agent session (${session.name}) is working in ${target.branchName}. Rename it anyway?`,
        default: false,
      },
      {
        value: `confirmation to rename ${target.branchName} while an agent session (${session.name}) is working in it`,
        flag: "-f",
      },
    );
  }
}

/**
 * D5: the branch keeps tracking its old name on `remote`; git's own refusal
 * quotes `HEAD:<old>`. Only called when the upstream is exactly that, so the
 * command it prints never pushes onto some other branch.
 */
function pushHint(
  upstream: string,
  remote: string,
  oldBranch: string,
  newBranch: string,
): string {
  return `It still tracks ${upstream}: \`git push ${remote} HEAD:${oldBranch}\` updates it, \`git push -u ${remote} ${newBranch}\` publishes the new name.`;
}

// Both sides are resolved: git records the path it was given, and a shell's
// working directory can sit behind a symlink such as macOS's /tmp.
async function isInside(directory: string, candidate: string) {
  const [realDirectory, real] = await Promise.all([
    toRealPath(directory),
    toRealPath(candidate),
  ]);
  const relative = path.relative(realDirectory, real);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}
