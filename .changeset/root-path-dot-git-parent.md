---
"@northguild/worktree": patch
---

Fix a repository under a directory whose name starts with `.git`, such as `~/.github/proj`, being rooted at the wrong place when run from one of its worktrees.
