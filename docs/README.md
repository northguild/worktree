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
  │
  │  POST /  { model, messages[] }
  ▼
Cloudflare Worker  (docs/worker/)
  │  – holds GEMINI_API_KEY as an encrypted secret
  │  – validates input, enforces CORS
  │  – prepends the system prompt (baked in at build time)
  ▼
Google Gemini API  (SSE stream)
  │
  ▼
Worker pipes SSE back to the browser
  │
  ▼
docs/src/chat/  – React components render the streamed response
```

The static bundle **never** sees the API key. The key lives exclusively in
Cloudflare's secret store and is injected by the Worker runtime on each request.

### How the AI gets its context

The AI's knowledge comes from two sources that are compiled together at worker
build time into a single system prompt string (`docs/worker/docs-context.ts`):

#### 1. MDX documentation pages

`docs/worker/build-context.mjs` scans every `*.mdx` file under
`docs/src/content/docs/`, turns each page's frontmatter into a heading, strips imports and Starlight `<Tabs>`/`<TabItem>` tags (keeping their content); any other component tag would pass through as written (no page uses one), and concatenates the plain-text
content with section labels. This is the authoritative reference the AI uses
to answer questions.

#### 2. Agent Skill (`skills/worktree/SKILL.md`)

The repo ships a plain Agent Skill, installable with `npx skills add northguild/worktree --skill worktree`.
`skills/worktree/SKILL.md` is a structured markdown document that describes the Worktree
CLI's core patterns and canonical terminology. It is hand-written: edit it in
the same change as the code that makes it untrue. It is included in the system
prompt before the MDX content so the AI understands product vocabulary before
it reads the docs.

#### Assembling the system prompt

`build-context.mjs` assembles the final system prompt in this order:

1. **Persona & scope** — the AI is instructed to answer only from the docs and
   skill guide, and to say so when a question is out of scope.
2. **Linking rules** — the AI is given an explicit list of valid doc routes
   (derived automatically from the MDX filesystem scan) and told never to link
   to GitHub repo anchors, SKILL.md headings, or any route not in that list.
3. **Skill Guide** — `skills/worktree/SKILL.md`
4. **Documentation** — all MDX pages, each labelled with its file path

The prompt is serialised with `JSON.stringify` into `docs-context.ts` and
bundled into the worker via tsup. **No runtime fetching** — the context is
embedded in the ~260 KB worker bundle.

#### Regenerating the context

```bash
pnpm --filter docs run worker:build-context
```

This also regenerates `docs/src/chat/docs-routes.generated.ts`, which the
React link renderer uses to validate that AI-generated links point to real pages.

Run this (or just `worker:build`) after:
- Adding or removing a docs page
- Editing any MDX content that you want reflected in the AI's answers
- Editing `skills/worktree/SKILL.md`

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
follows the visitor's system through Starlight's theme picker, which sets `data-theme` on `<html>`.
The header's NorthGuild mark is `src/components/SiteTitle.astro`, copied the same way.

### The accent, and how a product picks its colour

Each product keeps the NorthGuild style with its own accent (plan #235, D17): gmt's is cyan, worktree's is
spring green. The vendored tokens define both families (`--gmt-cyan`, `--gmt-spring`, each with an `-ink`
tier that the light theme darkens for text). **The accent is chosen in one place, `src/styles/theme.css`**:
`--sl-color-accent` (fills, borders, rings: 3:1) takes the fill tier and `--sl-color-text-accent`,
`--sl-color-accent-high` and the chat's `--color-chat-accent-ink` (in `globals.css`) take the ink tier (text: 4.5:1).
To move to another family, change those mappings, the focus-ring colour, the launcher in `globals.css`, the
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

- **Header.** Starlight's own `Header` is kept, so search, the theme picker, the language select and the mobile menu are
  untouched; two of the components it renders are overridden. `src/components/SiteTitle.astro` is the NorthGuild mark and
  "NorthGuild" (one link to `https://northguild.dev/`) and `worktree` in the accent (a second link, to the site's home),
  then the CLI version (`cliVersion` from `src/lib/site-meta.ts`) in small grey text on the name's baseline, from 30rem up.
  `src/components/SocialIcons.astro` is the GitHub and Discord pair from northguild.dev, opening in a new tab and saying so in
  their names; Starlight also renders it in the mobile menu. The glass bar is in `theme.css` (4px blur, a hairline under it only),
  and so is the wide header's grid: the search box keeps to the right, beside the GitHub link, on every page, where Starlight
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

