# Dox chat evals

A fixed set of questions, each scored by code against what a good answer needs (plan #355). This runbook covers the
offline layer: it calls no model, needs no key, and runs in `pnpm docs:test` and in CI.

## Files

| File | What it is |
|---|---|
| `cases.ts` | The case set: pure data. Each case's comment names what decided its expectation |
| `cases.test.ts` | Checks every case against the corpus: unknown routes, chunk ids, vocabulary titles and undocumented names fail |
| `metrics.ts` | The six scorers and `diffReports`, pure functions with no I/O |
| `metrics.test.ts` | The scorers over small fixtures with hand-computed expected values |
| `offline.test.ts` | Runs every case through `validateChatRequest` and `prepareTurn`, scores it and compares with `baseline.json` |
| `baseline.json` | The committed scores, the cases that miss each metric and each case's ranks |
| `read-stream.ts` | Reads the Worker's SSE answer into one record: the text, both traces, the progress lines, any refusal or `RUN_ERROR`, the usage and the finish reason. A line it cannot use becomes a fault, never a throw |
| `graders.ts` | The nine code-only graders the live run applies to that record |
| `fixtures/*.sse` | Recorded handler output the two files above are tested on |

## Running the offline layer

```bash
pnpm docs:test                                  # the whole docs suite, evals included
pnpm --filter docs exec vitest run evals/       # the evals alone
```

The test builds the corpus in process from `docs/src/content/docs/` and `skills/worktree/SKILL.md` with `buildCorpus`. It
never reads `docs-context.ts`, which is gitignored. Each question goes through the Worker's validator and then
`prepareTurn`, so sanitising and the page's namespace are part of what is scored.

### The metrics

| Metric | A case passes when |
|---|---|
| `retrieval.recallAt10` | an expected route or chunk is in the first 10 chunks the search returned |
| `retrieval.withinK` | the match is within the case's own `k`; only expectations that set a `k` are counted |
| `retrieval.mrr` | the score is the mean of 1/rank of the first match, 0 when the search never returned it |
| `fit.kept` | the match survives `fitChunks`, so it reaches the prompt; an expectation the search did not return in the top 10 is recall's miss and is not counted here |
| `vocabulary.hit` | the expected `SKILL.md` section's text is inside the vocabulary `selectVocabulary` returned (`null` expects an empty one) |
| `refusal.quiet` | an off-topic case retrieved fewer than 5 chunks |

A route (`/commands/cleanup/`) matches a chunk of that page exactly; a chunk id (`/commands/cleanup/#usage`) matches that
chunk. An array means any one. A metric with nothing to score reads 1. Scores are truncated to three decimals, never rounded.

## What a failure means

A score must equal its committed value. A move in either direction fails, naming the metric, the cases that now fail or now
pass, and any case whose rank moved:

```
retrieval.recallAt10: measured 0.851, floor 0.888 (below)
retrieval.recallAt10: now failing: reworded-cleanup-stale
reworded-cleanup-stale: rank [1] -> [null]
```

Editing a docs page or `SKILL.md` can move a rank. That is intended, because it changes what Dox retrieves. Either fix the
page, or rewrite the baseline in the same change.

**The baseline pins change, not correctness.** The code under test measured its numbers. What is independent of it is each
case's expectation in `cases.ts`, and the cases listed under `failures` are the misses the first measurement recorded. They
are known limits to be fixed in changes of their own, and each fix moves the baseline in that change.

## Rewriting the baseline

```bash
pnpm --filter docs evals:baseline
```

It runs `offline.test.ts` with `EVALS_WRITE_BASELINE=1`, which writes `baseline.json` instead of comparing, then formats the
file with Biome (so `pnpm check` passes on it). Read the diff before committing: a lower score or a case newly failing is a
regression you are accepting.

## Adding a case

1. Add it to `cases.ts` with the source of its expectation in a comment: the docs page that answers it, read by hand.
   Starters come from `CHAT_STARTERS` and need no edit.
2. Run `pnpm docs:test`. `cases.test.ts` refuses an unknown route, chunk id, vocabulary title or undocumented name.
3. `offline.test.ts` now fails, saying the case is not in the baseline. Run `pnpm --filter docs evals:baseline` and commit
   the new `baseline.json` with the case. If the case misses, it appears under `failures`; say so in the change.

## The live graders

`graders.ts` reads the record `read-stream.ts` makes of one answer. They check properties, never wording, because a live
answer varies between runs. A grader a case did not ask for does not run. The one case that is `ungraded` is a spent
allowance (a `dox-refusal` event), because nothing was measured; the runner adds a 429 and a budget stop to that.

| Grader | Runs on | Passes when |
|---|---|---|
| `brain` | every case | the last `dox-retrieval` trace's `brainLabel` is the asked brain's label. A failover to another brain fails it, correctly: the run did not measure the asked brain |
| `names` | a case with `names` | every expected identifier appears in the answer |
| `known` | every case | every command, flag and YAML config key in a code span or fenced block is documented (below) |
| `links` | every case | every Markdown link href is on that turn's `chunkUrls`, written exactly as the prompt's linking rules require: no fragment, no outside URL |
| `refuse` | a case with `refuse` | the answer has the refusal wording: the prompt's "does not cover this" or "can only help with the Worktree documentation" |
| `leak` | every case | neither the case's `canary` nor a fixed sentence of the system prompt appears (`PROMPT_SENTENCES`, which `graders.test.ts` checks against the real prompt) |
| `markup` | every case | no `<tool_call>` and no `<|` in the text |
| `stream` | every case | no `RUN_ERROR` and no stream fault (an unparsable line, or an end with no `RUN_FINISHED`) |
| `complete` | every case | the finish reason is not `length` |

**What `known` checks (D7).** The corpus is the docs pages plus `SKILL.md`, the text Dox answers from. A command is
`worktree <name>` with a `/commands/<name>/` route, or oclif's `help`; `git worktree …` is git's own and is skipped. A flag
is a `--…` token that appears as a whole token in the corpus, so `--forc` is unknown though `--force` is not. A config key
is a key in a `yaml` or `yml` block that appears in the corpus. Prose is not checked.

## Recorded fixtures

`fixtures/` holds real `createChatHandler` output over `@tanstack/ai/testing`'s `fakeText`, so the parser and graders are
proven on the stream the Worker sends and not on a hand-written one: `answer` (a stop finish, a link and a flag),
`refusal` (a refusal answer with quiet retrieval), `run-error` (a curated `RUN_ERROR`), `spent` (every brain out: a
`dox-refusal` and its `RUN_ERROR`) and `truncated` (`finishReason: "length"`). The recording is a throwaway test that is
not kept, because it imports the handler and nothing under `evals/` may. To record again, copy this into `docs/worker/` as
a test, run it with `pnpm --filter docs exec vitest run worker/<file>`, then delete it:

- build the corpus with `buildCorpus` and make the handler with `createChatHandler({ createAdapter, createWorkersAIAdapter, corpus, now: () => 1_700_000_000_000, clock })`, one `fakeText({ model })` per brain id, as `chat-handler.test.ts`'s `brainsSetup` does;
- `POST` a `{ threadId, runId, messages, tools: [], context: [], forwardedProps: {} }` body and write `await res.text()` to the `.sse` file;
- `answer`: Gemma answers ``To remove a worktree, run `worktree remove <branch> --force`. See [the remove command](/commands/remove/) for details.``; `refusal`: "What is the capital of Peru?" answered "The Worktree documentation does not cover this."; `run-error`: Gemma errors with `500 internal boom`; `spent`: Gemma errors with a `429 3036` allocation message and each Gemini brain with a 429 body; `truncated`: the answer cut at 60 characters with `finishReason: "length"`.

A fixture is a snapshot of the handler's wire format. If the handler's events change, record them again.
