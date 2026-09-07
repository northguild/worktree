import type { CONFIG_NAMES, OPENER_KINDS } from "./constants.js";

export type ConfigName = (typeof CONFIG_NAMES)[number];

export type OpenerKind = (typeof OPENER_KINDS)[number];

export interface WorktreeListBaseEntry {
  path: string;
  branchName: string;
  pathExists?: boolean;
  isCurrent?: boolean;
}

export interface WorktreeListEntry extends WorktreeListBaseEntry {
  remote: string;
  ahead?: number;
  behind?: number;
  remoteExists?: boolean;
  uncommittedChanges?: number;
  safeToRemove?: boolean;
}
