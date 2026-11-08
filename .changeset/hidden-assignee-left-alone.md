---
"@northguild/worktree": patch
---

`worktree branch --jira KEY --assign` no longer replaces a colleague's assignment when the issue's project leaves Assignee out of its field scheme. Jira then hides the assignee from the read, so `worktree` cannot tell a free issue from a held one: it warns, leaves the issue alone and still creates the worktree, and `assigned` is `false`.
