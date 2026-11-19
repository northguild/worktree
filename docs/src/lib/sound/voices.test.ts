import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type FakeAudioContext, installFakeAudio } from "../../test/fake-audio";
import { LOOPS, VOICES } from "./voices";

// Expected values: plan #352 D9, the audition board's NOTCHES[4] "Leaf brush": a bandpass noise brush, 2,600 to 3,400 Hz,
// Q 1.2, peak 0.035, 6 ms attack, 30 ms decay. The envelope's times follow from those: it rises to the peak at t + 0.006
// and has fallen to the exponential floor (0.0001, the kit's) at t + 0.006 + 0.03.
describe("the notch voice, Leaf brush (D9)", () => {
  let c: FakeAudioContext;
  beforeEach(() => {
    c = new (installFakeAudio())();
  });

  it("has a voice", () => {
    expect(VOICES.notch).toBeTypeOf("function");
  });

  it("is one bandpass noise burst sweeping 2600 to 3400 Hz at Q 1.2", () => {
    VOICES.notch?.(
      c as unknown as AudioContext,
      c.destination as unknown as AudioNode,
      2,
      0,
    );
    const filters = c.nodes.filter((n) => n.kind === "biquad");
    expect(filters).toHaveLength(1);
    expect(filters[0].type).toBe("bandpass");
    expect(filters[0].frequency.value).toBe(2600);
    expect(filters[0].Q.value).toBe(1.2);
    const [to, at] = filters[0].frequency.of("exponentialRampToValueAtTime")[0]
      .args;
    expect(to).toBe(3400);
    expect(at).toBeCloseTo(2.036, 9);
    expect(c.started("bufferSource")).toHaveLength(1);
    expect(c.started("oscillator")).toHaveLength(0);
  });

  it("rises to 0.035 in 6 ms and dies in 30 ms more", () => {
    VOICES.notch?.(
      c as unknown as AudioContext,
      c.destination as unknown as AudioNode,
      2,
      0,
    );
    const gain = c.nodes.find((n) => n.kind === "gain");
    const rise = gain?.gain.of("linearRampToValueAtTime")[0].args ?? [];
    expect(rise[0]).toBe(0.035);
    expect(rise[1]).toBeCloseTo(2.006, 9);
    const fall = gain?.gain.of("exponentialRampToValueAtTime")[0].args ?? [];
    expect(fall[0]).toBe(0.0001);
    expect(fall[1]).toBeCloseTo(2.036, 9);
  });
});

// The Dox chat's voices (plan #352 D13) are gmt's at d6031ecd. Every expected number below is read from gmt's
// `lib/sound/voices.ts` at that commit (the option literals of each voice) and carried through the kit's envelope by
// hand: a tone's gain rises to `peak` at t + attack, holds, and reaches the floor 0.0001 at t + attack + hold + release.
// The kit here is gmt's (tone, noise, bell, echo are unchanged), so the same options give the same schedule.
const T = 1;
const asContext = (c: FakeAudioContext) => c as unknown as AudioContext;
const play = (c: FakeAudioContext, name: keyof typeof VOICES) =>
  VOICES[name]?.(asContext(c), c.destination as unknown as AudioNode, T, 0);

/** Each note an oscillator voice made: when it started, its pitch, its gain's peak and where the gain reaches the floor. */
function notes(c: FakeAudioContext) {
  const gains = c.nodes.filter(
    (n) => n.gain.of("linearRampToValueAtTime").length,
  );
  return c.started("oscillator").map((osc, i) => ({
    at: osc.startedAt,
    type: osc.type,
    freq: osc.frequency.of("setValueAtTime")[0].args[0],
    peak: gains[i].gain.of("linearRampToValueAtTime")[0].args[0],
    end: gains[i].gain.of("exponentialRampToValueAtTime")[0].args[1],
  }));
}

