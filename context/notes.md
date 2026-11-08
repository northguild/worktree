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

## Phase 2

- **Dox and You share one colour.** D5 maps gmt's cyan (Dox) to spring, which was already gmt's user colour, so the
  two speakers' nodes, card tints and labels are the same green; only side and label tell them apart. A maintainer
  call: give one role ice or another tint, or accept it.
- **The drawer until Phase 4.** `ChatWarning`, `ChatErrorBoundary` (which also loses its toast placement), the code
  blocks' Copy bar in `MarkdownContent` and `ChatSubmitButton`'s icon now carry the hive look, which the drawer does not
  load, so they render unstyled there. The branch never merges before Phase 4 deletes the drawer (one PR per feature).
- **Layer order on the live site.** `@layer starlight.reset`'s `* { margin: 0 }` is declared after Tailwind's
  `utilities`, so `mb-2` and `space-y-*` do nothing anywhere on the site, the drawer's answers included. `/dox` gets
  its own reading surface; the drawer is retired in Phase 4, so nothing was filed.
- **Effect suppression.** `DoxChat.tsx` carries a `biome-ignore useExhaustiveDependencies` for an unread `turnCount`;
  `react/use-effect.md` says to fix the cause. Precedent at `useIdleTimeout.ts:40`; gmt's effect uses `[]` and a
  ResizeObserver.
- **Wording the code chose.** "Jump to latest message", "Copy" / "Copied" / "Copy failed" have no plan source (gmt's
  scroll button has no name). Belongs with §9 Q9.
- **Rules with no test yet.** The reader's text rendered as text rather than markdown (only `UserMessage.test.tsx`,
  deleted in Phase 4); "New chat" during a stream stopping it; `scrollToBottom` instant under reduced motion; the
  boundary marker `aria-hidden`. The warning's Try again focus ring (spring ink on the signal fill) is not measured.
- **Model preference.** A model stored by the drawer is ignored on `/dox` until Phase 8's brain menu.
- **Every code block is a tab stop.** `MarkdownContent`'s `<pre>` is a focusable named region even when it does not
  scroll, so a one-line block adds a tab stop and a landmark; the transcript scroller is a region only while it
  overflows (README). The same overflow-only rule would fit here.
- **No test pins the reading surface's margins.** jsdom does no layout; the caller's headless-Chrome measurement is the
  only check (recorded in the Phase 2 commit).

## Phase 3

- **The chip shows a raw route** (`/guides/env-files/`), which meets D7's letter (`ChatStarter.route`) but not gmt's
  look, where the chip is a human title. A short page label would be a `page` field on `ChatStarter`; its wording needs
  a source (the frontmatter titles are long SEO strings), so it goes to the maintainer with §9 Q7, as do the areas
  ("Issues", "Environment files", "Cleanup") and their heroicons.
- **DoxPage tests live in `ExamplesPanel.test.tsx`**, because `DoxPage.test.tsx` was not on Phase 3's Files line;
  `react/testing.md` wants them colocated with `DoxPage`.
- **Rules with no test.** `use-esc-layer.ts` deferring to an open native popover (seam: DoxPage with ChatInfo's
  popover open); the `checkVisibility` gate that keeps the sheet from being an Escape layer on a wide screen (no
  layout in jsdom); a refused card leaving the sheet open.
- **Contrast unmeasured.** `--gmt-ice` and `--gmt-ice-dim` on `--gmt-fill-subtle` (cards, chip, bar, area titles) and on
  `--gmt-fill-strong` (hover, focus), and the chip's `--gmt-border-strong` edge; `theme-contrast.mjs` was not on the
  Files line. §8 gives contrast to Phases 2 and 8.
- **Long inline code wraps mid-token on a phone** (`--github` broke as `--` / `github` at 390px in the seeded
  transcript).
- **Chunk sizes.** §8 asks for the gzipped `/dox` chunk sizes before and after each UI phase (#304); Phases 1 and 2 did
  not record them. Phase 3's commit records the sizes after it.
