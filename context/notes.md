# Notes

Branch-local and advisory. `/feature-close` deletes this file.

## Phase 1 — Extract `config.ts`

- `git.ts`'s call to `gitGetConfigValue` is now an imported binding, so a `config` spy can intercept it where a same-module call could not. No assertion changed; the suites that drive the real `gitGetWorktreeList` restore mocks first.
- The Done-when `git grep` for the export cannot see an untracked file, so it prints nothing until `src/lib/config.ts` is committed. `--untracked` shows the two lines.
- D1 (no re-export from `git.ts`) and the `config.ts` import restriction have no standing test. Phase 2's guard catches a cycle, not a silent re-export.
- `src/lib/git.ts:134` runs past 80 columns in its comment block. Cosmetic; Biome accepts it.
