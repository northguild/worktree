# Notes

Non-blocking observations from the gates of #266 (unify the header). Read by nothing; `/feature-close` deletes this file.

## Phase 1 — Two-state theme toggle

- `ThemeSelect.astro` guards `localStorage` with try/catch; the inline `ThemeProvider.astro` does not, so where storage access throws the provider throws first. Starlight's and GMT's providers behave the same, so not a regression.
- `docs/src/lib/theme-toggle.ts` declares `isTheme` as a module-level arrow function; `context/standards/typescript/rules.md` prefers `function` declarations there (`docs/src/lib/llms-txt.ts` does the same).
- The audit's theme rule is "at least one toggle", so a page that lost the header's toggle but kept the mobile menu's would pass. Phase 2's order rule (the header's theme button precedes GitHub) requires the header's one.
- With `light` stored and a light system, a click returns to following the system and nothing visibly changes. That is D1 as specified.