describe("the Dox chat voices match gmt's schedule (D13)", () => {
  let c: FakeAudioContext;
  beforeEach(() => {
    c = new (installFakeAudio())();
  });
  afterEach(() => vi.restoreAllMocks());

  it("key, Data blip: one 0.03 sine blip, a pentatonic note (MIDI 93 = 1760 Hz when the draw is 0), 2 ms attack, 30 ms release", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    play(c, "key");
    const [n] = notes(c);
    expect(c.started("oscillator")).toHaveLength(1);
    expect(n.freq).toBeCloseTo(1760, 6);
    expect(n.peak).toBe(0.03);
    expect(n.end).toBeCloseTo(T + 0.002 + 0.03, 9);
  });

  it("key draws from MIDI 93, 95, 98, 100 and 102 only", () => {
    const seen = new Set<number>();
    for (const draw of [0, 0.25, 0.45, 0.65, 0.85, 0.999]) {
      vi.spyOn(Math, "random").mockReturnValue(draw);
      const fresh = new (installFakeAudio())();
      play(fresh, "key");
      seen.add(Math.round(notes(fresh)[0].freq));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([
      1760, 1976, 2349, 2637, 2960,
    ]);
  });

  it("send, Sonar launch: a 1180 Hz ping, and the same ping 0.08 into a 120 ms echo built once per context", () => {
    play(c, "send");
    expect(notes(c)).toEqual([
      { at: T, type: "sine", freq: 1180, peak: 0.1, end: T + 0.003 + 0.15 },
      { at: T, type: "sine", freq: 1180, peak: 0.08, end: T + 0.003 + 0.12 },
    ]);
    const delay = c.nodes.find((n) => n.kind === "delay");
    expect(delay?.delayTime.value).toBe(0.12);
    play(c, "send");
    expect(c.nodes.filter((n) => n.kind === "delay")).toHaveLength(1);
  });

  it("stream, Morse: a 700 Hz beep, peak 0.035, 3 ms attack, 20 ms hold, 10 ms release", () => {
    play(c, "stream");
    expect(notes(c)).toEqual([
      {
        at: T,
        type: "sine",
        freq: 700,
        peak: 0.035,
        end: T + 0.003 + 0.02 + 0.01,
      },
    ]);
  });

  it("done, Ice bell: three partials of 2093 Hz dry and two in the room, the higher ones dying first", () => {
    play(c, "done");
    const got = notes(c);
    expect(got.map((n) => Math.round(n.freq * 100) / 100)).toEqual([
      2093, 5776.68, 11302.2, 2093, 5776.68,
    ]);
    expect(got.map((n) => n.peak)).toEqual([0.05, 0.025, 0.05 / 3, 0.04, 0.02]);
    const releases = [
      1.2,
      1.2 / Math.sqrt(2),
      1.2 / Math.sqrt(3),
      1.2,
      1.2 / Math.sqrt(2),
    ];
    for (const [i, n] of got.entries())
      expect(n.end).toBeCloseTo(T + 0.002 + releases[i], 9);
    // The room is the kit's shared hall, built once.
    expect(c.nodes.filter((n) => n.kind === "convolver")).toHaveLength(1);
  });

  it("error, Low double buzz: two 110 Hz squares 0.11 s apart, peak 0.07, 4 ms attack, 50 ms hold, 30 ms release, lowpass 600", () => {
    play(c, "error");
    expect(notes(c)).toEqual(
      [
        { at: T, type: "square", freq: 110, peak: 0.07, end: T + 0.084 },
        {
          at: T + 0.11,
          type: "square",
          freq: 110,
          peak: 0.07,
          end: T + 0.11 + 0.084,
        },
      ].map((n) => ({ ...n, end: expect.closeTo(n.end, 9) })),
    );
    const filters = c.nodes.filter((n) => n.kind === "biquad");
    expect(filters.map((f) => [f.type, f.frequency.value])).toEqual([
      ["lowpass", 600],
      ["lowpass", 600],
    ]);
  });

  it("loading, Servo spin-up: three bandpass notches 90 ms apart climbing 650, 987 and 1500 Hz, Q 4, peak 0.028", () => {
    play(c, "loading");
    const filters = c.nodes.filter((n) => n.kind === "biquad");
    expect(filters.map((f) => f.type)).toEqual([
      "bandpass",
      "bandpass",
      "bandpass",
    ]);
    const freqs = [650, 987.42, 1500];
    for (const [i, f] of filters.entries()) {
      expect(f.frequency.value).toBeCloseTo(freqs[i], 1);
      expect(f.Q.value).toBe(4);
      const [to, at] = f.frequency.of("exponentialRampToValueAtTime")[0].args;
      expect(to).toBeCloseTo(freqs[i] * 1.3, 1);
      expect(at).toBeCloseTo(T + i * 0.09 + 0.006 + 0.04, 9);
    }
    expect(c.started("bufferSource").map((s) => s.startedAt)).toEqual([
      T,
      T + 0.09,
      T + 0.18,
    ]);
    const peaks = c.nodes
      .filter((n) => n.gain.of("linearRampToValueAtTime").length)
      .map((g) => g.gain.of("linearRampToValueAtTime")[0].args[0]);
    expect(peaks).toEqual([0.028, 0.028, 0.028]);
  });
});

describe("the thinking loop, Sonar idle (D13)", () => {
  let c: FakeAudioContext;
  beforeEach(() => {
    vi.useFakeTimers();
    c = new (installFakeAudio())();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("swells in over 0.3 s, pings a soft 587 Hz every 1.6 s from 0.05 s and ends its scheduling on stop", () => {
    const stop = LOOPS.thinking?.(
      asContext(c),
      c.destination as unknown as AudioNode,
    );
    expect(stop).toBeTypeOf("function");
    const bus = c.nodes[0];
    expect(bus.gain.of("linearRampToValueAtTime")[0].args).toEqual([1, 0.3]);
    expect(c.nodes.filter((n) => n.kind === "oscillator")).toHaveLength(1);
    const first = c.nodes.find((n) => n.kind === "oscillator");
    expect(first?.startedAt).toBeCloseTo(0.05, 9);
    expect(first?.frequency.of("setValueAtTime")[0].args[0]).toBe(587);

    c.advance(1.2);
    vi.advanceTimersByTime(150);
    const pings = c.started("oscillator").map((o) => o.startedAt);
    expect(pings).toHaveLength(2);
    expect(pings[1]).toBeCloseTo(1.65, 9);

    stop?.();
    expect(vi.getTimerCount()).toBe(0);
  });
});
