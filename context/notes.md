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
