// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  diffReports,
  type Observation,
  QUIET_BELOW,
  RECALL_DEPTH,
  type Report,
  scoreObservations,
  truncate3,
} from "./metrics";

// Every expected value below is worked out by hand from the small fixtures beside it, never read off `scoreObservations`.
// The definitions are gmt's `evals/metrics.ts` at fccce75 (plan #355 §8): a recall depth of 10, a quiet refusal is fewer
// than 5 hits and is scored for off-topic cases alone, `fit.kept` is scored over the expectations found in the top 10,
// and MRR is the mean of 1/rank of the first match and 0 when absent. Scores are truncated (not rounded) to three decimals,
// which is this feature's own D4 rule.

const chunk = (url: string, heading = "h") => ({
  id: `${url}#${heading}`,
  url,
});
const filler = (count: number) =>
  Array.from({ length: count }, (_, i) => chunk(`/filler/${i}/`));

describe("the definitions' constants", () => {
  it("keeps gmt's recall depth of 10 and quiet threshold of 5", () => {
    expect(RECALL_DEPTH).toBe(10);
    expect(QUIET_BELOW).toBe(5);
  });
});

describe("truncate3", () => {
  it("cuts to three decimals rather than rounding: 2/3 is 0.666, not 0.667", () => {
    expect(truncate3(2 / 3)).toBe(0.666);
  });

  // 0.57 * 1000 is 569.9999999999999 in floating point, so a bare floor gives 0.569. 57 hundredths is 0.57 by hand.
  it("does not lose a thousandth to floating point: 0.57 stays 0.57", () => {
    expect(truncate3(0.57)).toBe(0.57);
  });

  it("leaves 0 and 1 alone", () => {
    expect(truncate3(0)).toBe(0);
    expect(truncate3(1)).toBe(1);
  });
});

describe("retrieval metrics over three expectations", () => {
  // c1 wants a route and finds it first (rank 1); c2 wants a chunk id and finds it second (rank 2), with k 1;
  // c3 wants a route the search never returns. By hand:
  //   MRR = (1/1 + 1/2 + 0) / 3 = 0.5
  //   recall@10 = 2 of 3 = 0.666 (truncated); the miss is c3
  //   withinK counts only the expectations that set a k: c2 (rank 2 > 1) fails, so 0 of 1 = 0
  //   fit.kept scores only expectations the search found (gmt does the same): c1 is kept, c2 was found but `kept` lost it,
  //   and c3 never retrieved, so it is recall's miss and not fit's: 2 of 3 = 0.666, the loss is c2
  const observations: Observation[] = [
    {
      id: "c1",
      searched: [chunk("/a/"), chunk("/b/")],
      kept: [chunk("/a/")],
      vocabulary: "",
      expect: { chunks: [{ want: "/a/" }] },
    },
    {
      id: "c2",
      searched: [chunk("/a/"), chunk("/b/", "section")],
      kept: [],
      vocabulary: "",
      expect: { chunks: [{ want: "/b/#section", k: 1 }] },
    },
    {
      id: "c3",
      searched: [chunk("/a/")],
      kept: [chunk("/a/")],
      vocabulary: "",
      expect: { chunks: [{ want: "/z/" }] },
    },
  ];
  const report = scoreObservations(observations);

  it("scores MRR as the mean of 1/rank, with 0 for a miss", () => {
    expect(report.metrics["retrieval.mrr"]).toBe(0.5);
  });

  it("scores recall@10 and names the case that missed", () => {
    expect(report.metrics["retrieval.recallAt10"]).toBe(0.666);
    expect(report.failures["retrieval.recallAt10"]).toEqual(["c3"]);
  });

  it("scores withinK over the expectations that set a k alone", () => {
    expect(report.metrics["retrieval.withinK"]).toBe(0);
    expect(report.failures["retrieval.withinK"]).toEqual(["c2"]);
  });

  it("scores fit.kept by what survives fitChunks", () => {
    expect(report.metrics["fit.kept"]).toBe(0.666);
    expect(report.failures["fit.kept"]).toEqual(["c2"]);
  });

  it("records each expectation's rank, null for a miss", () => {
    expect(report.ranks).toEqual({ c1: [1], c2: [2], c3: [null] });
  });
});

describe("matching an expectation", () => {
  // /y/ is at rank 2 and /z/ at rank 3 of the list; either is wanted, so the first one found is rank 2.
  it("takes any one of an array, at the best rank", () => {
    const report = scoreObservations([
      {
        id: "any",
        searched: [chunk("/x/"), chunk("/y/"), chunk("/z/")],
        kept: [],
        vocabulary: "",
        expect: { chunks: [{ want: ["/z/", "/y/"] }] },
      },
    ]);
    expect(report.ranks).toEqual({ any: [2] });
  });

  it("counts a match at rank 11 for MRR but not for recall@10 (1/11 = 0.0909, truncated 0.09)", () => {
    const deep: Observation = {
      id: "deep",
      searched: [...filler(10), chunk("/late/")],
      kept: [],
      vocabulary: "",
      expect: { chunks: [{ want: "/late/" }] },
    };
    const report = scoreObservations([deep]);
    expect(report.ranks).toEqual({ deep: [11] });
    expect(report.metrics["retrieval.recallAt10"]).toBe(0);
    expect(report.metrics["retrieval.mrr"]).toBe(0.09);
  });

  it("matches a route against the page, never a prefix of another route", () => {
    const report = scoreObservations([
      {
        id: "prefix",
        searched: [chunk("/commands/cleanup-all/")],
        kept: [],
        vocabulary: "",
        expect: { chunks: [{ want: "/commands/cleanup/" }] },
      },
    ]);
    expect(report.ranks).toEqual({ prefix: [null] });
  });
});

