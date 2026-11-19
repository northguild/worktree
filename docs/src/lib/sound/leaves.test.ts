import { beforeEach, describe, expect, it } from "vitest";
import {
  FakeAudioContext,
  type FakeNode,
  installFakeAudio,
} from "../../test/fake-audio";
import type { FlightDetail } from "./cue";
import { change, gust, startRustle } from "./leaves";

let ctx: FakeAudioContext;
let out: FakeNode;
const as = (n: FakeNode) => n as unknown as AudioNode;

beforeEach(() => {
  installFakeAudio();
  ctx = new FakeAudioContext();
  out = ctx.destination;
});

/**
 * A short flight: four samples 50 ms apart, so a curve of 0.2 s, ending at a duration of 0.15 s (the last landing).
 * The numbers the voices are expected to make from it are the audition board's: Soft canopy peak 0.0106 times the
 * square root of the curve, a band at 2,400 Hz (the second band 15% higher) riding 0.8 to 1.2 of itself with the curve.
 */
function stage(stageName: FlightDetail["stage"]): FlightDetail {
  return {
    stage: stageName,
    curve: Float32Array.of(0, 0.25, 1, 0),
    panCurve: Float32Array.of(0, -0.5, 0.5, 0),
    step: 0.05,
    duration: 0.15,
    grains: [
      { at: 0.05, pan: -0.85 },
      { at: 0.1, pan: 0.85 },
    ],
  };
}

/** The gain nodes whose gain has a value curve. */
const curved = (kind: "gain" | "biquad") =>
  ctx.nodes.filter(
    (n) =>
      n.kind === kind &&
      (n.gain.curves.length > 0 || n.frequency.curves.length > 0),
  );

describe("the gust (Soft canopy)", () => {
  it("makes two bands whose loudness is 0.0106 times the square root of the flight and whose filter rides with it", () => {
    gust(ctx as unknown as AudioContext, as(out), 1, stage("leaf"));
    const bands = ctx.started("bufferSource");
    expect(bands).toHaveLength(2);
    expect(bands.map((b) => b.startedAt)).toEqual([1, 1]);
    // 0.2 s of curve, then 50 ms of tail: stopped at 1.25
    expect(bands.map((b) => b.stoppedAt)).toEqual([1.25, 1.25]);

    const gains = ctx.nodes.filter((n) => n.gain.curves.length);
    expect(gains).toHaveLength(2);
    for (const g of gains) {
      expect(g.gain.curves).toHaveLength(1);
      expect(g.gain.curves[0].start).toBe(1);
      expect(g.gain.curves[0].duration).toBeCloseTo(0.2);
      // 0.0106 * sqrt(0, 0.25, 1, 0)
      const [a, b, c2, d] = g.gain.curves[0].values;
      expect(a).toBe(0);
      expect(b).toBeCloseTo(0.0053, 6);
      expect(c2).toBeCloseTo(0.0106, 6);
      expect(d).toBe(0);
    }
    const filters = ctx.nodes.filter((n) => n.frequency.curves.length);
    expect(filters).toHaveLength(2);
    expect(filters[0].Q.value).toBe(0.45);
    // 2,400 * (0.8 + 0.4 * v): v = 0 -> 1,920, 1 -> 2,880; the second band is 15% higher
    expect(filters[0].frequency.curves[0].values[0]).toBeCloseTo(1920, 3);
    expect(filters[0].frequency.curves[0].values[2]).toBeCloseTo(2880, 3);
    expect(filters[1].frequency.curves[0].values[2]).toBeCloseTo(
      2880 * 1.15,
      3,
    );
  });

  it("gives every automated parameter one curve and nothing else, which Safari and Firefox require", () => {
    gust(ctx as unknown as AudioContext, as(out), 1, stage("leaf"));
    for (const n of ctx.nodes) {
      for (const param of [n.gain, n.frequency]) {
        const curves = param.of("setValueCurveAtTime").length;
        if (curves > 0) expect(param.calls).toHaveLength(1);
      }
    }
  });

  it("is silent from its last landing: the curve ends at 0 and a guard bus reaches 0 at the landing", () => {
    gust(ctx as unknown as AudioContext, as(out), 1, stage("leaf"));
    for (const g of ctx.nodes.filter((n) => n.gain.curves.length))
      expect(g.gain.curves[0].values.at(-1)).toBe(0);
    // The guard: the bus the canopy ends in. It holds at 1 until 0.25 s before the landing (0 here: dur 0.15), then
    // ramps to 0 at 1 + 0.15.
    const guard = ctx.nodes.find(
      (n) => n.gain.of("linearRampToValueAtTime").length,
    );
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args).toEqual([
      0, 1.15,
    ]);
    expect(guard?.outputs).toContain(out);
  });

  it("holds the guard at 1 until the last 0.25 s of a long gust", () => {
    const long = { ...stage("leaf"), duration: 3 };
    gust(ctx as unknown as AudioContext, as(out), 2, long);
    const guard = ctx.nodes.find(
      (n) => n.gain.of("linearRampToValueAtTime").length,
    );
    expect(guard?.gain.of("setValueAtTime").map((c) => c.args)).toEqual([
      [1, 2],
      [1, 4.75],
    ]);
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args).toEqual([0, 5]);
  });

  it("pans the two bands to -0.75 and 0.75", () => {
    gust(ctx as unknown as AudioContext, as(out), 1, stage("leaf"));
    const pans = ctx.nodes
      .filter((n) => n.kind === "stereoPanner")
      .map((n) => n.pan.value);
    expect(pans.sort()).toEqual([-0.75, 0.75]);
    expect(curved("biquad").length).toBe(2);
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
    // An exponential approach, 0.06 s constant: 0.5 s after, it is exp(-0.5 / 0.06) = 0.00024 of 0.02
    expect(0.02 * Math.exp(-0.5 / 0.06)).toBeLessThan(0.00001);
  });

  it("with a speed of 0 aims the gain at 0", () => {
    const voice = startRustle(ctx as unknown as AudioContext, as(out));
    voice.set(0, 0);
    const gain = ctx.nodes.find((n) => n.kind === "gain");
    expect(gain?.gain.of("setTargetAtTime")[0].args[0]).toBe(0);
  });
});
