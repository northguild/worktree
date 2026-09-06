# History

Retired features, newest last. Append-only — written by `/feature-close`, one row per feature, never edited
afterwards.

This file **indexes** depth rather than duplicating it: the reasoning stays in the archived plan document,
so a row never grows and this file gains one line per feature.

`dropped` is the load-bearing case. An idea killed before it ever got a plan document leaves no trace
except git history, and this row is what stops it being re-proposed.

| Date | Feature | Outcome | Why | Document |
|---|---|---|---|---|
| 2026-09-05 | cleanup-data-loss | shipped | `isSafeToRemove` called a deleted-remote worktree safe while it held uncommitted work, and `cleanup` force-removed it; the hazard test is now hoisted above every remote branch and `cleanup` names what it held back | [`archive/CLEANUP-DATA-LOSS-PLAN.md`](archive/CLEANUP-DATA-LOSS-PLAN.md) |
| 2026-09-06 | shell-argv-safety | shipped | every subprocess call was a shell string, so a path containing a space failed and a config value containing a backtick executed; `cmd()` and both `exec` sites are gone, replaced by an argv-array `run()` with an explicit `cwd` | [`archive/SHELL-ARGV-SAFETY-PLAN.md`](archive/SHELL-ARGV-SAFETY-PLAN.md) |
