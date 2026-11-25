// The offline eval scorers (plan #355 §4.4, D5): pure functions from what retrieval returned to the six metrics. No I/O and
// no import from the Worker, so a test can feed them a hand-built fixture. The definitions are gmt's `evals/metrics.ts` at
// fccce75 without `tools.offered`: recall at a depth of 10, MRR, whether the match survives `fitChunks`, whether the
// vocabulary holds the expected section, and whether a refusal case retrieved quietly.

/** Recall is read over this many leading chunks (gmt's depth). */
export const RECALL_DEPTH = 10;
/** A refusal case is quiet when it retrieved fewer than this many chunks (gmt's threshold). */
export const QUIET_BELOW = 5;

export const METRIC_NAMES = [
  "fit.kept",
  "refusal.quiet",
  "retrieval.mrr",
  "retrieval.recallAt10",
  "retrieval.withinK",
  "vocabulary.hit",
] as const;

export type MetricName = (typeof METRIC_NAMES)[number];

/** The two fields of a retrieved chunk the scorers read. */
export interface RetrievedChunk {
  id: string;
  /** The page's route. */
  url: string;
}

export interface Observation {
  id: string;
  /** What the search returned, before `fitChunks`. */
  searched: readonly RetrievedChunk[];
  /** What `fitChunks` kept. */
  kept: readonly RetrievedChunk[];
  /** The string `selectVocabulary` returned. */
  vocabulary: string;
  expect: {
    /** A route or a chunk id (an array means any one); `k` is the rank the match must reach. */
    chunks?: readonly { want: string | readonly string[]; k?: number }[];
    /** The expected section's text: `null` expects no section; unset is not scored. */
    vocabularyText?: string | null;
    /** The case must retrieve quietly (fewer than `QUIET_BELOW` chunks): gmt scores this for off-topic cases alone. */
    quiet?: boolean;
  };
}

export interface Report {
  /** Metric name to the names of the cases that missed it, sorted. */
  failures: Record<string, string[]>;
  metrics: Record<string, number>;
  /** Case id to the rank of each chunk expectation's first match (`null` when absent from `searched`). */
  ranks: Record<string, (number | null)[]>;
}

/** Cuts to three decimals; the epsilon keeps 0.57 from reading 0.569 (0.57 * 1000 is 569.9999999999999). */
export function truncate3(value: number): number {
  return Math.floor(value * 1000 + 1e-9) / 1000;
}

/** A chunk id (it holds a `#`) must equal the chunk's id; a route must equal its page. */
function matches(want: string, chunk: RetrievedChunk): boolean {
  return want.includes("#") ? chunk.id === want : chunk.url === want;
}

/** The 1-based position of the first chunk matching any wanted target, or `null`. */
function rankIn(
  want: string | readonly string[],
  list: readonly RetrievedChunk[],
): number | null {
  const targets = typeof want === "string" ? [want] : want;
  const at = list.findIndex((chunk) =>
    targets.some((target) => matches(target, chunk)),
  );
  return at === -1 ? null : at + 1;
}

/** One unit a metric scores: the case it belongs to and whether it passed. */
interface Unit {
  caseId: string;
  pass: boolean;
}

function ratio(units: readonly Unit[]): number {
  if (units.length === 0) return 1;
  return truncate3(units.filter((u) => u.pass).length / units.length);
}

function failedCases(units: readonly Unit[]): string[] {
  return [...new Set(units.filter((u) => !u.pass).map((u) => u.caseId))].sort();
}

export function scoreObservations(
  observations: readonly Observation[],
): Report {
  const recall: Unit[] = [];
  const withinK: Unit[] = [];
  const kept: Unit[] = [];
  const vocabulary: Unit[] = [];
  const quiet: Unit[] = [];
  const reciprocal: Unit[] = [];
  let reciprocalSum = 0;
  const ranks: Record<string, (number | null)[]> = {};

  for (const o of observations) {
    if (o.expect.chunks !== undefined && o.expect.chunks.length > 0) {
      ranks[o.id] = [];
      for (const { want, k } of o.expect.chunks) {
        const rank = rankIn(want, o.searched);
        ranks[o.id]?.push(rank);
        recall.push({
          caseId: o.id,
          pass: rank !== null && rank <= RECALL_DEPTH,
        });
        if (k !== undefined) {
          withinK.push({ caseId: o.id, pass: rank !== null && rank <= k });
        }
        reciprocalSum += rank === null ? 0 : 1 / rank;
        reciprocal.push({ caseId: o.id, pass: rank !== null });
        // Only an expectation the search found can be lost by `fitChunks`; a miss is recall's, not this metric's (gmt).
        const found = rank !== null && rank <= RECALL_DEPTH;
        kept.push({
          caseId: o.id,
          pass: !found || rankIn(want, o.kept) !== null,
        });
      }
    }
    const text = o.expect.vocabularyText;
    if (text !== undefined) {
      vocabulary.push({
        caseId: o.id,
        pass: text === null ? o.vocabulary === "" : o.vocabulary.includes(text),
      });
    }
    if (o.expect.quiet === true) {
      quiet.push({ caseId: o.id, pass: o.searched.length < QUIET_BELOW });
    }
  }

  const units: Record<MetricName, readonly Unit[]> = {
    "fit.kept": kept,
    "refusal.quiet": quiet,
    "retrieval.mrr": reciprocal,
    "retrieval.recallAt10": recall,
    "retrieval.withinK": withinK,
    "vocabulary.hit": vocabulary,
  };
  const metrics: Record<string, number> = {};
  const failures: Record<string, string[]> = {};
  for (const name of METRIC_NAMES) {
    metrics[name] =
      name === "retrieval.mrr"
        ? reciprocal.length === 0
          ? 1
          : truncate3(reciprocalSum / reciprocal.length)
        : ratio(units[name]);
    failures[name] = failedCases(units[name]);
  }
  return { failures, metrics, ranks: sortKeys(ranks) };
}

function sortKeys<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

/** What moved between the committed baseline and a measurement: empty when they are equal. One line per move. */
export function diffReports(baseline: Report, measured: Report): string[] {
  const lines: string[] = [];
  const names = [
    ...new Set([
      ...Object.keys(baseline.metrics),
      ...Object.keys(measured.metrics),
    ]),
  ].sort();
  for (const name of names) {
    const floor = baseline.metrics[name];
    const value = measured.metrics[name];
    if (floor !== value) {
      const side = (value ?? 0) < (floor ?? 0) ? "below" : "above";
      lines.push(`${name}: measured ${value}, floor ${floor} (${side})`);
    }
    const was = new Set(baseline.failures[name] ?? []);
    const now = new Set(measured.failures[name] ?? []);
    const failing = [...now].filter((id) => !was.has(id));
    const passing = [...was].filter((id) => !now.has(id));
    if (failing.length > 0) {
      lines.push(`${name}: now failing: ${failing.join(", ")}`);
    }
    if (passing.length > 0) {
      lines.push(`${name}: now passing: ${passing.join(", ")}`);
    }
  }
  const ids = [
    ...new Set([
      ...Object.keys(baseline.ranks),
      ...Object.keys(measured.ranks),
    ]),
  ].sort();
  for (const id of ids) {
    const was = baseline.ranks[id];
    const now = measured.ranks[id];
    const before =
      was === undefined ? "(not in the baseline)" : JSON.stringify(was);
    const after =
      now === undefined ? "(not in the measurement)" : JSON.stringify(now);
    if (before !== after) lines.push(`${id}: rank ${before} -> ${after}`);
  }
  return lines;
}
