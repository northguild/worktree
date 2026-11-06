# Notes

Branch-local, advisory, read by nothing. `/feature-close` deletes this file whole.

## Phase 1 — Rename preflight in `git.ts` (Gate 2, PASS WITH NOTES)

- `gitPlanWorktreeRename` decides git's `check-ref-format` refusal by matching the English stderr
  ("is not a valid branch name"). `run` inherits the user's locale, so a translated git's refusal is
  rethrown and exits 1 with git's own text instead of exiting 2 `invalid_value`. Nothing moves either way.
  `env: { LC_ALL: "C" }` on that one call, or deciding on exit code 128, would close it.
- The containment check is the parent-directory loop's only termination guard: without it, a path outside
  `worktreesRoot` walks `path.dirname` up to `/` forever. Keep the two together if that loop is touched.
- `worktreesRoot` is compared exactly as passed; a trailing slash makes every name fail containment. The
  caller should pass a normalised absolute root.
- `validateName` is injected (validators.ts imports git.ts, so a direct import is a runtime cycle). The
  command has to pass `isValidBranchName`, or D3's first check is whatever the caller supplies.
- §4.3's table lists path-exists before nesting; the code checks nesting first, because `a/b → a` lands on
  `a/b`'s own parent directory. The containment refusal has no §4.3 wording; its message is the coder's.
- The §4.3 rows for *target not found* (`not_found`) and *live agent* (`missing_value`, naming `-f`) are the
  command layer's and are not on phase 3's Done-when line by name.
- Test gaps the review named: "shallowest first" is asserted with a one-element array, and the argv test
  does not pin `check-ref-format` as the only subprocess (`toHaveBeenCalledTimes(1)`).
- On a case-insensitive filesystem (macOS), a case-only rename (`feature/x → feature/X`) is refused as
  "already exists" for the worktree's own directory. A docs caveat candidate.
