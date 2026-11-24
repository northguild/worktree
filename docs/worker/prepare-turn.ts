// Everything the Worker does with a question before a model is asked (plan #355 D1): the question, the corpus's
// retriever, the namespaced search, `fitChunks`, the vocabulary and the system prompt. `createChatHandler` and the
// offline evals both call this one function, so the evals cannot drift from the handler.

import type {
  RetrievalChunk,
  VocabularySection,
} from "../src/chat/lib/chat-types";
import { namespaceFromPageContext } from "../src/chat/lib/page-context";
import { fitChunks } from "./retrieval/fit-chunks";
import { loadIndex, searchChunks } from "./retrieval/search";
import { selectVocabulary } from "./retrieval/select-vocabulary";
import { assembleSystemPrompt } from "./retrieval/system-prompt";

/** What `build-context.mjs` generates (`docs-context.ts`): the corpus the handler retrieves from. */
export interface RetrievalCorpus {
  chunks: readonly RetrievalChunk[];
  /** `MiniSearch#toJSON` of `chunks`. Empty when there is no corpus (the test stub). */
  searchIndexJson: string;
  vocabulary: readonly VocabularySection[];
}

/** The stages the handler times. `fitChunks` and the vocabulary choice are not among them, as before. */
export type TurnStage = "corpus" | "search" | "prompt";

/** Runs one stage's work and records how long it took. A caller with no use for timings passes none. */
export type StageTimer = <T>(stage: TurnStage, work: () => T) => T;

export interface PreparedTurn {
  /** The last message's text: retrieval reads it alone, never the history. */
  question: string;
  /** What the search returned, before `fitChunks`. */
  searched: RetrievalChunk[];
  /** What fits the prompt, after `fitChunks`: what the prompt, the link list and the trace are built from. */
  kept: RetrievalChunk[];
  /** The vocabulary text chosen for the question ("" when none matched). */
  vocabulary: string;
  systemPrompt: string;
}

interface Retriever {
  index: ReturnType<typeof loadIndex> | null;
  byId: ReadonlyMap<string, RetrievalChunk>;
}

// The serialized index is parsed once per isolate and kept for as long as the corpus object lives (R1).
const RETRIEVERS = new WeakMap<RetrievalCorpus, Retriever>();

function retrieverFor(corpus: RetrievalCorpus): Retriever {
  let retriever = RETRIEVERS.get(corpus);
  if (!retriever) {
    retriever = {
      index:
        corpus.searchIndexJson === ""
          ? null
          : loadIndex(corpus.searchIndexJson),
      byId: new Map(corpus.chunks.map((chunk) => [chunk.id, chunk])),
    };
    RETRIEVERS.set(corpus, retriever);
  }
  return retriever;
}

const untimed: StageTimer = (_stage, work) => work();

/** Throws what the corpus throws (a corrupt index); the handler answers that with a 500. */
export function prepareTurn(
  messages: ReadonlyArray<{ content: string }>,
  pageContext: string | undefined,
  corpus: RetrievalCorpus,
  time: StageTimer = untimed,
): PreparedTurn {
  const question = messages.at(-1)?.content ?? "";
  const retriever = time("corpus", () => retrieverFor(corpus));
  const searched = time("search", () =>
    retriever.index === null
      ? []
      : searchChunks(retriever.index, retriever.byId, question, {
          namespace: namespaceFromPageContext(pageContext),
        }),
  );
  const kept = fitChunks(searched);
  const { vocabulary, systemPrompt } = time("prompt", () => {
    const chosen = selectVocabulary(corpus.vocabulary, question, kept);
    return {
      vocabulary: chosen,
      systemPrompt: assembleSystemPrompt({ chunks: kept, vocabulary: chosen }),
    };
  });
  return { question, searched, kept, vocabulary, systemPrompt };
}
