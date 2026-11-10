// How much retrieved context goes into one prompt (plan #309 D8; ported from gmt's `worker/fit-chunks.ts`, caps
// unchanged).
//
// The search returns up to 15 chunks, and their size varies far more than their number: a section can be a page of
// prose. The long tail rarely helps, but every byte of it is read before the first token. So the prompt takes chunks,
// best first, until either cap is reached. The best chunk always goes in, whatever its size: a question with one long,
// exactly right section must not be answered from nothing. What is cut is also cut from the route list and the trace,
// which are built from the same list, so the reader is never shown a source the model did not see.

import type { RetrievalChunk } from "../../src/chat/lib/chat-types";

/** At most this many chunks. */
export const MAX_PROMPT_CHUNKS = 10;

/** At most this many characters of chunk text and titles: about 6,000 tokens. */
export const MAX_PROMPT_CHUNK_CHARS = 24_000;

export function fitChunks(
  retrieved: readonly RetrievalChunk[],
  {
    maxChunks = MAX_PROMPT_CHUNKS,
    maxChars = MAX_PROMPT_CHUNK_CHARS,
  }: { maxChunks?: number; maxChars?: number } = {},
): RetrievalChunk[] {
  const kept: RetrievalChunk[] = [];
  let used = 0;
  for (const chunk of retrieved) {
    if (kept.length >= maxChunks) break;
    const size = chunk.title.length + chunk.text.length;
    if (kept.length > 0 && used + size > maxChars) continue;
    kept.push(chunk);
    used += size;
  }
  return kept;
}
