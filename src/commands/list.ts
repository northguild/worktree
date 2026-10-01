import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command.js";
import { gitGetWorktreeList } from "../lib/git.js";
import { createSpinner } from "../lib/progress.js";
import type {
  WorktreeListDocument,
  WorktreeListEntry,
  WorktreeListEntryDocument,
} from "../lib/types.js";
import { worktreeListEntryToListName } from "../lib/utils.js";

/**
 * One entry as `--json` reports it. Every field the list could not fill in is
 * `null`, never omitted and never 0 (D6): `ahead` and `behind` are undefined
 * for a worktree whose count was never taken, and 0 would claim it was.
 * `agent` is left out entirely without `--agents`, because the lookup was
 * never made — `null` there means "looked, and none lives here".
 */
function toEntryDocument(
  entry: WorktreeListEntry,
  withAgents: boolean,
): WorktreeListEntryDocument {
  const document: WorktreeListEntryDocument = {
    branch: entry.branchName,
    path: entry.path,
    current: entry.isCurrent ?? false,
    pathExists: entry.pathExists ?? null,
    remote: entry.remote || null,
    remoteExists: entry.remoteExists ?? null,
    ahead: entry.ahead ?? null,
    behind: entry.behind ?? null,
    mergedInto: entry.mergedInto ?? null,
    // `gitGetWorktreeList` fills 0 for a directory that is gone, so the 0 is a
    // default there and not a count: nothing could be counted.
    uncommittedChanges:
      entry.pathExists === false ? null : (entry.uncommittedChanges ?? null),
    // The unsafe reading is the fallback, as everywhere a verdict is read.
    safeToRemove: entry.safeToRemove ?? false,
  };

  if (withAgents) {
    document.agent = entry.agent
      ? {
          name: entry.agent.name,
          sessionId: entry.agent.sessionId ?? null,
          herdrAgent: entry.agent.herdrAgent ?? null,
          live: entry.agent.live ?? null,
          interactive: entry.agent.interactive ?? null,
          waiting: entry.agent.waiting ?? null,
        }
      : null;
  }

  return document;
}

export default class List extends BaseCommand {
  // The first line is the summary oclif lists in `worktree --help`; the rest is
  // the `--json` shape and exit codes, kept to key names and nullability.
  static override description = `List worktree branches

--json prints one document on stdout: {worktrees: [entry]}
entry: branch, path, current, pathExists, remote, remoteExists, ahead,
behind, mergedInto, uncommittedChanges, safeToRemove
remote is null when the branch tracks nothing. mergedInto is null when not
known to be merged. pathExists and remoteExists are null, never false, when
they could not be checked; ahead, behind and uncommittedChanges are null,
never 0, when they could not be counted. current and safeToRemove are never
null: false when unknown.
With --agents each entry also has agent: null, or {name, sessionId,
herdrAgent, live, interactive, waiting}, where all but name can be null.
On failure: {error:{code, message, details?}} on stdout.

Exit codes:
0 success
1 failure
2 usage: a value is invalid`;
  // One JSON document on stdout, everything human on stderr (D6).
  static override enableJsonFlag = true;
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --agents",
    "<%= config.bin %> <%= command.id %> --json",
  ];

  static override flags = {
    agents: Flags.boolean({
      char: "a",
      description: "Show the agent session living in each worktree",
    }),
  };

  public async run(): Promise<WorktreeListDocument> {
    const { flags } = await this.parse(List);
    const spinner = createSpinner("Gathering worktree list").start();
    // The flag reaches both halves: it decides whether the session lookup
    // happens at all, and whether the result is rendered. Without it this
    // command costs exactly what it did before. See AGENT-MODE-PLAN §3 D8.
    const worktrees = await gitGetWorktreeList({
      includeCurrent: true,
      includeAgents: flags.agents,
    });
    spinner.stop();

    // The document is returned for oclif to print under `--json`, so the
    // human lines are not written at all then — they would only be noise on
    // stderr beside a document that says the same.
    if (!this.jsonEnabled()) {
      worktrees.forEach((wt) => {
        this.log(
          `- ${worktreeListEntryToListName(wt, "gray", { agents: flags.agents })}`,
        );
      });
    }

    return {
      worktrees: worktrees.map((wt) => toEntryDocument(wt, flags.agents)),
    };
  }
}
