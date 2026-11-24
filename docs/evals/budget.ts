// The budget guard for the live layer (plan #355 D10, D11). Pure, so every limit is proven offline without spending a Neuron
// or a Gemini request; `run-live.ts` is a thin runner around it. Ported from gmt's `evals/budget.ts` at fccce75, with its
// wrangler-log parsing replaced by the usage `RUN_FINISHED` carries (D10).
//
// The limits are the owner's: never in CI; one brain and the live subset by default; a Neurons budget per run; a per-model
// Gemini cap; `--brains all` asks first.
//
// Loaded under Node's type stripping (D8): erasable syntax only (no parameter properties, no enums), and relative imports
// carry a `.ts` extension.

import { parseArgs } from "node:util";
import type { EvalCase } from "./cases.ts";
import type { StreamUsage } from "./read-stream.ts";

/**
 * Neurons per million tokens, `[input, output]`, from Cloudflare's Workers AI pricing page, read 2026-11-24
 * (https://developers.cloudflare.com/workers-ai/platform/pricing/). Keyed by the model id `BRAINS` carries.
 */
export const NEURONS_PER_MILLION: Readonly<
  Record<string, readonly [number, number]>
> = {
  "@cf/google/gemma-4-26b-a4b-it": [9091, 27273],
  "@cf/zai-org/glm-4.7-flash": [5500, 36400],
};

/**
 * The worst case for one answer, and what an answer with no usage counts as. gmt measured 29,238 input tokens and 33 output
 * tokens at 267 Neurons on Gemma 4 26B, and its largest live prompt about a quarter bigger, so 350 left room for the
 * output. This Worker's prompts are capped smaller (plan §9 Q4); 350 stays until a live run measures the real maximum.
 */
export const WORST_CASE_NEURONS = 350;
export const DEFAULT_BUDGET = 2500;
export const DEFAULT_GEMINI_CAP = 3;
export const DEFAULT_DELAY_MS = 3500;
export const DEFAULT_BASE = "http://localhost:8787";
/** Relative to `docs/`, where the runner resolves it; gitignored. */
export const DEFAULT_OUT_DIR = ".cache/evals";

/** The part of a brain the guard reads. */
export interface GuardBrain {
  id: string;
  provider: "workers-ai" | "google";
  model?: string;
}

export interface RunOptions {
  base: string;
  brainIds: string[];
  all: boolean;
  confirmSpend: boolean;
  only: string[];
  budget: number;
  geminiCap: number;
  delayMs: number;
  outDir: string;
  writeBaseline: boolean;
}

export const USAGE = `Live evals for the Dox chat: asks the live cases of a running Worker and grades each answer.

  pnpm --filter docs evals:live [--base ${DEFAULT_BASE}]
    [--brains <id,...>|all [--confirm-spend]] [--only <id,...>]
    [--budget ${DEFAULT_BUDGET}] [--gemini-cap ${DEFAULT_GEMINI_CAP}] [--delay-ms ${DEFAULT_DELAY_MS}]
    [--out-dir ${DEFAULT_OUT_DIR}] [--write-baseline] [--help]

It spends real quota. A question costs up to ${WORST_CASE_NEURONS} Neurons (an answer with no usage counts as ${WORST_CASE_NEURONS}) against the
account's 10,000 a day, which the live site answers from, and each Gemini model allows about 20 requests a day.
Never run it in CI: it refuses when CI is set.

  --base            where the Worker listens (default ${DEFAULT_BASE}); exit 2 when nothing answers there
  --brains          brain ids, or all (default: the first brain). all prints its estimate and stops without --confirm-spend
  --confirm-spend   lets --brains all run
  --only            re-run these case ids only (live cases)
  --budget          Neurons this run may spend; it stops before the case that would pass it (default ${DEFAULT_BUDGET})
  --gemini-cap      requests a run may send each Gemini model (default ${DEFAULT_GEMINI_CAP})
  --delay-ms        pause between requests (default ${DEFAULT_DELAY_MS})
  --out-dir         where full answers go, relative to docs/ (default ${DEFAULT_OUT_DIR}, gitignored)
  --write-baseline  write evals/live-<brainId>.json, only from a run where every case passed

Exit codes: 0 clean; 1 a case that passed in the committed report now fails; 2 a usage error, or no Worker to run
against; 3 the run left cases ungraded (a 429, every brain out for the day, or the budget).`;

