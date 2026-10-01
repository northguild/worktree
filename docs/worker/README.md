# Cloudflare Worker: Gemini API Proxy

This worker runs on Cloudflare Workers and proxies chat requests from the docs
static site to the Google Gemini API, keeping `GEMINI_API_KEY` out of the browser.

## How it fits together

```
Browser (GitHub Pages)  →  POST https://<worker>.workers.dev?model=...
                              ↓
                        Cloudflare Worker  (docs/worker/)
                              ↓
                        Gemini REST API  (SSE stream)
                              ↑
                        SSE stream piped back to browser
```

The static bundle bakes in `GEMINI_WORKER_URL` at build time.
That variable is set as a GitHub repo **variable** (not a secret) and injected
by the `docs-deploy.yml` workflow.

## Commands reference

All commands are run from the repo root with `pnpm --filter docs run <command>`.

### One-time setup

| Command | What it does | When to run |
|---|---|---|
| `worker:setup-secret` | Stores `GEMINI_API_KEY` as an encrypted Cloudflare secret | Once per worker, or when rotating the key |
| `worker:setup-dev-vars` | Writes `docs/worker/.dev.vars` from `docs/.env.local` so `wrangler dev` can read the key | Once per machine, or after changing `.env.local` |

### Normal development

| Command | What it does | When to run |
|---|---|---|
| `worker:dev` | Runs the **already-built** worker locally at `http://localhost:8787` | After `worker:build`, when you want to test against the local worker |
| `worker:build:watch` | Rebuilds the worker bundle on every file save | In a separate terminal during active worker development |
| `worker:build-context` | Scans MDX files + `skills/worktree/SKILL.md` → regenerates `worker/docs-context.ts` (system prompt) **and** `src/chat/docs-routes.generated.ts` (valid link list) | After adding/editing any docs page or the skill guide |
| `worker:build` | Runs `worker:build-context` then bundles `worker.ts` via tsup | Before `worker:dev`, or manually before deploying |

