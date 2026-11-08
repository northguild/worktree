---
"@northguild/worktree": patch
---

`worktree branch`, `worktree rename` and `worktree config --user defaultSourceBranch` now accept a branch name containing `{`, such as `a{b`. Only the sequence `@{`, which git forbids, is refused.
