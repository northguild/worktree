# Notes — #121 branch-reopen-existing-worktree

Non-blocking observations from the phase gates. Branch-local; `/feature-close` deletes this file.

## Phase 1 — Find the worktree a branch name already has

- `gitFindBranchCheckout` tests stub `fs.existsSync` to a constant, so nothing asserts it is called with
  the matched record's path (`src/lib/git.test.ts`, the missing-directory case).
- `isCurrent` is `false` when the caller's own tree is on a detached HEAD. Correct, but untested.
- `gitFindBranchCheckout("(detached HEAD)")` would match a detached record. §4 accepts this, since no real
  branch name can equal `DETACHED_LABEL`. No test pins it.
- The detached-record and path-with-spaces tests would pass for most implementations. The spaces fixture's
  root has no space in it, unlike the neighbouring `gitGetWorktrees` suite's.
- The three `run` calls are awaited one after another, mirroring `gitGetWorktrees`. `error-handling.md`
  prefers `Promise.all` for independent calls, but the tests' mock order depends on the sequence.
