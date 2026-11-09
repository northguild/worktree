# Worktree Docs Site

Astro / Starlight documentation site for the Worktree CLI, served at
`https://northguild.dev/worktree/`.

## Quick start

From the **repo root**:

```bash
pnpm install
pnpm docs:dev
```

To run with the AI chat worker locally, choose based on what you are working on:

```bash
# Editing docs/UI only — builds the worker once, then starts worker + Astro
pnpm --filter docs run dev:local

# Editing worker code — same, but also watch-rebuilds the worker on every save
pnpm --filter docs run dev:local:watch
```

Both commands build the worker, write `.dev.vars`, start the Cloudflare Worker on `http://localhost:8787`, and start Astro on `http://localhost:4321`. The difference is that `dev:local:watch` also runs `worker:build:watch` so the worker bundle stays up to date as you edit.

`PUBLIC_GEMINI_WORKER_URL` is the variable that controls which worker the docs app talks to (Astro only exposes `PUBLIC_` variables to client code; unset, the chat falls back to `http://localhost:8787`). The `dev:local*` scripts set it to `http://localhost:8787` so Astro hits your local `wrangler dev` instance. In production, the GitHub Actions workflow bakes in (from its `GEMINI_WORKER_URL` repository variable) the deployed Cloudflare Worker URL at build time.

**Prerequisite:** `docs/.env.local` must exist with your Gemini API key.
Copy `.env.local.example` and fill it in:

```bash
cp docs/.env.local.example docs/.env.local
# then edit docs/.env.local and set GEMINI_API_KEY=...
```

---

## How the AI chat works

The chat widget lets visitors ask questions about the Worktree CLI. Here is the
full data flow — nothing is a black box.

### Architecture overview

```
Browser (static site on northguild.dev/worktree/)
  │  useChat (@tanstack/ai-react) – docs/src/chat/hooks/useDocsChat.ts
  │
  │  POST /api/chat  { threadId, runId, messages[], forwardedProps: { brain?, pageContext? } }
  ▼
Cloudflare Worker  (docs/worker/)
  │  – holds GEMINI_API_KEY as an encrypted secret, and the Workers AI binding `AI`
  │  – rate-limits, validates input (validation.ts), enforces CORS
  │  – searches the docs for the question and builds the system prompt from what it finds
  │  – reads the day's usage ledger (Workers KV, optional), refuses a visitor's sixth question of a UTC day
  │  – walks its brains in order until one starts answering (brains.ts)
  ▼
Workers AI (@tanstack/ai-cloudflare): Gemma 4 26B, GLM 4.7 Flash
Google Gemini API (@tanstack/ai-gemini): 3.5 Flash-Lite, 3.6 Flash, 3.5 Flash
  │
  ▼
Worker streams AG-UI events over SSE (RUN_STARTED, CUSTOM `dox-retrieval`, CUSTOM `dox-progress` for
each step of the walk, TEXT_MESSAGE_*, CUSTOM `dox-retrieval` again, RUN_FINISHED or RUN_ERROR;
CUSTOM `dox-usage` with the counts once a brain has accepted the question;
CUSTOM `dox-refusal` when every brain is out)
  │
  ▼
useChat folds the events into messages and hands the custom ones to onCustomEvent;  docs/src/chat/  renders them
```

On the page, the pieces are:

- **Opening it.** The chat is a page, `/worktree/dox/` (see *The Dox page*), and every way in is a plain link, so no other page
  loads chat code. The header's right group reads Dox, theme, GitHub, Discord: the first is the "Chat with Dox" crystal
  (`components/Header.astro`), a link named "Chat with Dox" that carries `aria-current="page"` on `/dox/`, and the mobile menu
  (`components/MobileMenuFooter.astro`, on the pages with a sidebar) repeats it before the social icons, because the header's
  group is hidden on a phone. The landing's "Ask Dox" is a link too (*The landing hero*). There is no launcher button, bubble,
  drawer, keyboard shortcut or open event.
