---
"@northguild/worktree": minor
---

`worktree branch --jira <KEY> --start` now moves the Jira issue to its in-progress status once the worktree exists, leaving an issue that is already started or finished, or whose workflow offers no single in-progress move, alone. The new `jira.autoStart` config key makes it the default, and `started` in the `--json` document reports the outcome.

With neither flag and `jira.autoStart` unset, a terminal run asks whether to move the issue, and a non-interactive one (`--json`, CI, an agent) **moves it by default**, so a script or agent that passes `--jira` now changes the issue's status. Pass `--no-start`, or set `jira.autoStart false`, to keep it read-only. The token's user needs the *Transition Issues* permission on the issue.
