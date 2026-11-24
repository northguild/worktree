// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VALID_DOC_ROUTES } from "../src/chat/docs-routes.generated";
import { CHAT_STARTERS } from "../src/chat/lib/chat-starters";
import { PAGE_CONTEXT_PATTERN } from "../src/chat/lib/page-context";
import { buildCorpus } from "../worker/build-context.mjs";
import { CASE_KINDS, CASES, type EvalCase, MAX_LIVE_CASES } from "./cases";

// Every check here is read from plan #355 §4.3 ("`cases.test.ts` checks the list against the corpus") and decided by the
// corpus itself, never by the code under test: the routes are `VALID_DOC_ROUTES` (generated from the 28 `.mdx` pages), the
// chunk ids and vocabulary titles are what `buildCorpus` makes of `docs/src/content/docs/` and `skills/worktree/SKILL.md`
// (the same call `search.test.ts` and `chat-handler.test.ts` make), and the names are the text of that corpus (D7).
// `problems` is the one function that applies them, so the same checks run over a planted list below and show that they can fail.

const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const CORPUS = buildCorpus(
  join(REPO, "docs/src/content/docs"),
  readFileSync(join(REPO, "skills/worktree/SKILL.md"), "utf8"),
);
const CHUNK_IDS = new Set(CORPUS.chunks.map((chunk) => chunk.id));
const VOCABULARY_TITLES = new Set(CORPUS.vocabulary.map((s) => s.title));
/** The text Dox answers from: the docs pages and `SKILL.md` (D7). */
const CORPUS_TEXT = [
  ...CORPUS.chunks.map((chunk) => chunk.text),
  ...CORPUS.vocabulary.map((section) => section.text),
].join("\n");

/** oclif's own `help` is a command with no page of its own (D7). */
const BUILT_IN_COMMANDS: ReadonlySet<string> = new Set(["help"]);

/** D7: a command is `worktree <name>` with a `/commands/<name>/` route (or `help`), a flag or config key is in the corpus. */
function isDocumented(name: string): boolean {
  const command = /^worktree ([a-z][a-z-]*)$/.exec(name)?.[1];
  if (command !== undefined) {
    return (
      BUILT_IN_COMMANDS.has(command) ||
      VALID_DOC_ROUTES.has(`/commands/${command}/`)
    );
  }
  return CORPUS_TEXT.includes(name);
}

/** What is wrong with a list, one sentence each, naming the case. Empty when the list holds. */
function problems(cases: readonly EvalCase[]): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) found.push(`${c.id}: duplicate id`);
    seen.add(c.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.id)) {
      found.push(`${c.id}: id is not kebab-case`);
    }
    for (const { want } of c.chunks ?? []) {
      for (const target of Array.isArray(want) ? want : [want]) {
        if (target.includes("#")) {
          if (!CHUNK_IDS.has(target)) {
            found.push(`${c.id}: unknown chunk id ${target}`);
          }
        } else if (!VALID_DOC_ROUTES.has(target)) {
          found.push(`${c.id}: unknown route ${target}`);
        }
      }
    }
    if (
      c.vocabulary !== undefined &&
      c.vocabulary !== null &&
      !VOCABULARY_TITLES.has(c.vocabulary)
    ) {
      found.push(`${c.id}: unknown vocabulary title ${c.vocabulary}`);
    }
    for (const name of c.names ?? []) {
      if (!isDocumented(name)) found.push(`${c.id}: undocumented name ${name}`);
    }
    if (c.page !== undefined && !PAGE_CONTEXT_PATTERN.test(c.page)) {
      found.push(`${c.id}: page ${c.page} is not a pageContext`);
    }
  }
  return found;
}

const SIGNED: EvalCase = {
  id: "planted-baseline",
  kind: "lookup",
  question: "How do I rename a worktree?",
};

