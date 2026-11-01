---
"@northguild/worktree": minor
---

`worktree branch --clickup <ID> --start` now moves the ClickUp task to its List's first in-progress status once the worktree exists, leaving a task that is already started, finished or in a List with no in-progress status alone. The new `clickup.autoStart` config key makes it the default, and `started` in the `--json` document reports the outcome.

With neither flag and `clickup.autoStart` unset, a terminal run asks whether to move the task, and a non-interactive one (`--json`, CI, an agent) **moves it by default**, so a script or agent that passes `--clickup` now changes the task's status. Pass `--no-start`, or set `clickup.autoStart false`, to keep it read-only. The token's user needs edit access to the task.
