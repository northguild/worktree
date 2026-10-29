---
"@northguild/worktree": patch
---

`worktree branch` now fetches with `--prune` on every run, so remote-tracking branches deleted on the remote are removed locally; before, only `--source` pruned.
