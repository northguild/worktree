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

## Phases 4 and 5 — chat button and Dox

- The phase 4 test checks `ChatLauncher.astro`'s script source, not behaviour; renaming `root` breaks it. A small exported start function (move, trap, init) tested in jsdom, or a browser driver once §9 Q4 is answered, would test it properly.
- `AssistantMessage.test.tsx` matches the article name with `/^Dox/`; the name is exactly "Dox", so `name: "Dox"` would be tighter.
- The loaded chat (`Chat.tsx`) mounts its own trigger on `<body>`, so after the first open it is outside Starlight's mobile-menu focus trap too; 6a09323 covers only the static launcher.

## Phase 3 — Landing header entrance

- Nothing pins D8's ordering: that `--entrance-ink-start` is at or after `--entrance-fade-delay-theme` + `--entrance-fade-duration`, and that GitHub and Discord are staggered. A check on the custom properties in `entranceCssFindings` would; the values themselves are D9's proposals.
- Nothing asserts that `header-entrance-ink` starts from `--gmt-ice-dim`, the colour `theme-contrast.mjs` measures; a change to the keyframe would leave that row measuring a colour no longer shown.
- 29ff4b7's browser record does not state item 5's 1440px viewport (it was 1440px) or item 6's "then responds to hover as normal".
- On the landing the internal-arrival script is the first child of `header.header` (craigbot, PR #267); no rule counts that element's children, and the header's geometry is identical on `/` and `/faq/`.

---

# #270 (rex-session-opener)

Non-blocking observations from the gates of #270. Read by nothing.

## Phase 1 — removal-side seam

- `Multiplexer.findSpaces` takes `gitRootPath` and returns every space keyed by path, not `findSpaces(paths)` as D1/§4 wrote it: `resolveSpaceCloser` builds the map before the closure gets its paths. The Rex adapter (phases 2, 4) lists the worktree paths itself.
- D1's "plus the open-failure policy" and §4's "the shared policy" in `multiplexer.ts` are owned by no phase; phase 3's Scope names "failure policy" for Rex only.
- `multiplexer.ts`'s `isInstalled` doc comment says "on PATH"; under D3 Rex is also found via `REX_BIN_DIR` and the app bundle.
- §4 says `resolveSpaceCloser` "no longer names Herdr"; after phase 1 it still selects `herdrMultiplexer` on `opener === "herdr"` (D9), which phase 4 replaces.
- The spinner-wording test sits in `resolveSpaceCloser`'s "the gate" block; it is about what the user sees and would read better under "what it closes".
