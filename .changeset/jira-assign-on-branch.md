---
"@northguild/worktree": minor
---

`worktree branch --jira <key> --assign` now assigns the Jira issue to you instead of warning that it is unsupported, and leaves an issue held by someone else alone. The new `jira.autoAssign` config key makes it the default.

With neither flag and `jira.autoAssign` unset, `branch --jira` now acts where it used to do nothing: a terminal run asks whether to assign, and a non-interactive one (`--json`, CI, an agent) **assigns by default**, so a script or agent that passes `--jira` starts taking issues for the token's owner. Pass `--no-assign`, or set `jira.autoAssign false`, to keep the old behaviour.
