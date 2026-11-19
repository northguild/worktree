import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeAudioContext,
  type FakeNode,
  installFakeAudio,
} from "../../test/fake-audio";
import type { FlightDetail } from "./cue";
import { change, fromOffset, gust, startRustle } from "./leaves";

let ctx: FakeAudioContext;
let out: FakeNode;
const as = (n: FakeNode) => n as unknown as AudioNode;

beforeEach(() => {
  installFakeAudio();
  ctx = new FakeAudioContext();
  out = ctx.destination;
});

/**
 * A short flight, ending at a duration of 0.15 s (the last landing).
 * The numbers the voices are expected to make from it are the audition board's (Sweep and grains).
 */
function stage(stageName: FlightDetail["stage"]): FlightDetail {
  return {
    stage: stageName,
    duration: 0.15,
    grains: [
      { at: 0.05, pan: -0.85 },
      { at: 0.1, pan: 0.85 },
    ],
  };
}

describe("the gust", () => {
  it("is the change's voice: Sweep and grains, with nothing of Soft canopy", () => {
    expect(gust).toBe(change);
    gust(ctx as unknown as AudioContext, as(out), 2, stage("leaf"));
    // the swell and one tick per grain, no pair of bands with value curves
    expect(ctx.started("bufferSource")).toHaveLength(1 + 2);
    expect(ctx.nodes.every((n) => n.gain.curves.length === 0)).toBe(true);
  });
});

describe("what is left of a stage (fromOffset)", () => {
  // Decided from D11 (amended) and the Done-when: only the grains still to come, silent at the last landing.
  const long = (): FlightDetail => ({
    stage: "leaf",
    duration: 0.25,
    grains: [
      { at: 0.05, pan: -1 },
      { at: 0.1, pan: -0.5 },
      { at: 0.2, pan: 0.5 },
    ],
  });

  it("keeps the grains still to come, timed from now, and ends at the last landing", () => {
    const rest = fromOffset(long(), 0.12);
    expect(rest?.duration).toBeCloseTo(0.13);
    expect(rest?.grains).toHaveLength(1);
    expect(rest?.grains[0].at).toBeCloseTo(0.08);
    expect(rest?.grains[0].pan).toBe(0.5);
    expect(rest?.stage).toBe("leaf");
  });

  it("plays nothing once every leaf has landed, and the whole stage if it has not started", () => {
    expect(fromOffset(long(), 0.25)).toBeUndefined();
    expect(fromOffset(long(), 3)).toBeUndefined();
    expect(fromOffset(long(), 0)?.grains).toHaveLength(3);
  });

  it("makes a voice that reaches 0 at the last landing and ticks only the grains left", () => {
    const rest = fromOffset(long(), 0.12);
    if (!rest) throw new Error("the stage is still in flight");
    gust(ctx as unknown as AudioContext, as(out), 5, rest);
    const guard = ctx.nodes.find(
      (n) =>
        n.gain.of("linearRampToValueAtTime").length === 1 &&
        n.gain.of("setValueAtTime").length === 2,
    );
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args[0]).toBe(0);
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args[1]).toBeCloseTo(
      5.13,
    );
    const ticks = ctx.nodes.filter(
      (n) =>
        n.kind === "bufferSource" &&
        n.startedAt !== undefined &&
        n.startedAt > 5,
    );
    expect(ticks).toHaveLength(1);
    expect(ticks[0].startedAt).toBeCloseTo(5.08);
  });
});

