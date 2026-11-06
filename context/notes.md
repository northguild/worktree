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

## Phase 2 — Move, rename and roll back in `git.ts` (Gate 2, PASS WITH NOTES)

- `gitRenameWorktree`'s `mkdirSync` of the new parents runs outside the try: a failure surfaces raw
  (`EACCES: … mkdir …`) with no "Could not rename" prefix, and a failure part-way through a recursive
  mkdir leaves the shallower directories behind. Untested.
- A failed upstream read (`for-each-ref`) is swallowed to `upstream: null`, so the push hint silently
  disappears. Untested; §4.4's `warnings` is where phase 3 could surface it.
- When the move-back fails, only its reason survives (in the message); `cause` is the branch-rename error,
  and the move-back error object is dropped.
- No phase 2 test pins that git's refusals are exit 1 (not an `InvalidValueError`); phase 3's exit-code
  tests are where that lands.
- `removeCreatedParents` ignores rmdir failures with no test showing it cannot replace the git error.
- `git.test.ts` declares `git worktree move <trees>/a/b/c <trees>/a/b/c` in `expectCommands`, a call that
  never happens; the real `feature/x → a/b/c` call is undeclared, so `afterEach` warns. Cosmetic.
- `gitRenameWorktree(plan, repoRoot)` takes the root as a second parameter rather than the plan field §6.2's
  signature implied, and its spinner stops without `succeed`, leaving the ✔ line to the command (§4.3 step 4).

## Phase 3 — `worktree rename` command, agent-mode cases and its docs (Gate 2, PASS WITH NOTES)

- No args, non-interactive, *outside* a worktree gives §4.3 row 2's message (the worktree to rename), not
  row 1's (the new branch name). More useful than the plan's wording, which now disagrees with the code
  and with `rename.mdx`; §4.3 could be amended to match.
- One arg in a terminal outside a worktree opens a picker where §4.3 row 2 says `missing_value`. Consistent
  with how prompts behave elsewhere, but neither recorded in the plan nor tested.
- Messages with no plan source and no test: `No worktrees under <root>/.`, and `Left <old> as it was.` on a
  declined confirm. The `rename.mdx` case-only-rename caveat was traced but not run on a real filesystem.
- Nothing asserts that a git refusal exits 1 end to end (D6). A spawned case with `git worktree lock` would
  pin `code: "failed"` and `Could not rename feature/x:`.
- `rename.test.ts`'s test "-f skips the question, interactive or not" only runs non-interactively.
- `rename.test.ts`'s own `mockRun.mockClear()` in `afterEach` hides every unplanned subprocess call in the
  file, not only `check-ref-format`; `expectCommands(...)` would keep the safety net.
- Code shape: `remote: ""` invented to satisfy `WorktreeListEntry` for `hasLiveAgent`; `RenameDocument`
  repeats `WorktreeRenameResult`'s fields (anti-patterns.md DTO duplication); `startedInside` has no
  boolean prefix (naming.md).
- README's agent-mode per-command page list (`:466-469`) does not link `rename`, which now has a JSON
  section.
- `rename.mdx` says Herdr spaces and Rex sessions are not renamed — phase 4 makes that untrue and carries
  the page on its Files line.
