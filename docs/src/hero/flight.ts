/**
 * What the leaves of one stage are doing, as numbers a sound can follow (plan #352, D10). Pure: it reads the arrays the
 * animation already holds (every leaf's `delay`, `dur` and the x it flies from and to) and returns about 60 numbers for
 * the stage, computed once when the stage starts, never per frame.
 *
 * Ported from the audition board's `flight` (context/reference/settings-gear/sound-audition.html): every 50 ms the leaves in
 * flight are summed, each weighted `sin(pi * p)` for how far through its flight it is (so fastest mid-flight), and the
 * sum is normalised to the stage's peak; the pan is the weighted mean x of those leaves.
 */
import type { CueName } from "../lib/sound/cue";

/** Seconds between two samples of a curve. */
export const FLIGHT_STEP = 0.05;
/** How far to a side the pan goes at the page's edge: the sound stays a little inside the speakers. */
const PAN_REACH = 0.85;
/** Where in its flight a leaf is heard landing. */
const LANDING_AT = 0.92;

export interface FlightInput {
  /** Each leaf's take-off and flight time, in the simulation's seconds. */
  delay: ArrayLike<number>;
  dur: ArrayLike<number>;
  /** Where each leaf flies from and to, as x from the page's centre, in the same unit as `halfWidth`. */
  from: ArrayLike<number>;
  to: ArrayLike<number>;
  /** The first `count` leaves are the flock. */
  count: number;
  /** Half the page's width: a leaf there pans fully to a side. */
  halfWidth: number;
  /** Audio-clock seconds per simulated second (the animation's `PACE`). */
  pace?: number;
  /**
   * Read every `every`th leaf (default 1). The curve is a share of the flock normalised to its peak, so a regular
   * sample of the flock gives the same shape for a fraction of the work (plan #352 §5, "The leaves stutter").
   */
  every?: number;
  /** How many landing grains to pick, and from how many leading leaves. */
  grains?: { count: number; pool: number };
  /** In [0, 1): injected so a test can fix the grains. */
  random?: () => number;
}

export interface Flight {
  /** The share of the stage's peak in flight every `step` seconds, 0 to 1; 0 at its first and last samples. */
  curve: Float32Array;
  /** The side of the page the flock is on at the same moments, -0.85 to 0.85. */
  panCurve: Float32Array;
  step: number;
  /** Seconds, on the audio clock, from the stage's start to its last landing. */
  duration: number;
  /** Where and when some leaves land, in time order. */
  grains: { at: number; pan: number }[];
}

function clampPan(x: number, halfWidth: number): number {
  const v = x / halfWidth;
  return (v < -1 ? -1 : v > 1 ? 1 : v) * PAN_REACH;
}

/**
 * Each leaf adds its weight to the samples it is in flight for, so a pass costs the flock's samples in the air, not
 * every leaf at every sample.
 */
export function flight({
  delay,
  dur,
  from,
  to,
  count,
  halfWidth,
  pace = 1,
  every = 1,
  grains = { count: 0, pool: 0 },
  random = Math.random,
}: FlightInput): Flight {
  let length = 0;
  for (let i = 0; i < count; i++)
    length = Math.max(length, (delay[i] + dur[i]) * pace);
  // The epsilon (far above the arrays' float32 rounding, far below a step) keeps a length that is a whole number of
  // steps from gaining a sample.
  const n = Math.max(2, Math.ceil(length / FLIGHT_STEP - 1e-5) + 1);
  const air = new Float32Array(n);
  const sumX = new Float32Array(n);
  for (let i = 0; i < count; i += every) {
    if (!(dur[i] > 0)) continue;
    const start = delay[i] * pace;
    const span = dur[i] * pace;
    const first = Math.max(0, Math.floor(start / FLIGHT_STEP + 1e-9) + 1);
    for (let k = first; k < n; k++) {
      const p = (k * FLIGHT_STEP - start) / span;
      if (p >= 1) break;
      if (p <= 0) continue;
      const w = Math.sin(Math.PI * p); // fastest mid-flight
      air[k] += w;
      sumX[k] += w * (from[i] + (to[i] - from[i]) * p);
    }
  }
  // The last sample is at or after the last landing, where float32 rounding can leave a hair of weight: a gain curve
  // ends in exact silence.
  air[n - 1] = 0;
  let most = 0;
  for (let k = 0; k < n; k++) most = Math.max(most, air[k]);
  const curve = new Float32Array(n);
  const panCurve = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    if (air[k] <= 0) continue;
    curve[k] = air[k] / most;
    panCurve[k] = clampPan(sumX[k] / air[k], halfWidth);
  }
  const landing: { at: number; pan: number }[] = [];
  for (let g = 0; g < grains.count; g++) {
    const i = Math.floor(random() * grains.pool);
    landing.push({
      at: (delay[i] + dur[i] * LANDING_AT) * pace,
      pan: clampPan(to[i], halfWidth),
    });
  }
  landing.sort((a, b) => a.at - b.at);
  return {
    curve,
    panCurve,
    step: FLIGHT_STEP,
    duration: length,
    grains: landing,
  };
}

/**
 * Which sound a stage makes (D11): the opening makes the gust and each later stage a change; a picture forming makes
 * none (it is not a stage), and neither does a stage re-fitted after a resize.
 */
export function soundFor(options: {
  quick?: boolean;
  gustIn?: boolean;
}): Extract<CueName, "gust" | "change"> | null {
  if (options.quick) return null;
  return options.gustIn ? "gust" : "change";
}
