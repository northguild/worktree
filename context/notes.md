# Notes — feature/257-chatbot-rebuild

Advisory, branch-local; `/feature-close` deletes this file. Nothing reads it.

- **Phase 1:** `Access-Control-Expose-Headers: Retry-After` landed in `docs/worker/cors.ts` here, ahead of Phase 3's scope, which lists it — it is already done, not a thing to add twice.
- **Phase 1:** the phase mixes a refactor (router extraction) with behaviour changes (D10 key header, JSON 404/405, `GET /` now a JSON 405 instead of plain "Not allowed"); `architecture/refactoring.md` prefers them apart, the plan scoped them together on purpose.
- **Phase 1:** `worker.ts` now carries a named export (`createWorker`) beside the default. `wrangler deploy --dry-run` bundles it and a local `wrangler dev` served OPTIONS 204, `POST /nope` 404 and `POST /api/chat` 501 on 2026-11-08, so workerd accepts it.
- **Phase 2:** two refusal texts are the coder's own wording, asserted by tests but named nowhere in the plan: "Unknown model." and "Too many messages — limit 50.". Envelope failures otherwise surface zod's default text (e.g. a missing `threadId`), which §4.2's "reader-facing reason" would want curated; only a hand-made client sees them.
- **Phase 2:** `threadId`/`runId` are required and capped at 200 characters — the cap is the coder's addition beyond D7 and no test asserts it. P4's contract test (R11) is where the real `useChat` body exercises the envelope.
- **Phase 2:** `zod` is pinned exactly (`4.6.7`, matching the root) among caret ranges in `docs/package.json`; no decision covers that choice (§9 Q15 is about `@tanstack/ai*` only).
- **Phase 2:** raw `content` has no size bound before sanitising (`z.string()` with no `.max()`), so NFC and the regex run over whatever arrives; a request-body size bound belongs to P3's pipeline (R4, CPU time).
- **Phase 2:** `validation.test.ts` writes U+200B literally (invisible in review); `chat-sanitize.test.ts` builds it with `at(0x200b)`, which reads better.
- **Phase 3:** `reasoning` is passed as `{ level: "low", summary: false }`, not D4's literal `"low"`: `chat()` normalises the string to `summary: true` (`@tanstack/ai` 1.2.0 `src/reasoning.ts:103`), which turns `includeThoughts` on — against D4's "thinking text is not requested".
- **Phase 3:** a bad key is a Google 400 `API_KEY_INVALID`, mapped to `misconfigured` (non-retryable) — a row §4.2's table does not have. The adapter's `RUN_ERROR` carries no HTTP status (`ai-gemini` `text.ts:519-538`), so `error-mapping.ts` parses Google's JSON out of the message.
- **Phase 3:** the tsup `external` for the two TanStack packages is what keeps workerd from hanging (seen under `wrangler dev --local`); `worker:bundle-check` does not execute the Worker, so nothing in CI would catch it coming back.
- **Phase 3 (not verified):** a client abort that surfaces as an adapter `RUN_ERROR` would be logged as `failed` at `error` level; `tooling/observability.md` reserves `error` for paging. Consider `warn`, or no log, when the controller is already aborted.
- **Phase 3:** `request.json()` is still unbounded — the body-size bound phase 2's note pointed at P3's pipeline (R4) was not added.
- **Phase 3:** untested: the key check before JSON parse (§4.2 steps 2→3), and D19's standing-order paragraph in the system prompt. Style: `chat-handler.ts:172` uses `as { threadId; runId }` (the clean fix is `validateChatRequest` returning them), `:89` `as StreamChunk` where `satisfies` would check, and `as never` casts in the tests look unnecessary.
- **Phase 3:** no recorded stream fixture exists, though §4.1 says P3 records one for P4's tests to replay.
