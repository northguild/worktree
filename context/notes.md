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
