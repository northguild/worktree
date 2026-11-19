/**
 * Every sound, one function each. `t` is a time on the audio clock; `out` is the master bus.
 *
 * Phase 4 gave the engine, its gaps and its master bus and no voices; phase 5 added the volume notch.
 * Later phases add theirs to the two maps below: the leaf particles' gust and changes
 * (phase 6) and the Dox chat's voices (phase 8). `CueName` and `LoopName` in `cue.ts` already list the names those
 * phases use, so a phase fills its entry in rather than widening a type.
 */
import type { CueName, LoopName } from "./cue";
import { noise } from "./kit";

/**
 * `rank` is the cue's place in a run of like cues, 0 for the first (`cue(name, rank)`); a voice that does not climb
 * ignores it.
 */
export type Voice = (
  c: AudioContext,
  out: AudioNode,
  t: number,
  rank: number,
) => void;
/** Starts a loop on `bus` and returns its stop function. */
export type Loop = (c: AudioContext, bus: AudioNode) => () => void;

/**
 * The volume notch (D9), the audition board's NOTCHES[4], "Leaf brush": a fingertip across a leaf, a bandpass brush of
 * air with no pitch, barely there. It is the same at every level; the master bus is what makes it louder.
 */
const notch: Voice = (c, out, t) => {
  noise(c, out, t, {
    freq: 2600,
    to: 3400,
    q: 1.2,
    peak: 0.035,
    attack: 0.006,
    decay: 0.03,
  });
};

/** A cue with no voice here is ignored by the engine. */
export const VOICES: Record<CueName, Voice | null> = {
  notch,
  key: null,
  send: null,
  stream: null,
  done: null,
  error: null,
  gust: null,
  change: null,
};

/** A loop with no entry here is ignored by the engine. */
export const LOOPS: Record<LoopName, Loop | null> = {
  thinking: null,
};
