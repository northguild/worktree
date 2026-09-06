import chalk, { type ColorName } from "chalk";
import type { WorktreeAgent, WorktreeListEntry } from "./types.js";

export function conjoin(
  arr: readonly (string | number)[],
  conjunction: "and" | "or" = "and",
): string {
  if (arr.length === 0) return "";
  if (arr.length === 1) return String(arr[0]);
  if (arr.length === 2) return `${arr[0]} ${conjunction} ${arr[1]}`;

  const allButLast = arr.slice(0, -1).join(", ");
  const last = arr[arr.length - 1];
  return `${allButLast} ${conjunction} ${last}`;
}

export function strToNum(str: string): number | undefined {
  const num = Number(str);
  if (!Number.isNaN(num)) {
    return num;
  }
}

interface WorktreeListNameOptions {
  // Off by default so the caller has to ask. `cleanup` shares this renderer and
  // its output is pinned by cleanup.test.ts, so a detail that appeared whenever
  // the field happened to be populated would rewrite that output the moment
  // cleanup starts joining sessions of its own. See AGENT-MODE-PLAN §3 D8.
  agents?: boolean;
}

// The two markers are mutually exclusive by construction — isSessionWaiting is
// never true for an interactive session (§4.1) — so at most one ever appends,
// and a background session that is getting on with its work carries none. That
// is what makes "actively working" the readable default rather than an absence
// the reader has to infer.
function agentDetail(agent: WorktreeAgent): string {
  const marker = agent.interactive
    ? " [interactive]"
    : agent.waiting
      ? " [waiting]"
      : "";
  return `Agent: ${agent.name}${marker}`;
}

export function worktreeListEntryToListName(
  wt: WorktreeListEntry,
  color: ColorName = "gray",
  { agents = false }: WorktreeListNameOptions = {},
): string {
  const details = [];
  if (!wt.pathExists) {
    details.push("Path does not exist");
  }
  if (wt.remote && !wt.remoteExists) {
    details.push(`Remote removed`);
  }
  if (wt.ahead || wt.behind) {
    details.push(`Ahead: ${wt.ahead ?? 0}, Behind: ${wt.behind ?? 0}`);
  }
  if (wt.uncommittedChanges) {
    details.push(
      `${wt.uncommittedChanges} uncommitted ${wt.uncommittedChanges === 1 ? "change" : "changes"}`,
    );
  }
  if (agents && wt.agent) {
    details.push(agentDetail(wt.agent));
  }

  const currentStr = wt.isCurrent ? chalk.green(" (Current)") : "";
  const detailsStr =
    details.length > 0 ? chalk[color](` (${details.join(", ")})`) : "";

  return `${wt.branchName}${currentStr}${detailsStr}`;
}

export function sanitizeBranchName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