`src/components/Footer.astro` overrides Starlight's `Footer`: it renders Starlight's own footer (edit link, last
updated, pagination) through `Default` and nothing else; the licence line, the CLI version and the maintainers it once
added are gone (the CLI version is in the header). The landing renders no footer at all: it is the hero alone. The chat
launcher is rendered from the same file on every page, the landing included, because Starlight has no slot of its own
for it. `Footer.astro` imports Starlight's virtual modules, which Vitest cannot resolve, so the built footer is
checked in `dist/` instead (`pnpm docs:audit-dist`).

## The landing hero

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
  are an invented palette), and re-tint when Starlight's theme picker changes `data-theme` on `<html>`.
- **Drawing** pauses, with the clock, while the tab is hidden or the art box is off screen; the device pixel ratio is capped at 1.5.
- Both the canvas and the SVG are `aria-hidden`: the heading and the link carry the meaning.

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
| `worker:build-context` | Scan MDX files + SKILL.md → generate `docs-context.ts` and `docs-routes.generated.ts` | After adding/editing docs pages, or after editing the skill |
| `worker:build` | Run `worker:build-context` then bundle `worker.ts` via tsup | Before `worker:dev` or before deploying |

### Testing & deployment

| Command | What it does |
|---|---|
| `test` | Run all docs tests with vitest |
| `worker:test` | Run worker unit tests |
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

Set in **GitHub repo → Settings → Secrets and variables → Actions**.

| Name | Type | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Used by `worker-deploy.yml` and `docs-deploy.yml` to authenticate `wrangler deploy`; the site deploy needs it to cover Routes on the `northguild.dev` zone |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Used by both workflows alongside the API token |
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

The docs site deploys automatically on every push to `main` that touches
`docs/**` (see `.github/workflows/docs-deploy.yml`), as two jobs:

- **`site`** builds `docs/dist`, audits it, copies it to `docs/.deploy/worktree/` and runs `wrangler deploy` with
  `docs/wrangler.jsonc`: a Worker with static assets and no script, on the Route `northguild.dev/worktree*`.
  The copy exists because a Route does not strip its path, while `astro build` writes `dist/` without the
  `/worktree` base. It then runs `deploy:smoke` against the live URL, retrying for route propagation.
- **`legacy-pages`** runs after `site` and publishes `docs/legacy/` (from `build:legacy`) to GitHub Pages: the
  schema file at `https://northguild.github.io/worktree/schema/v1.json` plus a redirect stub per old route.

The Worker config is not the chat Worker's: that one is `docs/worker/wrangler.toml`.

The Cloudflare Worker deploys automatically on pushes to `main` that touch
`docs/worker/**` (see `.github/workflows/worker-deploy.yml`).

The docs site's version label comes from `docs/src/lib/site-meta.ts`, which `pnpm sync-version` writes
from the root `package.json`. A release runs it as part of `pnpm changeset:prepare-release`, so the new
version arrives in the release pull request; `pnpm docs:dev` runs its docs half (`pnpm docs:sync-version`) first locally. Changesets ignores the
`docs` package (it is private and has no npm release), so docs changes need no release note and the site
deploys on its own, not on a version.

For manual deployment steps, including first-time Cloudflare setup, see
[docs/worker/README.md](worker/README.md).
