import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext, installFakeAudio } from "../../test/fake-audio";
import { saveSound, stubStorage } from "../../test/sound-storage";
import { cue } from "./cue";
import { createEngine, type Engine, HIDE_TAIL_MS } from "./engine";
import { writeSound } from "./settings";
import { VOICES, type Voice } from "./voices";

let engine: Engine | undefined;
let ctx: FakeAudioContext;

/** The engine loads only once a reader has turned sound on, so each boot saves that choice. */
function boot(saved: Record<string, unknown> = {}) {
  saveSound(saved);
  engine = createEngine();
  ctx = new FakeAudioContext();
  engine.attach(ctx as unknown as AudioContext);
  ctx.become("running");
  return ctx.nodes[0]; // the master gain
}

function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeAudio();
  stubStorage();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
  }));
});

const voices = { ...VOICES };

afterEach(() => {
  Object.assign(VOICES, voices);
  engine?.destroy();
  engine = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).visibilityState;
  expect(vi.getTimerCount()).toBe(0);
});

describe("level and mute", () => {
  it("maps the level to a gain of level / 11 * 0.6", () => {
    const master = boot({ level: 11 });
    expect(master.gain.value).toBeCloseTo(0.6);
    const [shaper] = master.outputs;
    expect(shaper.kind).toBe("waveShaper");
    expect(shaper.outputs).toContain(ctx.destination);
  });

  it("follows the fader on the audio clock", () => {
    const master = boot({ level: 5 });
    expect(master.gain.value).toBeCloseTo((5 / 11) * 0.6);
    writeSound({ level: 11 });
    expect(master.gain.of("setTargetAtTime")[0].args[0]).toBeCloseTo(0.6);
  });

  it("ramps to silence over 0.05 s, then suspends", () => {
    const master = boot({ level: 5, muted: false });
    ctx.advance(2);
    writeSound({ muted: true });
    expect(master.gain.of("linearRampToValueAtTime")[0].args).toEqual([
      0, 2.05,
    ]);
    expect(ctx.calls).not.toContain("suspend");
    vi.advanceTimersByTime(100);
    expect(ctx.calls).toContain("suspend");
  });

  it("resumes and ramps back up on unmute", () => {
    const master = boot({ level: 11, muted: true });
    expect(master.gain.value).toBe(0);
    writeSound({ muted: false });
    expect(ctx.calls).toContain("resume");
    expect(
      master.gain.of("linearRampToValueAtTime").at(-1)?.args[0],
    ).toBeCloseTo(0.6);
  });
});

