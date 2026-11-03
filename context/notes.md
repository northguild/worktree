# Notes — jira-data-center (#126)

Non-blocking review observations. Branch-local; `/feature-close` deletes this file whole. Nothing reads it.

## Phase 1 — The `jira.deployment` key

- `config.test.ts` exercises `--list --missing` only. The prompting `config --missing` run (no `--list`) is
  not exercised for `jira.deployment`, where the risk is an empty Jira group question (`config.ts`,
  `hasJiraPrompt`). Membership in `UNPROMPTED_CONFIG_NAMES` is pinned, so a regression on this key still
  fails a test. `github.host`'s test has the same gap.
- `validators.test.ts` pins the message "Jira deployment must be cloud or datacenter", which D2 does not
  specify. The `worktree config` refusal says "Jira deployment" rather than `jira.deployment`, as the other
  validators word theirs.
- `src/lib/types.ts` changed though it is not on the phase's Files line (a one-line `JiraDeployment` alias
  beside `OpenerKind`).
- `config.test.ts` asserts membership in constant arrays, mirroring the `github.host` test; the behavioural
  tests beside it cover the same rule.
- The narrowing comment in `resolveJiraDeployment` runs to 85 characters, a little past the file's ~80.
