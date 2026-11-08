---
"@northguild/worktree": patch
---

A `defaultSourceBranch` that starts with `-`, for example from a `.worktree.yml` committed to a repository, is now passed to `git worktree add` as a branch name rather than read by git as an option.
