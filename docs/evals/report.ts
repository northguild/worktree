// The committed live report (`evals/live-<brainId>.json`) and the diff against a new run (plan #355 D11). Verdicts, checks,
// latency and Neurons only: never an answer, and never a check's `detail`, which can quote one. Full answers go to the
// gitignored `docs/.cache/evals/`. Ported from gmt's `evals/report.ts` at fccce75.
//
// Loaded under Node's type stripping (D8): erasable syntax only, and relative imports carry a `.ts` extension.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Grade, GraderName } from "./graders.ts";
import type { StreamRecord } from "./read-stream.ts";

export type Verdict = Grade["verdict"];

export interface CaseReport {
  verdict: Verdict;
  /** Each grader that applied, pass or fail. */
  checks: Partial<Record<GraderName, boolean>>;
  /** Measured from the answer's usage; `null` when ungraded or when the answer carried none (counted as the worst case). */
  neurons: number | null;
  firstTokenMs: number | null;
  totalMs: number | null;
}

export interface LiveReport {
  brain: string;
  model: string;
  generatedAt: string;
  neurons: { spent: number; budget: number };
  cases: Record<string, CaseReport>;
}

/** What goes in the report for one answer: the verdict, a pass or fail per check, the last trace's latency and the Neurons. */
export function caseReport(
  grade: Grade,
  record: StreamRecord,
  neurons: number | null,
): CaseReport {
  const timings = record.traces.at(-1)?.timings;
  return {
    verdict: grade.verdict,
    checks: Object.fromEntries(grade.checks.map((c) => [c.name, c.pass])),
    neurons,
    firstTokenMs: timings?.firstToken ?? null,
    totalMs: timings?.total ?? null,
  };
}

export interface CaseDiff {
  id: string;
  before: Verdict | "none";
  after: Verdict;
  changedChecks: string[];
  /** A case that passed in the committed report and now fails. An ungraded case measured nothing, so it is not one. */
  regression: boolean;
  neurons: { before: number | null; after: number | null };
  totalMs: { before: number | null; after: number | null };
}

/** Compares only the cases the new run holds, so a partial run is never a regression elsewhere. */
export function diffLiveReports(
  committed: LiveReport | undefined,
  next: Readonly<Record<string, CaseReport>>,
): CaseDiff[] {
  return Object.keys(next)
    .sort()
    .map((id) => {
      const before = committed?.cases[id];
      const after = next[id] as CaseReport;
      const names = new Set([
        ...Object.keys(before?.checks ?? {}),
        ...Object.keys(after.checks),
      ]) as Set<GraderName>;
      const changedChecks = [...names]
        .filter((name) => before?.checks[name] !== after.checks[name])
        .map(
          (name) =>
            `${name}: ${before?.checks[name] ?? "-"} -> ${after.checks[name] ?? "-"}`,
        );
      return {
        id,
        before: before?.verdict ?? "none",
        after: after.verdict,
        changedChecks,
        regression: before?.verdict === "pass" && after.verdict === "fail",
        neurons: { before: before?.neurons ?? null, after: after.neurons },
        totalMs: { before: before?.totalMs ?? null, after: after.totalMs },
      };
    });
}

export interface RunResult {
  brain: string;
  model: string;
  generatedAt: string;
  budget: number;
  cases: Record<string, CaseReport>;
  /** `--only`: replace just these entries and add their Neurons to the committed total. */
  partial: boolean;
}

const byKey = ([a]: [string, unknown], [b]: [string, unknown]) =>
  a < b ? -1 : a > b ? 1 : 0;

/** The report to write: a full run replaces the cases, a partial one only its own entries. */
export function mergeReport(
  committed: LiveReport | undefined,
  run: RunResult,
): LiveReport {
  const ran = Object.values(run.cases).reduce(
    (sum, c) => sum + (c.neurons ?? 0),
    0,
  );
  const cases = run.partial ? { ...committed?.cases, ...run.cases } : run.cases;
  return {
    brain: run.brain,
    model: run.model,
    generatedAt: run.generatedAt,
    neurons: {
      spent: (run.partial ? (committed?.neurons.spent ?? 0) : 0) + ran,
      budget: run.budget,
    },
    cases: Object.fromEntries(Object.entries(cases).sort(byKey)),
  };
}

/** Object keys in sorted order at every depth, so a rewritten report differs only where it changed. */
const sortKeys = (_key: string, value: unknown): unknown =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(byKey))
    : value;

export const serialiseReport = (report: LiveReport): string =>
  `${JSON.stringify(report, sortKeys, 2)}\n`;

/**
 * Why this run may not become the committed report, or `undefined` when it may. Only a run where every case passed is
 * written: the report is the standard a later run is held to, so it never records a known fault, and an ungraded case was
 * never measured at all.
 */
export function baselineBlocker(
  results: Readonly<Record<string, CaseReport>>,
): string | undefined {
  const ids = Object.keys(results).sort();
  if (ids.length === 0) return "no case ran";
  const failed = ids.filter((id) => results[id]?.verdict === "fail");
  if (failed.length > 0) return `failed: ${failed.join(", ")}`;
  const ungraded = ids.filter((id) => results[id]?.verdict === "ungraded");
  if (ungraded.length > 0) return `ungraded: ${ungraded.join(", ")}`;
  return undefined;
}

const REPO = fileURLToPath(new URL("../..", import.meta.url));

/** Biome's formatter, as `evals:baseline` runs it, so `pnpm check` passes on what was written (D4). */
export function formatWithBiome(path: string): void {
  execFileSync("pnpm", ["exec", "biome", "format", path, "--write"], {
    cwd: REPO,
    stdio: "ignore",
  });
}

/** Writes the merged report when the run may be one, and formats it; otherwise writes nothing and says why. */
export function writeReport(
  path: string,
  committed: LiveReport | undefined,
  run: RunResult,
  format: (path: string) => void = formatWithBiome,
): { written: true } | { written: false; reason: string } {
  const reason = baselineBlocker(run.cases);
  if (reason !== undefined) return { written: false, reason };
  writeFileSync(path, serialiseReport(mergeReport(committed, run)));
  format(path);
  return { written: true };
}
