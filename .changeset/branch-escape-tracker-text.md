---
"@northguild/worktree": patch
---

`worktree branch` now prints a Jira assignee's name and any tracker error text with control characters shown as visible escapes, so text from the tracker can no longer redraw your terminal. The same goes for the error line a failed command ends on.
