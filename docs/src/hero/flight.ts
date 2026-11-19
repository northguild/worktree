/**
 * What the leaves of one stage are doing, as numbers a sound can follow (plan #352, D10, as amended by the review of PR
 * 354): when the last leaf lands and where a few of them land. Pure: it reads the arrays the animation already holds
 * and is computed once when the stage starts, never per frame.
 *
 * The audition board's `flight` also summed the leaves in the air every 50 ms into a loudness curve and a pan curve.
 * Nothing played them (the voices read only the duration, the stage and the grains), so they are not built.
 */
import type { CueName } from "../lib/sound/cue";

/** How far to a side the pan goes at the page's edge: the sound stays a little inside the speakers. */
const PAN_REACH = 0.85;
/** Where in its flight a leaf is heard landing. */
const LANDING_AT = 0.92;

export interface FlightInput {
  /** Each leaf's take-off and flight time, in the simulation's seconds. */
  delay: ArrayLike<number>;
  dur: ArrayLike<number>;
  /** Where each leaf lands, as x from the page's centre, in the same unit as `halfWidth`. */
  to: ArrayLike<number>;
  /** The first `count` leaves are the flock. */
  count: number;
  /** Half the page's width: a leaf there pans fully to a side. */
  halfWidth: number;
  /** Audio-clock seconds per simulated second (the animation's `PACE`). */
  pace?: number;
  /** How many landing grains to pick, and from how many leading leaves. */
  grains?: { count: number; pool: number };
  /** In [0, 1): injected so a test can fix the grains. */
  random?: () => number;
}

export interface Flight {
  /** Seconds, on the audio clock, from the stage's start to its last landing. */
  duration: number;
  /** Where and when some leaves land, in time order. */
  grains: { at: number; pan: number }[];
}

function clampPan(x: number, halfWidth: number): number {
  const v = x / halfWidth;
  return (v < -1 ? -1 : v > 1 ? 1 : v) * PAN_REACH;
}

export function flight({
  delay,
  dur,
  to,
  count,
  halfWidth,
  pace = 1,
  grains = { count: 0, pool: 0 },
  random = Math.random,
}: FlightInput): Flight {
  // Over every leaf, so the silence lands at the true last landing.
  let length = 0;
  for (let i = 0; i < count; i++)
    length = Math.max(length, (delay[i] + dur[i]) * pace);
  const landing: { at: number; pan: number }[] = [];
  for (let g = 0; g < grains.count; g++) {
    const i = Math.floor(random() * grains.pool);
    landing.push({
      at: (delay[i] + dur[i] * LANDING_AT) * pace,
      pan: clampPan(to[i], halfWidth),
    });
  }
  landing.sort((a, b) => a.at - b.at);
  return { duration: length, grains: landing };
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