describe("vocabulary.hit", () => {
  // Three cases: text contained passes; null with an empty string passes; null with a section chosen fails. 2 of 3 = 0.666.
  const report = scoreObservations([
    {
      id: "has",
      searched: [],
      kept: [],
      vocabulary: "intro ALPHA text outro",
      expect: { vocabularyText: "ALPHA text" },
    },
    {
      id: "none-ok",
      searched: [],
      kept: [],
      vocabulary: "",
      expect: { vocabularyText: null },
    },
    {
      id: "none-bad",
      searched: [],
      kept: [],
      vocabulary: "something chosen",
      expect: { vocabularyText: null },
    },
  ]);

  it("passes when the section's text is contained, and null passes on an empty string", () => {
    expect(report.metrics["vocabulary.hit"]).toBe(0.666);
    expect(report.failures["vocabulary.hit"]).toEqual(["none-bad"]);
  });

  it("does not score a case that sets no vocabulary expectation", () => {
    const none = scoreObservations([
      {
        id: "unset",
        searched: [],
        kept: [],
        vocabulary: "anything",
        expect: {},
      },
    ]);
    expect(none.metrics["vocabulary.hit"]).toBe(1);
  });
});

describe("refusal.quiet", () => {
  // An off-topic case (the caller sets `quiet`) is quiet when it retrieved fewer than 5 chunks: 4 passes, 5 fails. 1 of 2 = 0.5.
  const report = scoreObservations([
    {
      id: "four",
      searched: filler(4),
      kept: [],
      vocabulary: "",
      expect: { quiet: true },
    },
    {
      id: "five",
      searched: filler(5),
      kept: [],
      vocabulary: "",
      expect: { quiet: true },
    },
    {
      id: "not-a-refusal",
      searched: filler(9),
      kept: [],
      vocabulary: "",
      expect: {},
    },
  ]);

  it("passes on four hits and fails on five, ignoring cases that do not ask for quiet", () => {
    expect(report.metrics["refusal.quiet"]).toBe(0.5);
    expect(report.failures["refusal.quiet"]).toEqual(["five"]);
  });
});

describe("a metric with nothing to score", () => {
  it("reads 1, since nothing missed", () => {
    const empty = scoreObservations([]);
    expect(empty.metrics["retrieval.recallAt10"]).toBe(1);
    expect(empty.metrics["retrieval.mrr"]).toBe(1);
  });
});

describe("the report's shape", () => {
  it("sorts its keys so the committed file diffs cleanly", () => {
    const report = scoreObservations([
      {
        id: "zeta",
        searched: [chunk("/a/")],
        kept: [],
        vocabulary: "",
        expect: { chunks: [{ want: "/a/" }] },
      },
      {
        id: "alpha",
        searched: [chunk("/a/")],
        kept: [],
        vocabulary: "",
        expect: { chunks: [{ want: "/a/" }] },
      },
    ]);
    expect(Object.keys(report.ranks)).toEqual(["alpha", "zeta"]);
    expect(Object.keys(report.metrics)).toEqual(
      [...Object.keys(report.metrics)].sort(),
    );
    expect(Object.keys(report.failures)).toEqual(
      [...Object.keys(report.failures)].sort(),
    );
  });
});

describe("diffReports", () => {
  const baseline: Report = {
    failures: { "retrieval.recallAt10": ["c3"], "retrieval.mrr": ["c3"] },
    metrics: { "retrieval.recallAt10": 0.666, "retrieval.mrr": 0.5 },
    ranks: { c1: [1], c2: [2], c3: [null] },
  };

  it("is empty when nothing moved", () => {
    expect(diffReports(baseline, structuredClone(baseline))).toEqual([]);
  });

  it("names a metric that fell, as measured against the floor, and the case now failing", () => {
    const measured: Report = {
      failures: {
        "retrieval.recallAt10": ["c2", "c3"],
        "retrieval.mrr": ["c3"],
      },
      metrics: { "retrieval.recallAt10": 0.333, "retrieval.mrr": 0.5 },
      ranks: { c1: [1], c2: [null], c3: [null] },
    };
    const lines = diffReports(baseline, measured).join("\n");
    expect(lines).toContain(
      "retrieval.recallAt10: measured 0.333, floor 0.666 (below)",
    );
    expect(lines).toContain("now failing: c2");
    expect(lines).toContain("c2: rank [2] -> [null]");
  });

  it("fails a move up as well, naming the case now passing", () => {
    const measured: Report = {
      failures: { "retrieval.recallAt10": [], "retrieval.mrr": ["c3"] },
      metrics: { "retrieval.recallAt10": 1, "retrieval.mrr": 0.5 },
      ranks: { c1: [1], c2: [2], c3: [4] },
    };
    const lines = diffReports(baseline, measured).join("\n");
    expect(lines).toContain(
      "retrieval.recallAt10: measured 1, floor 0.666 (above)",
    );
    expect(lines).toContain("now passing: c3");
  });

  it("flags a rank that moved even when every metric is unchanged", () => {
    const measured: Report = {
      ...structuredClone(baseline),
      ranks: { c1: [2], c2: [2], c3: [null] },
    };
    expect(diffReports(baseline, measured)).toEqual(["c1: rank [1] -> [2]"]);
  });

  it("flags a case added to or removed from the set", () => {
    const measured: Report = {
      ...structuredClone(baseline),
      ranks: { c1: [1], c2: [2], c3: [null], c4: [1] },
    };
    expect(diffReports(baseline, measured)).toEqual([
      "c4: rank (not in the baseline) -> [1]",
    ]);
  });
});