describe("a change (Sweep and grains)", () => {
  it("makes a bandpass swell that rises over 45% of the flight and falls over 55%, at 0.6 of its level", () => {
    change(ctx as unknown as AudioContext, as(out), 2, stage("graph"));
    const sweeps = ctx.started("bufferSource");
    expect(sweeps).toHaveLength(1 + 2); // the swell and one tick per grain
    const filter = ctx.nodes.find(
      (n) =>
        n.kind === "biquad" && n.frequency.of("linearRampToValueAtTime").length,
    );
    expect(filter?.Q.value).toBe(0.9);
    // 0.15 s: attack 0.0675, decay 0.0825
    expect(filter?.frequency.calls.map((c) => c.args)).toEqual([
      [1100, 2],
      [2600, 2.0675],
      [1500, 2.15],
    ]);
    const env = ctx.nodes.find((n) =>
      n.gain.of("linearRampToValueAtTime").some((c) => c.args[0] === 0.026),
    );
    expect(env?.gain.calls.map((c) => c.args)).toEqual([
      [0, 2],
      [0.026, 2.0675],
      [0, 2.15],
    ]);
    const scale = ctx.nodes.find(
      (n) => n.kind === "gain" && n.gain.value === 0.6,
    );
    expect(scale).toBeDefined();
  });

  it("brightens less and travels left to right for the wordmark", () => {
    change(ctx as unknown as AudioContext, as(out), 2, stage("word"));
    const filter = ctx.nodes.find(
      (n) =>
        n.kind === "biquad" && n.frequency.of("linearRampToValueAtTime").length,
    );
    expect(filter?.frequency.of("linearRampToValueAtTime")[0].args[0]).toBe(
      1800,
    );
    const pan = ctx.nodes.find((n) => n.pan.calls.length);
    expect(pan?.pan.calls.map((c) => c.args)).toEqual([
      [-0.7, 2],
      [0.7, 2.15],
    ]);
  });

  it("does not travel for the graph or the leaf", () => {
    change(ctx as unknown as AudioContext, as(out), 2, stage("leaf"));
    expect(ctx.nodes.every((n) => n.pan.calls.length === 0)).toBe(true);
  });

  it("ticks once for each landing grain, at its time and place, at a peak of 0.008", () => {
    change(ctx as unknown as AudioContext, as(out), 2, stage("graph"));
    const ticks = ctx.nodes.filter(
      (n) =>
        n.kind === "bufferSource" &&
        n.startedAt !== undefined &&
        n.startedAt > 2,
    );
    expect(ticks.map((n) => n.startedAt).sort()).toEqual([2.05, 2.1]);
    const peaks = ctx.nodes
      .filter((n) => n.kind === "gain")
      .flatMap((n) => n.gain.of("linearRampToValueAtTime"))
      .filter((c) => c.args[0] === 0.008);
    expect(peaks).toHaveLength(2);
    // the grains' panners: one at each side, both ending in the guard bus
    const pans = ctx.nodes.filter(
      (n) => n.kind === "stereoPanner" && n.pan.value !== 0,
    );
    expect(pans.map((p) => p.pan.value).sort()).toEqual([-0.85, 0.85]);
  });

  it("is silent from its last landing: the guard bus reaches 0 there, and every envelope ends by it", () => {
    change(ctx as unknown as AudioContext, as(out), 2, stage("graph"));
    const guard = ctx.nodes.find(
      (n) =>
        n.gain.of("linearRampToValueAtTime").length === 1 &&
        n.gain.of("setValueAtTime").length === 2,
    );
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args).toEqual([
      0, 2.15,
    ]);
    // The swell's gain ends at 0 exactly at the landing.
    const env = ctx.nodes.find((n) =>
      n.gain.of("linearRampToValueAtTime").some((c) => c.args[0] === 0.026),
    );
    expect(env?.gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      0, 2.15,
    ]);
  });
});

describe("the pointer's rustle (Soft rustle)", () => {
  it("is one voice: one noise source, started once, a bandpass at 1,500 Hz Q 0.7 under a 4,500 Hz lowpass", () => {
    startRustle(ctx as unknown as AudioContext, as(out));
    expect(ctx.started("bufferSource")).toHaveLength(1);
    const [band, dark] = ctx.nodes.filter((n) => n.kind === "biquad");
    expect([band.type, band.frequency.value, band.Q.value]).toEqual([
      "bandpass",
      1500,
      0.7,
    ]);
    expect([dark.type, dark.frequency.value]).toEqual(["lowpass", 4500]);
  });

  it("follows speed: gain 0.02 times speed (0.1 s), filter 1,500 + 900 times speed (0.13 s), pan 0.7 of the pointer's (0.06 s)", () => {
    const voice = startRustle(ctx as unknown as AudioContext, as(out));
    ctx.advance(1);
    voice.set(0.5, 0.4);
    const gain = ctx.nodes.find((n) => n.kind === "gain");
    const band = ctx.nodes.find((n) => n.kind === "biquad");
    const pan = ctx.nodes.find((n) => n.kind === "stereoPanner");
    expect(gain?.gain.of("setTargetAtTime")[0].args).toEqual([0.01, 1, 0.1]);
    expect(band?.frequency.of("setTargetAtTime")[0].args[0]).toBeCloseTo(1950);
    expect(band?.frequency.of("setTargetAtTime")[0].args[2]).toBeCloseTo(0.13);
    expect(pan?.pan.of("setTargetAtTime")[0].args[0]).toBeCloseTo(0.28);
    expect(pan?.pan.of("setTargetAtTime")[0].args[2]).toBe(0.06);
  });

  it("falls to silence within 0.5 s of being let go: gain target 0 and the source stopped at 0.5 s", () => {
    const voice = startRustle(ctx as unknown as AudioContext, as(out));
    ctx.advance(1);
    voice.set(1, 0);
    ctx.advance(0.2);
    voice.stop();
    const gain = ctx.nodes.find((n) => n.kind === "gain");
    expect(gain?.gain.of("setTargetAtTime").at(-1)?.args).toEqual([
      0, 1.2, 0.06,
    ]);
    expect(ctx.started("bufferSource")[0].stoppedAt).toBeCloseTo(1.7);
    // The target is an exponential approach, so 0.5 s after the release the gain is its level times exp(-0.5 / constant),
    // read from what the voice scheduled: below 0.00001, far under hearing.
    const level = gain?.gain.of("setTargetAtTime")[0].args[0] ?? 0;
    const constant = gain?.gain.of("setTargetAtTime").at(-1)?.args[2] ?? 0;
    expect(level).toBeGreaterThan(0);
    expect(level * Math.exp(-0.5 / constant)).toBeLessThan(0.00001);
  });

  it("with a speed of 0 aims the gain at 0", () => {
    const voice = startRustle(ctx as unknown as AudioContext, as(out));
    voice.set(0, 0);
    const gain = ctx.nodes.find((n) => n.kind === "gain");
    expect(gain?.gain.of("setTargetAtTime")[0].args[0]).toBe(0);
  });
});
