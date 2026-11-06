# Notes

Non-blocking observations from the gates of #266 (unify the header). Read by nothing; `/feature-close` deletes this file.

## Phase 1 — Two-state theme toggle

- `ThemeSelect.astro` guards `localStorage` with try/catch; the inline `ThemeProvider.astro` does not, so where storage access throws the provider throws first. Starlight's and GMT's providers behave the same, so not a regression.
- `docs/src/lib/theme-toggle.ts` declares `isTheme` as a module-level arrow function; `context/standards/typescript/rules.md` prefers `function` declarations there (`docs/src/lib/llms-txt.ts` does the same).
- The audit's theme rule is "at least one toggle", so a page that lost the header's toggle but kept the mobile menu's would pass. Phase 2's order rule (the header's theme button precedes GitHub) requires the header's one.
- With `light` stored and a light system, a click returns to following the system and nothing visibly changes. That is D1 as specified.

## Phase 2 — Theme before GitHub and Discord

- Nothing asserts D5's "no divider" or "three children in order"; only the browser pass covers them. Possible seams: the audit could check the built CSS has no `.social-icons…::after` rule, and that the header's second child holds `site-search`.
- Biome's noUnusedImports/noUnusedVariables flag `.astro` frontmatter imports the template uses (31 warnings now, 6 from `Header.astro`). The fixes are "unsafe", so `biome check --write` leaves the files alone, but `--unsafe` would break six components. A Biome `overrides` entry for `**/*.astro` in the root config would silence it; never a second `biome.json`.
- `audit-dist.mjs:344` locates a link by `header.indexOf(whole)` (first occurrence); the match's own `.index` would be exact. Duplicates are already caught elsewhere.
- The language select's slot (between the toggle and GitHub) cannot be observed on this one-language site.
