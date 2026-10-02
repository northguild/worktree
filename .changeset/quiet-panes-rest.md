---
"@northguild/worktree": patch
---

`worktree cleanup` no longer holds back a merged worktree just because an agent session in it is idle, such as a Claude pane left open at its prompt. A session that is working, blocked or in an unknown state still holds its worktree back.
