---
"@northguild/worktree": patch
---

Opening a worktree with a Herdr agent now retries the agent start for a couple of seconds when the pane's shell is not ready yet, before warning `agent_pane_busy` and leaving the agent unstarted.
