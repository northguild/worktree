// Keyword search over the docs corpus (plan #309 D8). Ported from gmt's `src/lib/retrieval/search.ts`: the stopwords,
// the camelCase split of identifiers, the namespace boost of 1.5 and a relevance floor, over MiniSearch 7.2.0.
//
// The index is built once, by `build-context.mjs`, and serialised (`MiniSearch#toJSON`). The Worker loads it with
// `MiniSearch.loadJSON` under the same options, so no request builds an index. `loadJSON` does not serialise functions,
// which is why the options live here, in the one module both sides import.
//
// `build-context.mjs` imports this file under Node's type stripping, so it holds erasable syntax only and its one
// relative import is `import type`.

import MiniSearch, { type Options } from "minisearch";
import type { RetrievalChunk } from "../../src/chat/lib/chat-types";

/** Weight of a chunk in its own section's favour, when the question came from a page of that section. */
export const NAMESPACE_BOOST = 1.5;

/** Chunks the search returns, before `fitChunks` caps what the prompt takes. gmt's. */
export const SEARCH_LIMIT = 15;

// A question is full of words that appear in nearly every chunk ("a", "the", "what", "do", "for"). Left in, they turn
// MiniSearch's OR combination into "any word overlaps".
const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "do",
  "does",
  "did",
  "is",
  "are",
  "was",
  "were",
  "what",
  "how",
  "to",
  "of",
  "for",
  "in",
  "on",
  "at",
  "and",
  "or",
  "with",
  "from",
  "i",
  "me",
  "my",
  "you",
  "your",
  "it",
  "this",
  "that",
]);

// An identifier is also split into its camelCase words (gmt's reasoning, kept): `branchPrefix` is one token to the
// default tokenizer, so a question that says "branch prefix" never matched it. Only the index is split, so a query that
// types an identifier stays one narrow term. In a title the words count in full; in a body they go to a separate
// `parts` field with a low weight, so a word that only occurs inside an identifier cannot lift a chunk on its own.
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;
const IDENTIFIER_WORDS = /\p{Lu}+(?!\p{Ll})|\p{Lu}?\p{Ll}+|\p{Nd}+/gu;

/** Weight of an identifier's words when they occur in a chunk's body. */
const PARTS_BOOST = 0.25;

// Edits only on longer terms: on a 3-5 letter word one edit reaches a different real word.
const MIN_FUZZY_LENGTH = 6;

function fuzzyFor(term: string): number {
  return term.length >= MIN_FUZZY_LENGTH ? 0.2 : 0;
}

function tokenizeQuery(text: string): string[] {
  return text.split(SPACE_OR_PUNCTUATION).filter(Boolean);
}

function identifierWords(text: string): string[] {
  const out: string[] = [];
  for (const raw of tokenizeQuery(text)) {
    const words = raw.match(IDENTIFIER_WORDS);
    if (words && words.length > 1) out.push(...words);
  }
  return out;
}

function tokenizeField(text: string, fieldName?: string): string[] {
  if (fieldName === "parts") return identifierWords(text);
  const whole = tokenizeQuery(text);
  return fieldName === "title" ? [...whole, ...identifierWords(text)] : whole;
}

function processTerm(term: string): string | false {
  const lower = term.toLowerCase();
  if (STOPWORDS.has(lower) || lower.length < 2) return false;
  return lower;
}

/**
 * The lowest score a chunk may have and still be returned: the relevance floor (plan #309 §9 Q14). gmt's is 8, tuned on
 * 755 chunks; this corpus has 210, and BM25 scores here run higher for the same question because most chunks say
 * "worktree" and the prefix match widens it. Measured over the corpus with no floor:
 *
 * - the three starter questions: best chunk 136, 490 and 156, and the page that answers each is in the first six;
 * - one-word and terse lookups ("rename", "clickup", "undo a cleanup", "install"): best chunk 15 to 25;
 * - out of domain: "capital of Peru" 2, "bake sourdough bread" 2.6, "tell me a story about a dog" 6.2, "recommend a
 *   pizza restaurant" 8.4, but "write me a haiku about cats" 12.7, "how do I use docker compose" 15 and "best pasta
 *   recipe" 22 (it shares "best" with a "Best practices" heading).
 *
 * The two ranges overlap, as they did for gmt, so no floor separates them: what the floor does is send the questions
 * that share only a stray word to "nothing matched" and keep the weakest real lookup (15). 10 sits between the two
 * clusters, and `search.test.ts` holds the questions above it.
 */
export const MIN_RELEVANCE_SCORE = 10;

/** The options both the build and the Worker pass to MiniSearch. */
export const INDEX_OPTIONS: Options<RetrievalChunk> = {
  idField: "id",
  fields: ["title", "text", "parts"],
  storeFields: ["namespace"],
  tokenize: tokenizeField,
  // `parts` is the body re-read for its identifiers' words only.
  extractField: (chunk, field) =>
    field === "parts" ? chunk.text : chunk[field as keyof RetrievalChunk],
  processTerm,
  searchOptions: {
    // BM25's default weights already favour short, exact matches; the title is boosted on top, so a direct question
    // ranks the page's own chunk above one that mentions the name in passing.
    boost: { title: 2, parts: PARTS_BOOST },
    tokenize: tokenizeQuery,
    prefix: true,
    fuzzy: fuzzyFor,
  },
};

/** An index over `chunks`: what `build-context.mjs` serialises. */
export function buildIndex(
  chunks: readonly RetrievalChunk[],
): MiniSearch<RetrievalChunk> {
  const index = new MiniSearch<RetrievalChunk>(INDEX_OPTIONS);
  index.addAll(chunks);
  return index;
}

/** The index `build-context.mjs` serialised, ready to search. */
export function loadIndex(json: string): MiniSearch<RetrievalChunk> {
  return MiniSearch.loadJSON<RetrievalChunk>(json, INDEX_OPTIONS);
}

/** The topic words of a piece of text: the query's terms as the search sees them, stopwords and one-letter words out. */
export function queryTerms(text: string): string[] {
  return tokenizeQuery(text).flatMap((term) => processTerm(term) || []);
}

export interface SearchOptions {
  /** The section to bias toward. A bias, not a filter: a question about another section still finds its page. */
  namespace?: string;
  limit?: number;
}

/**
 * The chunks that answer `query`, best first, at most `limit`, none under the relevance floor. A bias toward
 * `namespace` multiplies the score of that section's chunks by `NAMESPACE_BOOST` before the floor is applied.
 */
export function searchChunks(
  index: MiniSearch<RetrievalChunk>,
  byId: ReadonlyMap<string, RetrievalChunk>,
  query: string,
  { namespace, limit = SEARCH_LIMIT }: SearchOptions = {},
): RetrievalChunk[] {
  const results = index.search(query, {
    boostDocument: namespace
      ? (_id, _term, stored) =>
          stored?.namespace === namespace ? NAMESPACE_BOOST : 1
      : undefined,
  });
  return results
    .filter((result) => result.score >= MIN_RELEVANCE_SCORE)
    .slice(0, limit)
    .flatMap((result) => byId.get(result.id) ?? []);
}
