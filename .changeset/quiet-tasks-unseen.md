---
"@northguild/worktree": patch
---

A ClickUp task that does not exist, or that your token cannot see, is no longer reported as an authentication failure. `worktree` now says it could not find the task, or that the token cannot see it, and quotes ClickUp's own explanation. A rejected token still reports `Authentication failed`.
