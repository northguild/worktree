import { beforeEach, describe, expect, it } from "vitest";
import { type FakeAudioContext, installFakeAudio } from "../../test/fake-audio";
import { VOICES } from "./voices";

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
