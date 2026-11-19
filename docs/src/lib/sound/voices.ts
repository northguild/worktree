/**
 * Every sound, one function each. `t` is a time on the audio clock; `out` is the master bus.
 *
 * Phase 4 gave the engine, its gaps and its master bus and no voices; phase 5 added the volume notch.
 * Later phases add theirs to the two maps below: the leaf particles' gust and changes
 * (phase 6); the Dox chat's seven voices (phase 8, plan #352 D13) are ported from gmt `voices.ts` at d6031ecd. `CueName` and `LoopName` in `cue.ts` already list the names those
 * phases use, so a phase fills its entry in rather than widening a type.
 */
import type { CueName, LoopName } from "./cue";
import { bell, echo, hz, noise, scheduler, sharedFx, space, tone } from "./kit";
import { fadedLoop } from "./loops";

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

/** A frequency `z` of the way from `lo` to `hi`, on a log scale. */
const zoomPitch = (lo: number, hi: number, z: number): number =>
  lo * (hi / lo) ** z;

/** A cue with no voice here is ignored by the engine. */
export const VOICES: Record<CueName, Voice | null> = {
  notch,
  // key C, "Data blip": very quiet high blips from a pentatonic scale, like a terminal echoing keys.
  key(c, out, t) {
    const notes = [93, 95, 98, 100, 102];
    tone(c, out, t, {
      freq: hz(notes[Math.floor(Math.random() * notes.length)]),
      peak: 0.03,
      attack: 0.002,
      release: 0.03,
    });
  },
  // send C, "Sonar launch": one ping with a run of echoes receding into the distance. The
  // audition builds the echo per play; here it is built once per context, like `sonarEcho`.
  send(c, out, t) {
    const far = sharedFx(c, "launch", (cc, o) => echo(cc, o, 0.12, 0.5, 0.5));
    tone(c, out, t, { freq: 1180, peak: 0.1, attack: 0.003, release: 0.15 });
    tone(c, far, t, { freq: 1180, peak: 0.08, attack: 0.003, release: 0.12 });
  },
  // stream C, "Morse": a short soft beep per chunk, like a signal keyed in.
  stream(c, out, t) {
    tone(c, out, t, {
      freq: 700,
      peak: 0.035,
      attack: 0.003,
      hold: 0.02,
      release: 0.01,
    });
  },
  // done C, "Ice bell": one high ice bell ringing out in the room.
  done(c, out, t) {
    bell(c, out, t, {
      freq: 2093,
      ratios: [1, 2.76, 5.4],
      peak: 0.05,
      decay: 1.2,
    });
    bell(c, space(c), t, {
      freq: 2093,
      ratios: [1, 2.76],
      peak: 0.04,
      decay: 1.2,
    });
  },
  // loading E, "Servo spin-up": three soft notches of the globe's lens servo, climbing: something
  // winding up.
  loading(c, out, t) {
    for (let i = 0; i < 3; i++) {
      const f = zoomPitch(650, 1500, i / 2);
      noise(c, out, t + i * 0.09, {
        freq: f,
        to: f * 1.3,
        q: 4,
        peak: 0.028,
        attack: 0.006,
        decay: 0.04,
      });
    }
  },
  // error B, "Low double buzz": two short, muffled low buzzes.
  error(c, out, t) {
    for (const at of [0, 0.11]) {
      tone(c, out, t + at, {
        type: "square",
        freq: 110,
        peak: 0.07,
        attack: 0.004,
        hold: 0.05,
        release: 0.03,
        filter: ["lowpass", 600],
      });
    }
  },
  gust: null,
  change: null,
};

/** A loop with no entry here is ignored by the engine. */
export const LOOPS: Record<LoopName, Loop | null> = {
  // thinking F, "Sonar idle": one very soft, low ping every 1.6 s, the sonar listening while it
  // waits. The body is the audition's; `fadedLoop` puts it behind a bus that swells in over 0.3 s
  // and dims over 0.15 s, and its stop ends the scheduling: a ping already queued plays into the
  // dimmed bus.
  thinking: fadedLoop(
    (c, bus) =>
      scheduler(
        c,
        () => 1.6,
        (t) =>
          tone(c, bus, t, {
            freq: 587,
            peak: 0.014,
            attack: 0.01,
            release: 0.45,
            filter: ["lowpass", 1200],
          }),
      ),
    0.3,
    0.15,
  ),
};
