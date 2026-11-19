/**
 * The leaves' voices (plan #352, D11 and D12): each change of picture, which the opening gust shares, and the pointer's
 * rustle, ported from the audition board (context/reference/settings-gear/sound-audition.html): MORPHS "D" Sweep and grains
 * (MORPHS "A" Rustle sweep at 0.6 through `scaled`, a `leafTick` at 0.008 for each landing grain), TOUCHES "D" Soft
 * rustle, and the helpers `panTo`, `swell`, `leafTick`, `scaled` and
 * `untilLanded`.
 *
 * This is a chunk of its own: the engine imports it only on the landing, so no other page loads a byte of it. It makes
 * no sound by itself; the engine hands it the audio context, the master bus and the stage's flight (`hero/flight.ts`).
 *
 * Every time is on the audio clock. No voice here schedules a value curve (`setValueCurveAtTime`): Safari and Firefox throw
 * when one overlaps another automation on the same `AudioParam`, so a voice that ever needs one must leave its parameter
 * nothing else scheduled after the curve's start.
 */
import type { FlightDetail } from "./cue";
import { biquad, noise, noiseBuffer, rand } from "./kit";

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

/** A stereo panner to `out`, set to `p` (-1 to 1). */
export function panTo(
  c: AudioContext,
  out: AudioNode,
  p: number,
): StereoPannerNode {
  const s = c.createStereoPanner();
  s.pan.value = clamp(p, -1, 1);
  s.connect(out);
  return s;
}

/** A gain stage that scales what is sent through it by `k`. */
function scaled(c: AudioContext, out: AudioNode, k: number): GainNode {
  const g = c.createGain();
  g.gain.value = k;
  g.connect(out);
  return g;
}

interface SwellOptions {
  type: BiquadFilterType;
  freq: number;
  peakFreq: number;
  to: number;
  q: number;
  peak: number;
  attack: number;
  decay: number;
}

/** A swell of filtered noise: silence, a rise over `attack`, a fall over `decay`; the filter rides up and back. */
function swell(c: AudioContext, out: AudioNode, t: number, o: SwellOptions) {
  const end = t + o.attack + o.decay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const f = biquad(c, o.type, o.freq, o.q);
  f.frequency.setValueAtTime(o.freq, t);
  f.frequency.linearRampToValueAtTime(o.peakFreq, t + o.attack);
  f.frequency.linearRampToValueAtTime(o.to, end);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(o.peak, t + o.attack);
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 2.5);
  src.stop(end + 0.05);
}

/** One dry leaf touching another: a few milliseconds of bright noise. */
export function leafTick(
  c: AudioContext,
  out: AudioNode,
  t: number,
  peak = 0.012,
) {
  noise(c, out, t, {
    type: "bandpass",
    freq: rand(2800, 6200),
    q: rand(1.5, 3),
    peak,
    attack: 0.001,
    decay: rand(0.004, 0.009),
  });
}

/**
 * A bus that is silent once the last leaf has landed: the wind is the leaves, so it never outlasts them. It holds at 1
 * and falls to 0 over the last 0.25 s of `dur`, a guard under the voices' own envelopes.
 */
function untilLanded(
  c: AudioContext,
  out: AudioNode,
  at: number,
  dur: number,
): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(1, at);
  g.gain.setValueAtTime(1, at + Math.max(0, dur - 0.25));
  g.gain.linearRampToValueAtTime(0, at + dur);
  g.connect(out);
  return g;
}

/** MORPHS "A" Rustle sweep: a rustle that travels with the leaves, left to right as the wordmark is written. */
function rustleSweep(
  c: AudioContext,
  out: AudioNode,
  t: number,
  flight: FlightDetail,
) {
  const p = c.createStereoPanner();
  p.connect(out);
  const dur = flight.duration;
  if (flight.stage === "word") {
    p.pan.setValueAtTime(-0.7, t);
    p.pan.linearRampToValueAtTime(0.7, t + dur);
  }
  swell(c, p, t, {
    type: "bandpass",
    freq: 1100,
    peakFreq: flight.stage === "word" ? 1800 : 2600,
    to: 1500,
    q: 0.9,
    peak: 0.026,
    attack: dur * 0.45,
    decay: dur * 0.55,
  });
}

/** One picture becoming the next: MORPHS "D" Sweep and grains. Silent from the last landing. */
export function change(
  c: AudioContext,
  out: AudioNode,
  t: number,
  flight: FlightDetail,
): void {
  const bus = untilLanded(c, out, t, flight.duration);
  rustleSweep(c, scaled(c, bus, 0.6), t, flight);
  for (const g of flight.grains)
    leafTick(c, panTo(c, bus, g.pan), t + g.at, 0.008);
}

/**
 * The opening: the leaves sweeping in, in the change's voice over the opening's own flight (plan #352, D11 as amended:
 * "use the same sound for the initial entrance of the particles"). Not a second voice: the same function.
 */
export const gust = change;

/**
 * What is left of a stage `elapsed` seconds after it started: only the grains still to come (timed from now), and the
 * time to its last landing. Nothing (`undefined`) once its last leaf has landed. A
 * stage that has not started is returned as it is. A stage that began before sound was ready is joined here, not
 * replayed.
 */
export function fromOffset(
  flight: FlightDetail,
  elapsed: number,
): FlightDetail | undefined {
  if (!(elapsed < flight.duration)) return undefined;
  if (elapsed <= 0) return flight;
  return {
    ...flight,
    duration: flight.duration - elapsed,
    grains: flight.grains
      .filter((g) => g.at >= elapsed)
      .map((g) => ({ ...g, at: g.at - elapsed })),
  };
}

/** A voice that follows the pointer: `set` every frame, `stop` to let it go. */
export interface Rustle {
  set(speed: number, pan: number): void;
  stop(): void;
}

/** TOUCHES "D" Soft rustle. */
const SOFT = {
  band: 1500,
  lift: 900,
  q: 0.7,
  lowpass: 4500,
  peak: 0.02,
  follow: 0.1,
};

/**
 * Leaves brushing aside: one continuous bandpassed noise for the whole drag, its loudness and brightness following the
 * pointer's speed (0 to 1), panned to the pointer, easing in and out.
 */
export function startRustle(c: AudioContext, out: AudioNode): Rustle {
  const o = SOFT;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c);
  src.loop = true;
  const f = biquad(c, "bandpass", o.band, o.q);
  const dark = biquad(c, "lowpass", o.lowpass);
  const g = c.createGain();
  g.gain.value = 0;
  const p = c.createStereoPanner();
  src.connect(f).connect(dark).connect(g).connect(p).connect(out);
  src.start();
  return {
    set(speed, pan) {
      g.gain.setTargetAtTime(o.peak * speed, c.currentTime, o.follow);
      f.frequency.setTargetAtTime(
        o.band + o.lift * speed,
        c.currentTime,
        o.follow * 1.3,
      );
      p.pan.setTargetAtTime(pan * 0.7, c.currentTime, 0.06);
    },
    stop() {
      g.gain.setTargetAtTime(0, c.currentTime, 0.06);
      src.stop(c.currentTime + 0.5);
    },
  };
}
