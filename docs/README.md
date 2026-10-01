# Worktree Docs Site

Next.js / Nextra documentation site for the Worktree CLI, deployed to GitHub Pages at
`https://northguild.github.io/worktree/docs`.

## Quick start

From the **repo root**:

```bash
pnpm install
pnpm docs:dev
```

To run with the AI chat worker locally, choose based on what you are working on:

```bash
# Editing docs/UI only — builds the worker once, then starts worker + Next.js
pnpm --filter docs run dev:local

# Editing worker code — same, but also watch-rebuilds the worker on every save
pnpm --filter docs run dev:local:watch
```

Both commands build the worker, write `.dev.vars`, start the Cloudflare Worker on `http://localhost:8787`, and start Next.js on `http://localhost:3000`. The difference is that `dev:local:watch` also runs `worker:build:watch` so the worker bundle stays up to date as you edit.

`GEMINI_WORKER_URL` is the variable that controls which worker the docs app talks to. The `dev:local*` scripts set it to `http://localhost:8787` so Next.js hits your local `wrangler dev` instance. In production, the GitHub Actions workflow bakes in the deployed Cloudflare Worker URL at build time.

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
Browser (GitHub Pages static site)
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
`docs/src/app/docs/`, strips JSX/imports, and concatenates the plain-text
content with section labels. This is the authoritative reference the AI uses
to answer questions.

#### 2. TanStack Intent Skill Guide (`skills/core/SKILL.md`)

The repo ships as a TanStack Intent-enabled package. `skills/core/SKILL.md` is
an AI skill file — a structured markdown document that describes the Worktree
CLI's core patterns, intent model, and canonical terminology. It is authored
and maintained using the `@tanstack/intent` CLI, and is included in the system
prompt before the MDX content so the AI understands product vocabulary before
it reads the docs.

