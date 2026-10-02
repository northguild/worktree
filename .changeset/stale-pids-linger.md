---
"@northguild/worktree": patch
---

`worktree cleanup` no longer removes a worktree whose agent session the runtime reports as done while its process is still running. Such a session now counts as live, so it holds the worktree back unless it is idle, and `worktree list --agents` no longer marks it `[done]`.
