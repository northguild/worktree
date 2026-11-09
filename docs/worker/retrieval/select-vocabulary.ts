// Which sections of the skill guide to put in front of the model for one question (plan #309 D8; adapted from gmt's
// `worker/select-vocabulary.ts`, whose budget carries over).
//
// SKILL.md is 60 KB, over three times what the prompt may spend on vocabulary, and a question about renaming does not
// need the Linear setup. gmt picks whole skills by the pages each one lists as its sources, which this skill guide does
// not have: it is one file. So a section is picked by what it says. Each topic word of the question scores a section
// (a word in the section's title counts more than one in its text), weighted by how few sections use it: "worktree" is
// in nearly all of them and says nothing about which one is wanted, "rename" is in one. The titles of the first few
// retrieved chunks vote too, at half weight, because retrieval has already decided what the question is about.
//
// The best section always goes in. Others follow while they fit `VOCABULARY_BUDGET_CHARS` and score at least
// `RUNNER_UP_SHARE` of the best: a section one stray word voted for is noise. A question that names no section in its
// words gets none. Vocabulary is never a source to link (D8): it carries no route and the prompt says so.

import type {
  RetrievalChunk,
  VocabularySection,
} from "../../src/chat/lib/chat-types";
import { queryTerms } from "./search";

/** Roughly 4,000 tokens: big enough for any one section, and for several of the smaller ones together. */
export const VOCABULARY_BUDGET_CHARS = 16_000;

/** A further section must score at least this share of the best. */
const RUNNER_UP_SHARE = 0.5;

/** A title word is worth this many text words. */
const TITLE_WEIGHT = 3;

/**
 * A section is about the question only if its title is: the guide's sections run to 13,000 characters, and a section
 * that long holds nearly every word a question can use, so the text alone proves nothing. The title's words, weighted
 * by rarity, must reach this. One rare word reaches it (3 x ln(1 + 19/4), a title word in four of nineteen sections,
 * is 5.2); "worktree", which is in most titles, does not (2.1).
 */
const MIN_TITLE_SCORE = 3;

/** How many retrieved chunks' titles also vote, and the weight of each vote against a word of the question. */
const VOTING_DEPTH = 3;
const RETRIEVED_VOTE = 0.5;

/** "worktrees" and "worktree" are one topic. */
function stem(term: string): string {
  return term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term;
}

function stems(text: string): Set<string> {
  return new Set(queryTerms(text).map(stem));
}

interface Indexed {
  title: Set<string>;
  text: Set<string>;
}

interface Words {
  sections: Indexed[];
  /** How rare a word is in the guide: ln(1 + sections / sections holding it). */
  rarity: (term: string) => number;
}

// The words of a section, once per array for as long as the array lives (the corpus is a module constant).
const INDEXES = new WeakMap<readonly VocabularySection[], Words>();

function indexFor(sections: readonly VocabularySection[]): Words {
  let indexed = INDEXES.get(sections);
  if (!indexed) {
    const held = sections.map((s) => ({
      title: stems(s.title),
      text: stems(s.text),
    }));
    const holding = new Map<string, number>();
    for (const { title, text } of held) {
      for (const term of new Set([...title, ...text])) {
        holding.set(term, (holding.get(term) ?? 0) + 1);
      }
    }
    indexed = {
      sections: held,
      rarity: (term) =>
        Math.log(1 + held.length / Math.max(holding.get(term) ?? 0, 1)),
    };
    INDEXES.set(sections, indexed);
  }
  return indexed;
}

/** The sections for one question, best first, joined; `""` when none is about it. */
export function selectVocabulary(
  sections: readonly VocabularySection[],
  query: string,
  retrieved: readonly RetrievalChunk[],
  budget: number = VOCABULARY_BUDGET_CHARS,
): string {
  const weights = new Map<string, number>();
  const vote = (text: string, weight: number) => {
    for (const term of stems(text)) {
      weights.set(term, (weights.get(term) ?? 0) + weight);
    }
  };
  vote(query, 1);
  for (const chunk of retrieved.slice(0, VOTING_DEPTH)) {
    vote(chunk.title, RETRIEVED_VOTE);
  }

  const words = indexFor(sections);
  const scored = sections
    .map((section, position) => {
      const { title, text } = words.sections[position] as Indexed;
      let named = 0;
      let score = 0;
      for (const [term, weight] of weights) {
        const worth = weight * words.rarity(term);
        if (title.has(term)) named += TITLE_WEIGHT * worth;
        if (text.has(term)) score += worth;
      }
      return { section, score: score + named, named, position };
    })
    .filter((entry) => entry.named >= MIN_TITLE_SCORE)
    // Stable: equal scores keep the guide's order.
    .sort((a, b) => b.score - a.score || a.position - b.position);

  const best = scored[0]?.score ?? 0;
  const chosen: VocabularySection[] = [];
  let used = 0;
  for (const { section, score } of scored) {
    if (chosen.length > 0) {
      if (score < best * RUNNER_UP_SHARE) break;
      if (used + section.text.length > budget) continue;
    }
    chosen.push(section);
    used += section.text.length;
  }
  return chosen.map((section) => section.text).join("\n\n---\n\n");
}
