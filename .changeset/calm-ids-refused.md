---
"@northguild/worktree": patch
---

`worktree branch` now reports a malformed `--github` issue id or `--jira` issue key as `invalid_value` and exits 2, like any other refused value, instead of exiting 1 with `failed`. An issue that does not exist, or a failed lookup, still exits 1.
