---
"@northguild/worktree": patch
---

`worktree branch --agent-stdin` now reads the piped brief when the branch comes from an issue flag (`--linear`, `--github`, `--jira`, `--clickup`) instead of failing with "The agent brief from --agent-stdin is empty", so `worktree linear-listen` delegations start their agent.
