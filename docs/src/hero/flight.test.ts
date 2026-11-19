import { describe, expect, it } from "vitest";
import { flight, soundFor } from "./flight";

/**
 * A hand-built flock of four leaves. Every expected number below was worked out on paper from the rule in plan #352
 * D10 (each leaf in flight, 0 < p < 1, weighs sin(pi * p); the curve is the sum normalised to its peak; the pan is the
 * weighted mean x over the page's half width, times 0.85), never read back from `flight`.
 *
 *   leaf  delay  dur   x (from -> to)
 *   0     0.25   1.0   -100 -> -100
 *   1     0.25   1.0   -100 -> -100
 *   2     1.25   1.0    100 ->  100
 *   3     0.50   0.5    100 ->  100
 *
 * The first take-off is at 0.25 s and the last landing at 2.25 s, so a 0.05 s step makes 46 samples (0 to 2.25 s).
 * At 0.75 s leaves 0, 1 and 3 are each half way (p = 0.5, weight 1): the sum is 3, and nothing else reaches it
 * (0.70 s and 0.80 s give 2 * 0.9877 + 0.9511 = 2.926).
 */
const flock = {
  delay: Float32Array.of(0.25, 0.25, 1.25, 0.5),
  dur: Float32Array.of(1, 1, 1, 0.5),
  from: Float32Array.of(-100, -100, 100, 100),
  to: Float32Array.of(-100, -100, 100, 100),
  count: 4,
  halfWidth: 100,
};

describe("flight, the share of leaves in the air", () => {
  const f = flight(flock);

  it("samples every 50 ms from 0 to the last landing", () => {
    expect(f.step).toBe(0.05);
    expect(f.curve).toHaveLength(46);
    expect(f.panCurve).toHaveLength(46);
    expect(f.duration).toBeCloseTo(2.25);
  });

  it("is 0 before the first take-off and after the last landing", () => {
    // 0.25 s is sample 5: leaf 0 has p = 0 there, which is not in flight yet.
    for (let k = 0; k <= 5; k++) expect(f.curve[k]).toBe(0);
    expect(f.curve[45]).toBe(0); // 2.25 s: p = 1 for leaf 2
  });

  it("peaks, at 1, where the most leaves are mid-flight", () => {
    expect(f.curve[15]).toBeCloseTo(1, 6); // 0.75 s: three leaves at p = 0.5
    expect(Math.max(...f.curve)).toBeCloseTo(1, 6);
    expect(f.curve.indexOf(Math.max(...f.curve))).toBe(15);
    // 0.70 s: (2 * 0.98769 + 0.95106) / 3
    expect(f.curve[14]).toBeCloseTo(0.97548, 4);
  });

  it("puts the pan at the weighted mean x, over the half width, times 0.85", () => {
    // 0.75 s: x = (-100 - 100 + 100) / 3 = -33.33; -0.3333 * 0.85
    expect(f.panCurve[15]).toBeCloseTo(-0.28333, 4);
    // 1.75 s: only leaf 2 (p = 0.5) is up, at x = 100
    expect(f.panCurve[35]).toBeCloseTo(0.85, 5);
    // Nothing in the air: centre
    expect(f.panCurve[0]).toBe(0);
  });
});

describe("flight, a leaf on the move", () => {
  const one = {
    delay: Float32Array.of(0),
    dur: Float32Array.of(1),
    from: Float32Array.of(-100),
    to: Float32Array.of(100),
    count: 1,
    halfWidth: 100,
  };

  it("follows the leaf along its path", () => {
    const f = flight(one);
    expect(f.panCurve[5]).toBeCloseTo(-0.425, 5); // 0.25 s: x = -50
    expect(f.panCurve[10]).toBeCloseTo(0, 5); // 0.50 s: x = 0
    expect(f.panCurve[15]).toBeCloseTo(0.425, 5); // 0.75 s: x = 50
  });

  it("clamps a leaf off the page to the page's edge", () => {
    const f = flight({
      ...one,
      from: Float32Array.of(-1000),
      to: Float32Array.of(-1000),
    });
    expect(f.panCurve[10]).toBeCloseTo(-0.85, 5);
  });

  it("reads the simulation's slower clock: a pace of 1.25 stretches the flight to 1.25 times as many seconds", () => {
    // delay 0, dur 0.8 simulated = 1.0 s on the audio clock; mid-flight at 0.5 s is sample 10
    const f = flight({ ...one, dur: Float32Array.of(0.8), pace: 1.25 });
    expect(f.duration).toBeCloseTo(1);
    expect(f.curve).toHaveLength(21);
    expect(f.curve[10]).toBeCloseTo(1, 6);
    expect(f.curve[20]).toBe(0);
  });

  it("counts only the first `count` leaves", () => {
    const f = flight({
      ...flock,
      count: 2, // leaves 0 and 1 only: peak at 0.75 s is 2 leaves, x = -100
      halfWidth: 100,
    });
    expect(f.curve[15]).toBeCloseTo(1, 6);
    expect(f.panCurve[15]).toBeCloseTo(-0.85, 5);
    // leaf 2 is not counted: the flock lands at 1.25 s, so there are 26 samples, not 46
    expect(f.curve).toHaveLength(26);
    expect(f.curve[25]).toBe(0);
  });

  it("reads every other leaf when asked, and still ends at the last landing of them all", () => {
    // leaves 0 and 2 only: leaf 0 alone at 0.75 s (weight 1, x = -100), leaf 2 alone at 1.75 s (weight 1, x = 100);
    // the 46 samples still reach leaf 3's and leaf 1's landing, because the length is the whole flock's
    const f = flight({ ...flock, every: 2 });
    expect(f.curve).toHaveLength(46);
    expect(f.curve[15]).toBeCloseTo(1, 6);
    expect(f.curve[35]).toBeCloseTo(1, 6);
    expect(f.panCurve[15]).toBeCloseTo(-0.85, 5);
    expect(f.panCurve[35]).toBeCloseTo(0.85, 5);
  });

  it("makes a quiet curve for an empty flock", () => {
    const f = flight({ ...one, count: 0 });
    expect(f.curve.length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...f.curve)).toBe(0);
  });
});

describe("flight, the landing grains", () => {
  it("picks leaves from the pool and puts each at 92% of its flight, panned to where it lands, in time order", () => {
    // random 0.99 -> leaf floor(0.99 * 4) = 3 (lands 0.5 + 0.5 * 0.92 = 0.96 s, x = 100)
    // random 0    -> leaf 0              (lands 0.25 + 1 * 0.92 = 1.17 s, x = -100)
    const values = [0.99, 0];
    const f = flight({
      ...flock,
      grains: { count: 2, pool: 4 },
      random: () => values.shift() ?? 0,
    });
    expect(f.grains).toHaveLength(2);
    expect(f.grains[0].at).toBeCloseTo(0.96, 5);
    expect(f.grains[0].pan).toBeCloseTo(0.85, 5);
    expect(f.grains[1].at).toBeCloseTo(1.17, 5);
    expect(f.grains[1].pan).toBeCloseTo(-0.85, 5);
  });

  it("is empty when none are asked for", () => {
    expect(flight(flock).grains).toEqual([]);
  });
});

describe("soundFor, which stage makes which sound", () => {
  it("is the gust for the opening and a change for every later stage", () => {
    expect(soundFor({ gustIn: true })).toBe("gust");
    expect(soundFor({})).toBe("change");
  });

  it("is nothing for a re-fit after a resize", () => {
    expect(soundFor({ quick: true })).toBeNull();
    expect(soundFor({ quick: true, gustIn: true })).toBeNull();
  });
});