export type Parsed =
  | { kind: "help" }
  | { kind: "error"; message: string }
  | { kind: "preview"; lines: string[] }
  | {
      kind: "run";
      options: RunOptions;
      brains: GuardBrain[];
      cases: EvalCase[];
    };

/** The slice of a committed report the estimates read. A `null` figure was never measured. */
export interface ReportNeurons {
  cases: Readonly<Record<string, { neurons?: number | null } | undefined>>;
}

export type CommittedReports = Readonly<
  Record<string, ReportNeurons | undefined>
>;

/** What one case is expected to cost: the committed report's figure, else the worst case. */
export function estimateNeurons(
  report: ReportNeurons | undefined,
  caseId: string,
): number {
  return report?.cases[caseId]?.neurons ?? WORST_CASE_NEURONS;
}

const OPTIONS = {
  help: { type: "boolean", short: "h" },
  base: { type: "string", default: DEFAULT_BASE },
  brains: { type: "string" },
  "confirm-spend": { type: "boolean" },
  only: { type: "string" },
  budget: { type: "string" },
  "gemini-cap": { type: "string" },
  "delay-ms": { type: "string" },
  "out-dir": { type: "string", default: DEFAULT_OUT_DIR },
  "write-baseline": { type: "boolean" },
} as const;

const count = (raw: string | undefined, fallback: number): number =>
  raw === undefined ? fallback : Number(raw);

