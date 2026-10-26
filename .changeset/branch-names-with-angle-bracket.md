---
"@northguild/worktree": patch
---

Fix a branch whose name contains `<-` losing its upstream: `worktree list` showed it as untracked and counted its commits against the default branch, and `worktree cleanup` could judge it safe to remove even though its remote branch still existed.
