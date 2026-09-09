import type { ConfigName } from "./types.js";

export const CONFIG_NAMES = [
  "has-called-config",
  "jira.host",
  "jira.email",
  "jira.apiToken",
  "github.token",
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
// did before the key existed.
export const OPENER_KINDS = ["editor", "herdr"] as const;

// The keys that only mean something when Herdr is installed. `worktree config`
// hides them when it is not, so the feature is invisible to everyone else.
// `opener` is here because `editor` — the default — is the only other kind it
// accepts; adding a third kind to OPENER_KINDS is the signal to revisit that.
export const HERDR_CONFIG_NAMES = [
  "opener",
  "herdr.focus",
  "herdr.agent",
] as const satisfies readonly ConfigName[];
