import { Args, Flags } from "@oclif/core";
import chalk from "chalk";
import { BaseCommand } from "../lib/base-command.js";
import {
  findWorktreeByTarget,
  gitGetWorktreeList,
  gitRemoveWorktree,
  gitRemoveWorktreesWithProgress,
  hasLiveAgent,
  isPathTarget,
} from "../lib/git.js";
import { createSpinner } from "../lib/progress.js";
import { askCheckbox, askConfirm, Separator } from "../lib/prompt.js";
import type { RemoveDocument, WorktreeListEntry } from "../lib/types.js";
import { worktreeListEntryToListName } from "../lib/utils.js";

export default class Delete extends BaseCommand {
  static aliases = ["rm", "delete"];
  static override args = {
    branchName: Args.string({
      description:
        "Name of the branch to remove, or the path of a worktree (the only way to name a detached one)",
    }),
  };
  // The first line is the summary oclif lists in `worktree --help`; the rest is
  // the `--json` shape and exit codes, kept to key names and nullability.
  static override description = `Remove worktree branches

--json prints one document on stdout:
{removed: [{branch, path}], herdrSpacesClosed: [id], warnings: [string]}
On failure: {error:{code, message, details?}} on stdout.
A non-interactive run needs <branchName> and --force.

Exit codes:
0 success
1 failure, such as git refusing the removal
2 usage: <branchName> or --force missing, or the branch was not found`;
  // One JSON document on stdout, everything human on stderr (D6).
  static override enableJsonFlag = true;
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> my-new-branch",
    "<%= config.bin %> <%= command.id %> my-new-branch --force --json",
  ];
  static override flags = {
    force: Flags.boolean({
      char: "f",
      description: "Force remove the branch without confirmation",
    }),
  };

  private getWorktreeChoices(worktrees: WorktreeListEntry[]) {
    const choices = worktrees.map((wt) => ({
      name: worktreeListEntryToListName(wt, "red", { agents: true }),
      value: wt,
    }));
    const safeToRemove = choices.filter(({ value }) => value.safeToRemove);
    const unsafeToRemove = choices.filter(({ value }) => !value.safeToRemove);

    if (safeToRemove.length > 0 && unsafeToRemove.length > 0) {
      return [
        new Separator(chalk.gray("─ Inactive branches (Safe to delete)")),
        ...safeToRemove,
        new Separator(chalk.gray("─ Active branches")),
        ...unsafeToRemove,
      ];
    }

    return [...safeToRemove, ...unsafeToRemove];
  }

  public async run(): Promise<RemoveDocument> {
    const { args, flags } = await this.parse(Delete);
    const spinner = createSpinner("Gathering worktree branches").start();
    // The run's one session lookup, for both paths (#56, D5): the picker renders
    // and groups by it, and the named path hands the session it finds to the
    // prompt. `gitRemoveWorktree` gathers the list again but never the sessions.
    const worktrees = await gitGetWorktreeList({ includeAgents: true });
    spinner.stop();

    // A named branch under `--json` is a request a script is waiting on, so an
    // empty list falls through to the not-found error below instead of
    // reporting a success that removed nothing.
    if (worktrees.length === 0 && !(this.jsonEnabled() && args.branchName)) {
      this.log("No worktree branches found.");
      return this.toDocument([], []);
    }

    if (args.branchName) {
      const wt = findWorktreeByTarget(worktrees, args.branchName);

      if (!wt) {
        // The current worktree is never listed, so from inside one `remove .`
        // lands here too.
        this.error(
          isPathTarget(args.branchName)
            ? `No worktree to remove at "${args.branchName}".`
            : `Branch "${args.branchName}" not found.`,
          { code: "not_found" },
        );
      }

      // Resolved before the removal, never after: `git worktree remove` and
      // `git worktree prune` take the entry out of Herdr's listing too, so a
      // lookup afterwards finds nothing to close (D2). gitRemoveWorktree does
      // its own confirming, so a declined removal costs one lookup and closes
      // nothing — the price of an ordering that cannot be corrected later.
      const closeSpaces = await this.resolveSpaceCloser();
      const removed = await gitRemoveWorktree(args.branchName, {
        force: flags.force,
        // Only a session that blocks (#89). Left off otherwise, so a run with
        // no blocking session makes exactly the call it always made.
        ...(hasLiveAgent(wt) && wt.agent ? { agent: wt.agent } : {}),
      });

      // Only what was actually removed (D4). gitRemoveWorktree answers
      // undefined when the branch was not found or the confirmation declined,
      // and throws, with git's reason, when the removal failed — closing a space
      // whose checkout is still on disk is worse than the orphan this feature
      // exists to prevent.
      const closed = await closeSpaces(removed ? [removed.path] : []);

      // A script that named the branch asked for it to be gone, so under
      // `--json` nothing removed is a failure. A failed removal has already
      // thrown with git's reason, and `--json` cannot decline a confirmation —
      // it never prompts — so what is left is a branch that was gone by the
      // time it was looked up again.
      if (!removed && this.jsonEnabled()) {
        throw new Error(`Could not remove the worktree ${args.branchName}.`);
      }

      // `wt` rather than `removed`: it is the entry the sessions were joined
      // onto, and the one `removed` is read back from carries none.
      if (removed && flags.force) {
        this.warnRemovedWhileWorking([wt]);
      }

      return this.toDocument(removed ? [removed] : [], closed);
    }

    const selected = await askCheckbox(
      {
        message: "Select worktree branches to delete",
        choices: this.getWorktreeChoices(worktrees),
      },
      { value: "the branches to remove", flag: "<branchName> -f" },
    );

    if (selected.length === 0) {
      return this.toDocument([], []);
    }

    if (selected.some((wt) => !wt.safeToRemove) && !flags.force) {
      const confirmDelete = await askConfirm(
        {
          message:
            "Some selected branches are not safe to delete. Are you sure you want to continue?",
          default: false,
        },
        { value: "removing branches that are not safe to delete", flag: "-f" },
      );
      if (!confirmDelete) {
        return this.toDocument([], []);
      }
    }

    // After the last prompt, so a run that removes nothing spawns no lookup.
    const closeSpaces = await this.resolveSpaceCloser();
    const removed = await gitRemoveWorktreesWithProgress(selected);

    const closed = await closeSpaces(removed.map((worktree) => worktree.path));

    if (flags.force) {
      this.warnRemovedWhileWorking(removed);
    }

    return this.toDocument(removed, closed);
  }

  /**
   * `--force` answers the confirmation, not the telling (D4): the person is not
   * asked, so this is the only place they hear that somebody was in the worktree
   * they just removed. `warn` rather than `recordWarning`, which would put it in
   * the document and show it to no one. Without `--force` the prompt said it.
   */
  private warnRemovedWhileWorking(removed: WorktreeListEntry[]) {
    for (const worktree of removed) {
      if (worktree.agent && hasLiveAgent(worktree)) {
        this.warn(
          `Removed ${worktree.branchName} while an agent session (${worktree.agent.name}) was working in it.`,
        );
      }
    }
  }

  private toDocument(
    removed: WorktreeListEntry[],
    herdrSpacesClosed: string[],
  ): RemoveDocument {
    return {
      removed: removed.map(({ branchName, path }) => ({
        branch: branchName,
        path,
      })),
      herdrSpacesClosed,
      warnings: this.warnings,
    };
  }
}
