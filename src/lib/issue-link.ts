import { run, runCapturing } from "./cli.js";

// Restated from `getIssueIdentifier` in src/integrations/linear.ts (the same
// shape as a Jira key), which is not exported. A value read back from git
// config is checked against it before use (D9).
const ISSUE_IDENTIFIER = /^[A-Z][A-Z0-9]*-\d+$/;

// D2: the value names its provider, so the key can carry others later.
const LINEAR_PREFIX = "linear:";

const KEY_PREFIX = "branch.";
// Git lowercases a variable name when it lists it, whatever case it was set in.
const KEY_SUFFIX = ".worktreeissue";

/**
 * Links a branch to its Linear issue: `branch.<name>.worktreeIssue =
 * linear:<IDENTIFIER>` (D1). Git moves a `branch.<name>.*` section on a rename
 * and drops it when the branch is deleted, so the link follows the branch.
 *
 * argv only; the branch name and value are single elements, never a shell
 * string.
 */
export async function gitSetBranchIssueLink(
  branchName: string,
  identifier: string,
): Promise<void> {
  if (!ISSUE_IDENTIFIER.test(identifier)) {
    throw new Error("Invalid issue identifier.");
  }
  await run("git", [
    "config",
    `${KEY_PREFIX}${branchName}.worktreeIssue`,
    `${LINEAR_PREFIX}${identifier}`,
  ]);
}

/**
 * Every recorded link in the repository, branch name to Linear identifier, from
 * one `git config` call. A value that is not `linear:<identifier>` is dropped
 * (D9), so nothing unvalidated leaves this function.
 */
export async function gitGetBranchIssueLinks(): Promise<Map<string, string>> {
  // `-z` ends each entry with NUL and separates key from value with a newline.
  // Not trimmed: the stream is delimited, not one value.
  const { stdout, stderr, exitCode } = await runCapturing(
    "git",
    [
      "config",
      "--local",
      "-z",
      "--get-regexp",
      "^branch\\..*\\.worktreeissue$",
    ],
    { trim: false },
  );

  // Exit 1: no key matched, so no branch is linked.
  if (exitCode === 1) {
    return new Map();
  }
  if (exitCode !== 0) {
    throw new Error(stderr || `git config exited with code ${exitCode}`);
  }

  const links = new Map<string, string>();
  for (const entry of stdout.split("\0")) {
    // A branch name cannot hold a newline, so the first one ends the key.
    const separator = entry.indexOf("\n");
    if (separator === -1) {
      continue;
    }
    const key = entry.slice(0, separator);
    const value = entry.slice(separator + 1);

    if (!value.startsWith(LINEAR_PREFIX)) {
      continue;
    }
    const identifier = value.slice(LINEAR_PREFIX.length);
    if (!ISSUE_IDENTIFIER.test(identifier)) {
      continue;
    }
    // The subsection may hold dots, so the branch is what lies between the
    // fixed prefix and suffix, not a split on ".".
    links.set(key.slice(KEY_PREFIX.length, -KEY_SUFFIX.length), identifier);
  }
  return links;
}
