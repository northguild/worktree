import { run, runCapturing } from "./cli.js";
import { gitGetConfigValue } from "./config.js";
import { redactSecrets } from "./redact.js";
import type { WorktreeIssue } from "./types.js";

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

// Fixed texts: nothing but a validated `Linear:` message ever reaches a warning
// (D7), and a failure that is not one has no message worth showing.
const NOT_CONSIDERED = "Canceled issues were not considered.";
const READ_FAILED = `Linear: could not read the recorded issue links. ${NOT_CONSIDERED}`;
const REMOTE_FAILED =
  "Git: could not ask a remote about a canceled issue's branch. Canceled branches on a remote that did not answer were kept.";
const LOOKUP_FAILED = `Linear: could not read issue states. ${NOT_CONSIDERED}`;

function lookupWarning(
  error: unknown,
  showVisibly: (text: string) => string,
): string {
  // `readLinearAnswer` and friends throw `Linear:` errors that can quote
  // Linear's own text, so it is redacted and escaped. Anything else (a raw
  // `fetch` failure, whose message can quote a header value) is not shown.
  if (error instanceof Error && error.message.startsWith("Linear:")) {
    return `${showVisibly(redactSecrets(error.message))} ${NOT_CONSIDERED}`;
  }
  return LOOKUP_FAILED;
}

const SHA = /^[0-9a-f]{40,64}$/;

// One line per branch: `<ref>\0<remotename>\0<remoteref>\0<tracking ref>`, and
// one per remote-tracking ref: `<ref>\0<object>`. git-for-each-ref(1) `%00`.
// The branch name is only ever a map key or an argv element.
async function readUpstreams() {
  const read = async (ref: string, format: string) =>
    (await run("git", ["for-each-ref", `--format=${format}`, ref]))
      .split("\n")
      .map((line) => line.split("\0"))
      .filter((fields) => fields.length > 1);

  const branches = await read(
    "refs/heads",
    "%(refname)%00%(upstream:remotename)%00%(upstream:remoteref)%00%(upstream)",
  );
  const tips = new Map(
    (await read("refs/remotes", "%(refname)%00%(objectname)")).map(
      ([ref, object]) => [ref, object] as const,
    ),
  );
  return { branches, tips };
}

/**
 * D4: sets `remoteConfirmed` on every canceled issue. True only when the remote
 * named by the branch's upstream reports, for the upstream's own ref, the object
 * the local tracking ref holds. Everything else is false: no upstream, an
 * upstream on this repository (`.`), a branch missing remotely, a different tip,
 * a failed call. One `ls-remote` per distinct remote; one failure never stops
 * another remote, and the caller warns once with fixed text (git's own text can
 * carry a URL with credentials).
 */
async function confirmRemoteTips(
  issues: Map<string, WorktreeIssue>,
  runGit: (args: string[]) => Promise<string>,
): Promise<boolean> {
  const canceled = [...issues].filter(
    ([, issue]) => issue.state === "canceled",
  );
  if (canceled.length === 0) {
    return true;
  }
  for (const [, issue] of canceled) {
    issue.remoteConfirmed = false;
  }

  let healthy = true;
  let upstreams: Awaited<ReturnType<typeof readUpstreams>>;
  try {
    upstreams = await readUpstreams();
  } catch {
    return false;
  }

  // remote -> the branches to check against it.
  const wanted = new Map<
    string,
    { issue: WorktreeIssue; remoteRef: string; tip: string }[]
  >();
  for (const [branch, issue] of canceled) {
    const fields = upstreams.branches.find(
      ([ref]) => ref === `refs/heads/${branch}`,
    );
    const [, remote = "", remoteRef = "", tracking = ""] = fields ?? [];
    const tip = upstreams.tips.get(tracking);
    // `.` is a branch of this repository: no remote holds it.
    if (!remote || remote === "." || !remoteRef || !tip || !SHA.test(tip)) {
      continue;
    }
    wanted.set(remote, [
      ...(wanted.get(remote) ?? []),
      { issue, remoteRef, tip },
    ]);
  }

  for (const [remote, branches] of wanted) {
    let listing: string;
    try {
      // `--end-of-options`: a remote name comes from config and may start "-".
      listing = await runGit([
        "ls-remote",
        "--heads",
        "--end-of-options",
        remote,
      ]);
    } catch {
      healthy = false;
      continue;
    }
    const heads = new Map(
      listing.split("\n").map((line) => {
        const [object = "", ref = ""] = line.split("\t");
        return [ref, object] as const;
      }),
    );
    for (const { issue, remoteRef, tip } of branches) {
      issue.remoteConfirmed = heads.get(remoteRef) === tip;
    }
  }
  return healthy;
}

/**
 * Every recorded issue link, branch name to issue, and with `lookup` the state
 * type of each, from one Linear request per 50 identifiers (D6, D11), and for
 * canceled ones the remote's confirmation of the tip (D4). It never throws and never warns more
 * than once: a failed read, a missing key that throws, or a failed lookup is
 * "no signal" (D7). No key, or no record, means no request and no warning (D8).
 */
export async function gatherIssueLinks({
  lookup,
  onWarning,
  runGit,
}: {
  lookup: boolean;
  onWarning: (message: string) => void;
  // The bounded, non-interactive runner for a call that waits on a remote
  // (`runGitFetch` in git.ts). Passed in because importing git.ts from here
  // would make a runtime import cycle.
  runGit: (args: string[]) => Promise<string>;
}): Promise<Map<string, WorktreeIssue>> {
  // Loaded on call, not at module load: git.ts imports this file, and both of
  // these reach git.ts again (linear.ts through branch-type.ts, and
  // project-config.ts directly), which would make a runtime import cycle.
  // project-config is already loaded by every command, so it cannot newly
  // fail; linear is loaded inside the try below, only when a request is due.
  const { showVisibly } = await import("./project-config.js");
  const issues = new Map<string, WorktreeIssue>();
  let warning: string | undefined;

  try {
    const links = await gitGetBranchIssueLinks().catch(() => {
      warning = READ_FAILED;
      return new Map<string, string>();
    });
    for (const [branch, key] of links) {
      issues.set(branch, { provider: "linear", key });
    }

    if (
      lookup &&
      links.size > 0 &&
      (await gitGetConfigValue("linear.apiKey"))
    ) {
      const { fetchLinearIssueStates } = await import(
        "../integrations/linear.js"
      );
      const states = await fetchLinearIssueStates([...new Set(links.values())]);
      for (const issue of issues.values()) {
        const state = states.get(issue.key);
        if (state) {
          issue.state = state;
        }
      }
      if (!(await confirmRemoteTips(issues, runGit))) {
        warning ??= REMOTE_FAILED;
      }
    }
  } catch (error) {
    warning = lookupWarning(error, showVisibly);
    // A half-applied answer is not a signal: every state is unknown.
    for (const issue of issues.values()) {
      delete issue.state;
    }
  }

  if (warning) {
    onWarning(warning);
  }
  return issues;
}
