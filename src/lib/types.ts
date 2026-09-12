import type { CONFIG_NAMES, OPENER_KINDS } from "./constants.js";

export type ConfigName = (typeof CONFIG_NAMES)[number];

export type OpenerKind = (typeof OPENER_KINDS)[number];

export interface WorktreeListBaseEntry {
  path: string;
  branchName: string;
  pathExists?: boolean;
  isCurrent?: boolean;
}

// One entry of the agent runtime's session listing, as `src/lib/agent.ts` reads
// it. `kind`, `state` and `status` are optional because they appear in the
// output but not in the runtime's own --help, so a rename has to degrade a
// marker rather than drop the session. Nothing outside `agent.ts` reads them.
export interface AgentSession {
  name: string;
  pid: number;
  cwd: string;
  kind?: string;
  status?: string;
  state?: string;
}

// What a worktree entry carries about the session living in it — derived in
// `agent.ts`, so no raw `kind`, `state` or `status` value crosses this boundary.
//
// `live` is the only one of the three that a safety verdict rests on, and it is
// optional like the rest, so every reader has to say what an absent one means.
// `isSafeToRemove` reads it as live — the same direction D6 fails in, and the
// reason the test there is `!== false` rather than a truthiness check.
export interface WorktreeAgent {
  name: string;
  pid: number;
  live?: boolean;
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
