---
"@northguild/worktree": patch
---

Cut the title part of a branch name from `--jira` and `--linear` to at most 48 characters at a word boundary, the way `--github` already does, so a long issue title no longer makes an unwieldy branch name and worktree directory.
