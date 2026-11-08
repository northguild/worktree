---
"@northguild/worktree": patch
---

`worktree config --user defaultSourceBranch <branch>` now works from a directory that is not a git repository, and accepts a branch that exists in other repositories but not the current one. It checks the branch name's syntax only, since the user file is a fallback for every repository.
