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

/** The pointer's speed, as a share of the loudest, below which the rustle is let go. */
export const RUSTLE_FLOOR = 0.02;
/** How fast the pointer's remembered speed dies away, per second, when it has stopped moving. */
export const RUSTLE_DECAY = 20;

export interface RustleState {
  /** The pointer's remembered speed, 0 to 1. */
  speed: number;
  /** Whether the pointer is over the art box. */
  active: boolean;
  /** Whether the voice has been told to sound and not yet to let go. */
  rustling: boolean;
  /** Whether the reader has sound on (`html[data-sound="on"]`). Muted, nothing is sent; absent counts as on. */
  soundOn?: boolean;
}

/**
 * One frame of the pointer's rustle: whether to sound at the speed it has now (`sound`), whether to tell the voice to let
 * go (`release`: a speed of 0), the speed after this frame's decay, and whether the voice is still sounding. The speed
 * dies away at `RUSTLE_DECAY` per second, so a pointer that stops falls below `RUSTLE_FLOOR` in about 0.2 s and is
 * released inside half a second, with the voice's own follow after it. `wall` is the frame's wall-clock seconds.
 */
export function rustleStep(
  { speed, active, rustling, soundOn = true }: RustleState,
  wall: number,
): { sound: boolean; release: boolean; speed: number; rustling: boolean } {
  // Muted, no rustle is sent on any frame (Baldur, #354); one still sounding is let go.
  const sound = soundOn && active && speed > RUSTLE_FLOOR;
  return {
    sound,
    release: !sound && rustling,
    speed: speed * Math.exp(-RUSTLE_DECAY * wall),
    rustling: sound,
  };
}

/**
 * Which sound a stage makes (D11): the opening makes the gust and each later stage a change; a picture forming makes
 * none (it is not a stage), and neither does a stage re-fitted after a resize. Nothing at all while sound is muted, so a
 * muted visitor, the default, pays nothing for the leaves' sound (#354 review).
 */
export function soundFor(
  options: {
    quick?: boolean;
    gustIn?: boolean;
  },
  soundOn: boolean,
): Extract<CueName, "gust" | "change"> | null {
  if (!soundOn || options.quick) return null;
  return options.gustIn ? "gust" : "change";
}
