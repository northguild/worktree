# Notes

Branch-local observations from the gates of #218 (cleanup-deletion-progress). Read by nothing;
`/feature-close` deletes this file.

## Phase 1 — Count a tree and watch it empty

- **D3's checkpoint size moved from about 0.5% to 1%** (`CHECKPOINT_FRACTION` in
  `src/lib/removal-progress.ts`). At 0.5% the measured poll cost was 4.2–5.0% of the removal, at 1%
  3.7–4.4%, against the 5% bar. The §9 item Phase 1 settles records it; D3's own text still says 0.5%.
- **The clamp in `countGone` and `isGone`'s ENOTDIR and other-error branches have no failing test.** The
  partition is exact, so removing `Math.min(gone, total)` passes the suite; a hand-built
  `TreeMeasurement` whose checkpoints sum past its total would pin it.
- **`isGone` treats an lstat error other than ENOENT/ENOTDIR (EACCES) as "still there".** Defensible under
  D5's best-effort watch, but nothing says so at the call.
- **An empty directory makes the root a 1-entry checkpoint** (threshold floors to 1 at total 0). Harmless:
  the count clamps to 0, and a worktree always holds `.git`.
- **The EACCES test relies on not running as root.** CI runs as the non-root runner, so it holds today.
- **The coder wrote the module before its tests.** The reviewer found every expected value derived from the
  fixture, so no assertion was read back from the code.

## Phase 2 — One bar over the whole run, stopped on failure

- **Nothing pins that the poll timer is cleared** (`clearInterval` at both `finally`s in
  `gitRemoveWorktreesWithProgress`). Removing both keeps the suite green while a failed removal leaves a
  live interval; `vi.getTimerCount()` under fake timers would pin it.
- **Nothing pins D6's format string or the bar's `Deleting <branch> (n/m)` text**: the `SingleBar` mock in
  `src/lib/git.test.ts` ignores its constructor options. Only the spinner fallback's text is asserted.
- **A failed count is discarded silently** (`measureWorktrees`' bare `catch`). D5 decides the fallback; a
  person still never learns why the bar did not appear. The file has the same pattern elsewhere.
- **The last frame reads "Done"**, dropping the branch and `(n/m)`, as the old bar did; `{value}/{total}
  files` still carries a count.
- **An existing but empty directory counts 0**, so a run of only such trees has a total of 0, which
  cli-progress shows as 100%. A worktree always holds `.git`.
- **An empty selection at a terminal now draws nothing**, where it used to start and stop a zero-total bar.
