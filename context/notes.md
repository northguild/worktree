# Notes

Branch-local observations from the gates of #355 (dox-chat-evals). Read by nothing; `/feature-close` deletes this file.

## Phase 1 (Gate 2, non-blocking)

- `docs/worker/prepare-turn.test.ts`: the `turn` helper is a module-level arrow function (`typescript/rules.md` prefers a `function` declaration), and its `pageContext` parameter is never passed.
- `prepare-turn.test.ts`: the 24,000-character check sums `kept.slice(1)` only, looser than `fitChunks`, which counts the first chunk whenever a second is kept.
- `prepare-turn.test.ts`: `text as string` assertions in the `it.each` cases could be avoided with tuples or `$text`.
- `prepare-turn.test.ts` never passes a `pageContext`; the namespace pass-through is covered only through `chat-handler.test.ts`.
- `docs/worker/chat-handler.ts` header step 7 could name `prepareTurn`; it is still accurate.

## Phase 2 (Gate 2, non-blocking)

- `docs/evals/cases.ts`: two canaries can never fire, because neither appears in its question (`injection-ignore-instructions`, `injection-print-instructions`); worth settling before Phase 4's `leak` grader.
- `cases.ts`: `injection-outside-link` asks for `ZQ7-CANARY-LINK` but its canary is `zq7-canary-link`; the grader must be case-insensitive or the two made to match.
- `docs/evals/cases.test.ts`: the names check is a plain substring match, so `copy` and fragments like `--a` pass; a code-span or word-boundary match would make it bite.
- D8's erasable-syntax rule is not enforced until Phase 5's runner loads `cases.ts`; `erasableSyntaxOnly` in the docs tsconfig would pin it.
- Sources are stated once per group of cases, not per case; the env-files starter's vocabulary is chosen from a section's first paragraph, not its heading (`SKILL.md:63`).
- Naming: single-letter variables, the non-verb function names `slug` and `problems`, `SIGNED`; `cases.ts:143` is a long comment line.

## Phase 3 (Gate 2, non-blocking)

- `docs/evals/metrics.ts`: a metric with nothing to score reads 1, where gmt throws (`apps/dox/evals/metrics.ts:156`); a future case set could score a vacuous 1.
- `metrics.ts`: MRR counts every expectation and recall is per case; gmt counts the first expectation per case. Identical today, since every case has one expectation. Routes match exactly here and by prefix in gmt.
- `docs/evals/offline.test.ts`: `JSON.parse(...) as Report` is a type assertion against `typescript/rules.md`.
- `docs/evals/README.md` "Adding a case" step 3 says the test fails naming a case missing from the baseline; true only for cases with `chunks`.
- The gmt source is cited as `evals/metrics.ts`; it is `apps/dox/evals/metrics.ts` at fccce75 (also in plan §8).

## Phase 4 (Gate 2, non-blocking)

- `docs/evals/README.md` graders table: the `markup` row names `<tool_call>` only (the code also catches `</tool_call>`); the `refuse` row is narrower than `graders.ts`'s regex, which accepts "doesn't mention …" and could pass a non-refusal; the `links` row says "no outside URL" though only inline links are read (autolinks, bare URLs and reference links pass).
- `docs/evals/graders.ts`: `known` does not read `~~~` fences; canary matching is case-sensitive while prompt sentences are not.
- Unpinned rules: the usage sum and single-object form, the top-level `finishReason` fallback, `yml` and `- key:` YAML, image and titled links (`read-stream.ts`, `graders.ts`).
- `docs/evals/read-stream.ts`: the `TRACE` and `REFUSAL` schemas repeat `RetrievalTraceData` and `RefusalData` rather than deriving them; test files use module-level arrow functions.
- The README's recording recipe leaves out `startTimeoutMs`, `log` and the env the recorder used; the throwaway recorder is not in the repository.

## Phase 5 (Gate 2, non-blocking)

- `docs/evals/run-live.ts` has no test seam: the stale-corpus exit 2, the brain-not-offered exit 2, the no-answer and lost-connection stops and the exit-code order are proven by hand only.
- No test checks that every Workers AI brain in `BRAINS` has a `NEURONS_PER_MILLION` entry; a changed model id would cost every answer at 350, flagged "unmeasured".
- `docs/evals/report.test.ts`: the written-file no-text test runs on hand-made cases that never held text, so it cannot fail; going through `caseReport` then `writeReport` would cover the path.
- A Gemini-cap stop exits 0 with cases ungraded (as gmt), against the letter of D11's exit 3.
- A malformed committed report or a failing `formatWithBiome` still exits 1, the regression code.
- Unreached cases are not printed after a no-answer stop; under `--brains all` a budget stop skips the remaining brains.
- `[env.evals]` leaves `preview_urls` unset; `preview_urls = false` would rule out a preview URL on a mistaken deploy.
- The top-level `wrangler deploy` (bundle-check, `worker-deploy.yml`) now warns that several environments exist; `--env=""` would silence it.
- `report.ts:69`, `:73` and `report.test.ts:253` use type assertions against `typescript/rules.md`.
- GLM's output rate is 36,400 here (D10, Cloudflare's page as read 2026-11-24) and 36,364 in gmt.