> **`SKILL.md` is managed by TanStack Intent — do not edit it by hand.**
> Use the Intent CLI commands described in the [TanStack Intent workflow](#tanstack-intent-workflow) section below.

#### Assembling the system prompt

`build-context.mjs` assembles the final system prompt in this order:

1. **Persona & scope** — the AI is instructed to answer only from the docs and
   skill guide, and to say so when a question is out of scope.
2. **Linking rules** — the AI is given an explicit list of valid doc routes
   (derived automatically from the MDX filesystem scan) and told never to link
   to GitHub repo anchors, SKILL.md headings, or any route not in that list.
3. **Skill Guide** — `skills/core/SKILL.md`
4. **Documentation** — all MDX pages, each labelled with its file path

The prompt is serialised with `JSON.stringify` into `docs-context.ts` and
bundled into the worker via tsup. **No runtime fetching** — the context is
embedded in the ~30 KB worker bundle.

#### Regenerating the context

```bash
pnpm --filter docs run worker:build-context
```

This also regenerates `docs/src/chat/docs-routes.generated.ts`, which the
React link renderer uses to validate that AI-generated links point to real pages.

Run this (or just `worker:build`) after:
- Adding or removing a docs page
- Editing any MDX content that you want reflected in the AI's answers
- After using TanStack Intent to update `skills/core/SKILL.md` (see below)

---

### TanStack Intent workflow

The `skills/core/SKILL.md` file is owned by [`@tanstack/intent`](https://tanstack.com/intent/latest/docs/overview),
which versions it alongside the package and provides tooling to keep it
accurate as source docs change.

#### Check if the skill is stale

Run this after editing source docs (MDX pages, README, CLI source files) to see
if the skill references outdated content:

```bash
npx @tanstack/intent@latest stale
```

#### Update / scaffold the skill

If the skill is stale or you want to revise it:

```bash
npx @tanstack/intent@latest scaffold
```

This guides an AI agent through domain discovery and skill authoring
interactively.

#### Validate before publishing

```bash
npx @tanstack/intent@latest validate
```

Enforces SKILL.md format rules and packaging requirements. Run this before
cutting a release.

#### After updating the skill

Once `skills/core/SKILL.md` has been updated by Intent, re-embed it in the
worker so the docs chat reflects the changes:

```bash
pnpm --filter docs run worker:build-context
# or as part of a full worker rebuild:
pnpm --filter docs run worker:build
```

### How links in AI responses are validated

The React component `docs/src/chat/components/MarkdownContent.tsx` processes
every link in the AI's markdown response through `resolveHref()` before
rendering:

| Link type | Outcome |
|---|---|
| Relative path in `VALID_DOC_ROUTES` | Rendered as a `<Link>` (internal navigation) |
| Full GH Pages URL (`https://northguild.github.io/worktree/...`) | Stripped to relative path, then same check as above |
| GitHub repo anchor (`github.com/northguild/worktree#...`) | Rendered as plain text — no link |
| Any other relative path not in the route list | Rendered as plain text — no link |
| Any other external URL | Rendered as `<a target="_blank">` |

`VALID_DOC_ROUTES` is auto-generated from the MDX filesystem scan — it never
needs to be maintained by hand.

---

## Scripts reference

All commands are run from the repo root with `pnpm --filter docs run <command>`,
or use the root-level aliases where noted.

### Development

| Command | What it does |
|---|---|
| `dev` | Start Next.js dev server (no worker) |
| `dev:local` | Build worker once, then start worker + Next.js — use when not editing worker code |
| `dev:local:watch` | Same as `dev:local`, plus watch-rebuild the worker on every save — use when editing worker code |
| `worker:dev` | Start the already-built worker at `http://localhost:8787` |
| `worker:build:watch` | Watch-rebuild the worker bundle on file changes |

### AI context & skill maintenance

| Command | What it does | When to run |
|---|---|---|
| `worker:build-context` | Scan MDX files + SKILL.md → generate `docs-context.ts` and `docs-routes.generated.ts` | After adding/editing docs pages, or after updating the skill via Intent |
| `worker:build` | Run `worker:build-context` then bundle `worker.ts` via tsup | Before `worker:dev` or before deploying |
| `npx @tanstack/intent@latest stale` | Check if `skills/core/SKILL.md` references outdated source docs | After editing MDX pages, README, or CLI source |
| `npx @tanstack/intent@latest scaffold` | AI-guided skill authoring / update | When the skill is stale or needs revision |
| `npx @tanstack/intent@latest validate` | Validate SKILL.md format and packaging | Before cutting a release |

### Testing & deployment

| Command | What it does |
|---|---|
| `test` | Run all docs tests with vitest |
| `worker:test` | Run worker unit tests |
| `worker:setup-secret` | Store `GEMINI_API_KEY` as an encrypted Cloudflare secret (one-time) |
| `worker:setup-dev-vars` | Write `worker/.dev.vars` from `.env.local` for local wrangler dev |
| `worker:deploy` | Test → build → `wrangler deploy` |

---

## Environment variables & secrets

### Local development

| Variable | File | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | `docs/.env.local` | Gemini API key for local worker dev — never committed |
| `GEMINI_WORKER_URL` | `docs/.env.local` (optional) | Override the worker URL in Next.js; defaults to `http://localhost:8787` |

### GitHub Actions

Set in **GitHub repo → Settings → Secrets and variables → Actions**.

| Name | Type | Purpose |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Secret | Used by `worker-deploy.yml` to authenticate `wrangler deploy` |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Used by `worker-deploy.yml` alongside the API token |
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
`docs/**` (see `.github/workflows/docs-deploy.yml`).

The Cloudflare Worker deploys automatically on pushes to `main` that touch
`docs/worker/**` (see `.github/workflows/worker-deploy.yml`).

The docs site's version label comes from `docs/src/lib/site-meta.ts`, which `pnpm sync-version` writes
from the root `package.json`. A release runs it as part of `pnpm changeset:prepare-release`, so the new
version arrives in the release pull request; `pnpm docs:dev` runs it first locally. Changesets ignores the
`docs` package (it is private and has no npm release), so docs changes need no release note and the site
deploys on its own, not on a version.

For manual deployment steps, including first-time Cloudflare setup, see
[docs/worker/README.md](worker/README.md).
