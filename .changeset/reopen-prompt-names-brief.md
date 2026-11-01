---
"@northguild/worktree": patch
---

`worktree branch` with a brief (`--agent`, `--agent-file` or `--agent-stdin`) on a branch that already has a worktree now asks `Open it and hand the brief to a new agent there? One may already be running in it.` instead of `Open it instead?`, so a yes no longer starts a second agent without warning.
