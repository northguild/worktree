import chalk, { type ColorName } from "chalk";
import type { WorktreeListEntry } from "./types.js";

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

export function worktreeListEntryToListName(
  wt: WorktreeListEntry,
  color: ColorName = "gray",
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

/**
 * Splits a configured command value into an executable plus its arguments,
 * honouring single and double quotes. `open -a "Sublime Text"` is the value a
 * macOS user writes, and before quote awareness it reached `execFile` as four
 * arguments with the quote characters still attached, so `open` launched and
 * then failed on an application name it could not resolve (F-001).
 *
 * Quotes group and are not themselves part of the token. Nothing else is
 * interpreted: with no shell involved there is nothing to expand `~` or
 * `$EDITOR`, and an unterminated quote simply runs to the end of the value
 * rather than throwing — the opener runs after the worktree already exists, so
 * a bad value is worth a failed launch, never a failed command.
 */
export function splitCommandValue(value: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let hasToken = false;
  let openQuote: '"' | "'" | undefined;

  for (const character of value) {
    if (openQuote) {
      if (character === openQuote) {
        openQuote = undefined;
      } else {
        token += character;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      openQuote = character;
      // A quote opens a token even when what it encloses is empty, so an
      // explicit `""` argument survives as one.
      hasToken = true;
      continue;
    }

    if (/\s/.test(character)) {
      if (hasToken) {
        tokens.push(token);
        token = "";
        hasToken = false;
      }
      continue;
    }

    token += character;
    hasToken = true;
  }

  if (hasToken) {
    tokens.push(token);
  }

  return tokens;
}
