// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAT_STARTERS } from "../src/chat/lib/chat-starters";
import { buildCorpus } from "./build-context.mjs";
import { prepareTurn, type RetrievalCorpus } from "./prepare-turn";
import {
  MAX_PROMPT_CHUNK_CHARS,
  MAX_PROMPT_CHUNKS,
} from "./retrieval/fit-chunks";

// Expected values (plan #355 §8): each starter's route is the starter's own `route` in `chat-starters.ts`; the limits
// are `fitChunks`'s documented caps (10 chunks, 24,000 characters, the first chunk always kept); the linking list is
// what `system-prompt.ts` says it is ("exactly the kept chunks' pages"); and the Peru question is off-topic, so the
// corpus has nothing for it (`search.test.ts` asserts the same of its unrelated questions), which the prompt says in
// the words `system-prompt.ts` writes for an empty list.

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..");
const BUILT = buildCorpus(
  join(REPO, "docs/src/content/docs"),
  readFileSync(join(REPO, "skills/worktree/SKILL.md"), "utf8"),
);
const CORPUS: RetrievalCorpus = {
  chunks: BUILT.chunks,
  searchIndexJson: BUILT.indexJson,
  vocabulary: BUILT.vocabulary,
};
const turn = (question: string, pageContext?: string) =>
  prepareTurn([{ content: question }], pageContext, CORPUS);

/** The routes the prompt's linking list names: the `- /route` lines under "Linking rules". */
function linkingList(prompt: string): string[] {
  const rules = prompt.split("## Linking rules")[1]?.split("\n## ")[0] ?? "";
  return rules
    .split("\n")
    .filter((line) => line.startsWith("- /"))
    .map((line) => line.slice(2));
}

describe("prepareTurn", () => {
  it.each(
    CHAT_STARTERS.map((s) => [s.text, s.route]),
  )("keeps the starter's own page for %s", (text, route) => {
    expect(turn(text as string).kept.map((c) => c.url)).toContain(route);
  });

  it("reads the last message alone", () => {
    const starter = CHAT_STARTERS[0];
    const result = prepareTurn(
      [
        { content: "What is the capital of Peru?" },
        { content: starter?.text ?? "" },
      ],
      undefined,
      CORPUS,
    );

    expect(result.question).toBe(starter?.text);
    expect(result.kept.map((c) => c.url)).toContain(starter?.route);
  });

  it.each(
    CHAT_STARTERS.map((s) => [s.text]),
  )("keeps an ordered subset of what was searched, within the caps, for %s", (text) => {
    const { searched, kept } = turn(text as string);

    // An ordered subsequence: walk `searched` once, matching each kept chunk in turn.
    let at = 0;
    for (const chunk of kept) {
      const found = searched.indexOf(chunk, at);
      expect(found).toBeGreaterThanOrEqual(at);
      at = found + 1;
    }
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(MAX_PROMPT_CHUNKS);
    const rest = kept.slice(1);
    expect(
      rest.reduce((n, c) => n + c.title.length + c.text.length, 0),
    ).toBeLessThanOrEqual(MAX_PROMPT_CHUNK_CHARS);
    expect(kept[0]).toBe(searched[0]);
  });

  it.each(
    CHAT_STARTERS.map((s) => [s.text]),
  )("lists in the prompt the kept chunks' routes, once each, for %s", (text) => {
    const { kept, systemPrompt } = turn(text as string);
    const routes = [...new Set(kept.map((c) => c.url))];

    expect(linkingList(systemPrompt)).toEqual(routes);
  });

  it("finds nothing for an off-topic question and tells the prompt not to link", () => {
    const { searched, kept, systemPrompt } = turn(
      "What is the capital of Peru?",
    );

    expect(searched).toEqual([]);
    expect(kept).toEqual([]);
    expect(systemPrompt).toContain(
      "(none: this question retrieved no pages; do not link to anything)",
    );
  });

  it("times the corpus, search and prompt stages, in that order, and no others", () => {
    const stages: string[] = [];
    prepareTurn(
      [{ content: "worktree cleanup" }],
      undefined,
      CORPUS,
      (stage, work) => {
        stages.push(stage);
        return work();
      },
    );

    expect(stages).toEqual(["corpus", "search", "prompt"]);
  });

  it("searches nothing, and does not throw, when the corpus has no index", () => {
    const result = prepareTurn([{ content: "worktree cleanup" }], undefined, {
      chunks: [],
      searchIndexJson: "",
      vocabulary: [],
    });

    expect(result.searched).toEqual([]);
  });
});
