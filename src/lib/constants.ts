import type { ConfigName } from "./types.js";

export const CONFIG_NAMES = [
  "has-called-config",
  "jira.host",
  "jira.deployment",
  "jira.email",
  "jira.apiToken",
  "jira.autoAssign",
  "jira.autoStart",
  "linear.apiKey",
  "linear.autoStart",
  "linear.agentToken",
  "linear.webhookSecret",
  "linear.agentAllow",
  "linear.agentContext",
  "clickup.apiToken",
  "clickup.workspaceId",
  "clickup.autoAssign",
  "clickup.autoStart",
  "github.token",
  "github.autoAssign",
  "github.repository",
  "github.host",
  "branchPrefix.feature",
  "branchPrefix.bugfix",
  "branchPrefix.chore",
  "opener",
  "codeEditor",
  "herdr.focus",
  "herdr.agent",
  "rex.focus",
  "agent.command",
  "postCreate",
  "defaultSourceBranch",
] as const;

// The keys that hold a credential. `worktree config --list` shows these as set
// but masked, because a listing ends up in screen shares and pasted bug reports.
export const SECRET_CONFIG_NAMES = [
  "jira.apiToken",
  "linear.apiKey",
  "linear.agentToken",
  "linear.webhookSecret",
  "clickup.apiToken",
  "github.token",
] as const satisfies readonly ConfigName[];

// Keys the wizard never asks for: stored, listed and settable by name, but
// absent from a bare run and from `--missing`. `github.repository` names a fork
// setup's issue repository, an exception rather than something to ask everyone
// (D7), so a prompt for it would be noise for the people with no fork.
// `github.host` names a GitHub Enterprise host (#120 D7); most people use
// github.com, so it is asked of no one. `jira.deployment` names a Jira Data
// Center site (#126 D2); most people use Cloud, so it is asked of no one.
// The four `linear.agent*`/`linear.webhookSecret` keys (#115 D9) mean something
// only to someone running a Linear agent listener, so they are asked of no one.
export const UNPROMPTED_CONFIG_NAMES = [
  "github.repository",
  "github.host",
  "jira.deployment",
  "linear.agentToken",
  "linear.webhookSecret",
  "linear.agentAllow",
  "linear.agentContext",
] as const satisfies readonly ConfigName[];

// Accepted values for the `jira.deployment` config key (#126 D1, D2). Unset
// means `cloud`, which is what every install did before the key existed.
// `server` is deliberately not an alias for `datacenter`.
export const JIRA_DEPLOYMENTS = ["cloud", "datacenter"] as const;

// Accepted values for the `opener` config key: which destination a worktree is
// handed to once it exists. Unset means `editor`, which is what every install
// did before the key existed. `none` opens nothing: the path is printed and the
// command stops, for scripts and agents that have no use for a window.
export const OPENER_KINDS = ["editor", "herdr", "rex", "none"] as const;

// The keys that only mean something when Herdr is installed. `worktree config`
// hides them when it is not, so the feature is invisible to everyone else.
// `opener` is not here: with `none` it has a use on every machine, so it is
// always shown.
export const HERDR_CONFIG_NAMES = [
  "herdr.focus",
  "herdr.agent",
] as const satisfies readonly ConfigName[];

// The keys that only mean something when the `rex` CLI can be found, hidden
// from `worktree config` the same way (#270 D5). `opener` stays out for the
// reason it stays out of the list above.
export const REX_CONFIG_NAMES = [
  "rex.focus",
] as const satisfies readonly ConfigName[];