- **The connection.** `fetchServerSentEvents` posts to `PUBLIC_GEMINI_WORKER_URL` plus `/api/chat`
  (`lib/chat-endpoint.ts`; unset, it is `http://localhost:8787`). Its `fetchClient` is `chatFetch`
  (`lib/chat-fetch.ts`), which does three things the library does not: it reads the Worker's `{ error, retryable }`
  body on a non-OK status and throws it as the error's `cause`; it drops assistant turns with no text from the
  request; and it removes the `X-Run-Id` header the library adds, because the Worker's CORS allows `Content-Type`
  alone. The page names no model, which is Automatic: the Worker picks. (A brain the reader chose would travel as
  `forwardedProps.brain`, and #306's `forwardedProps.model` is still accepted; the menu that chooses is not on the page yet.)
- **The transcript.** One conversation (`threadId` `docs-chat`), kept in `localStorage` by `useChat`'s
  persistence under `docs_chat_transcript:docs-chat`. Only text parts are stored; anything else read back is
  refused (`lib/chat-history.ts`) and removed (`hooks/transcript-storage.ts`). "New chat" (on `/dox/`) stops a stream and removes it. A model the drawer stored under
  `docs_chat_model` is ignored. The retired client's three `docs_chat_history_<model>` keys are removed on first mount.
- **Failures.** They are never messages. A status before the stream opens, a `RUN_ERROR` inside it or a dropped
  connection becomes one warning under the transcript (`components/ChatWarning.tsx`) with "Try again" when asking
  again can help. An answer that is silent for 30 s, or runs for 120 s, is stopped and warned about; a progress line from
  the Worker counts as the answer being alive. When every brain is out for the day the Worker writes a `dox-refusal` event,
  which `useDocsChat` shows as a warning that asking again will not fix ("Dox has used its free allowance for today.").
- **Brains and progress.** The Worker tries Workers AI's Gemma 4 26B and GLM 4.7 Flash first, then Gemini's three models, and
  skips one that is busy, slow or out for the day before any text streams. Each step is a `dox-progress` event, and
  `useDocsChat` (`progress`) hands the last to the waiting turn, which shows it in place of "Searching docs…". The trace's
  summary names the brain that answered: "Searched 210 chunks → 8 matched · GLM 4.7 Flash". How the walk works, and what the
  Worker needs for it, is in [worker/README.md](worker/README.md#brains).
- **The usage ledger.** The Worker keeps a best-effort count of what is spent today in a Workers KV namespace,
  `DOX_USAGE` (`worker/usage.ts`). It is advisory: it picks a brain that probably has room and feeds the badge, and the
  provider's own refusal is still the only real gate. A brain the ledger has marked out is not asked; a visitor's sixth
  question of a UTC day is refused with a 429 before any brain is asked. Without the namespace the Worker takes the first
  brain and counts nothing. `GET /api/brains` returns the counts (`BrainsInfo`, `lib/chat-types.ts`) and, after each
  question, the same shape arrives as a `dox-usage` event. The page does not read either yet (the badge and the menu are
  a later phase of #309); `lib/day-clock.ts` is the clock they share. Keys, TTLs and the setup are in
  [worker/README.md](worker/README.md#the-usage-ledger).
- **The empty chat and its limits.** With no question yet, the page shows the hub and the examples rail, whose three starter
  questions (`lib/chat-starters.ts`, each paired with the docs page that answers it) are sent through the same guarded
  `submit` as the composer; focus moves to the message field when one is sent. A line under the composer
  (`AccuracyNote` in `components/ChatInfo.tsx`) says the answers can be wrong. `DoxPage.tsx` wraps the chat in
  `ChatErrorBoundary`: a render error shows a `role="alert"` notice, with "Reload the page" when the error is
  a failed module load and "Try again" otherwise.
- **Rendering.** Only text parts render, the assistant's through `MarkdownContent` (see below). The answer's card is a
  polite live region; a recoverable warning is `role="status"`, one that retrying will not fix is `role="alert"`.

`POST /` on the Worker still speaks the old protocol for the site that is live until the next release; see
[worker/README.md](worker/README.md).

The static bundle **never** sees the API key. The key lives exclusively in
Cloudflare's secret store and is injected by the Worker runtime on each request.

### How the AI gets its context

The AI does not read the whole docs for each question. `worker:build-context` compiles the docs into a searchable
corpus (`docs/worker/docs-context.ts`, generated and gitignored) and the Worker searches it for each question
(plan #309 D8).

#### 1. MDX documentation pages

`docs/worker/build-context.mjs` scans every `*.mdx` file under `docs/src/content/docs/`, strips imports and Starlight
`<Tabs>`/`<TabItem>` tags (keeping their content; any other component tag would pass through as written, and no page
uses one), and cuts each page at its `##` headings (a heading inside a code fence is not one). Every section is a
**chunk**: its heading and body, the page's route, and the page's *section* (`commands`, `guides`, or `general` for the
pages at the root: `routeNamespace` in `src/chat/lib/page-context.ts`). The text before the first heading, with the page's
title and description, is a chunk of its own. A chunk's route is the page's, never a `#fragment`: the route is what the
model may link. Today that is 28 pages and 210 chunks.

#### 2. Agent Skill (`skills/worktree/SKILL.md`)

The repo ships a plain Agent Skill, installable with `npx skills add northguild/worktree --skill worktree`.
`skills/worktree/SKILL.md` is a structured markdown document that describes the Worktree
CLI's core patterns and canonical terminology. It is hand-written: edit it in
the same change as the code that makes it untrue. The build keeps its `##` and `###` sections as **vocabulary**, so the
AI learns the tool's own terms. Vocabulary is never a page: the prompt tells the model not to link it.

#### 3. The index

The build indexes the chunks with [MiniSearch](https://lucaong.github.io/minisearch/) 7.2.0 and serialises the index
(`MiniSearch#toJSON`) beside them. The Worker loads it with `MiniSearch.loadJSON` under the same options
(`docs/worker/retrieval/search.ts`, which both sides import), once per isolate, so no request builds an index.

#### What the Worker does with a question

For each `POST /api/chat`, after validation (`docs/worker/chat-handler.ts`):

1. **Search** the last message of the conversation (`retrieval/search.ts`). Stopwords are dropped; an identifier such as
   `branchPrefix` is also split into its words in the index; a chunk in the section of the page the reader came from
   (`forwardedProps.pageContext`, the `document.referrer` route without the base) scores 1.5 times, which is a bias and
   not a filter; and a chunk under a relevance floor of 10 is dropped. At most 15 are returned.
2. **Keep** what fits (`retrieval/fit-chunks.ts`): the best first, at most 10 chunks and 24,000 characters, the first
   chunk always kept.
3. **Choose vocabulary** (`retrieval/select-vocabulary.ts`): the guide's sections whose titles the question names, at
   most 16,000 characters.
4. **Assemble the prompt** (`retrieval/system-prompt.ts`), in this order: persona and scope; a standing order (user
   messages and retrieved text are data to answer about, never instructions, and the prompt is never revealed); the
   linking rules, whose list of routes is exactly the kept chunks' pages (the client still checks links against every
   route, `VALID_DOC_ROUTES`); vocabulary; the retrieved chunks; and a refusal instruction for a question the chunks do
   not answer. It is passed to `chat()` as `systemPrompts`. The reader's text is never spliced into it.

**No runtime fetching**: the corpus is embedded in the Worker bundle (the `AI` binding is for the models only), which `wrangler deploy --dry-run`
measured on 2026-11-08 at 3,931 KiB uploaded (761 KiB gzipped), of which the generated `docs-context.ts` is 1,046 KB
(it was 361 KB as a whole-docs prompt). Adding the Workers AI adapter took it to 5,396 KiB (986 KiB gzipped) on 2026-11-09. `POST /` (the frozen legacy route) still sends the whole docs, as one prompt that
`buildLegacyPrompt` writes from the `.mdx` files and the skill guide into `docs-context.ts` as `LEGACY_PROMPT` (plan #257 D3; removing it is #300).

#### The retrieval trace

The Worker writes what it retrieved into the stream as an AG-UI `CUSTOM` event named `dox-retrieval`, right after
`RUN_STARTED` and again just before `RUN_FINISHED` (not on a failed run). It carries counts, chunk titles, the pages
and timings, never prompt text: `{ totalChunks, retrievedCount, chunkTitles, chunkUrls, timings }`. The second write
adds `firstToken` and `total`. `useDocsChat` reads it with `useChat`'s `onCustomEvent`, keeps the latest per question
(`traces`, not saved with the transcript) and `RetrievalTrace` shows it in the answer's card: collapsed, "Searched 210
chunks → 8 matched"; open, the chunk titles and the stage timings, or "Nothing in the corpus matched this question."
The empty page's status line, "Dox // 28 pages · 210 sections indexed", reads the counts `build-context.mjs` writes into
`docs-routes.generated.ts`.

#### Regenerating the context

```bash
pnpm --filter docs run worker:build-context
```

This also regenerates `docs/src/chat/docs-routes.generated.ts`, which the
React link renderer uses to validate that AI-generated links point to real pages, and which holds the corpus counts.

Run this (or just `worker:build`) after:
- Adding or removing a docs page
- Editing any MDX content that you want reflected in the AI's answers
- Editing `skills/worktree/SKILL.md`

The build runs `docs/worker/build-context.mjs` under Node's type stripping (it imports two `.ts` files that the Worker also
bundles), so `node` prints a `MODULE_TYPELESS_PACKAGE_JSON` warning for them. It is harmless.

---

### How links in AI responses are validated

The React component `docs/src/chat/components/MarkdownContent.tsx` processes
every link in the AI's markdown response through `resolveHref()` before
rendering:

| Link type | Outcome |
|---|---|
| Route in `VALID_DOC_ROUTES` (no base path, trailing slash: `/commands/branch/`) | Rendered as an `<a>` with the `/worktree` base prepended (`import.meta.env.BASE_URL`) |
| Full site URL (`https://northguild.dev/worktree/...`) or the bare base path (`/worktree/...`) | Origin and base stripped to a route (`/commands/branch/`), then same check as above |
| Legacy GH Pages URL (`https://northguild.github.io/worktree/...`) | Stripped to a route, then same check as above |
| GitHub repo anchor (`github.com/northguild/worktree#...`) | Rendered as plain text — no link |
| Any other relative path not in the route list | Rendered as plain text — no link |
| Any other external URL, or a `javascript:`/`data:`/`ftp:`/`mailto:` link | Rendered as plain text — no link (in development only, `http://localhost:4321` renders as `<a target="_blank">`) |

`VALID_DOC_ROUTES` is auto-generated from the MDX filesystem scan — it never
needs to be maintained by hand.

---

## Theme

The site wears the NorthGuild theme. `src/styles/northguild/{tokens,tokens-light,primitives}.css` and
`public/fonts/michroma-latin-400-normal.woff2` are copies of `packages/theme/` in `northguild/northguild.dev`
(private, never published), taken at the commit each file's header names. Below that header each file is
that commit's bytes, so **never edit them in place**. `src/styles/theme.css` is this site's own: it maps the
`--gmt-*` tokens onto Starlight's `--sl-*` variables, repoints the `@font-face` at `/worktree/fonts/`
(the vendored one looks for `./fonts/`) and sets the few rules Starlight has no variable for. Light or dark
follows the visitor's system until they press the header's theme button, a two-state toggle (system, or the opposite theme set
explicitly; pressing it again returns to the system) that sets `data-theme` on `<html>` and stores only `light` or `dark` under
Starlight's `starlight-theme` key (`src/components/ThemeSelect.astro`, `ThemeProvider.astro`, the logic in `src/lib/theme-toggle.ts`).
The header's NorthGuild mark is `src/components/SiteTitle.astro`, copied the same way.

### The accent, and how a product picks its colour

Each product keeps the NorthGuild style with its own accent (plan #235, D17): gmt's is cyan, worktree's is
spring green. The vendored tokens define both families (`--gmt-cyan`, `--gmt-spring`, each with an `-ink`
tier that the light theme darkens for text). **The accent is chosen in one place, `src/styles/theme.css`**:
`--sl-color-accent` (fills, borders, rings: 3:1) takes the fill tier and `--sl-color-text-accent`,
`--sl-color-accent-high` and the chat's `--color-chat-accent-ink` (in `globals.css`) take the ink tier (text: 4.5:1).
To move to another family, change those mappings, the focus-ring colour, the Dox mark's glow and current-page bar in `custom.css`, the
re-derived hairline, border and selection tokens, and the two `--gmt-teal` lines in `theme.css` (the vendored tokens
tint hairlines, glass and fills with cyan, and the vendored files are never edited). Then run:

- `node docs/scripts/theme-contrast.mjs` prints every foreground/background pair in both themes with its ratio
  and exits 1 under 4.5:1 (text) or 3:1 (controls, focus rings, and the dots and marks that carry meaning). It
  resolves the colours from the CSS itself, so a changed mapping is measured, not assumed. `pnpm docs:test` runs
  the same check.
- `pnpm docs:build && pnpm docs:audit-dist` fails if the old family still reaches anything the site uses: it reads the
  `--gmt-cyan*` variables and their literal colours out of the vendored tokens and searches the built CSS, HTML and
  scripts. The vendored files' own definitions, rules for classes no page uses, and values that `theme.css` overrides
  remain by design and are not findings.

If gmt adopts the same accent it moves into `@northguild/theme`, and these overrides go with it.

### The header, the sidebar and the page details

- **Header.** `src/components/Header.astro` overrides Starlight's `Header` (copied from Starlight 0.42.8, with the right group from GMT's `apps/dox`, commit `b15b3899`):
  the right group is the theme button, the language select, then GitHub and Discord, as three controls of one size in one row with one gap and no divider,
  and `scripts/audit-dist.mjs` fails a page whose header orders them otherwise. The three direct children of `.header` (title, search, right group) keep their order, because `theme.css` selects them by position.
  The components it renders (`SiteTitle`, `SocialIcons`, `ThemeSelect`) are overridden too, and so is `ThemeProvider`, which Starlight's `Page.astro` loads in the head. `src/components/ThemeSelect.astro` and `ThemeProvider.astro` make the theme
  control a two-state button (ported from GMT's `apps/dox`, commit `b15b3899`; Starlight also renders the select in the mobile
  menu); the provider's script stays inline so the theme is set before first paint, and replacing both is what keeps the
  button's icon current. The button and the two links below share one chip, `.header-chip` in `src/styles/custom.css`.
  `src/components/SiteTitle.astro` is the NorthGuild mark and
  "NorthGuild" (one link to `https://northguild.dev/`) and `worktree` in the accent (a second link, to the site's home),
  then the CLI version (`cliVersion` from `src/lib/site-meta.ts`) in small grey text on the name's baseline, from 30rem up.
  `src/components/SocialIcons.astro` is the GitHub and Discord pair from northguild.dev, opening in a new tab and saying so in
  their names; Starlight also renders it in the mobile menu. The glass bar is in `theme.css` (4px blur, a hairline under it only),
  and so is the wide header's grid: the search box keeps to the right, beside the theme button, on every page, where Starlight
  would start it at the main column's edge (which moves with the sidebar and the table of contents).
- **Sidebar as a git graph, and the leaf list markers (a smaller, paler leaf for a nested item), and the growing link underline.** All in `src/styles/custom.css`, as
  CSS on Starlight's own markup: pseudo-elements with empty content, so nothing is added to the page, nothing decorative can take
  focus and nothing is announced. The graph's lengths are variables at the top of its rule (`--g-dot`, `--g-trunk`, ...), and the
  dots, lines and the two curves of each fork are derived from them, so change a length there and not in each rule. Every transition is switched off
  under `prefers-reduced-motion: reduce`.
- **The search dialog** (Starlight's `<site-search>` and the Pagefind UI) is styled in `src/styles/search.css`, after gmt's
  search modal: one frosted panel over a blurred page, rows with no fill, a page's title in Michroma, hits in the accent, and
  each result drawn as a commit and its branch, like the sidebar's graph. Corners stay Starlight's and Pagefind's own, not
  gmt's bevels. The panel's colour is spelled out a second time as `SEARCH` in `scripts/theme-contrast.mjs`, which measures
  the dialog's pairs; change both together. Search runs only on a build: `pnpm docs:build`, then
  `pnpm --filter docs exec astro preview`.
- **The scrollbar** is one rule in `theme.css` for the whole site: thin, with an accent thumb on a clear track, at the
  faintest strength that keeps 3:1 (`--site-scrollbar-thumb`, a value per theme).
- **The 404** (`src/content/docs/404.md`) is a splash page headed `fatal: no such branch`, with a broken-twig graphic
  (inline SVG, `aria-hidden`). `audit-dist.mjs` asserts the heading is a git error line and that every `<svg>` on every page is
  hidden or named.

To refresh: `git -C <northguild.dev clone> show origin/main:packages/theme/<file>` into the same path, put a
new header above it naming the new commit, copy the font the same way, then check that every
`var(--gmt-*)` in `theme.css`, `SiteTitle.astro` and `NorthGuildMark.astro` is still defined and that body text, muted text,
links and inline code still reach 4.5:1 on their surfaces in both themes, and run `pnpm docs:build`.
`astro build` warns that `./fonts/michroma-latin-400-normal.woff2` did not resolve: that is the vendored
`@font-face`, overridden by the one in `theme.css`; the warning is expected.

## Footer

`src/components/Footer.astro` overrides Starlight's `Footer`: it renders Starlight's own footer (last updated,
pagination; there is no edit link, since `astro.config.mjs` sets no `editLink`) through `Default` and nothing else; the licence line, the CLI version and the maintainers it once
added are gone (the CLI version is in the header). The landing renders no footer at all: it is the hero alone, and `/dox/` renders none either, told by the URL
because `/dox/` is a `StarlightPage` and not a collection entry, so it has no route id. `Footer.astro` imports Starlight's virtual modules, which Vitest cannot resolve, so the built footer is
checked in `dist/` instead (`pnpm docs:audit-dist`). The chat launcher it once rendered is gone (#309): the chat is the page `/dox/`.

## The Dox page

`/worktree/dox/` (`src/pages/dox.astro`) is the page the chat is becoming (plan #309): a full-bleed hive of its own under the
site header, with a strip holding "New chat" (once there is a transcript) and the environment badge (`● local` or `● live`, set after
mount so the server markup matches), and, below it, the chat: the empty hub (the Dox crystal at logo scale and the prompt line) or the
transcript, and the pinned composer, with the examples rail beside it. It is the only chat surface: the drawer, its launcher and the
shortcut are gone, and every other page links to it (*Opening it* above).

- **Shape.** A `StarlightPage` with `template: splash`, title "Dox", `noindex`, `pagefind: false`, an inline `<head>` script that sets
  `data-dox-shell` on `<html>`, and one `client:load` island, `DoxPage` (`src/chat/components/`). The page's global `<style>` keys
  every layout override off that attribute, so none of it can reach another page. Those overrides name Starlight's own wrappers
  (`.page`, `.main-frame`, `.content-panel`, `.sl-container`, `.sl-markdown-content`): after a Starlight upgrade, open `/dox/` and check
  the page does not scroll and the hub is centred.
- **Kept out of lists.** The sitemap is `@astrojs/sitemap`, configured in `astro.config.mjs` with a `filter` that drops `/worktree/dox/`
  (Starlight adds its own sitemap only when none is configured). `llms.txt` is built from the content collection, which `/dox/` is not
  part of, and it is not one of the audit's 28 `PAGE_PATHS`.
- **The chat (`chat/components/DoxChat.tsx`).** The engine is `useDocsChat`; the parts (`ChatInput`, `ChatSubmitButton`, `ChatWarning`, `MarkdownContent`) are the
  site's own, restyled into the hive. Each question and answer is a turn: the crystal's node, labelled "You" or "Dox", beside a card (a zigzag from 48rem
  of the transcript's own width; one column below). The answer is `MarkdownContent`, whose fenced code carries the language and a
  "Copy" button, and no download. The reader's question is text, never markdown.
  - **Waiting.** From the send until the first text, the newest turn is Dox's, with "Searching docs…" (or the Worker's latest progress line, "Asking Gemma 4 26B…", "… is busy — trying the next model…"), a scanline and the crystal
    spinning (`hive/use-crystal-spin.ts`). It lands square on the first text; under `prefers-reduced-motion` it does not spin and a
    still halo and bar carry the wait. The answer's card is a polite live region from the wait on. An answer with no text (stopped, or
    killed by an error) is not a turn: the failure shows as the warning.
  - **Warnings** (`ChatWarning`) keep their roles, a polite status when asking again can help and an alert when it cannot, in the
    `--gmt-signal` tokens. "Try again" asks the last question again and moves focus to Stop.
  - **The scroller** is the only thing that scrolls. It is a focusable region named "Conversation, scrollable" only while it
    overflows (a box that scrolls must take focus, and one that does not should not be a tab stop). Once the reader scrolls up, a
    "Jump to latest message" button appears (`hooks/useBottomScroll.ts`).
  - **The composer** is `ChatInput` and `ChatSubmitButton`: Enter sends, Shift+Enter adds a line, one button is Send and then Stop.
    Under it, the accuracy note on a wide screen; at 60rem and below it moves into a popup the info button opens (`ChatInfo.tsx`).
  - **"New chat"** stops a stream, empties the transcript, shows the hub and puts focus in the composer. The transcript is kept in
    `localStorage` as before; per-message times are not shown.
  - **The examples rail** (`ExamplesRail.tsx`, `ExamplesPanel.tsx`) holds the three starters of `lib/chat-starters.ts`, which
    are the page's examples. Each has an `area` ("Issues", "Environment files", "Cleanup"; the rail groups by it and
    draws an icon per area in `ExamplesPanel.tsx`) and a `route`, the docs page that answers it, shown as the card's chip. A card is a
    button named by its question and described by its chip. It sends through `DoxChat`'s handle (`send`), which is the composer's own
    guarded send: refused while an answer is coming (focus stays on the card), otherwise sent, with a draft in the field left alone
    and focus moving to the field. On a wide screen the rail is a column, 22rem to 34rem by default (`clamp(22rem, 34vw, 34rem)`),
    and `RailResizer.tsx` widens it up to half the page while the chat keeps 28rem (`rail-width.ts` holds the bounds and mirrors the
    CSS): drag, or focus the handle and press Left or Right (16px, 64px with Shift), Home or End; a double-click resets it. The width
    is remembered in `localStorage` (`northguild-dox-rail-width`). At 60rem and below the rail is a sheet under the chat and the
    handle is gone. The stylesheet decides when it shows: open before the first question on a phone taller than 44rem, folded behind
    the "Examples · 3" bar above the composer from the first question on (and from the start on a shorter phone). The bar opens the
    sheet; a card whose send succeeds, or Escape (`use-esc-layer.ts`, which puts focus on the bar), folds it. Which docs page a card names is its route,
    not a title: there is no page-title map in the client.
  - **Model.** The page asks the default model until the brain selector arrives in a later phase of #309.
  - **Contrast.** `scripts/theme-contrast.mjs` measures the hive's pairs ("hive: ..."), text at 4.5:1 and glyphs and edges at 3:1. Its
    surfaces are spelled out there (a card is the spring tier at 5% over the page): change `dox-hive.css` and the script together.
    Both roles are the spring tier (plan #309 D5), so a turn is told by its side and label rather than by colour.
- **Style.** `src/styles/dox-hive.css` is gmt's hive stylesheet, recoloured to the spring tier (`--gmt-spring` for fills and borders,
  `--gmt-spring-ink` for text) and imported by the island, so Vite ships it with that page only. The three tokens the vendored theme lacks
  (`--gmt-motion-scan-duration`, `--gmt-motion-sheen-duration`, `--gmt-z-behind`) are declared in `theme.css`. The crystal's geometry
  is `src/lib/dox-mark.ts`, ported unchanged from gmt and drawn in `currentColor` by `chat/components/hive/HiveGlyph.tsx` in the hive and by
  `components/DoxMark.astro` in the header, the menu and the landing, where the hive's stylesheet is not loaded: the mark's own rules
  (`.gmt-dox-mark*`) are therefore site-wide, in `custom.css`, with the Dox link's chip, glow and current-page bar.
- **Audit.** `pnpm docs:audit-dist` holds `/dox/` to rules of its own (`auditDox`): `noindex`, the `data-dox-shell` script, exactly one
  `astro-island`, the title `Dox · @northguild/worktree`, the site header, named controls, no footer, hidden or named
  graphics, unique ids, absent from the sitemap and `llms.txt`, and no other page (the 404 included) loading the island's chunk or the
  stylesheet that carries the hive. Its header's Dox link is the current page (`aria-current="page"`); on every other page and the
  404 the header has one link to `/worktree/dox/` named "Chat with Dox", before the theme toggle, without `aria-current`, and a page
  with a mobile menu has the same link there before the social icons.

## The landing hero

The copy has two actions: "Get started", a link to Getting Started, and "Ask Dox", a link to `/worktree/dox/` with the Dox crystal
after its label (`Hero.astro` renders the hero action carrying `data-dox-cta` as that link; it is not a `LinkButton`, so it is not
counted as a second link action). `pnpm docs:audit-dist` holds both, and no other link action, and no "Ask Dox" button.

The landing's art box (`src/components/HeroLeaves.astro`, rendered by the landing branch of `Hero.astro` only) is a field of
leaf-shaped WebGL particles (D18): on load they gust in from every edge of the viewport and from behind the header, build one
large leaf, become a git graph, write the `worktree` wordmark and flow back into the leaf, holding 5 s on each picture, for as
long as the page is visible. The pointer pushes leaves near the art box.

- **Code**: `src/hero/` holds `geometry.ts` (the shapes, in design units), `targets.ts` (where each particle goes in the leaf and the
  graph), `shaders.ts`, `particles.ts` (the simulation and the drawing, on OGL: `Renderer`, `Program`, `Geometry`, `Mesh`) and
  `loader.ts`. The effect is a port of the approved prototype; the numbers are its.
- **Loading**: the loader is the hero's only static script, on the landing alone. It waits for the first paint, then probes for
  WebGL and `import()`s
  `particles.ts`, which Vite bundles with OGL into a chunk nothing else references, so every other page, the 404 included, ships no
  hero code. Budget: the loader at most 2 KB gzipped, everything it imports at most 32 KB (`pnpm docs:audit-dist` enforces both).
- **The still**: under `prefers-reduced-motion: reduce`, without WebGL, or without script, the box shows a static SVG of the
  formed graph, drawn from the same geometry the particles sample, and the library is never requested. The art box's
  `data-hero` attribute (`live` or `still`) and CSS choose between the SVG and the canvas. A WebGL context the browser takes back
  later turns the box to the still for good. The hero's CSS is in the site's shared stylesheet; only its script is landing-only.
- **Theme**: the leaves read the `--leaf-*` tokens, defined at the foot of `HeroLeaves.astro` (leaf 1 is `--gmt-spring`; the rest
  are an invented palette), and re-tint when the header's theme toggle (`ThemeSelect.astro`, `ThemeProvider.astro`) changes `data-theme` on `<html>`.
- **Drawing** pauses, with the clock, while the tab is hidden or the art box is off screen; the device pixel ratio is capped at 1.5.
- Both the canvas and the SVG are `aria-hidden`: the heading and the link carry the meaning.
- **The Dox link and the entrance.** The Dox link (`.dox-link`) takes part in neither the fade nor the colour pass of the landing header's entrance: custom.css excludes it with `a.header-chip:not(.dox-link)`. No audit rule checks this; plan §9 Q8 asks whether it should enter.
- **The header's entrance** (#266, 2026-11-06): on the landing only, and on an arrival from outside the docs site and on every reload, the header's
  `/ worktree vX.Y.Z` (the shield and the "NorthGuild" wordmark stay static), search button and theme toggle fade up like the hero copy (`hero-copy-in`), left to right. Once they are
  in, a second pass paints the theme toggle, GitHub and Discord, one after another, from northguild.dev's resting icon colour
  (`--gmt-ice-dim`) into their own green. GitHub and Discord do not fade; they are there throughout. It is CSS in `custom.css` ("The
  landing header's entrance"), all inside `prefers-reduced-motion: no-preference`, animating opacity, transform and colour only, with a
  `backwards` fill so hover and focus take over afterwards; with reduced motion, or no script, the finished header is simply there.
  **Timings** are the `--entrance-*` custom properties at the top of that block (fade duration and the three fade delays, the colour
  pass's start, step and duration); change numbers there, not rules. `Header.astro` marks its root `data-landing-entrance` on the
  landing, and an inline script in it sets `data-entrance-off` on `<html>` when the navigation followed a link or used Back/Forward
  (Navigation Timing type `navigate` or `back_forward`, read as `navigate` if unavailable) and `document.referrer` is a page under the
  site base; a reload always plays it, since it keeps the old referrer (`internal-arrival.ts` is the tested form of that test;
  `Header.test.ts` runs the inline copy against it). No referrer, and northguild.dev itself, count as external. To see it: open the landing from a typed URL or `https://northguild.dev/`; reload it and it plays again; follow the
  header's "worktree" link from `/worktree/faq/` and it does not play. `pnpm docs:audit-dist` pins the marker, the inline script, the
  query, the absence of any `opacity: 0` rule on a header item, and which parts may fade (never the wordmark, GitHub or
  Discord, or the search dialog's buttons).

## Scripts reference

All commands are run from the repo root with `pnpm --filter docs run <command>`,
or use the root-level aliases where noted.

### Development

| Command | What it does |
|---|---|
| `dev` | Start Astro dev server (no worker) |
| `dev:local` | Build worker once, then start worker + Astro — use when not editing worker code |
| `dev:local:watch` | Same as `dev:local`, plus watch-rebuild the worker on every save — use when editing worker code |
| `worker:dev` | Start the already-built worker at `http://localhost:8787` |
| `worker:build:watch` | Watch-rebuild the worker bundle on file changes |

### AI context & skill maintenance

| Command | What it does | When to run |
|---|---|---|
| `worker:build-context` | Scan MDX files + SKILL.md → generate the corpus (`docs-context.ts`: chunks, serialised index, vocabulary) and `docs-routes.generated.ts` (routes, counts) | After adding/editing docs pages, or after editing the skill |
| `worker:build` | Run `worker:build-context` then bundle `worker.ts` via tsup | Before `worker:dev` or before deploying |

### Testing & deployment

| Command | What it does |
|---|---|
| `test` | Run all docs tests with vitest |
| `worker:test` | Run every worker test under `worker/` (the router, both handlers, the validator, the error mapping, the rate limiter) |
| `worker:bundle-check` | Build the worker, then `wrangler deploy --dry-run`: proves it still bundles for Cloudflare, with no credentials and nothing sent. Run it after changing a dependency or an import; CI runs it |
| `worker:setup-secret` | Store `GEMINI_API_KEY` as an encrypted Cloudflare secret (one-time) |
| `worker:setup-dev-vars` | Write `worker/.dev.vars` from `.env.local` for local wrangler dev |
| `worker:deploy` | Test → build → `wrangler deploy` |
| `audit-dist` | Assert the SEO requirements over `dist/` (run after `build`; root alias `pnpm docs:audit-dist`) |
| `build:legacy` | Write `legacy/` (gitignored): the bundle for the old GitHub Pages site |
| `stage:deploy` | Copy `dist/` to `.deploy/worktree/` (gitignored), the directory `wrangler.jsonc` serves |
| `deploy:smoke` | Check the live routes on `https://northguild.dev/worktree/` (`SMOKE_ORIGIN` overrides the origin) |

---

## Environment variables & secrets

### Local development

| Variable | File | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `docs/.env.local` | Gemini API key for local worker dev — never committed |
| `PUBLIC_GEMINI_WORKER_URL` | `docs/.env.local` (optional) | Override the worker URL in Astro; defaults to `http://localhost:8787` |

### GitHub Actions

The two Cloudflare secrets are **environment** secrets, set in **GitHub repo → Settings → Environments →
`cloudflare-production`**, whose deployment-branch policy admits only `main`. The variable is set in **Settings →
Secrets and variables → Actions**.

| Name | Type | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Environment secret (`cloudflare-production`) | Used by `worker-deploy.yml` and `docs-deploy.yml` to authenticate `wrangler deploy`; the site deploy needs it to cover Routes on the `northguild.dev` zone |
| `CLOUDFLARE_ACCOUNT_ID` | Environment secret (`cloudflare-production`) | Used by both workflows alongside the API token |
| `GEMINI_WORKER_URL` | Variable (not secret) | Public worker URL baked into the static bundle at docs build time |

`GEMINI_WORKER_URL` is a **variable**, not a secret — its value is the public
HTTPS URL of the Cloudflare Worker and is embedded in the client bundle. The
API key itself never leaves Cloudflare.

### Cloudflare

| Name | How to set | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `pnpm --filter docs run worker:setup-secret` | Gemini API key injected by the Worker runtime on each request; never sent to the browser |

---

## Deployment

The docs site deploys once per stable release, as the `docs` job of `publish.yml`, after `publish` and beside
`notify` (a prerelease does not deploy it), by calling `.github/workflows/docs-deploy.yml`. It builds the release
commit, so a docs change merged after the release waits for the next one. Two jobs:

- **`site`** builds `docs/dist`, audits it, copies it to `docs/.deploy/worktree/` and runs `wrangler deploy` with
  `docs/wrangler.jsonc`: a Worker with static assets and no script, on the Route `northguild.dev/worktree*`.
  The copy exists because a Route does not strip its path, while `astro build` writes `dist/` without the
  `/worktree` base. It then runs `deploy:smoke` against the live URL, retrying for route propagation.
- **`legacy-pages`** runs after `site` and publishes `docs/legacy/` (from `build:legacy`) to GitHub Pages: the
  schema file at `https://northguild.github.io/worktree/schema/v1.json` plus a redirect stub per old route.

The Worker config is not the chat Worker's: that one is `docs/worker/wrangler.toml`.

The Cloudflare Worker deploys automatically on pushes to `main` that touch
`docs/worker/**`, `docs/src/chat/lib/**`, `docs/package.json` or `pnpm-lock.yaml` (see
`.github/workflows/worker-deploy.yml`): the last two because the Worker bundles its dependencies.

To deploy outside a release (a docs fix that cannot wait), use "Run workflow" on `docs-deploy.yml`, from `main`:
a run from any other branch skips both jobs and deploys nothing, and the `cloudflare-production` environment would
refuse it anyway. It builds `main`'s head at that moment.

To recover a failed `docs` job, use "Re-run failed jobs" on that Publish run (`gh run rerun <run-id> --failed`),
within 30 days of it. Only what failed runs again, with the run's own commit and ref: it rebuilds the release
commit, the `github-pages` environment still sees `main`, and `publish` and `notify` do not repeat. Past 30 days,
use "Run workflow" on `docs-deploy.yml`, from `main`, as above; it builds `main`'s head. A failed `docs` job leaves
the Publish run red although the package shipped.

The docs site's version label comes from `docs/src/lib/site-meta.ts`, which `pnpm sync-version` writes
from the root `package.json`. A release runs it as part of `pnpm changeset:prepare-release`, so the new
version arrives in the release pull request; `pnpm docs:dev` runs its docs half (`pnpm docs:sync-version`) first locally. Changesets ignores the
`docs` package (it is private and has no npm release), so docs changes need no release note and the site
deploys with the next stable release.

For manual deployment steps, including first-time Cloudflare setup, see
[docs/worker/README.md](worker/README.md).