describe("the committed case list", () => {
  it("has no case that disagrees with the corpus", () => {
    expect(problems(CASES)).toEqual([]);
  });

  it("gives every kind at least one case", () => {
    for (const kind of CASE_KINDS) {
      expect(
        CASES.filter((c) => c.kind === kind).length,
        `kind ${kind}`,
      ).toBeGreaterThan(0);
    }
  });

  it("has a starter case for every starter, expecting the starter's own route, and two rewordings of each", () => {
    for (const starter of CHAT_STARTERS) {
      const starters = CASES.filter(
        (c) => c.kind === "starter" && c.question === starter.text,
      );
      expect(starters, starter.text).toHaveLength(1);
      expect(starters[0]?.chunks).toEqual([{ want: starter.route }]);

      const rewordings = CASES.filter(
        (c) =>
          c.kind === "reworded" &&
          c.chunks?.some((e) => e.want === starter.route),
      );
      expect(rewordings.length, `rewordings of ${starter.text}`).toBe(2);
      for (const reworded of rewordings) {
        expect(reworded.question).not.toBe(starter.text);
      }
    }
  });

  it("marks at most twelve cases for the live run, and at least one", () => {
    const live = CASES.filter((c) => c.live === true);
    expect(live.length).toBeGreaterThan(0);
    expect(live.length).toBeLessThanOrEqual(MAX_LIVE_CASES);
    expect(MAX_LIVE_CASES).toBe(12);
  });

  it("refuses only where the docs cannot answer: absent, off-topic and bare-injection cases expect no chunk", () => {
    for (const c of CASES.filter((x) => x.refuse === true)) {
      expect(c.chunks, c.id).toBeUndefined();
    }
  });

  it("gives every injection case a canary, a nonsense token that is not in the corpus", () => {
    for (const c of CASES.filter((x) => x.kind === "injection")) {
      expect(c.canary, c.id).toBeDefined();
      expect(CORPUS_TEXT).not.toContain(c.canary ?? "");
    }
  });

  it("has no vocabulary section whose text sits inside another's, which the vocabulary.hit check (D5) relies on", () => {
    const sections = CORPUS.vocabulary;
    for (const a of sections) {
      for (const b of sections) {
        if (a !== b) {
          expect(b.text.includes(a.text), `${a.title} in ${b.title}`).toBe(
            false,
          );
        }
      }
    }
  });
});

describe("the checks themselves", () => {
  it("pass a list of one valid case", () => {
    expect(problems([SIGNED])).toEqual([]);
  });

  it("fail a planted unknown route, naming the case", () => {
    expect(
      problems([
        {
          ...SIGNED,
          id: "planted-route",
          chunks: [{ want: "/commands/nonexistent/" }],
        },
      ]),
    ).toEqual(["planted-route: unknown route /commands/nonexistent/"]);
  });

  it("fail a planted unknown chunk id", () => {
    expect(
      problems([
        {
          ...SIGNED,
          id: "planted-chunk",
          chunks: [{ want: ["/commands/cleanup/#no-such-heading"] }],
        },
      ]),
    ).toEqual([
      "planted-chunk: unknown chunk id /commands/cleanup/#no-such-heading",
    ]);
  });

  it("fail a planted unknown vocabulary title", () => {
    expect(
      problems([
        { ...SIGNED, id: "planted-title", vocabulary: "Core Patterns › Nope" },
      ]),
    ).toEqual(["planted-title: unknown vocabulary title Core Patterns › Nope"]);
  });

  it("fail a planted undocumented command, flag and config key", () => {
    expect(
      problems([
        {
          ...SIGNED,
          id: "planted-names",
          names: ["worktree frobnicate", "--no-such-flag", "noSuchKey"],
        },
      ]),
    ).toEqual([
      "planted-names: undocumented name worktree frobnicate",
      "planted-names: undocumented name --no-such-flag",
      "planted-names: undocumented name noSuchKey",
    ]);
  });

  it("accept documented names: a command with a page, oclif's help, a flag and a config key", () => {
    expect(
      problems([
        {
          ...SIGNED,
          id: "documented-names",
          names: ["worktree rename", "worktree help", "--source", "postCreate"],
        },
      ]),
    ).toEqual([]);
  });

  it("fail a duplicate id, an id that is not kebab-case and a page that is not a pageContext", () => {
    expect(
      problems([
        SIGNED,
        SIGNED,
        { ...SIGNED, id: "Not_Kebab", page: "commands config" },
      ]),
    ).toEqual([
      "planted-baseline: duplicate id",
      "Not_Kebab: id is not kebab-case",
      "Not_Kebab: page commands config is not a pageContext",
    ]);
  });
});
