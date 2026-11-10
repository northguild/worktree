// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type {
  RetrievalChunk,
  VocabularySection,
} from "../../src/chat/lib/chat-types";
import { buildVocabulary } from "../build-context.mjs";
import { selectVocabulary, VOCABULARY_BUDGET_CHARS } from "./select-vocabulary";

// Expected values: plan #309 D8 (a 16,000-character budget, vocabulary is never linkable) and the rules in gmt's
// `select-vocabulary.ts` header: the best section always goes in, others follow while they fit the budget and score at
// least half of the best, and a question that no section is about gets none. The scoring is this site's own (the guide
// is one file, with no page lists to vote by), so its figures are worked by hand here: over four sections a word held by
// one has rarity ln(5) = 1.61 and is worth 4.83 in a title (3 x 1.61), which clears the title floor of 3; "worktree",
// held by three, has rarity ln(7/3) = 0.85 and is worth 2.54 in a title, which does not.

const section = (title: string, text: string): VocabularySection => ({
  title,
  text,
});
const none: RetrievalChunk[] = [];

const SECTIONS = [
  section(
    "Rename a worktree",
    "Rename a worktree\n\nRenames the directory and the branch.",
  ),
  section("Remove a worktree", "Remove a worktree\n\nDeletes the directory."),
  section("Linear worktree", "Linear worktree\n\nSet the linear api key."),
  section("Setup", "Setup\n\nRun config once."),
];

describe("selectVocabulary", () => {
  it("has gmt's 16,000-character budget", () => {
    expect(VOCABULARY_BUDGET_CHARS).toBe(16_000);
  });

  it("is empty when no section is about the question", () => {
    expect(
      selectVocabulary(SECTIONS, "What is the capital of Peru?", none),
    ).toBe("");
    expect(selectVocabulary(SECTIONS, "what is this for", none)).toBe("");
  });

  it("is empty for words that are only in a section's text: a long section holds every word", () => {
    expect(selectVocabulary(SECTIONS, "directory", none)).toBe("");
    expect(selectVocabulary(SECTIONS, "config once", none)).toBe("");
  });

  it("is empty for a word that is in most titles", () => {
    expect(selectVocabulary(SECTIONS, "worktree", none)).toBe("");
  });

  it("picks the section whose title the question names, with its text", () => {
    expect(
      selectVocabulary(SECTIONS, "How do I rename a worktree?", none),
    ).toBe(SECTIONS[0]?.text);
  });

  it("treats a plural as its singular", () => {
    expect(selectVocabulary(SECTIONS, "renames", none)).toBe(SECTIONS[0]?.text);
  });

  it("adds a section that scores as well, joined by a rule, in the guide's order", () => {
    expect(selectVocabulary(SECTIONS, "rename or remove", none)).toBe(
      `${SECTIONS[0]?.text}\n\n---\n\n${SECTIONS[1]?.text}`,
    );
  });

  it("lets retrieval vote: a retrieved chunk's title lifts the section it names above an equal", () => {
    const chunk: RetrievalChunk = {
      id: "a",
      url: "/a/",
      namespace: "x",
      title: "Remove",
      text: "t",
    };

    expect(selectVocabulary(SECTIONS, "rename or remove", [chunk])).toBe(
      `${SECTIONS[1]?.text}\n\n---\n\n${SECTIONS[0]?.text}`,
    );
  });

  it("does not let retrieval alone choose a section: the question has to name it", () => {
    const chunk: RetrievalChunk = {
      id: "a",
      url: "/a/",
      namespace: "x",
      title: "Remove",
      text: "t",
    };

    expect(selectVocabulary(SECTIONS, "tickets", [chunk])).toBe("");
  });

  it("always takes the best section, however large, and skips a runner-up that would pass the budget", () => {
    const big = section("Alpha", `Alpha\n\n${"alpha ".repeat(10)}`);
    const next = section("Alpha next", `Alpha next\n\n${"alpha ".repeat(10)}`);
    const rest = [
      section("Other", "Other\n\nx"),
      section("Another", "Another\n\ny"),
    ];

    expect(selectVocabulary([big, next, ...rest], "alpha", none, 10)).toBe(
      big.text,
    );
    expect(
      selectVocabulary(
        [big, next, ...rest],
        "alpha",
        none,
        big.text.length + next.text.length,
      ),
    ).toBe(`${big.text}\n\n---\n\n${next.text}`);
  });
});

const HERE = fileURLToPath(new URL(".", import.meta.url));

describe("selectVocabulary on the skill guide", () => {
  const SKILL = join(HERE, "..", "..", "..", "skills/worktree/SKILL.md");
  const GUIDE = buildVocabulary(readFileSync(SKILL, "utf8"));

  it("gives a Linear question the sections that name Linear, within budget", () => {
    const picked = selectVocabulary(
      GUIDE,
      "How do I create a worktree for a Linear issue?",
      none,
    );

    expect(picked).toContain(
      "Derive a branch name from a GitHub, Jira or Linear issue",
    );
    expect(picked.length).toBeLessThanOrEqual(VOCABULARY_BUDGET_CHARS);
  });

  it("gives a question about handing work to an agent that section", () => {
    expect(
      selectVocabulary(GUIDE, "how do I hand a worktree to an agent", none),
    ).toContain("Hand a new worktree to a coding agent");
  });

  it("gives nothing for a question off the topic", () => {
    expect(selectVocabulary(GUIDE, "What is the capital of Peru?", none)).toBe(
      "",
    );
  });
});
