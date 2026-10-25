---
"@northguild/worktree": patch
---

`worktree config` no longer overwrites a stored `github.token` or `jira.apiToken` when the prompt is answered with only spaces (or, for Jira, nothing), and `worktree branch` now says why it could not save `github.autoAssign`.
