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
  "defaultSourceBranch",
] as const;

// Accepted values for the `opener` config key: which destination a worktree is
// handed to once it exists. Unset means `editor`, which is what every install
// did before the key existed.
export const OPENER_KINDS = ["editor", "herdr"] as const;
