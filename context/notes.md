# Notes

Branch-local and advisory. `/feature-close` deletes this file.

## Phase 1 — Extract `config.ts`

- `git.ts`'s call to `gitGetConfigValue` is now an imported binding, so a `config` spy can intercept it where a same-module call could not. No assertion changed; the suites that drive the real `gitGetWorktreeList` restore mocks first.
- The Done-when `git grep` for the export cannot see an untracked file, so it prints nothing until `src/lib/config.ts` is committed. `--untracked` shows the two lines.
- D1 (no re-export from `git.ts`) and the `config.ts` import restriction have no standing test. Phase 2's guard catches a cycle, not a silent re-export.
- `src/lib/git.ts:134` runs past 80 columns in its comment block. Cosmetic; Biome accepts it.

## Phase 2 — Guard against runtime import cycles

- `import {} from` and `export {} from` count as runtime edges and no case pins it. `tsc` elides them under this tsconfig, so the choice can only over-report; the comment saying an empty list "can still load the module" is imprecise.
- The scanner assumes `verbatimModuleSyntax` is off, and the file does not say so. `import { Foo }` used only as a type counts as an edge (a possible false red). Turning that option on would make all-`type` lists emit real imports, and the guard would then under-count.
- The `match` parameter of `read` is unused.
- Two statements joining the same pair of files print the same cycle line twice. Only the failure message is affected.
- The `.js` half of the check in `resolveEdge` is unpinned; only a specifier like `./a.ts` would behave differently.
- A stray backtick in a regex literal can also invert masking and produce a false edge. That fails closed, and the known-limit comment names only the missed-import direction. That comment's last line runs long.
- `scripts/` is outside Biome's `files.includes`, so this file is not linted.
