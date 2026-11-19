import { describe, expect, it } from "vitest";
import { flight, soundFor } from "./flight";

/**
 * A hand-built flock of four leaves. Every expected number below was worked out on paper from plan #352 D10 as amended
 * by the review of PR 354 (nothing plays a curve, so only the stage's length and its landing grains are computed), never
 * read back from `flight`.
 *
 *   leaf  delay  dur   lands at x
 *   0     0.25   1.0   -100
 *   1     0.25   1.0   -100
 *   2     1.25   1.0    100
 *   3     0.50   0.5    100
 *
 * The last landing is leaf 2's, at 1.25 + 1.0 = 2.25 s.
 */
const flock = {
  delay: Float32Array.of(0.25, 0.25, 1.25, 0.5),
  dur: Float32Array.of(1, 1, 1, 0.5),
  to: Float32Array.of(-100, -100, 100, 100),
  count: 4,
  halfWidth: 100,
};

describe("flight, how long the stage lasts", () => {
  it("is the seconds from the start to the last landing of any leaf", () => {
    expect(flight(flock).duration).toBeCloseTo(2.25);
  });

  it("returns only what the voices read: the stage's length and its grains", () => {
    expect(Object.keys(flight(flock)).sort()).toEqual(["duration", "grains"]);
  });

  it("reads the simulation's slower clock: a pace of 1.25 stretches 0.8 simulated seconds to 1.0", () => {
    const f = flight({
      delay: Float32Array.of(0),
      dur: Float32Array.of(0.8),
      to: Float32Array.of(0),
      count: 1,
      halfWidth: 100,
      pace: 1.25,
    });
    expect(f.duration).toBeCloseTo(1);
  });

  it("counts only the first `count` leaves", () => {
    // leaves 0 and 1 only: the flock lands at 0.25 + 1.0 = 1.25 s, not leaf 2's 2.25 s
    expect(flight({ ...flock, count: 2 }).duration).toBeCloseTo(1.25);
  });

  it("is 0 for an empty flock", () => {
    expect(flight({ ...flock, count: 0 }).duration).toBe(0);
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

  it("clamps a leaf that lands off the page to the page's edge", () => {
    const f = flight({
      ...flock,
      to: Float32Array.of(-1000, 0, 0, 0),
      grains: { count: 1, pool: 1 },
      random: () => 0,
    });
    expect(f.grains[0].pan).toBeCloseTo(-0.85, 5);
  });

  it("is empty when none are asked for", () => {
    expect(flight(flock).grains).toEqual([]);
  });
});

describe("soundFor, which stage makes which sound", () => {
  it("is the gust for the opening and a change for every later stage", () => {
    expect(soundFor({ gustIn: true }, true)).toBe("gust");
    expect(soundFor({}, true)).toBe("change");
  });

  // Source: PR 354 thread on flight.ts:104 and the phase's Scope: a muted visitor's stages are not computed at all.
  it("is nothing while sound is muted, for the opening and for a change", () => {
    expect(soundFor({ gustIn: true }, false)).toBeNull();
    expect(soundFor({}, false)).toBeNull();
  });

  it("is nothing for a re-fit after a resize", () => {
    expect(soundFor({ quick: true }, true)).toBeNull();
    expect(soundFor({ quick: true, gustIn: true }, true)).toBeNull();
  });
});