export function parseRunArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  known: {
    brains: readonly GuardBrain[];
    liveCases: readonly EvalCase[];
    committed?: CommittedReports;
  },
): Parsed {
  let values: ReturnType<
    typeof parseArgs<{ options: typeof OPTIONS }>
  >["values"];
  try {
    ({ values } = parseArgs({ args: [...argv], options: OPTIONS }));
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (values.help) return { kind: "help" };

  // The first limit: no run, and no preview, under CI.
  if (env.CI) {
    return {
      kind: "error",
      message: "refusing to run under CI: live evals spend real quota",
    };
  }

  const numbers = {
    budget: count(values.budget, DEFAULT_BUDGET),
    "gemini-cap": count(values["gemini-cap"], DEFAULT_GEMINI_CAP),
    "delay-ms": count(values["delay-ms"], DEFAULT_DELAY_MS),
  };
  for (const [name, value] of Object.entries(numbers)) {
    if (!Number.isFinite(value) || value < 0) {
      return {
        kind: "error",
        message: `--${name} must be a non-negative number`,
      };
    }
  }

  const all = values.brains === "all";
  const brains: GuardBrain[] = [];
  if (all) brains.push(...known.brains);
  else if (values.brains !== undefined) {
    for (const id of values.brains.split(",").map((part) => part.trim())) {
      const brain = known.brains.find((candidate) => candidate.id === id);
      if (brain === undefined) {
        return { kind: "error", message: `unknown brain id: ${id}` };
      }
      brains.push(brain);
    }
  } else {
    const first = known.brains[0];
    if (first !== undefined) brains.push(first);
  }

  const asked =
    values.only === undefined
      ? []
      : values.only.split(",").map((part) => part.trim());
  const unknownIds = asked.filter(
    (id) => !known.liveCases.some((c) => c.id === id),
  );
  if (unknownIds.length > 0) {
    return {
      kind: "error",
      message: `unknown or non-live case id: ${unknownIds.join(", ")}`,
    };
  }
  const cases =
    asked.length > 0
      ? known.liveCases.filter((c) => asked.includes(c.id))
      : [...known.liveCases];

  const options: RunOptions = {
    base: values.base.replace(/\/$/, ""),
    brainIds: brains.map((brain) => brain.id),
    all,
    confirmSpend: values["confirm-spend"] ?? false,
    only: asked,
    budget: numbers.budget,
    geminiCap: numbers["gemini-cap"],
    delayMs: numbers["delay-ms"],
    outDir: values["out-dir"],
    writeBaseline: values["write-baseline"] ?? false,
  };

  // `--brains all` asks first: it prints the cost and sends nothing without --confirm-spend.
  if (all && !options.confirmSpend) {
    return {
      kind: "preview",
      lines: previewLines(brains, cases, options, known.committed ?? {}),
    };
  }
  return { kind: "run", options, brains, cases };
}

function previewLines(
  brains: readonly GuardBrain[],
  cases: readonly EvalCase[],
  options: RunOptions,
  committed: CommittedReports,
): string[] {
  const lines = ["--brains all would run:"];
  for (const brain of brains) {
    if (brain.provider === "workers-ai") {
      const total = cases.reduce(
        (sum, c) => sum + estimateNeurons(committed[brain.id], c.id),
        0,
      );
      lines.push(
        `  ${brain.id}: ${cases.length} cases, about ${total} Neurons (budget ${options.budget})`,
      );
    } else {
      lines.push(
        `  ${brain.id}: ${cases.length} cases, up to ${Math.min(cases.length, options.geminiCap)} requests (cap ${options.geminiCap})`,
      );
    }
  }
  lines.push("Nothing was sent. Add --confirm-spend to run it.");
  return lines;
}

/**
 * The Neurons one answer cost, from the token counts `RUN_FINISHED` carried and the model's published rates (D10). An
 * answer with no usage, or a model with no rates, counts as the worst case and is flagged as not measured.
 */
export function measureNeurons(
  brain: GuardBrain,
  usage: StreamUsage | null,
): { neurons: number; measured: boolean } {
  const rates =
    brain.model === undefined ? undefined : NEURONS_PER_MILLION[brain.model];
  if (usage === null || rates === undefined) {
    return { neurons: WORST_CASE_NEURONS, measured: false };
  }
  return {
    neurons: Math.round(
      (usage.inputTokens * rates[0] + usage.outputTokens * rates[1]) / 1e6,
    ),
    measured: true,
  };
}

export type Decision =
  | { start: true }
  | { start: false; note: "budget" | "gemini cap"; endsRun: boolean };

/** Tracks what a run has spent and decides, before each case, whether it may start. */
export class RunGuard {
  spent = 0;
  stopped = false;
  private readonly requests = new Map<string, number>();
  private readonly limits: { budget: number; geminiCap: number };
  private readonly committed: CommittedReports;

  constructor(
    limits: { budget: number; geminiCap: number },
    committed: CommittedReports = {},
  ) {
    this.limits = limits;
    this.committed = committed;
  }

  /** A budget stop ends the run: that case and every later one are `ungraded`. A Gemini cap stops that model only. */
  decide(brain: GuardBrain, caseId: string): Decision {
    if (this.stopped) return { start: false, note: "budget", endsRun: true };
    if (brain.provider === "google") {
      if ((this.requests.get(brain.id) ?? 0) >= this.limits.geminiCap) {
        return { start: false, note: "gemini cap", endsRun: false };
      }
      return { start: true };
    }
    const reserved = estimateNeurons(this.committed[brain.id], caseId);
    if (this.spent + reserved > this.limits.budget) {
      this.stopped = true;
      return { start: false, note: "budget", endsRun: true };
    }
    return { start: true };
  }

  /** Call after each request: a Gemini request counts against its model's cap, a Workers AI one against the budget. */
  record(brain: GuardBrain, neurons: number): void {
    this.requests.set(brain.id, (this.requests.get(brain.id) ?? 0) + 1);
    if (brain.provider === "workers-ai") this.spent += neurons;
  }
}
