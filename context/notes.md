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
- **The drawer until Phase 4.** Moot: Phase 4 deleted the drawer.
- **Layer order on the live site.** `@layer starlight.reset`'s `* { margin: 0 }` is declared after Tailwind's
  `utilities`, so `mb-2` and `space-y-*` do nothing anywhere on the site, the drawer's answers included. `/dox` gets
  its own reading surface; the drawer is retired in Phase 4, so nothing was filed.
- **Effect suppression.** `DoxChat.tsx` carries a `biome-ignore useExhaustiveDependencies` for an unread `turnCount`;
  `react/use-effect.md` says to fix the cause. Precedent at `useIdleTimeout.ts:40`; gmt's effect uses `[]` and a
  ResizeObserver.
- **Wording the code chose.** "Jump to latest message", "Copy" / "Copied" / "Copy failed" have no plan source (gmt's
  scroll button has no name). Belongs with §9 Q9.
- **Rules with no test yet.** (The reader's text rendered as text is tested in `DoxChat.test.tsx` since Phase 4.)
  "New chat" during a stream stopping it; `scrollToBottom` instant under reduced motion; the
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

## Phase 4

- **Visible differences from gmt, for §9 Q8.** gmt's hero CTA is a ghost `LinkButton`; ours is the site's bordered
  pill beside "Get started". gmt animates the header Dox link in its landing entrance; ours keeps it static
  (`a.header-chip:not(.dox-link)` in `custom.css`) while Q8 is open — change those two selectors to animate it.
- **No Dox link on a phone's 404.** The header's right group is hidden at phone width and splash pages have no mobile
  menu. gmt has the same shape.
- **The share image is stale.** `docs/public/og-image.jpg` (last committed 2026-11-04) shows neither the header crystal
  nor the "Ask Dox" CTA; the og-image comment says to retake it when the landing changes. Needs a person with the
  capture setup.
- **Test style.** `DoxChat.test.tsx` queries `.gmt-hive-user-text` to check raw newlines (`toHaveTextContent`
  collapses whitespace); `react/testing.md` advises against class queries.

## Phase 5

- **Q14's floor leaks both ways.** At 10, "write me a haiku about cats" (12.7), "docker compose" (15) and "best pasta
  recipe" (22) still retrieve chunks, so the prompt's refusal carries them; the single word "worktree" retrieves
  nothing. The off-topic and terse-real ranges overlap on a 210-chunk corpus, as they did for gmt.
- **R1 is measured only in Node.** `MiniSearch.loadJSON` took 8.1 ms cold and a search 1-3 ms in Node; on Workers Free
  (10 ms CPU) a cold isolate's first request may exceed it. §8's `wrangler dev` CPU reading was not taken; §9 Q5 open.
- **`POST /` ships the whole docs again.** `LEGACY_PROMPT` (~354 KB of the 1,046 KB `docs-context.ts`) keeps the frozen
  handler byte-identical; the Worker uploads 3,930 KiB / 761 KiB gzip. It goes with #300.
- **Injection fixtures prove prompt construction, not model behaviour** — all an offline suite can do.
- **Traces are not persisted**, so an answer restored after a reload has no trace.
- **Route pattern accepts `..` segments** (`validation.ts`); harmless, since only the top-level section is read and the
  value never reaches a prompt.
- **Node warning.** `build-context.mjs` imports `.ts` under Node's type stripping and prints
  `MODULE_TYPELESS_PACKAGE_JSON` on every build; `"type": "module"` in `docs/package.json` would silence it but changes
  how Vite and Astro load config.

## Phase 6

- **Per-minute 429s read as spent for the day.** Every Gemini 429 marks the brain spent, per-minute included (gmt and
  D9 alike), so a reader who hits only a per-minute limit sees "Dox has used its free allowance for today." where they
  used to get a retryable `rate_limited`; Phase 7's ledger will carry it over to the whole day. Distinguishing
  `PerMinute` quota ids would fix it.
- **D9 read narrowly, as gmt does.** A Workers AI 429 that is not the daily allocation (3040) is "busy", not "spent";
  a Gemini 400 `API_KEY_INVALID` is "other", not "unavailable" (no plan or gmt source for the latter).
- **Real binding errors unverified.** How `env.AI.run(…, { returnRawResponse: true })` reports an allocation error
  (returned or thrown) is unknown offline; `withoutRetries` handles both. §8's live `wrangler dev` pass would confirm it,
  and spends real Neurons.
- **The frozen #306 client and slow brains.** Its 30 s idle timer resets only on text, so two slow brains in a row
  (15 s, then 20 s) could trip it before an answer. Rare; the frozen client cannot change. `/dox` resets on progress.
- **Type assertions.** `brains.ts` casts the binding (`as never`, `as unknown as AnyTextAdapter`) because the optional
  workers-types peer is not installed; `typescript/anti-patterns.md` advises against it.
- **Worker size.** 5,396 KiB uncompressed / 986 KiB gzip after `@tanstack/ai-cloudflare` and `openai`; Cloudflare's limit
  is 64 MiB uncompressed on both plans, no compressed limit, 1 s startup. The binding constraint is R1's 10 ms CPU on
  Free (§9 Q5).
- **`withRunId` is broader than it needs to be.** It rewrites any top-level `runId`; safe today because `chat()` gets no
  tools or subagents. Limiting it to `RUN_STARTED`/`RUN_FINISHED`/`RUN_ERROR` and skipping chunks with `parentRunId` or
  `subagentRunId` would keep it safe if tools ever arrive.

## Phase 7

- **The visitor hash is reversible.** D10's unkeyed, truncated SHA-256 of `dox:<ip>` can be reversed for IPv4 by trying
  all 2^32 addresses, so "the ledger cannot name a visitor" overstates it. A keyed HMAC with a secret would be a separate
  decision for the maintainer.
- **`POST /` skips the cap.** The frozen route has no visitor cap or ledger, so a visitor can bypass 5-a-day through it
  until #300 retires it. Worth one line when #299 is closed or narrowed (§9 item 18).
- **KV write budget.** About 2 writes (and 2 reads) per answered question, plus one per brain marked out; R2's 1,000
  free writes a day is about 500 answered questions per account, shared with gmt if the account is (§9 Q4).
- **Awaited ledger writes.** `recordRequest` and `markBrain` are awaited (gmt uses `void`): one KV round trip before the
  answer, well inside the client's idle clock; nothing pins await vs void.
- **The visitor-cap 429 sends no `Retry-After`** (gmt neither; the client does not need it).
