# Notes

Non-blocking gate observations for this branch. Read by nothing; `/feature-close` deletes this file.

## From #102 Phase 2 (Gate 2, PASS WITH NOTES)

- The plan put `.changeset/herdr-pane-busy-retry.md` in Phase 2, while `context/release.md` says the note is
  once per feature and written by `/feature-close`. `/feature-close` should update this file, not add a
  second one. Its name is descriptive, not random as `release.md` prefers. That is harmless here.
- `herdr.test.ts` "rejects with the last HerdrError" uses one identical fixture per attempt, so it cannot
  tell the last refusal from the first. Distinct messages would make it assert what its name says.
- The 500 ms delay is proven to exist but its length is not pinned (e.g. `advanceTimersByTimeAsync(499)`
  → 1 call, `(1)` → 2).
- `base-command.test.ts` was on Phase 2's Files line but needed no change. An optional seam test (busy, then
  success, then the brief delivered) would add coverage.
