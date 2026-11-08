# Notes — dox-page (#309)

Non-blocking observations from the phase gates. Branch-local; `/feature-close` deletes this file.

## Phase 1

- **Lattice in the light theme.** The lattice stroke in `dox-hive.css` is a literal `#4ade80` inside a data URI, so it
  stays the dark theme's spring in the light theme (`--gmt-spring` is `#16a34a` there). gmt has the same limitation
  with its literal cyan, at 0.04 opacity.
- **Head on a noindex page.** `Head.astro` still emits a canonical link and a BreadcrumbList JSON-LD on `/dox/`, which
  is `noindex`. Outside Phase 1's Files; decide whether it should go.
- **Contrast not yet measured.** The hive text pairs Phase 1 already shows (`--gmt-spring-ink` on `--gmt-code-bg`;
  `--gmt-signal-ink`, `--gmt-spring-ink`, `--gmt-ice-dim` on `--gmt-void`) are not in `theme-contrast.mjs`. §8 schedules
  the hive pairs for Phases 2 and 8.
- **For Phase 4.** `.gmt-dox-mark` will be needed site-wide for the header link (gmt keeps it in
  `gmt-primitives.css`); `custom.css` was on Phase 1's Files line and untouched. `context/verify.md`'s Audit section
  does not describe the `/dox` rules yet; §7 assigns `verify.md` to Phase 4.
- **For Phase 2.** D5 maps gmt's cyan (the assistant channel) to spring, which is already gmt's user channel
  (`.gmt-hive-turn[data-role="user"] { --gmt-hive-role: var(--gmt-spring) }`), so the two speakers would share a
  colour. `HiveNode` renders with `--gmt-hive-role` undefined until the turn rules are ported.
- **`not-content` covers the whole shell.** Added on loopback so the prompt chips escape Starlight's
  `.sl-markdown-content code` rule. It also opts every descendant out of this site's own prose rules in `custom.css`
  (links at `:269`/`:278`, list markers at `:227-253`), so answers rendered inside the shell get no prose styling unless
  the hive stylesheet supplies it (as gmt's `.gmt-ask-response` does), or the class moves onto the hub and strip.
- **Test style.** `DoxPage.test.tsx` queries `[data-empty]` by DOM structure, which `react/testing.md` advises against.
- **Phone layout unverified in a real device.** The caller's headless Chrome pass measured no scroll and a centred hub
  at 390×844, but its screenshots overflow on the right for gmt's live page too, so the phone pictures were not
  trusted.
