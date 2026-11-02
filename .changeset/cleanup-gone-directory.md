---
"@northguild/worktree": patch
---

`worktree cleanup` no longer stops partway with `fatal: '<path>' is not a working tree` when a worktree's directory is already gone. It now deletes that worktree's branch and carries on to the ones after it.
