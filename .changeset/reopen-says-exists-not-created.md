---
"@northguild/worktree": patch
---

Reopening an existing worktree, from `branch` after answering yes to "Open it instead?" or from `open`, no longer ends on a line saying the worktree was created. With `--no-open`, `opener` `none` or no `codeEditor` it now prints `Worktree already exists at <path>`, still ending on the path.
