---
"@northguild/worktree": patch
---

`worktree config --user <key> <value>` now works from a directory that is not a git repository, such as your home directory, instead of failing with `fatal: not in a git directory`.
