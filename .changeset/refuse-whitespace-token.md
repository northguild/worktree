---
"@northguild/worktree": patch
---

`worktree config github.token "   "`, and the same for `jira.apiToken` and `linear.apiKey`, now refuses a value that is only whitespace with exit 2 (`invalid_value` under `--json`) and stores nothing. Before, it exited 0 and stored a token that read back as unset.
