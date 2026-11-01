import type { ConfigName } from "./types.js";

export const CONFIG_NAMES = [
  "has-called-config",
  "jira.host",
  "jira.email",
  "jira.apiToken",
  "jira.autoAssign",
  "jira.autoStart",
  "linear.apiKey",
  "linear.autoStart",
  "clickup.apiToken",
  "clickup.workspaceId",
  "clickup.autoStart",
  "github.token",
  "github.autoAssign",
  "github.repository",
  "branchPrefix.feature",
  "branchPrefix.bugfix",
  "branchPrefix.chore",
  "opener",
  "codeEditor",
  "herdr.focus",
  "herdr.agent",
  "agent.command",
  "postCreate",
  "defaultSourceBranch",
] as const;

// The keys that hold a credential. `worktree config --list` shows these as set
// but masked, because a listing ends up in screen shares and pasted bug reports.
export const SECRET_CONFIG_NAMES = [
  "jira.apiToken",
  "linear.apiKey",
  "clickup.apiToken",
  "github.token",
] as const satisfies readonly ConfigName[];

// Keys the wizard never asks for: stored, listed and settable by name, but
// absent from a bare run and from `--missing`. `github.repository` names a fork
// setup's issue repository, an exception rather than something to ask everyone
// (D7), so a prompt for it would be noise for the people with no fork.
export const UNPROMPTED_CONFIG_NAMES = [
  "github.repository",
] as const satisfies readonly ConfigName[];

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
