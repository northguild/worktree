---
"@northguild/worktree": minor
---

`worktree branch --clickup <ID> --assign` now assigns the ClickUp task to you instead of warning that it is unsupported, adding you alongside anyone already on it and leaving a task that is already yours alone. The new `clickup.autoAssign` config key makes it the default.

With neither flag and `clickup.autoAssign` unset, `branch --clickup` now acts where it used to do nothing: a terminal run asks whether to assign, and a non-interactive one (`--json`, CI, an agent) **assigns by default**, so a script or agent that passes `--clickup` starts taking tasks for the token's owner. Pass `--no-assign`, or set `clickup.autoAssign false`, to keep it read-only. The token's user needs edit access to the task.
