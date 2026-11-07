# Notes — locale-aware-cleanup-stats (#283)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

- **Phase 1:** `formatCount`'s parameter is `n`, which `standards/typescript/naming.md:31` discourages; kept because plan D2 spells the signature that way.
- **Phase 1:** D1 (omitted locale means the runtime default) and D3 (no styling in the helper) have no test of their own; the helper is one line, so a regression there is unlikely but would pass.
- **Phase 1:** the coder wrote the implementation before the tests, against `roles/coder.md`'s test-first ask. The expected values were then checked against CLDR independently by the reviewer.
- **Phase 2:** only the Found and Skipped-uncommitted headings have a large-count test; the live-agent, uncountable, removing-despite-agents and canceled-Linear headings (`cleanup.ts:146,163,186,205`) would stay green if they lost `formatCount`. An `it.each` over the four `makeEntries` overrides in the locale describe would cover them.
- **Phase 2:** the Found heading's singular form ("Found 1 worktree branch that is…") is asserted nowhere; this predates the feature. The single-safe-worktree test at `cleanup.test.ts:225` is the seam.
- **Phase 2:** the locale test spies on the global `Intl.NumberFormat`, so it depends on `formatCount` constructing one; a switch to `toLocaleString()` would break the test without changing behaviour.
- **Phase 2:** the spy's parameters are typed `any` where `Intl.LocalesArgument` / `Intl.NumberFormatOptions` would do; the `function` it passes (new `useArrowFunction` warning, `cleanup.test.ts:1875`) is required because it is called with `new`. The 12345-entry fixture drives a quadratic filter at `cleanup.ts:323-328`.
- **Phase 2:** the new sentence at `cleanup.mdx:68` sits between the Found example and "Those five are the whole vocabulary", separating that line from what it refers to; after the held-back example block, or opening "Every count heading", would read better.
