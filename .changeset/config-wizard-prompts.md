---
"@northguild/worktree": minor
---

`worktree config` now asks yes/no and fixed-choice settings (`herdr.focus`, `github.autoAssign`, `opener`) as prompts instead of typed words, and `--yes --names <key>` keeps the stored value instead of exiting 2. Stored values and `worktree config <key> <value>` are unchanged.
