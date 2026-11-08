# Notes

Branch-local, advisory and disposable — `/feature-close` deletes this file whole. See *`notes.md`* in
[`workflow.md`](workflow.md).

- **Phase 1** — `worktree config` has no `catch` around `offerProjectConfig()` (`src/commands/config.ts:431`),
  so a failed unset fails a bare `worktree config` while `branch` only warns. Predates this feature; the
  `project-configuration.mdx` sentence "If a key cannot be removed, `branch` warns and still succeeds" is true
  but silent about `config`.
- **Phase 1** — the "warnings are not printed again" test only spies on `console.error`; a reprint through
  `process.stderr.write` or `this.warn` would pass it. Fine while the callers own reporting.
- **Phase 1** — in "leaves a global value alone", `expect(global.get(...)).toBe("fix/")` cannot fail (the fake
  never writes the global map); the load-bearing assertion is the `--unset` one.
- **Phase 1** — the `offerProjectConfig` doc comment says keys are removed "on every run" (true per call) and
  does not mention the `defaultSourceBranch` exception that lives on `removeCoveredLocalConfig`.
- **Phase 1** — `commands/config.mdx` lists `--json` under a heading naming both `branch` and `config`; only
  `branch` has the flag. Imprecise, not false.
- **Phase 1** — the "keeps a covered defaultSourceBranch" test re-mocks `gitGetConfigValue` to local-only,
  which `fakeGitConfig` already gives with an empty global map.
- **Phase 1** — `removeCoveredLocalConfig` adds one `gitResolveOriginHead()` call per run on top of
  `readProjectConfig`'s; inside §8 step 3's ~100 ms budget, not yet measured.
