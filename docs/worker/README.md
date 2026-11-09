# Cloudflare Worker: Dox chat

This worker runs on Cloudflare Workers and answers chat requests from the docs
static site, keeping `GEMINI_API_KEY` out of the browser. It answers with the first of five "brains" that is
available: two Workers AI models, then three Gemini models (see [Brains](#brains)).

## How it fits together

```
Browser (northguild.dev/worktree/)  →  POST https://<worker>.workers.dev/api/chat
                              ↓
                        Cloudflare Worker  (docs/worker/)
                          1. rate limit        → 429 + Retry-After
                          2. a brain to ask    → else 500 "The assistant is not configured."
                             (a GEMINI_API_KEY, or the AI binding: brains.ts, configuredBrains)
                          3. JSON, then validate (validation.ts) → 400
                          3a. the ledger (usage.ts): read today's counts from KV (if bound);
                              a visitor at their cap of 5 a UTC day → 429 { error, retryable, resetsAt }
                          4. retrieval: search the question in the bundled corpus,
                             keep what fits, build the system prompt (retrieval/)  → 500 if the corpus cannot be searched
                          5. the stream opens: RUN_STARTED, then the walk past the brains (brains.ts, walkBrains):
                               for each candidate the ledger has not marked out, in order, chat()  (@tanstack/ai) over its adapter
                                 – createCloudflareText over env.AI for a Workers AI brain
                                 – createGeminiChat for a Gemini brain
                               and a CUSTOM dox-progress line for each step
                               ↓                       ↓
                   first content from a brain     every brain out → CUSTOM dox-refusal (429, resetsAt)
                   → record it in the ledger,       then a RUN_ERROR "allowance_spent"
                     CUSTOM dox-usage (the counts),
                     its stream is the answer
                              ↓
                        error-mapping.ts wraps the stream, so a failure is a curated RUN_ERROR;
                        withRetrievalTrace adds the CUSTOM dox-retrieval events (the last names the brain)
                              ↓
                        toServerSentEventsResponse → AG-UI events over SSE, back to the browser
```

`POST /` still speaks the legacy protocol (Gemini's own SSE piped through) for the live site's current client. A second route,
`GET /api/brains`, answers the ledger's counts and needs no key.

## Routes

`worker.ts` is a router. Every route answers with CORS headers: an allowed origin is reflected, any other gets `https://northguild.dev`.

| Request | Answer |
|---|---|
| `OPTIONS` on any path | 204 with CORS headers (`Access-Control-Allow-Methods: GET, POST, OPTIONS`; `Access-Control-Expose-Headers: Retry-After` included) |
| `POST /` | the **legacy** protocol (`legacy-handler.ts`): the Gemini SSE stream piped through, with its own copy of the old model list (`gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-3-flash-preview`) and caps (20,000 characters a message, 50 messages). Frozen: the live site's current client speaks it, and it is retired only after a stable release has deployed the new client |
| `POST /api/chat` | the new protocol (`chat-handler.ts`). The body is the AG-UI shape `useChat` sends (`threadId`, `runId`, `messages`, optional `forwardedProps.brain`, a brain id, optional `forwardedProps.model`, #306's model, still accepted and treated as a brain id, and optional `forwardedProps.pageContext`, the route of the page the reader came from, e.g. `/commands/branch/`, which only biases the search), validated by `validation.ts`; only `{ role, content }` pairs reach `chat()`. With no brain named the Worker walks its brains in order (Automatic). The answer is AG-UI events over SSE (`RUN_STARTED`, a `CUSTOM` event named `dox-retrieval` carrying what was retrieved, any `CUSTOM` `dox-progress` lines from the walk, a `CUSTOM` `dox-usage` carrying `BrainsInfo` once a brain has accepted the question (only with `DOX_USAGE` bound), `TEXT_MESSAGE_*`, the `dox-retrieval` event again with timings and the brain that answered, `RUN_FINISHED`; a failed run gets at most the first `dox-retrieval`). Before the stream opens a failure is an HTTP status with `{ error, retryable }`: 429 with `Retry-After`, 429 `{ error, retryable: false, resetsAt }` when the visitor has asked their 5 questions of the UTC day (see [The usage ledger](#the-usage-ledger)), 500 when there is neither a key nor the `AI` binding, 500 `{ error, retryable: true }` when the corpus cannot be searched (no model is called), 400 for bad JSON, a bad request or a conversation over the cap. A refusal the history causes rather than the new question — more than 50 messages, an earlier turn over 20,000 characters, or over 100,000 together — says "Conversation is too long. Start a new chat.", since the client replays the whole transcript and every later question would fail the same way. Once the stream is open, a failure is one `RUN_ERROR` event with our own text and a `code` (see below) |
| `GET /api/brains` | the brains this deployment offers, with what is left of each, as `BrainsInfo` (`brains-payload.ts`, `lib/chat-types.ts`): `brains[]` (`id`, `label`, `provider`, `remaining`, `limit`, `state` `ok`/`spent`/`unavailable`), `providers[]` (each configured provider once, with `resetsAt`: Workers AI 00:00 UTC, Gemini midnight `America/Los_Angeles`), `activeBrainId` (the brain an unpicked question would be asked first, or `null`) and `visitor` (`used`, `limit` 5, `remaining`, `resetsAt` the next UTC midnight). Always `Cache-Control: private, no-store`: the body holds one visitor's own counts, keyed on a hash of their address. Without `DOX_USAGE` it answers every brain with its full limit, nothing used, the first brain active. It spends a `brains:<client>` rate-limit bucket (same limits as chat) and answers 429 with `Retry-After` past it. Additive: the page does not read it until the control bar lands |
| any other method on a route | 405 `{ error, retryable: false }`, with `Allow` naming the method the route takes (`POST` for `/` and `/api/chat`, `GET` for `/api/brains`) |
| any other path | 404 `{ error, retryable: false }` |

Both `POST` routes spend one `chat:<client>` rate-limit bucket (`rate-limit.ts`), so using both cannot double a client's allowance. The Gemini key is sent in the `x-goog-api-key` header on every upstream call, never in the URL.

## Brains

`brains.ts` and `src/chat/lib/chat-constants.ts` (`BRAINS`), ported from gmt's `apps/dox` (plan #309 D9). In order:

| Brain id | Model | Provider | Needs |
|---|---|---|---|
| `cf-gemma-4-26b` | `@cf/google/gemma-4-26b-a4b-it` | Workers AI | the `AI` binding |
| `cf-glm-4.7-flash` | `@cf/zai-org/glm-4.7-flash` | Workers AI | the `AI` binding |
| `gemini-3.5-flash-lite` | same | Gemini | `GEMINI_API_KEY` |
| `gemini-3.6-flash` | same | Gemini | `GEMINI_API_KEY` |
| `gemini-3.5-flash` | same | Gemini | `GEMINI_API_KEY` |

- **Only configured brains are offered.** Without the binding the list is the three Gemini brains; without the key, the two
  Workers AI brains; with neither, `POST /api/chat` answers 500 "The assistant is not configured.". A brain the reader
  asked for that is not on the list is no request.
- **Order.** The brain named in `forwardedProps.brain` (or #306's `forwardedProps.model`) goes first, then the rest in the
  order above. No name is Automatic.
- **The walk happens before any answer text streams.** Each brain gets 15 s (Gemini) or 20 s (Workers AI) to produce its
  first content. A brain that is busy (HTTP 503 or 529, or a Workers AI 429 that is not the allocation), slow, spent
  (a Gemini 429, or a Workers AI allocation error) or unavailable (400 or 404, or a Workers AI 403) is passed over, and a
  `CUSTOM` event named `dox-progress` with `{ text }` says so: "Asking Gemma 4 26B…", then "Gemma 4 26B is busy — trying the
  next model…", "… is taking too long — …" or "… is out for today — …". Each pass-over is logged (`chat.brain_skipped`).
  Nothing is retried within a brain: the next brain is the retry, and the adapter's own retries are switched off
  (`withoutRetries`: a failed run is marked `x-should-retry: false`).
- **Workers AI's allowance is one pool.** The 10,000 free Neurons a day belong to the account, not the model, so an
  allocation error (Cloudflare codes 3036 and 4006) retires both Workers AI brains at once. Code 3040 ("no more data centers")
  is a capacity blip and retires nothing. Gemini's allowance is per model.
- **Every brain out** ends the stream with a `CUSTOM` event named `dox-refusal`, `{ status: 429, payload: { error,
  retryable: false, resetsAt } }`, where `resetsAt` is the soonest refill (Workers AI at 00:00 UTC, Gemini at midnight
  `America/Los_Angeles`), then a `RUN_ERROR` with code `allowance_spent` for a client that ignores `CUSTOM` events. If the
  walk ended on busy or slow brains only, nobody's allowance is gone, and it ends in the curated `rate_limited`,
  `upstream_unavailable` or `upstream_slow` error instead. A failure that says nothing about the brain (a Gemini 500, a bad
  key) ends the walk at once.
- **Settings.** Gemini runs with `reasoning: { level: "low", summary: false }`. Workers AI brains run with thinking off and
  2,048 output tokens, passed as `modelOptions: { max_tokens: 2048, chat_template_kwargs: { enable_thinking: false } }`.
  `@tanstack/ai-cloudflare` 1.2.0 sets neither by itself, and `chat({ maxTokens })` is not read: `modelOptions` is spread
  into the request body untouched (`brains.test.ts` asserts what reaches `env.AI.run`). No `reasoning` is given to a
  Workers AI brain, because the adapter would send `reasoning_effort: null`, which gmt measured not to turn thinking off.
  gmt measured thinking on at 4-21 s a question against 1.6 s off.
- **The ledger feeds the choice.** A brain the usage ledger has marked out for today is left off the candidate list, so it is
  neither asked nor mentioned in a progress line; a reader's pick that is marked out is no pick. When the walk finds a brain
  spent or unavailable it marks it (`markBrain`), and an exhausted Workers AI allocation marks both Workers AI brains. See
  [The usage ledger](#the-usage-ledger).
- **The `AI` binding is remote in dev.** `wrangler.toml` states `[ai] binding = "AI"` with `remote = true`: models never run
  locally, so `wrangler dev` spends the account's real 10,000-Neuron daily allocation exactly as production does. Staying on
  the Workers Free plan is what keeps it free: there an exhausted allocation fails with an error, where on Workers Paid it
  bills.
- **`POST /` is not part of this.** The legacy route keeps its own model list and speaks to Gemini only.

## The usage ledger

`usage.ts`, `brains-payload.ts` and `src/chat/lib/day-clock.ts`, ported from gmt's `apps/dox` (plan #309 D10). A best-effort
count in Workers KV of what is spent today, so the Worker can pick a brain that probably has room and tell the reader what is
left. **It is advisory and optional.** The provider's own refusal is the only real gate, and KV is eventually consistent, so
a count that lags by one changes a digit and lets nothing through that a provider would refuse.

| Key | Holds | Day | TTL |
|---|---|---|---|
| `model:<day>:<brain id>` | questions a brain has accepted | the brain's provider's: Gemini `America/Los_Angeles`, Workers AI UTC | seconds to that midnight + 300, never below 60 |
| `state:<day>:<brain id>` | `spent` or `unavailable`, written when the walk finds a brain out | same | same |
| `visitor:<day>:<hash>` | questions one visitor has asked | UTC | seconds to UTC midnight + 300, never below 60 |

`<hash>` is the first 16 hex characters of SHA-256 of `dox:<client id>` (the `CF-Connecting-IP`, else the first
`X-Forwarded-For`, else `unknown`): the ledger can tell two visitors apart for a day and cannot name either. The day, midnight
and TTL come from `@northguild/gmt` (`day-clock.ts`), so a 23- or 25-hour day is right.

- **Reads happen before the brain choice; the write happens once a brain has accepted the question.** The visitor cap
  (`VISITOR_DAILY_MAX`, 5 a UTC day, gmt's number, kept until plan #309 §9 Q4 answers) is checked right after validation,
  before retrieval and before any brain is asked. There is no dev-key bypass (D11).
- **A missing or failing store never fails a chat.** With no `DOX_USAGE` binding, every brain reads as usable with nothing
  spent, the first brain is asked, and no `dox-usage` event is sent. A read that throws reads as no record; a write that
  throws is swallowed. Each is one structured `console.warn` line (`usage.read_failed`, `usage.write_failed` or
  `usage.mark_failed`, with the key, the error's message and, on a chat request, its `threadId` and `runId`). A burst can lose an increment: accepted.
- **Cloudflare's KV minimum.** `expirationTtl` below 60 seconds is refused ("The minimum value is 60", KV `put()` reference;
  expiration targets under 60 s in the future are unsupported for both options). The 300 s margin means the floor never binds
  today; it is there so a TTL can never be one KV refuses.
- **The Free plan's limits matter.** Reading the ledger is `2 × brains + 1` reads (a count and a state for each brain, and the
  visitor's), done for every question and every `GET /api/brains`; recording an answer is 2 reads and 2 writes (each counter is
  read, then written: a brain's count and the visitor's), and 1 more write for each brain marked out. KV Free allows 1,000 writes and 100,000 reads a day, shared by every Worker
  on the account (plan #309 R2).

### Adding the binding

`DOX_USAGE` is declared optional on `Env`, so the Worker runs, and is tested, with and without it. **Nothing binds it yet**:
the namespace ids are created by the maintainer (plan #309 §9 Q3), and `wrangler.toml` carries no `[[kv_namespaces]]` block
until they exist. A made-up id would make `wrangler deploy` fail. With the Cloudflare credentials in the shell:

```bash
wrangler kv namespace create DOX_USAGE
wrangler kv namespace create DOX_USAGE --preview
```

Each prints an id. Then add this block to `docs/worker/wrangler.toml`, with the first command's id as `id` and the second's as
`preview_id` (the ids are not secrets; gmt commits its own):

```toml
[[kv_namespaces]]
binding = "DOX_USAGE"
id = "<id from the first command>"
preview_id = "<id from the second command, the --preview one>"
remote = true
```

`remote = true` is stated, as it is for `[ai]`, because `worker:dev` runs `wrangler dev --local`, and a local `wrangler dev`
defaults to a simulated local KV that ignores both ids (Cloudflare's KV docs: "Wrangler defaults to using a local version of KV
... you can set `"remote": true` in the KV binding configuration"; wrangler 4.152.0's `config-schema.json` describes
`kv_namespaces[].remote` as "Whether the KV namespace should be remote or not in local development"). With it, `wrangler dev`
reads and writes the `preview_id` namespace on Cloudflare, so a local question spends real KV writes (R2). Leave the line out to
develop against the simulated local KV instead. Until the block is added, `GET /api/brains` answers full limits and chat never records.

### Errors inside the stream

Provider error text never reaches the reader. `error-mapping.ts` reads the HTTP status inside the failure and replaces the event. Gemini's adapter puts Google's JSON body in the `RUN_ERROR`'s `message` and sets no `code`; the Workers AI adapter's message is the HTTP status, a space and Cloudflare's text, and its `code` is Cloudflare's own number:

| Upstream | `code` | Retryable |
|---|---|---|
| 401, 403, or an invalid API key | `misconfigured` | no |
| 429 whose body says "per day", or a Workers AI allocation error (3036, 4006) | `rate_limited_daily` | yes |
| any other 429 | `rate_limited` | yes |
| every brain busy or failing with a 5xx or 529 | `upstream_unavailable` | yes |
| no brain started in time (`brains_timed_out`) | `upstream_slow` | yes |
| every brain out for the day (after the refusal event) | `allowance_spent` | no |
| any other API error | `upstream_unavailable` | yes |
| anything else | `failed` | no |

Each mapped failure is logged once as a JSON line (`chat.failed`, with the code, the brain last asked, thread and run ids) and never with the key or any message text. `retry` is left unset so a 429 is not repeated against the quota.

Gemini is called with `reasoning: { level: "low", summary: false }`: the bare string `"low"` is normalised by `@tanstack/ai` to `summary: true`, which asks Gemini for thought summaries.

The static bundle bakes in `PUBLIC_GEMINI_WORKER_URL` at build time.
That variable is set as a GitHub repo **variable** (not a secret) and injected
by the `docs-deploy.yml` workflow.

## Commands reference

All commands are run from the repo root with `pnpm --filter docs run <command>`.

### One-time setup

| Command | What it does | When to run |
|---|---|---|
| `worker:setup-secret` | Stores `GEMINI_API_KEY` as an encrypted Cloudflare secret. The Workers AI brains need no secret: the `AI` binding in `wrangler.toml` is all they use | Once per worker, or when rotating the key |
| `worker:setup-dev-vars` | Writes `docs/worker/.dev.vars` from `docs/.env.local` so `wrangler dev` can read the key | Once per machine, or after changing `.env.local` |

### Normal development

| Command | What it does | When to run |
|---|---|---|
| `worker:dev` | Runs the **already-built** worker locally at `http://localhost:8787` | After `worker:build`, when you want to test against the local worker |
| `worker:build:watch` | Rebuilds the worker bundle on every file save | In a separate terminal during active worker development |
| `worker:build-context` | Scans MDX files + `skills/worktree/SKILL.md` → regenerates `worker/docs-context.ts` (the corpus: chunks, serialised MiniSearch index, vocabulary, counts, plus `LEGACY_PROMPT`, the frozen `POST /` route's whole-docs prompt) **and** `src/chat/docs-routes.generated.ts` (valid link list, corpus counts) | After adding/editing any docs page or the skill guide |
| `worker:build` | Runs `worker:build-context` then bundles `worker.ts` via tsup | Before `worker:dev`, or manually before deploying |

> **Tip:** Use `dev:local:watch` (see [Local development](#local-development)) to run the full stack in one command instead of managing terminals manually.

### Testing

| Command | What it does | When to run |
|---|---|---|
| `worker:test` | Runs every test under `docs/worker/` (the router, both handlers, the validator, the retrieval modules, the error mapping, the rate limiter) with vitest | Before deploying, or in CI |
| `worker:bundle-check` | Builds the worker, then `wrangler deploy --dry-run`: proves it still bundles for Cloudflare. Needs no credentials and sends nothing | After changing a dependency or an import; CI runs it |

### Deployment

| Command | What it does | When to run |
|---|---|---|
| `worker:deploy` | Runs `worker:test` → `worker:build` → `wrangler deploy` | When you want to push a new version of the worker to Cloudflare |

---

## Local development

**Prerequisite:** `docs/.env.local` must contain your Gemini API key.
Copy `docs/.env.local.example` → `docs/.env.local` and fill it in. The first two brains use the `AI` binding, which is remote (see [Brains](#brains)): a question asked against `wrangler dev`
spends the account's real daily allocation. Leave the binding out of `wrangler.toml` to run on Gemini alone.

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

Builds the worker (regenerates `docs-context.ts` from MDX and the skill guide, then bundles via tsup)
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
deployed worker always has up-to-date docs content in its corpus.

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
reach the URL can spend the key's daily Gemini quota and the account's daily Workers AI allocation. The visible effect would be
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
`main` that change `docs/worker/**`, `docs/src/chat/lib/**` (the contract the worker bundles), or
`docs/package.json` or `pnpm-lock.yaml` (the dependencies it bundles, so a bump alone redeploys it). A manual "Run workflow" deploys only from `main`: a run from any other
branch deploys nothing, and GitHub refuses it at the `cloudflare-production` environment even if that branch's
copy of the workflow drops the guard. Requires two secrets in that GitHub **environment** (Settings →
Environments), whose deployment branches are limited to `main`:

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | CF dashboard → My Profile → API Tokens → *Edit Cloudflare Workers* template |
| `CLOUDFLARE_ACCOUNT_ID` | `wrangler whoami` or CF dashboard right sidebar |

## Bundle size and dependencies

The worker depends on `@tanstack/ai`, `@tanstack/ai-gemini` and `@tanstack/ai-cloudflare` (and `zod`, `@northguild/gmt`, `minisearch` 7.2.0).
`tsup` bundles everything except the three TanStack packages, which `wrangler deploy` then
bundles itself: only wrangler resolves the packages' `workerd` export conditions, and the
Node build that tsup would inline hung under `wrangler dev --local`. `compatibility_flags`
holds `nodejs_compat` (the packages import `node:events` and `node:process`) and
`enable_request_signal` (a closed tab aborts the Gemini call).
`wrangler deploy --dry-run` measured 3,931 KiB uploaded, 761 KiB gzipped, on 2026-11-08 (with the retrieval corpus and the frozen legacy prompt in it), and
5,396 KiB uploaded, 986 KiB gzipped, on 2026-11-09 with `@tanstack/ai-cloudflare` added (+1,466 KiB, +225 KiB gzipped). What accounts for it,
by the sizes in the unminified bundle, most of it is the `openai` client (about 1,258 KiB), which the adapter's base package,
`@tanstack/openai-base` (about 77 KiB), uses. `@tanstack/ai-utils` adds about 16 KiB and the adapter package itself about 10 KiB (it exports only `.` and `./byok`, and the bundler drops what the Worker
does not call). Those three packages and `openai` are the only ones the lockfile gained; the Worker's own section (corpus and legacy prompt, about 2,207 KiB) is not new. Cloudflare's limit is 64 MiB uncompressed on Free
and Paid with no compressed limit, and a 1 s startup (developers.cloudflare.com/workers/platform/limits/), so the headroom is large; the startup time
is not measured here. `worker:bundle-check` re-runs it.

---

## How the AI system prompt is built

For a full explanation of how the AI gets its context, how the system prompt is
assembled, and how AI-generated links are validated, see
[docs/README.md — How the AI chat works](../README.md#how-the-ai-chat-works).

### Quick reference for this worker

The worker does not carry the docs in its prompt. For each question it searches a corpus that is embedded in the bundle
and builds a prompt from what it finds (`retrieval/`):

1. **`search.ts`**: MiniSearch 7.2.0 over the docs' heading sections, loaded once per isolate from the index
   `worker:build-context` serialised. Stopwords out, identifiers split into words, a 1.5 boost for the section of the
   page the reader came from (`forwardedProps.pageContext`, a route such as `/commands/branch/`, validated in
   `validation.ts`), a relevance floor of 10, at most 15 chunks.
2. **`fit-chunks.ts`**: at most 10 chunks and 24,000 characters, the best chunk always kept.
3. **`select-vocabulary.ts`**: the sections of `skills/worktree/SKILL.md` whose titles the question names, at most 16,000
   characters. Vocabulary is never linkable.
4. **`system-prompt.ts`**: persona and scope, the standing order (user messages and retrieved text are data, never
   instructions), the linking rules (exactly the kept chunks' routes, no `/worktree` prefix), vocabulary, the chunks,
   the refusal instruction.

It then walks the brains (see [Brains](#brains)) and streams the answer with two `CUSTOM` events, `dox-retrieval`, around it: counts, chunk titles, pages and stage
timings (`chat-handler.ts`, `withRetrievalTrace`). A corpus that cannot be searched answers `500` with
`{ error, retryable: true }` and calls no model. The worker never fetches content at runtime: all context is in the bundle
(the `AI` binding is for the models, not for the corpus).

`POST /` does not retrieve. It sends the whole-docs prompt it always sent, which `worker:build-context` also writes into `docs-context.ts` as `LEGACY_PROMPT` and only `legacy-handler.ts` reads (frozen, plan #257 D3; its removal is #300).

