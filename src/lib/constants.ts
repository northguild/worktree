import type { ConfigName } from "./types.js";

export const CONFIG_NAMES = [
  "has-called-config",
  "jira.host",
  "jira.email",
  "jira.apiToken",
  "github.token",
  "github.autoAssign",
  "branchPrefix.feature",
  "branchPrefix.bugfix",
  "branchPrefix.chore",
  "opener",
  "codeEditor",
  "herdr.focus",
  "herdr.agent",
  "agent.command",
  "defaultSourceBranch",
] as const;

// Accepted values for the `opener` config key: which destination a worktree is
// handed to once it exists. Unset means `editor`, which is what every install
// did before the key existed. `none` opens nothing: the path is printed and the
// command stops, for scripts and agents that have no use for a window.
export const OPENER_KINDS = ["editor", "herdr", "none"] as const;

// The keys that only mean something when Herdr is installed. `worktree config`
// hides them when it is not, so the feature is invisible to everyone else.
// `opener` is not here: with `none` it has a use on every machine, so it is
// always shown.
export const HERDR_CONFIG_NAMES = [
  "herdr.focus",
  "herdr.agent",
] as const satisfies readonly ConfigName[];
