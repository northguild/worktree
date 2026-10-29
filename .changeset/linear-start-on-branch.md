---
"@northguild/worktree": minor
---

`worktree branch --linear <ID> --start` now moves the Linear issue to its team's first started state once the worktree exists, leaving issues already started, done or in triage alone. The new `linear.autoStart` config key makes it the default, and `started` in the `--json` document reports the outcome.

With neither flag and `linear.autoStart` unset, a terminal run asks whether to start the issue, and a non-interactive one (`--json`, CI, an agent) **starts it by default**, so a script or agent that passes `--linear` now changes the issue's state. Pass `--no-start`, or set `linear.autoStart false`, to keep it read-only. The API key needs the Write permission.
