import type { CONFIG_NAMES, OPENER_KINDS } from "./constants.js";
import type { InstallResult } from "./install.js";

export type ConfigName = (typeof CONFIG_NAMES)[number];

export type OpenerKind = (typeof OPENER_KINDS)[number];

/** An agent the open started. */
export interface OpenedAgent {
  /** The runtime session name; `null` where this CLI named nothing (D12). */
  name: string | null;
  kind: string | null;
  /** The command, without the brief. */
  command: string[];
  /** Whether a brief went to it — the receipt `branch` exits 1 without. */
  prompted: boolean;
}

/** What `openWorktreePath` opened and started. */
export interface OpenOutcome {
  opener: OpenerKind;
  herdr?: {
    space: string;
    pane: string;
    /** The Herdr handle, `null` when no agent was started in the pane. */
    agent: string | null;
  };
  agent?: OpenedAgent;
}

export interface WorktreeListBaseEntry {
  path: string;
  branchName: string;
  pathExists?: boolean;
  isCurrent?: boolean;
}

// One agent session, as `src/lib/agent.ts` builds it from the runtime's listing,
// Herdr's `agent list`, or both joined. Only `cwd` — the join key, already a
// real path by the time it is here — is load-bearing. `pid` is optional because
// the runtime omits it for a background session it has no process for (F-021).
// `kind`, `state` and `status` are optional because they appear in the output
// but not in the runtime's own --help, so a rename has to degrade a marker
// rather than drop the session. Nothing outside `agent.ts` reads them.
export interface AgentSession {
  name: string;
  pid?: number;
  cwd: string;
  /** The runtime's id for the session; what Herdr's entry is joined on. */
  sessionId?: string;
  /** The Herdr agent name, or the pane id when Herdr names none (#74). */
  herdrAgent?: string;
  kind?: string;
  status?: string;
  /** Herdr's status for a session the runtime also lists; kept apart from `status` so neither signal is lost in the join. */
  herdrStatus?: string;
  /** Set on a session only Herdr lists, whose `status` is then Herdr's. */
  herdrOnly?: boolean;
  state?: string;
}

// What a worktree entry carries about the session living in it — derived in
// `agent.ts`, so no raw `kind`, `state` or `status` value crosses this boundary.
//
// `live` is the only one of the three that a safety verdict rests on, and it is
// optional like the rest, so every reader has to say what an absent one means.
// `isSafeToRemove` reads it as live — the same direction D6 fails in, and the
// reason the test there is `!== false` rather than a truthiness check.
//
// `blocks` is the same kind of fact, narrower: whether the session holds a
// worktree back from `cleanup`. A live session that is only idle does not. Absent
// reads as blocking, for the same reason, and it is internal: `list --json` does
// not print it (#89).
export interface WorktreeAgent {
  name: string;
  pid?: number;
  sessionId?: string;
  herdrAgent?: string;
  live?: boolean;
  blocks?: boolean;
  interactive?: boolean;
  waiting?: boolean;
}

export interface WorktreeListEntry extends WorktreeListBaseEntry {
  remote: string;
  // Commits this worktree carries that its comparison base does not — `@{u}`
  // where the branch tracks a remote that still exists, the repository's
  // default branch where it does not. Undefined means the count was never
  // taken, which is not the same as zero and must never be read as it.
  ahead?: number;
  // Upstream-only, deliberately: counting it against the default branch would
  // mean "commits on main this branch does not have", which is non-zero for
  // almost every worktree the moment main advances. Undefined for a worktree
  // with no upstream, and no safety verdict rests on it.
  // See UNPUSHED-COMMIT-GUARD-PLAN §3 D4, GitHub issue #63.
  behind?: number;
  // Why `ahead` was not taken, when it was not. Set only alongside an
  // undefined `ahead`, and only where the reason is not already obvious from
  // another field — a worktree whose directory is gone says so through
  // `pathExists`. This is what keeps a cleanup that cannot classify anything
  // distinguishable from a cleanup with nothing to do. See §3 D5.
  aheadUnknownReason?: string;
  // The base every change this worktree carries was found in, when it was
  // found in one — set by patch equivalence, not by ancestry, so it survives a
  // squash merge and a rebase alike. Undefined means "not known to be merged",
  // which covers both a branch carrying real unmerged work and a probe that was
  // never run or could not answer; unknown is never safe, exactly as `ahead`
  // treats its own hole. See STALE-WORKTREE-DETECTION.
  mergedInto?: string;
  remoteExists?: boolean;
  uncommittedChanges?: number;
  safeToRemove?: boolean;
  agent?: WorktreeAgent;
}

// The documents `--json` prints on stdout, one per run (D6). A count or value
// that could not be taken is `null` in them, never omitted and never 0: a
// reader cannot tell "unknown" from "none" if both look the same.

/** The machine-readable reason an `--json` run failed. */
export type JsonErrorCode =
  | "missing_value"
  | "invalid_value"
  | "not_found"
  | "timeout"
  | "failed";

/** What stdout carries instead of a command's document when the run fails. */
export interface JsonErrorDocument {
  error: {
    code: JsonErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** The issue a branch was derived from; `url` is `null` when not known. */
export type BranchIssue =
  | { provider: "github"; number: number; url: string | null }
  | { provider: "jira"; key: string; url: string | null };

export interface BranchDocument {
  path: string;
  branch: string;
  source: string;
  issue: BranchIssue | null;
  /** `null` when no assignment was attempted. */
  assigned: boolean | null;
  envFilesCopied: string[];
  installed: InstallResult;
  /** `null` when Herdr was not opened. */
  herdr: OpenOutcome["herdr"] | null;
  /** `null` when no agent was started. */
  agent: OpenedAgent | null;
  warnings: string[];
}

export interface WorktreeListAgentDocument {
  name: string;
  sessionId: string | null;
  herdrAgent: string | null;
  live: boolean | null;
  interactive: boolean | null;
  waiting: boolean | null;
}

export interface WorktreeListEntryDocument {
  branch: string;
  path: string;
  current: boolean;
  pathExists: boolean | null;
  /** The upstream ref, `null` when the branch tracks none. */
  remote: string | null;
  remoteExists: boolean | null;
  ahead: number | null;
  behind: number | null;
  mergedInto: string | null;
  uncommittedChanges: number | null;
  safeToRemove: boolean;
  /** Present only with `--agents`; `null` when no session lives there. */
  agent?: WorktreeListAgentDocument | null;
}

export interface WorktreeListDocument {
  worktrees: WorktreeListEntryDocument[];
}

export interface RemoveDocument {
  removed: { branch: string; path: string }[];
  /** The Herdr workspace ids that were closed. */
  herdrSpacesClosed: string[];
  warnings: string[];
}
