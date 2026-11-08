---
"@northguild/worktree": patch
---

`worktree branch`, `worktree rename` and `worktree config --user defaultSourceBranch` now accept a branch name containing `@`, such as `user@fix`. Only the sequence `@{`, which git forbids, and the name `@` on its own, which git reads as HEAD, are refused.
