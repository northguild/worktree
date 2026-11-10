/**
 * The visible retrieval trace (plan #309 Phase 5, §4.1 row 12; ported from gmt's `RetrievalTrace`).
 *
 * Makes grounding legible instead of asserted: how many chunks of the docs were searched, how many cleared the
 * relevance floor and made the prompt, and which. A question that retrieved nothing looks like it did, right above an
 * answer that declines to guess. Collapsed by default: a reader's first look is the answer, not the retrieval log.
 *
 * gmt's is a vendored `Task` over Radix; this is Base UI's `Collapsible` (D4), which gives the trigger its
 * `aria-expanded` and `aria-controls` and shows or hides the panel.
 */

import { Collapsible } from "@base-ui/react/collapsible";
import {
  ChevronDownIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import type { RetrievalTimings, RetrievalTraceData } from "../lib/chat-types";

/** "0.4 s" above a second, "320 ms" below it. */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

/** One line, the stages in the order the Worker runs them, so a slow answer shows which stage was slow. */
export function describeTimings(timings: RetrievalTimings): string {
  const stages: Array<[string, number | undefined]> = [
    ["index", timings.corpus],
    ["search", timings.search],
    ["prompt", timings.prompt],
    ["first token", timings.firstToken],
    ["total", timings.total],
  ];
  return stages
    .filter((stage): stage is [string, number] => stage[1] !== undefined)
    .map(([name, ms]) => `${name} ${formatMs(ms)}`)
    .join(" · ");
}

export function RetrievalTrace({ data }: { data: RetrievalTraceData }) {
  const { totalChunks, retrievedCount, chunkTitles, brainLabel, timings } =
    data;

  // Naming the brain matters more than it looks: from phase 6 Dox moves between models as their allowances run out, and
  // two answers in one transcript can then differ in voice or depth. Absent until the Worker names it.
  const summary = brainLabel
    ? `Searched ${totalChunks} chunks → ${retrievedCount} matched · ${brainLabel}`
    : `Searched ${totalChunks} chunks → ${retrievedCount} matched`;

  return (
    <Collapsible.Root defaultOpen={false} className="gmt-hive-trace">
      <Collapsible.Trigger className="gmt-hive-trace-trigger">
        <MagnifyingGlassIcon aria-hidden="true" />
        <span>{summary}</span>
        <ChevronDownIcon aria-hidden="true" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="gmt-hive-trace-panel">
        {chunkTitles.length === 0 ? (
          <p>Nothing in the corpus matched this question.</p>
        ) : (
          <ul>
            {chunkTitles.map((title, index) => (
              // A title can repeat across pages; the position is what is unique.
              // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, read once
              <li key={`${index}:${title}`}>{title}</li>
            ))}
          </ul>
        )}
        {timings && (
          <p className="gmt-hive-trace-timing" data-role="timings">
            {describeTimings(timings)}
          </p>
        )}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
