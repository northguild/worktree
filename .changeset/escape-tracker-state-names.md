---
"@northguild/worktree": patch
---

When `worktree branch --linear`, `--clickup` or `--jira` moves an issue to started, it now prints the state or status names, and the text of a tracker error, with control and formatting characters shown as escapes such as `\x1b`. The Linear issue picker already did this. A name set by anyone in the workspace can no longer redraw your terminal. The same escaped text appears in the `warnings` of the `--json` document.
