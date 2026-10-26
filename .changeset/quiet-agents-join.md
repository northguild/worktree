---
"@northguild/worktree": patch
---

`remove` now names a live agent session before it asks (and warns under `--force`), `cleanup --ignore-agents` names the worktrees it sweeps past, and a detached agent that fails to start is reported as failed (`agent: null`, exit `1`) instead of started.
