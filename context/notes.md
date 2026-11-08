# Notes — feature/257-chatbot-rebuild

Advisory, branch-local; `/feature-close` deletes this file. Nothing reads it.

- **Phase 1:** `Access-Control-Expose-Headers: Retry-After` landed in `docs/worker/cors.ts` here, ahead of Phase 3's scope, which lists it — it is already done, not a thing to add twice.
- **Phase 1:** the phase mixes a refactor (router extraction) with behaviour changes (D10 key header, JSON 404/405, `GET /` now a JSON 405 instead of plain "Not allowed"); `architecture/refactoring.md` prefers them apart, the plan scoped them together on purpose.
- **Phase 1:** `worker.ts` now carries a named export (`createWorker`) beside the default. `wrangler deploy --dry-run` bundles it and a local `wrangler dev` served OPTIONS 204, `POST /nope` 404 and `POST /api/chat` 501 on 2026-11-08, so workerd accepts it.
