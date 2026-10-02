---
"@northguild/worktree": patch
---

`worktree list --agents` now marks an interactive agent session as `waiting` when it has finished its turn or is blocked on a question, as it already did for background sessions. That includes the agents `worktree branch` starts through Herdr, so a coordinator polling `list --agents --json` can see a worker finish. The text list shows such a session as `[interactive, waiting]`. A session is now `waiting` only when every source agrees: one the runtime calls idle while Herdr reports it working is not, and Herdr's `done` (a finished turn nobody has looked at yet) counts as waiting.
