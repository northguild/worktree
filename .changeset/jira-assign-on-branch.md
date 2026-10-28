---
"@northguild/worktree": minor
---

`worktree branch --jira <key> --assign` now assigns the Jira issue to you instead of warning that it is unsupported, and leaves an issue held by someone else alone. The new `jira.autoAssign` config key makes it the default.
