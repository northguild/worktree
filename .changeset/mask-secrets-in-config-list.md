---
"@northguild/worktree": patch
---

`worktree config --list` no longer prints `github.token`, `jira.apiToken` or `linear.apiKey` in clear: a key that holds a value is listed as `<key>=***`. `worktree config <key>` still prints the value, so scripts that read a token by name keep working.
