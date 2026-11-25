---
"@northguild/worktree": patch
---

`remove`, `list` and `cleanup` no longer fail when a worktree directory has lost its `.git` file. Git's record of it is pruned on removal, and the directory is left on disk for you to check.
