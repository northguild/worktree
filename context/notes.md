# Notes — worktree-churn-stats (#39)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

## Phase 1 — Take the churn figure in the gather

- No churn assertion covers `@{u}` failing to resolve inside `countAhead`. Today `base` stays unset there, so
  no diff runs; a regression would cost one wasted call, not a wrong figure.
- `parseShortstat` (`src/lib/git.ts`) reads non-empty output that matches no clause as `{0,0,0}`. Git prints
  the shortstat line untranslated, so this is theoretical; returning `undefined` there would rule it out.
- `gitGetChurn` swallows its error (`catch { return undefined; }`) against `typescript/error-handling.md`'s
  "never swallow silently" — deliberate per R3/D9, the same shape as `findMergedBase`.
- `parseShortstat`'s inner `count` helper is an arrow; borderline under `typescript/rules.md`'s
  function-declaration rule.
- Plan §8's first value row says a file going `a,b,c` → `a,X,c,d,e` is "2 added, 1 removed"; it is 3
  insertions, 1 deletion (confirmed against git 2.56.0 by the reviewer). The tests use 3/1.

## Phase 2 — `list --churn`: flag, line, JSON and docs

- D1's "no short alias, off by default" is not test-pinned: `list.test.ts` mocks `parse`, so a `char: "c"` or
  `default: true` on the `churn` flag would pass. A static check of `List.flags.churn` beside the `--help`
  test would pin it.
- The singular `1 file` is not in D7, which only shows `5 files`; it follows the renderer's existing
  `1 uncommitted change` rule, recorded in the `utils.test.ts` comment.
- `toEntryDocument` now takes two positional booleans (`withAgents`, `withChurn`); a third would want an
  options object.
- The new JSON test uses `as` on `output.document()`, copying the existing `agent` test's pattern.
