---
"@northguild/worktree": patch
---

Reopening an existing worktree, from `branch` after answering yes to "Open it instead?" or from `open`, no longer ends on a line saying the worktree was created. With `opener` `none`, no `codeEditor`, or (for `branch`) `--no-open`, it now says the worktree already exists — `Worktree already exists at <path>`, or `✔ Worktree already exists at <path>` with no `codeEditor` — still ending on the path.
