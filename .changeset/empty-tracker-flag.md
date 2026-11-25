---
"@northguild/worktree": patch
---

`worktree branch` now refuses an empty `--github`, `--jira`, `--linear` or `--clickup` (exit `2`, `invalid_value`) instead of going on as if the flag were not given.
