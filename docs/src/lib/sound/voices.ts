/**
 * Every sound, one function each. `t` is a time on the audio clock; `out` is the master bus.
 *
 * Starts with no voices (plan #352, phase 4): the engine, its gaps and its master bus are here, and nothing sounds.
 * Later phases add theirs to the two maps below: the volume notch (phase 5), the leaf particles' gust and changes
 * (phase 6) and the Dox chat's voices (phase 8). `CueName` and `LoopName` in `cue.ts` already list the names those
 * phases use, so a phase fills its entry in rather than widening a type.
 */
import type { CueName, LoopName } from "./cue";

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

/** A cue with no voice here is ignored by the engine. */
export const VOICES: Record<CueName, Voice | null> = {
  notch: null,
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
