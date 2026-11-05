---
"@northguild/worktree": patch
---

`worktree cleanup` and `worktree remove` now move their progress bar as git deletes a worktree, instead of sitting at 0% until it finishes, and a failed removal no longer leaves the terminal cursor hidden.
