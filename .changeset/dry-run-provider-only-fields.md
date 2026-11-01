---
"@northguild/worktree": patch
---

`worktree branch --dry-run` no longer offers a provider-only field, such as a Jira custom field, as a line to paste into the shared `branchType` list. When the shared list decided, it names `<provider>.branchType` beside that field, and `--json` gives every field the list its lines belong in as `pasteInto`.
