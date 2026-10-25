---
"@northguild/worktree": patch
---

Fix `worktree remove` and `worktree cleanup` failing on a detached worktree: they deleted its directory, then exited 1 on `git branch -D (detached HEAD)`, and `cleanup` never reached the rest of the batch. A detached worktree is now removed without a branch delete, and `remove` takes a worktree's path so each detached worktree can be named on its own.
