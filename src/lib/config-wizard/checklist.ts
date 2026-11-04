import type { ConfigName } from "../types.js";

export type ChecklistId =
  | "github"
  | "jira"
  | "linear"
  | "clickup"
  | "opening"
  | "agent"
  | "branchPrefixes"
  | "postCreate";

export type ChecklistItem = {
  readonly id: ChecklistId;
  /** Says what the item does; never a key name. */
  readonly label: string;
  /** The keys the item asks, when still in the run's prompt list; a stored value in any pre-ticks it. */
  readonly keys: readonly ConfigName[];
};

/**
 * The bare run's checklist, in the order it is shown and its ticked items are
 * asked (plan #236, D2). `defaultSourceBranch` is not here: it is always asked.
 */
export const CHECKLIST_ITEMS: readonly ChecklistItem[] = [
  {
    id: "github",
    label: "GitHub issues: a token, and whether to assign issues to you",
    // A stored value in any key pre-ticks the item. The token is optional
    // (`gh auth token` supplies one), so `gh auth` alone does not: only a
    // stored token or a stored choice does (plan #236, D2).
    keys: ["github.token", "github.autoAssign"],
  },
  {
    id: "jira",
    label: "Jira: your site, sign-in, and whether to assign and start issues",
    keys: [
      "jira.host",
      "jira.email",
      "jira.apiToken",
      "jira.autoAssign",
      "jira.autoStart",
    ],
  },
  {
    id: "linear",
    label: "Linear: your API key, and whether to start issues",
    keys: ["linear.apiKey", "linear.autoStart"],
  },
  {
    id: "clickup",
    label: "ClickUp: your API token, workspace, and whether to start tasks",
    keys: ["clickup.apiToken", "clickup.workspaceId", "clickup.autoStart"],
  },
  {
    id: "opening",
    label: "How worktrees open: in an editor or Herdr, or not at all",
    keys: ["opener", "codeEditor", "herdr.focus", "herdr.agent"],
  },
  {
    id: "agent",
    label: "Coding agent: the command that `--agent` runs",
    keys: ["agent.command"],
  },
  {
    id: "branchPrefixes",
    label: "Branch prefixes: for feature, bugfix and chore branches",
    keys: ["branchPrefix.feature", "branchPrefix.bugfix", "branchPrefix.chore"],
  },
  {
    id: "postCreate",
    label: "Command to run after creating a worktree",
    keys: ["postCreate"],
  },
];

/** The items with at least one key still to ask, in checklist order. */
export function listChecklistItems(
  configNames: readonly ConfigName[],
): ChecklistItem[] {
  return CHECKLIST_ITEMS.filter((item) =>
    item.keys.some((name) => configNames.includes(name)),
  );
}

/** The items whose keys already hold a value. Reads only; clears nothing. */
export async function preTickedIds(
  items: readonly ChecklistItem[],
  read: (name: ConfigName) => Promise<string>,
): Promise<Set<ChecklistId>> {
  const ticked = new Set<ChecklistId>();
  for (const item of items) {
    for (const name of item.keys) {
      if (await read(name)) {
        ticked.add(item.id);
        break;
      }
    }
  }
  return ticked;
}
