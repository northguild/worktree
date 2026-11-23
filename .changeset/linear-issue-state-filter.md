---
"@northguild/worktree": patch
---

`worktree list --issues` and `worktree cleanup` now read the state of every Linear issue instead of showing most as `state unknown`. Linear ignored the filter `worktree` sent for the batch, so a canceled issue's worktree was rarely offered for removal.
