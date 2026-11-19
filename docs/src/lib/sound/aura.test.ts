import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FakeAudioContext,
  type FakeNode,
  installFakeAudio,
} from "../../test/fake-audio";
import { AURA_LEVEL, type Aura, startAura } from "./aura";

// Expected values: plan #352 D14 (bus 12 dB under the cues, 2 s fade in, 1.5 s crossfade) and the audition board's BEDS in
// prototypes/settings-gear/sound-audition.html: A "Forest air" (two looped noise bands panned -0.6 and 0.6, low-passed at
// 500 and 500 + 120 Hz, Q 0.6, level 0.009 with an LFO of 0.07 and 0.07 + 0.03 Hz at depth 0.006) and B "Leaves overhead"
// (A, and a leafTick of peak 0.006 every rand(1.5, 4.5) s, panned within -0.8..0.8). 12 dB is a factor of 10 ** (-12 / 20),
// 0.251, by hand.

let ctx: FakeAudioContext;
let master: FakeNode;
let aura: Aura | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  installFakeAudio();
  ctx = new FakeAudioContext();
  ctx.become("running");
  master = ctx.createGain();
});

afterEach(() => {
  aura?.stop(0);
  aura = undefined;
  vi.useRealTimers();
});

const begin = (track?: "forest" | "overhead", fadeIn?: number) =>
  startAura(
    ctx as unknown as AudioContext,
    master as unknown as AudioNode,
    fadeIn,
    track,
  );
const bus = () => ctx.nodes.find((n) => n.outputs.includes(master)) as FakeNode;
const trackGains = () => ctx.nodes.filter((n) => n.outputs.includes(bus()));
const panners = () => ctx.nodes.filter((n) => n.kind === "stereoPanner");

describe("the bus", () => {
  it("sits 12 dB under the cues and fades in over 2 s by default", () => {
    ctx.advance(5);
    aura = begin();
    expect(AURA_LEVEL).toBeCloseTo(10 ** (-12 / 20), 2);
    expect(bus().gain.value).toBe(0);
    expect(bus().gain.of("linearRampToValueAtTime")[0].args).toEqual([
      AURA_LEVEL,
      7,
    ]);
  });

  it("is built once per context, whatever tracks come and go", () => {
    aura = begin();
    aura.stop(0);
    aura = begin();
    expect(ctx.nodes.filter((n) => n.outputs.includes(master))).toHaveLength(1);
  });
});

describe("Forest air", () => {
  it("is two looped noise bands, panned either side, low-passed, each with a slow LFO", () => {
    aura = begin("forest");
    const bands = ctx.started("bufferSource");
    expect(bands).toHaveLength(2);
    expect(bands.every((b) => b.loop)).toBe(true);
    expect(
      panners()
        .map((p) => p.pan.value)
        .sort((a, b) => a - b),
    ).toEqual([-0.6, 0.6]);
    const filters = ctx.nodes.filter((n) => n.kind === "biquad");
    expect(filters.map((f) => f.type)).toEqual(["lowpass", "lowpass"]);
    expect(filters.map((f) => f.frequency.value)).toEqual([500, 620]);
    expect(filters.map((f) => f.Q.value)).toEqual([0.6, 0.6]);
    const lfos = ctx.started("oscillator");
    expect(lfos.map((o) => o.frequency.value)).toEqual(
      [0.07, 0.1].map((v) => expect.closeTo(v, 6)),
    );
    const levels = ctx.nodes.filter(
      (n) => n.kind === "gain" && n.gain.value === 0.009,
    );
    expect(levels).toHaveLength(2);
    expect(ctx.nodes.filter((n) => n.gain.value === 0.006)).toHaveLength(2);
  });

  it("makes no tick, and no timer", () => {
    aura = begin("forest");
    ctx.advance(30);
    vi.advanceTimersByTime(300);
    expect(ctx.started("bufferSource")).toHaveLength(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("Leaves overhead", () => {
  it("is Forest air with a faint tick every 1.5 to 4.5 s, panned within 0.8", () => {
    aura = begin("overhead");
    for (let i = 0; i < 120; i++) {
      ctx.advance(0.15);
      vi.advanceTimersByTime(150);
    }
    const sources = ctx.started("bufferSource");
    const ticks = sources.slice(2);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    const times = ticks.map((t) => t.startedAt as number);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(1.5);
      expect(times[i] - times[i - 1]).toBeLessThanOrEqual(4.5);
    }
    // Each tick's envelope peaks at 0.006.
    const env = (ticks[0].outputs[0] as FakeNode).outputs[0] as FakeNode;
    expect(env.gain.of("linearRampToValueAtTime")[0].args[0]).toBe(0.006);
    const tickPans = panners()
      .slice(2)
      .map((p) => p.pan.value);
    expect(tickPans.length).toBe(ticks.length);
    for (const pan of tickPans) expect(Math.abs(pan)).toBeLessThanOrEqual(0.8);
  });

  it("stops its ticks with the aura", () => {
    aura = begin("overhead");
    expect(vi.getTimerCount()).toBe(1);
    aura.stop(0.6);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("a change of track", () => {
  it("crossfades the two track gains over 1.5 s while the bus holds still", () => {
    aura = begin("forest");
    ctx.advance(10);
    const busRamps = bus().gain.calls.length;
    aura.switchTo("overhead", 1.5);
    const [out, into] = trackGains();
    expect(out.gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      0, 11.5,
    ]);
    expect(into.gain.value).toBe(0);
    expect(into.gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      1, 11.5,
    ]);
    expect(bus().gain.calls).toHaveLength(busRamps);
    // The old track's sources end after the fade.
    expect(
      ctx.nodes.filter((n) => n.kind === "bufferSource")[0].stoppedAt,
    ).toBeCloseTo(11.55, 6);
  });

  it("does nothing for the track that is already playing", () => {
    aura = begin("forest");
    aura.switchTo("forest", 1.5);
    expect(trackGains()).toHaveLength(1);
  });

  it("does nothing once stopped", () => {
    aura = begin("forest");
    aura.stop(0.6);
    aura.switchTo("overhead", 1.5);
    expect(trackGains()).toHaveLength(1);
  });
});

describe("stop", () => {
  it("fades the bus to 0, closes the track's gain behind it and ends the sources after the fade", () => {
    aura = begin("forest");
    ctx.advance(4);
    aura.stop(0.6);
    expect(bus().gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      0, 4.6,
    ]);
    const [gain] = trackGains();
    expect(gain.gain.of("setValueAtTime").at(-1)?.args).toEqual([0, 4.6]);
    for (const band of ctx.nodes.filter((n) => n.kind === "bufferSource"))
      expect(band.stoppedAt).toBeCloseTo(4.65, 6);
  });

  it("is idempotent", () => {
    aura = begin();
    aura.stop(0.6);
    const calls = bus().gain.calls.length;
    aura.stop(0.6);
    expect(bus().gain.calls).toHaveLength(calls);
  });
});
