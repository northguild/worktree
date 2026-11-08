# Cloudflare Worker: Gemini chat

This worker runs on Cloudflare Workers and answers chat requests from the docs
static site with Google's Gemini models, keeping `GEMINI_API_KEY` out of the browser.

## How it fits together

```
Browser (northguild.dev/worktree/)  →  POST https://<worker>.workers.dev/api/chat
                              ↓
                        Cloudflare Worker  (docs/worker/)
                          1. rate limit        → 429 + Retry-After
                          2. key present       → else 500
                          3. JSON, then validate (validation.ts) → 400
                          4. chat()  (@tanstack/ai) with createGeminiChat
                              ↓
                        Gemini REST API  (SSE stream)
                              ↓
                        error-mapping.ts wraps the stream, so a failure is a curated RUN_ERROR
                              ↓
                        toServerSentEventsResponse → AG-UI events over SSE, back to the browser
```

`POST /` still speaks the legacy protocol (Gemini's own SSE piped through) for the live site's current client.

## Routes

`worker.ts` is a router. Every route answers with CORS headers: an allowed origin is reflected, any other gets `https://northguild.dev`.

| Request | Answer |
|---|---|
| `OPTIONS` on any path | 204 with CORS headers (`Access-Control-Expose-Headers: Retry-After` included) |
| `POST /` | the **legacy** protocol (`legacy-handler.ts`): the Gemini SSE stream piped through, with its own copy of the old model list (`gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3-flash-preview`) and caps (20,000 characters a message, 50 messages). Frozen: the live site's current client speaks it, and it is retired only after a stable release has deployed the new client |
| `POST /api/chat` | the new protocol (`chat-handler.ts`). The body is the AG-UI shape `useChat` sends (`threadId`, `runId`, `messages`, optional `forwardedProps.model`), validated by `validation.ts`; only `{ role, content }` pairs reach `chat()`. The answer is AG-UI events over SSE (`RUN_STARTED`, `TEXT_MESSAGE_*`, `RUN_FINISHED`). Before the stream opens a failure is an HTTP status with `{ error, retryable }`: 429 with `Retry-After`, 500 when the key is missing, 400 for bad JSON, a bad request or a conversation over the cap. Once the stream is open, a failure is one `RUN_ERROR` event with our own text and a `code` (see below) |
| any other method on `/` or `/api/chat` | 405 `{ error, retryable: false }` |
| any other path | 404 `{ error, retryable: false }` |

Both `POST` routes spend one `chat:<client>` rate-limit bucket (`rate-limit.ts`), so using both cannot double a client's allowance. The Gemini key is sent in the `x-goog-api-key` header on every upstream call, never in the URL.

### Errors inside the stream

Google's error text never reaches the reader. `error-mapping.ts` reads the HTTP status inside the failure (the Gemini adapter puts Google's JSON body in the `RUN_ERROR`'s `message` and sets no `code`) and replaces the event:

| Upstream | `code` | Retryable |
|---|---|---|
| 401, 403, or an invalid API key | `misconfigured` | no |
| 429 whose body says "per day" | `rate_limited_daily` | yes |
| any other 429 | `rate_limited` | yes |
| any other API error | `upstream_unavailable` | yes |
| anything else | `failed` | no |

Each mapped failure is logged once as a JSON line (`chat.failed`, with the code, model, thread and run ids) and never with the key or any message text. `retry` is left unset so a 429 is not repeated against the quota.

The model is called with `reasoning: { level: "low", summary: false }`: the bare string `"low"` is normalised by `@tanstack/ai` to `summary: true`, which asks Gemini for thought summaries.

The static bundle bakes in `PUBLIC_GEMINI_WORKER_URL` at build time.
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
| `worker:test` | Runs every test under `docs/worker/` (the router, both handlers, the validator, the error mapping, the rate limiter) with vitest | Before deploying, or in CI |
| `worker:bundle-check` | Builds the worker, then `wrangler deploy --dry-run`: proves it still bundles for Cloudflare. Needs no credentials and sends nothing | After changing a dependency or an import; CI runs it |

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
| `dev:local` | Builds the worker once, then starts `worker:dev` + `astro dev` concurrently. Use when you are **not** actively editing worker code. |
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

# Terminal 2 — Astro (http://localhost:4321)
pnpm --filter docs run dev
```

### How `PUBLIC_GEMINI_WORKER_URL` controls which worker is used

`PUBLIC_GEMINI_WORKER_URL` is the single environment variable that switches between the local worker and the deployed Cloudflare Worker:

| Value | Where it comes from | Effect |
|---|---|---|
| `http://localhost:8787` | Set explicitly by `dev:local` / `dev:local:watch` at startup | Astro sends chat requests to your local `wrangler dev` instance |
| `https://worktree-gemini-proxy.northguild.workers.dev` | GitHub repo variable, baked in at build time by `docs-deploy.yml` | The production static bundle hits the live Cloudflare Worker |
| *(unset)* | — | Astro falls back to `http://localhost:8787` |

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

The `docs-deploy.yml` workflow bakes its `GEMINI_WORKER_URL` repository variable (as `PUBLIC_GEMINI_WORKER_URL`) into the static bundle.
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
- `https://northguild.dev` — the production docs site
- `http://localhost:4321` — local Astro dev (Astro's default port)

All other origins receive the production origin in `Access-Control-Allow-Origin`,
so browsers will block unexpected cross-origin requests. Update `CORS_ORIGINS`
in `cors.ts` if the site moves to another host.

## Abuse protection

CORS controls browser behavior, but it is **not** authentication. This worker
also applies app-level rate limiting before calling Gemini, with **one limiter shared by both routes**.
The limiter lives in the isolate's memory, so it is **per isolate, not global**:
Cloudflare may run several isolates, each with its own count, and anyone who can
reach the URL can spend the key's daily Gemini quota. The visible effect would be
daily-limit warnings for everyone. Stronger controls are a decision for the
account holder (plan #257 §9 Q5).

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
`main` that change `docs/worker/**` or `docs/src/chat/lib/**` (the contract the worker bundles). A manual "Run workflow" deploys only from `main`: a run from any other
branch deploys nothing, provided that branch's copy of the workflow still has the guard (a manual run uses the
selected branch's file). Requires two GitHub **repository secrets**:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | CF dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami` or CF dashboard right sidebar |

## Bundle size and dependencies

The worker depends on `@tanstack/ai` and `@tanstack/ai-gemini` (and `zod`, `@northguild/gmt`).
`tsup` bundles everything except the two TanStack packages, which `wrangler deploy` then
bundles itself: only wrangler resolves the packages' `workerd` export conditions, and the
Node build that tsup would inline hung under `wrangler dev --local`. `compatibility_flags`
holds `nodejs_compat` (the packages import `node:events` and `node:process`) and
`enable_request_signal` (a closed tab aborts the Gemini call).
`wrangler deploy --dry-run` measured 3,222 KiB uploaded, 577 KiB gzipped, on 2026-11-08;
`worker:bundle-check` re-runs it.

---

## How the AI system prompt is built

For a full explanation of how the AI gets its context, how the system prompt is
assembled, and how AI-generated links are validated, see
[docs/README.md — How the AI chat works](../README.md#how-the-ai-chat-works).

### Quick reference for this worker

The system prompt embedded in this worker contains, in order:

1. **Persona & scope instructions** — restricts answers to the docs and skill guide
2. **Linking rules** — an auto-generated list of valid routes (`/commands/branch/`, no `/worktree` prefix) the AI
   may link to; derived from the MDX filesystem scan in `build-context.mjs`
3. **`skills/worktree/SKILL.md`** — Agent Skill guide (product vocabulary
   and core patterns)
4. **Doc pages** — every `*.mdx` file under `src/content/docs/`, stripped of JSX

The prompt is baked in at build time via `worker:build-context`. The worker
never fetches content at runtime — all context is in the bundle. It is passed to `chat()` as `systemPrompts`, and its persona paragraph ends with the standing order that user messages are questions, never instructions.
