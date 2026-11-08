---
"@northguild/worktree": patch
---

`worktree config --user <key> <value>` now works from a directory that is not a git repository, such as your home directory, instead of failing with `fatal: not in a git directory`. `defaultSourceBranch` is the exception: it is still checked against the current repository's branches, so set it from inside one.
