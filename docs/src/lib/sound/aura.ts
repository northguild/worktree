/**
 * The landing's aura (plan #352, D14): one of two tracks the reader picks in the settings panel, ported unchanged from
 * the audition board's `BEDS` (context/reference/settings-gear/sound-audition.html). Loaded by the engine only where `<html>`
 * has `data-aura` (the landing), the reader is unmuted and the aura is on, so no other page fetches it.
 *
 * - "Forest air" (A, the default): two bands of looped noise, panned -0.6 and 0.6, low-passed at 500 and 620 Hz, each
 *   breathing through a slow LFO.
 * - "Leaves overhead" (B): Forest air, and a faint `leafTick` every 1.5 to 4.5 s, panned anywhere from -0.8 to 0.8.
 *
 * The structure is GMT's apps/dox/src/lib/sound/aura.ts at d6031ecd: everything sits on one bus 12 dB under the cues
 * (0.25 of the master), built once per context; the bus does the fade in and out, each track plays into its own gain
 * under it, and a change of track crossfades the two gains while the bus holds still. On a stop the playing track's gain
 * drops to 0 as the bus reaches 0. The board's bed fades itself in over 2 s and out over 0.8 s; here the bus and the
 * track gains do that, so a track's body keeps the board's numbers and drops its own envelope. Every fade and tick is on
 * `ctx.currentTime`.
 */
import { biquad, noiseBuffer, rand, scheduler, sharedFx } from "./kit";
import { leafTick, panTo } from "./leaves";
import type { AuraTrack } from "./settings";

/** The bus level: 12 dB under the cues, 10 ** (-12 / 20). */
export const AURA_LEVEL = 0.25;

export interface Aura {
  /** Fade the bus out over `fade` seconds, then stop every track's sources. */
  stop(fade: number): void;
  /** Fade the playing track out and `track` in, both over `over` seconds; the bus holds. */
  switchTo(track: AuraTrack, over: number): void;
}

/** A track, playing into `out` (its own gain). Returns its stop: sources end after `fade`. */
type Track = (c: AudioContext, out: AudioNode) => (fade: number) => void;

/** Forest air, from the board's BEDS A: two noise bands, each with a slow LFO on its level. */
const forestAir: Track = (c, out) => {
  const stops = [-0.6, 0.6].map((pan, k) => {
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c);
    src.loop = true;
    const f = biquad(c, "lowpass", 500 + k * 120, 0.6);
    const lv = c.createGain();
    lv.gain.value = 0.009;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07 + k * 0.03;
    const depth = c.createGain();
    depth.gain.value = 0.006;
    lfo.connect(depth).connect(lv.gain);
    src
      .connect(f)
      .connect(lv)
      .connect(panTo(c, out, pan));
    src.start(c.currentTime, Math.random() * 2.5);
    lfo.start();
    return (fade: number) => {
      src.stop(c.currentTime + fade + 0.05);
      lfo.stop(c.currentTime + fade + 0.05);
    };
  });
  return (fade) => {
    for (const stop of stops) stop(fade);
  };
};

/** Leaves overhead, from the board's BEDS B: Forest air and one faint tick every few seconds. */
const leavesOverhead: Track = (c, out) => {
  const stopAir = forestAir(c, out);
  const stopTicks = scheduler(
    c,
    () => rand(1.5, 4.5),
    (t) => leafTick(c, panTo(c, out, rand(-0.8, 0.8)), t, 0.006),
  );
  return (fade) => {
    stopAir(fade);
    stopTicks();
  };
};

export const TRACKS: Record<AuraTrack, Track> = {
  forest: forestAir,
  overhead: leavesOverhead,
};

/** A track playing into its own gain under the bus. */
interface Playing {
  gain: GainNode;
  stop: (fade: number) => void;
}

/** Ramp `param` from where it is now to `to` over `over` seconds. */
function ramp(c: AudioContext, param: AudioParam, to: number, over: number) {
  const t = c.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + over);
}

/** Start the aura playing `track`, fading in over `fadeIn` seconds from now. */
export function startAura(
  c: AudioContext,
  master: AudioNode,
  fadeIn = 2,
  track: AuraTrack = "forest",
): Aura {
  const bus = sharedFx(c, "aura", (cc) => {
    const g = cc.createGain();
    g.gain.value = 0;
    g.connect(master);
    return g;
  });
  ramp(c, bus.gain, AURA_LEVEL, fadeIn);

  const play = (name: AuraTrack, from: number): Playing => {
    const gain = c.createGain();
    gain.gain.value = from;
    gain.connect(bus);
    return { gain, stop: TRACKS[name](c, gain) };
  };
  let current = play(track, 1);
  let playing: AuraTrack = track;
  let stopped = false;
  return {
    stop(fade) {
      if (stopped) return;
      stopped = true;
      ramp(c, bus.gain, 0, fade);
      // The bus does the fade; the track's own gain only closes behind it, with no ramp of its own.
      const t = c.currentTime;
      const own = current.gain.gain;
      own.cancelScheduledValues(t);
      own.setValueAtTime(own.value, t);
      own.setValueAtTime(0, t + fade);
      current.stop(fade);
    },
    switchTo(next, over) {
      if (stopped || next === playing) return;
      ramp(c, current.gain.gain, 0, over);
      current.stop(over);
      current = play(next, 0);
      playing = next;
      ramp(c, current.gain.gain, 1, over);
    },
  };
}