> **Tip:** Use `dev:local:watch` (see [Local development](#local-development)) to run the full stack in one command instead of managing terminals manually.

### Testing

| Command | What it does | When to run |
|---|---|---|
| `worker:test` | Runs the worker unit tests with vitest | Before deploying, or in CI |

### Deployment

| Command | What it does | When to run |
|---|---|---|
| `worker:deploy` | Runs `worker:test` → `worker:build` → `wrangler deploy` | When you want to push a new version of the worker to Cloudflare |

---

## Local development

**Prerequisite:** `docs/.env.local` must contain your Gemini API key.
Copy `docs/.env.local.example` → `docs/.env.local` and fill it in.

Two commands cover the common cases:

| Command | What it does |
|---|---|
| `dev:local` | Builds the worker once, then starts `worker:dev` + `next dev` concurrently. Use when you are **not** actively editing worker code. |
| `dev:local:watch` | Same as above, but also starts `worker:build:watch` so the worker bundle rebuilds automatically on every file save. Use when you **are** editing worker code. |

```bash
# Quick iteration on docs/UI only — worker rebuilt once, then left running
pnpm --filter docs run dev:local

# Active worker development — worker rebuilds on every save
pnpm --filter docs run dev:local:watch
```

Or run them separately:

```bash
# Terminal 1 — worker (http://localhost:8787)
pnpm --filter docs run worker:dev

# Terminal 2 — Next.js (http://localhost:3000)
pnpm --filter docs run dev
```

### How `GEMINI_WORKER_URL` controls which worker is used

`GEMINI_WORKER_URL` is the single environment variable that switches between the local worker and the deployed Cloudflare Worker:

| Value | Where it comes from | Effect |
|---|---|---|
| `http://localhost:8787` | Set explicitly by `dev:local` / `dev:local:watch` at startup | Next.js sends chat requests to your local `wrangler dev` instance |
| `https://worktree-gemini-proxy.northguild.workers.dev` | GitHub repo variable, baked in at build time by `docs-deploy.yml` | The production static bundle hits the live Cloudflare Worker |
| *(unset)* | — | Next.js falls back to `http://localhost:8787` |

The variable is **public** — it is just a URL, not a secret. The API key never leaves Cloudflare.

## First-time Cloudflare deployment

> **Done for this project.** The worker is live at
> `https://worktree-gemini-proxy.northguild.workers.dev`.
> Steps below are for reference or if you need to redo from scratch.

### 1. Find your Cloudflare Account ID

```bash
npx wrangler whoami
```

Or open [dash.cloudflare.com](https://dash.cloudflare.com) → right sidebar.

### 2. Export credentials for your shell session

```bash
export CLOUDFLARE_API_TOKEN="<your token>"
export CLOUDFLARE_ACCOUNT_ID="<your account id>"
```

### 3. Set the Gemini API key secret on the worker *(one-time)*

Do this **before** deploying if the worker doesn't exist yet — wrangler will
create a stub worker, bind the secret, then you deploy the code on top of it.
Or run it after deploy; either order works.

```bash
pnpm --filter docs run worker:setup-secret
# prompts: "Enter a secret value:" — paste your GEMINI_API_KEY
```

**This is a one-time operation.** Re-run only if you rotate the Gemini API key.
The secret lives in Cloudflare's secret store — it is separate from:
- `GEMINI_API_KEY` in `docs/.env.local` (used by `worker:setup-dev-vars` for local wrangler dev only)
- `GEMINI_API_KEY` in GitHub Secrets (not used here — that was added for future CI if needed)

### 4. Deploy the worker

```bash
pnpm --filter docs run worker:deploy
```

Builds the worker (regenerates `docs-context.ts` from MDX + bundles via tsup)
then deploys. On success wrangler prints:

```
Deployed worktree-gemini-proxy triggers
  https://worktree-gemini-proxy.northguild.workers.dev
```

### 5. Set the GitHub repo variable

In your GitHub repo → **Settings → Secrets and variables → Actions →
Variables**, add:

| Name | Value |
|---|---|
| `GEMINI_WORKER_URL` | `https://worktree-gemini-proxy.northguild.workers.dev` |

### 6. Trigger a docs rebuild

The `docs-deploy.yml` workflow bakes `GEMINI_WORKER_URL` into the static bundle.
Push a commit or manually trigger:

```
GitHub repo → Actions → Deploy Docs → Run workflow
```

## Redeploying after changes

```bash
pnpm --filter docs run worker:deploy
```

The `worker:build` step regenerates `docs-context.ts` every time, so the
deployed worker always has up-to-date docs content embedded in the system prompt.

## CORS

The worker allows requests from:
- `https://northguild.github.io` — production GitHub Pages
- `http://localhost:3000` — local Next.js dev

All other origins receive the production origin in `Access-Control-Allow-Origin`,
so browsers will block unexpected cross-origin requests. Update `CORS_ORIGINS`
in `worker.ts` if you add a custom domain.

## Abuse protection

CORS controls browser behavior, but it is **not** authentication. This worker
also applies app-level rate limiting before calling Gemini.

- Limit key: client IP (`CF-Connecting-IP`, fallback to first `X-Forwarded-For` value)
- Default policy: `30` requests per `60` seconds per client
- Response on limit: HTTP `429` with `Retry-After`

You can tune limits with non-secret worker vars in `worker/wrangler.toml`:

```toml
[vars]
WORKER_RATE_LIMIT_MAX = "30"
WORKER_RATE_LIMIT_WINDOW_SECONDS = "60"
```

For stronger protection, add Cloudflare WAF/Rate Limiting or Turnstile in front
of this endpoint.

## CI auto-deployment (optional)

See `.github/workflows/worker-deploy.yml`. Deploys automatically on pushes to
`main` that change `docs/worker/**`. Requires two GitHub **repository secrets**:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | CF dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami` or CF dashboard right sidebar |

## Bundle size

Zero npm dependencies — the worker calls the Gemini REST API directly with
`fetch()`. Typical bundle size: ~30 KB.

---

## How the AI system prompt is built

For a full explanation of how the AI gets its context, how the system prompt is
assembled, and how AI-generated links are validated, see
[docs/README.md — How the AI chat works](../README.md#how-the-ai-chat-works).

### Quick reference for this worker

The system prompt embedded in this worker contains, in order:

1. **Persona & scope instructions** — restricts answers to the docs and skill guide
2. **Linking rules** — an auto-generated list of valid `/docs/...` routes the AI
   may link to; derived from the MDX filesystem scan in `build-context.mjs`
3. **`skills/worktree/SKILL.md`** — Agent Skill guide (product vocabulary
   and core patterns)
4. **Doc pages** — every `*.mdx` file under `src/app/docs/`, stripped of JSX

The prompt is baked in at build time via `worker:build-context`. The worker
never fetches content at runtime — all context is in the ~30 KB bundle.
