import { lstatSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/**
 * A directory counts as a checkpoint when its subtree is at most this share of
 * the tree. Measured on a 52,555-entry node_modules: 0.5% put the polling at
 * 4.2 to 4.6% of the removal time, 1% at 3.7 to 4.4%, so 1% keeps the margin
 * under the 5% budget while the bar still moves in steps of at most 1%.
 */
const CHECKPOINT_FRACTION = 0.01;

/**
 * Files sitting directly in a directory too large to be a checkpoint are
 * watched by sample, at most this many. Checking every one of them reached
 * 98% of the tree but cost 44% of the removal time in polling; 100 samples
 * reached 99% before git exited for about 4%.
 */
const MAX_SAMPLED_FILES = 100;

/**
 * Directory checkpoints have no cap of their own: a large directory holding
 * many tiny subdirectories (a build cache of hashed directories, say) makes one
 * checkpoint of each. A tree of 30,000 two-entry subdirectories gave 30,001
 * checkpoints, and one lstat pass over them took 71 to 89 ms of the 100 ms
 * interval. So each poll checks at most this many, in rotation. This repo's
 * 52,044-entry node_modules gave 1,290 checkpoints in a 3.6 to 4.0 ms pass, so
 * it is still checked whole on every poll; a tree with more checkpoints costs
 * about as much per poll, and its count lags by one rotation at most.
 */
const MAX_CHECKS_PER_POLL = 1_500;

/**
 * One path whose disappearance accounts for `entries` entries of the tree.
 * A checkpoint directory accounts for its whole subtree, because git removes a
 * directory only after everything inside it.
 */
export interface Checkpoint {
  path: string;
  entries: number;
}

export interface TreeMeasurement {
  /** Every file, directory and symlink below the root; the root itself is not counted. */
  total: number;
  checkpoints: Checkpoint[];
  /** Share of `total` the checkpoints can account for, from 0 to 1. */
  coveredFraction: number;
}

export interface MeasureTreeOptions {
  checkpointFraction?: number;
  maxSampledFiles?: number;
}

export interface RemovalWatcherOptions {
  maxChecksPerPoll?: number;
}

export interface RemovalWatcher {
  /**
   * Entries gone so far; never decreases, never exceeds the total. Each call
   * checks at most `maxChecksPerPoll` of the remaining checkpoints, the ones
   * checked longest ago, so the count can trail the deletion by a few calls.
   */
  countGone(): number;
}

interface DirectoryRecord {
  path: string;
  /** Entries in the subtree, the directory itself included. */
  size: number;
  subdirectories: DirectoryRecord[];
  filePaths: string[];
}

async function readDirectory(path: string): Promise<DirectoryRecord> {
  const children = await readdir(path, { withFileTypes: true });
  const subdirectories = await Promise.all(
    children
      .filter((child) => child.isDirectory())
      .map((child) => readDirectory(join(path, child.name))),
  );
  const filePaths = children
    .filter((child) => !child.isDirectory())
    .map((child) => join(path, child.name));
  const size =
    1 +
    filePaths.length +
    subdirectories.reduce((sum, directory) => sum + directory.size, 0);
  return { path, size, subdirectories, filePaths };
}

/** The entry for a worktree whose directory is already gone: it weighs 1 and has no checkpoints. */
export function measureAbsentTree(): TreeMeasurement {
  return { total: 1, checkpoints: [], coveredFraction: 0 };
}

/**
 * Counts the tree under `path` without following symlinks (a symlink is one
 * entry and is never entered) and picks the checkpoints to watch. Reads only;
 * any error propagates so the caller can fall back.
 */
export async function measureTree(
  path: string,
  options: MeasureTreeOptions = {},
): Promise<TreeMeasurement> {
  const {
    checkpointFraction = CHECKPOINT_FRACTION,
    maxSampledFiles = MAX_SAMPLED_FILES,
  } = options;
  const root = await readDirectory(path);
  const total = root.size - 1;
  const threshold = Math.max(1, Math.floor(total * checkpointFraction));

  const largeDirectories: DirectoryRecord[] = [];
  const checkpoints: Checkpoint[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (directory === undefined) break;
    if (directory.size <= threshold) {
      checkpoints.push({ path: directory.path, entries: directory.size });
      continue;
    }
    largeDirectories.push(directory);
    pending.push(...directory.subdirectories);
  }
  let coveredEntries = checkpoints.reduce(
    (sum, checkpoint) => sum + checkpoint.entries,
    0,
  );

  // A large directory is itself one entry (the root is not), and its direct
  // files are covered by sampling one file in every stride, in readdir's order.
  const gapFileCount = largeDirectories.reduce(
    (sum, directory) => sum + directory.filePaths.length,
    0,
  );
  const stride = Math.max(1, Math.ceil(gapFileCount / maxSampledFiles));
  for (const directory of largeDirectories) {
    if (directory !== root) {
      checkpoints.push({ path: directory.path, entries: 1 });
      coveredEntries += 1;
    }
    // The last file of each group stands for the whole group. Node's readdir
    // sorts by name while git unlinks in the filesystem's own order, so the
    // representative can vanish before the rest of its group: the count may
    // run ahead by up to one group, never past the total.
    for (let start = 0; start < directory.filePaths.length; start += stride) {
      const group = directory.filePaths.slice(start, start + stride);
      const representative = group.at(-1);
      if (representative === undefined) continue;
      checkpoints.push({ path: representative, entries: group.length });
      coveredEntries += group.length;
    }
  }

  return {
    total,
    checkpoints,
    coveredFraction: total === 0 ? 0 : Math.min(1, coveredEntries / total),
  };
}

function isGone(path: string): boolean {
  try {
    lstatSync(path);
    return false;
  } catch (error) {
    return (
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    );
  }
}

/**
 * Answers how many entries are gone from which checkpoints no longer exist.
 * It holds no timer: the caller polls `countGone`, and a test drives it by
 * deleting paths and calling it.
 */
export function createRemovalWatcher(
  measurement: TreeMeasurement,
  options: RemovalWatcherOptions = {},
): RemovalWatcher {
  const { maxChecksPerPoll = MAX_CHECKS_PER_POLL } = options;
  // A queue: each call checks the front of it, and what is still there goes
  // to the back, so every checkpoint is checked once per rotation.
  let remaining = [...measurement.checkpoints];
  let gone = 0;
  return {
    countGone() {
      const checked = remaining.slice(0, maxChecksPerPoll);
      const stillThere = checked.filter((checkpoint) => {
        if (!isGone(checkpoint.path)) return true;
        gone += checkpoint.entries;
        return false;
      });
      remaining = remaining.slice(checked.length).concat(stillThere);
      return Math.min(gone, measurement.total);
    },
  };
}
