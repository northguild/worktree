// @vitest-environment node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCorpus } from "../worker/build-context.mjs";
import { prepareTurn, type RetrievalCorpus } from "../worker/prepare-turn";
import { validateChatRequest } from "../worker/validation";
import { CASES, type EvalCase } from "./cases";
import {
  diffReports,
  type Observation,
  type Report,
  scoreObservations,
} from "./metrics";

// The offline layer (plan #355 §4.4, D3, D4): every case goes through `validateChatRequest` and then `prepareTurn`, the
// two steps the handler runs before a model, over the corpus built in process from the docs pages and `SKILL.md` (never
// `docs-context.ts`, which is gitignored and stubbed here). The scores must equal `baseline.json`, a move in either
// direction fails, and `pnpm --filter docs evals:baseline` rewrites the file.
//
// The baseline is measured by the code under test, so it pins change, not correctness: what is independent of the code is
// each case's expectation in `cases.ts`, whose comments name the source of each one.

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const BASELINE_PATH = join(REPO, "docs/evals/baseline.json");
const REWRITE_SCRIPT = "pnpm --filter docs evals:baseline";
/** Set by the `evals:baseline` script alone, so a plain `docs:test` run never writes. */
const REWRITING = process.env.EVALS_WRITE_BASELINE === "1";

const BUILT = buildCorpus(
  join(REPO, "docs/src/content/docs"),
  readFileSync(join(REPO, "skills/worktree/SKILL.md"), "utf8"),
);
const CORPUS: RetrievalCorpus = {
  chunks: BUILT.chunks,
  searchIndexJson: BUILT.indexJson,
  vocabulary: BUILT.vocabulary,
};
const SECTION_TEXT = new Map(BUILT.vocabulary.map((s) => [s.title, s.text]));

/** The request the client sends for the case; `validateChatRequest` sanitises it as it does a reader's. */
function envelope(c: EvalCase) {
  return {
    threadId: `eval-${c.id}`,
    runId: `eval-${c.id}`,
    messages: [
      ...(c.history ?? []),
      { role: "user" as const, content: c.question },
    ].map((message, i) => ({ id: `m${i}`, ...message })),
    ...(c.page === undefined
      ? {}
      : { forwardedProps: { pageContext: c.page } }),
  };
}

function observe(c: EvalCase): Observation {
  const validated = validateChatRequest(envelope(c));
  if (!validated.ok) {
    throw new Error(
      `${c.id}: the validator refused the case: ${validated.error}`,
    );
  }
  const turn = prepareTurn(
    validated.value.messages,
    validated.value.pageContext,
    CORPUS,
  );
  const sectionText =
    c.vocabulary === undefined || c.vocabulary === null
      ? c.vocabulary
      : SECTION_TEXT.get(c.vocabulary);
  if (sectionText === undefined && c.vocabulary !== undefined) {
    throw new Error(`${c.id}: no vocabulary section titled ${c.vocabulary}`);
  }
  return {
    id: c.id,
    searched: turn.searched,
    kept: turn.kept,
    vocabulary: turn.vocabulary,
    expect: {
      ...(c.chunks === undefined ? {} : { chunks: c.chunks }),
      ...(sectionText === undefined ? {} : { vocabularyText: sectionText }),
      ...(c.kind === "offTopic" ? { quiet: true } : {}),
    },
  };
}

describe("the offline evals", () => {
  const measured: Report = scoreObservations(CASES.map(observe));

  it(
    REWRITING
      ? "rewrites baseline.json"
      : "scores exactly what baseline.json records",
    () => {
      if (REWRITING) {
        writeFileSync(BASELINE_PATH, `${JSON.stringify(measured, null, 2)}\n`);
        return;
      }
      const baseline = JSON.parse(
        readFileSync(BASELINE_PATH, "utf8"),
      ) as Report;
      const moved = diffReports(baseline, measured);
      if (moved.length > 0) {
        expect.fail(
          [
            "The offline eval scores moved from baseline.json:",
            ...moved.map((line) => `  ${line}`),
            `If the move is intended, rewrite the baseline in the same change: ${REWRITE_SCRIPT}`,
          ].join("\n"),
        );
      }
    },
  );

  it("scores every case that states a retrieval expectation", () => {
    const expected = CASES.filter((c) => c.chunks !== undefined).map(
      (c) => c.id,
    );
    expect(Object.keys(measured.ranks).sort()).toEqual([...expected].sort());
  });
});
