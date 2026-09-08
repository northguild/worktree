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
  ahead?: number;
  behind?: number;
  remoteExists?: boolean;
  uncommittedChanges?: number;
  safeToRemove?: boolean;
  agent?: WorktreeAgent;
}