describe("a cue", () => {
  let notch: ReturnType<typeof vi.fn<Voice>>;
  beforeEach(() => {
    notch = vi.fn<Voice>();
    VOICES.notch = notch;
  });

  it("plays 5 ms ahead on the audio clock", () => {
    boot();
    ctx.advance(3);
    cue("notch");
    expect(notch).toHaveBeenCalledTimes(1);
    expect(notch.mock.calls[0][0]).toBe(ctx);
    expect(notch.mock.calls[0][2]).toBeCloseTo(3.005);
  });

  it("starts cues less than 5 ms apart together, even across an audio block, and later ones on their own", () => {
    boot();
    const key = vi.fn<Voice>();
    VOICES.key = key;
    ctx.advance(3);
    cue("key");
    ctx.advance(0.0027); // one audio block of 128 frames at 48 kHz
    cue("notch");
    ctx.advance(0.04);
    cue("notch");
    expect(key.mock.calls[0][2]).toBeCloseTo(3.005, 6);
    expect(notch.mock.calls[0][2]).toBeCloseTo(3.005, 6);
    expect(notch.mock.calls[1][2]).toBeCloseTo(3.0477, 6);
  });

  it("measures a cue's gap on the clock, not the shared start", () => {
    boot();
    const key = vi.fn<Voice>();
    VOICES.key = key;
    cue("notch");
    ctx.advance(0.004);
    cue("key"); // starts with the notch, 4 ms before it was asked for
    ctx.advance(0.025);
    cue("key"); // 25 ms after the first key: its gap has passed
    expect(key).toHaveBeenCalledTimes(2);
  });

  it("drops the same cue inside its gap and plays it after", () => {
    boot();
    cue("notch");
    ctx.advance(0.02);
    cue("notch");
    expect(notch).toHaveBeenCalledTimes(1);
    ctx.advance(0.02);
    cue("notch");
    expect(notch).toHaveBeenCalledTimes(2);
  });

  it("keeps a cue's own gap: key 25 ms, stream 60 ms", () => {
    boot();
    const key = vi.fn<Voice>();
    const stream = vi.fn<Voice>();
    VOICES.key = key;
    VOICES.stream = stream;
    for (const name of ["key", "stream"] as const) cue(name);
    ctx.advance(0.03);
    for (const name of ["key", "stream"] as const) cue(name);
    expect(key).toHaveBeenCalledTimes(2);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it("hands a cue's rank to its voice, 0 when none is given", () => {
    boot();
    cue("notch");
    ctx.advance(1);
    cue("notch", 3);
    expect(notch.mock.calls.map((call) => call[3])).toEqual([0, 3]);
  });

  it("is silent while muted, and before the context is attached", () => {
    saveSound();
    engine = createEngine();
    cue("notch");
    expect(notch).not.toHaveBeenCalled();
    engine.destroy();
    boot({ muted: true });
    cue("notch");
    expect(notch).not.toHaveBeenCalled();
  });

  it("is dropped while the context is suspended outside a gesture, so nothing plays late", () => {
    // An arrival the browser did not let start: the clock is stopped until the first press.
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: false },
    });
    saveSound();
    engine = createEngine();
    ctx = new FakeAudioContext();
    engine.attach(ctx as unknown as AudioContext);
    cue("notch");
    ctx.become("running");
    expect(notch).not.toHaveBeenCalled();
  });

  it("plays the press's own cue while that press is starting the context", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: true },
    });
    saveSound();
    engine = createEngine();
    ctx = new FakeAudioContext();
    engine.attach(ctx as unknown as AudioContext);
    cue("notch");
    expect(notch).toHaveBeenCalledOnce();
  });

  it("drops a cue on a suspended context where the browser has no userActivation", () => {
    saveSound();
    engine = createEngine();
    ctx = new FakeAudioContext();
    engine.attach(ctx as unknown as AudioContext);
    cue("notch");
    ctx.become("running");
    expect(notch).not.toHaveBeenCalled();
  });

  it("is ignored, and not heard, when its cue has no voice yet", () => {
    boot();
    expect(() => cue("send")).not.toThrow();
    expect(cue("send")).toBe(false);
  });
});

describe("visibility", () => {
  it("suspends once what is sounding has finished when hidden, and resumes when shown", () => {
    boot();
    setVisibility("hidden");
    // A link that opened a new tab hid this one: what is sounding plays out first.
    vi.advanceTimersByTime(HIDE_TAIL_MS - 50);
    expect(ctx.calls).not.toContain("suspend");
    vi.advanceTimersByTime(50);
    expect(ctx.calls).toContain("suspend");
    setVisibility("visible");
    expect(ctx.calls.at(-1)).toBe("resume");
  });

  it("never sleeps when shown again before the tail has played", () => {
    boot();
    setVisibility("hidden");
    vi.advanceTimersByTime(300);
    setVisibility("visible");
    vi.advanceTimersByTime(1000);
    expect(ctx.calls).not.toContain("suspend");
  });

  it("stays suspended when shown while muted", () => {
    boot({ muted: true });
    setVisibility("visible");
    expect(ctx.calls).not.toContain("resume");
  });
});

describe("the silent switch", () => {
  it("asks for an ambient audio session where the browser has one", () => {
    const session = { type: "auto" };
    Object.defineProperty(navigator, "audioSession", {
      value: session,
      configurable: true,
    });
    boot();
    expect(session.type).toBe("ambient");
    delete (navigator as unknown as Record<string, unknown>).audioSession;
  });
});

describe("destroy", () => {
  it("closes the context and leaves no listener, timer or later sound", () => {
    boot({ muted: false });
    writeSound({ muted: true });
    const notch = vi.fn<Voice>();
    VOICES.notch = notch;
    engine?.destroy();
    expect(ctx.state).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
    cue("notch");
    setVisibility("hidden");
    expect(notch).not.toHaveBeenCalled();
    engine = undefined;
  });
});
