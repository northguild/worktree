import { readFileSync } from "node:fs";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { FakeAudioContext, installFakeAudio } from "../../test/fake-audio";
import { saveSound, stubStorage } from "../../test/sound-storage";
import {
  cue,
  cueFlight,
  type FlightDetail,
  loop,
  rustle,
  startCue,
} from "./cue";
import { createEngine, type Engine, HIDE_TAIL_MS } from "./engine";
import { SOUND_KEY, writeAura, writeSound } from "./settings";
import { LOOPS, VOICES, type Voice } from "./voices";

let engine: Engine | undefined;
let ctx: FakeAudioContext;

/** The engine loads only once a reader has turned sound on, so each boot saves that choice. */
function boot(saved: Record<string, unknown> = {}) {
  saveSound(saved);
  engine = createEngine();
  ctx = new FakeAudioContext();
  ctx.become("running"); // cue.ts hands over a context a gesture has started
  engine.attach(ctx as unknown as AudioContext);
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

describe("the fader racing the unmute ramp", () => {
  // Source: PR 354 thread on engine.ts:242. The first input of a drag from muted unmutes with a linear ramp to the first
  // notch's level, ending 0.05 s on. Each input after it must cancel what is scheduled before it sets its target, or the
  // ramp lands last and the gain holds the first notch. Levels: 2/11 * 0.6 then 9/11 * 0.6 then 11/11 * 0.6.
  it("cancels the ramp before each target, and the last target is the last level", () => {
    const master = boot({ level: 1, muted: true });
    ctx.advance(1);
    writeSound({ muted: false, level: 2 });
    expect(master.gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      (2 / 11) * 0.6,
      1.05,
    ]);
    ctx.advance(0.01);
    writeSound({ level: 9 });
    ctx.advance(0.01);
    writeSound({ level: 11 });
    const calls = master.gain.calls;
    const targets = calls.filter((c) => c.method === "setTargetAtTime");
    expect(targets.map((c) => c.args[0])).toEqual([(9 / 11) * 0.6, 0.6]);
    // each target is directly preceded by a cancel and a hold of the value the ramp had reached
    for (const [i, c] of calls.entries()) {
      if (c.method !== "setTargetAtTime") continue;
      expect(calls[i - 2].method).toBe("cancelScheduledValues");
      expect(calls[i - 1].method).toBe("setValueAtTime");
    }
    // nothing is scheduled after the last target
    expect(calls.at(-1)?.method).toBe("setTargetAtTime");
  });

  it("uses cancelAndHoldAtTime where the browser has it", () => {
    const master = boot({ level: 1, muted: false });
    const held: number[] = [];
    (master.gain as unknown as Record<string, unknown>).cancelAndHoldAtTime = (
      t: number,
    ) => {
      held.push(t);
    };
    ctx.advance(2);
    writeSound({ level: 8 });
    expect(held).toEqual([2]);
    expect(master.gain.of("cancelScheduledValues")).toHaveLength(0);
    expect(master.gain.of("setTargetAtTime")[0].args[0]).toBeCloseTo(
      (8 / 11) * 0.6,
    );
  });
});

describe("the thinking loop across a mute", () => {
  // Source: PR 354 thread on engine.ts:229. The chat asks for the loop once, when the wait starts. A mute stops its
  // sound; an unmute while the caller still wants it brings it back; the caller's stop ends the want.
  const original = LOOPS.thinking;
  let started: number;
  let stopped: number;
  beforeEach(() => {
    started = 0;
    stopped = 0;
    LOOPS.thinking = () => {
      started++;
      return () => {
        stopped++;
      };
    };
  });
  afterEach(() => {
    LOOPS.thinking = original;
  });

  it("restarts after a mute and unmute during the wait", () => {
    boot({ muted: false });
    const stop = loop("thinking");
    expect([started, stopped]).toEqual([1, 0]);
    writeSound({ muted: true });
    expect([started, stopped]).toEqual([1, 1]);
    writeSound({ muted: false });
    expect([started, stopped]).toEqual([2, 1]);
    stop();
    expect([started, stopped]).toEqual([2, 2]);
  });

  it("does not restart on a later unmute once the caller has stopped it", () => {
    boot({ muted: false });
    const stop = loop("thinking");
    stop();
    writeSound({ muted: true });
    writeSound({ muted: false });
    expect(started).toBe(1);
  });

  it("does not restart after the caller stops it while muted", () => {
    boot({ muted: false });
    const stop = loop("thinking");
    writeSound({ muted: true });
    stop();
    writeSound({ muted: false });
    expect(started).toBe(1);
  });

  it("starts a loop asked for while muted when the reader unmutes during the wait", () => {
    boot({ muted: true });
    loop("thinking");
    expect(started).toBe(0);
    writeSound({ muted: false });
    expect(started).toBe(1);
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

describe("the leaves", () => {
  const flightDetail: FlightDetail = {
    stage: "leaf",
    duration: 0.1,
    grains: [],
  };
  const landing = () => {
    const art = document.createElement("div");
    art.dataset.heroArt = "";
    document.body.append(art);
  };
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("plays the gust 5 ms ahead on the audio clock, in the change's voice, once the landing's chunk has loaded", async () => {
    landing();
    boot();
    await vi.dynamicImportSettled();
    ctx.advance(2);
    cueFlight("gust", { ...flightDetail, grains: [{ at: 0.05, pan: 0.5 }] });
    const sources = ctx.started("bufferSource");
    expect(sources).toHaveLength(2); // the sweep and one grain, not two canopy bands
    expect(sources[0].startedAt).toBeCloseTo(2.005);
  });

  it("plays a change as the sweep and its grains", async () => {
    landing();
    boot();
    await vi.dynamicImportSettled();
    cueFlight("change", {
      ...flightDetail,
      stage: "word",
      grains: [{ at: 0.05, pan: 0.5 }],
    });
    expect(ctx.started("bufferSource")).toHaveLength(2); // the sweep and one grain
  });

  const longFlight: FlightDetail = {
    stage: "leaf",
    duration: 3,
    grains: [
      { at: 0.5, pan: -0.5 },
      { at: 1.5, pan: 0.2 },
      { at: 2.5, pan: 0.7 },
    ],
  };

  it("plays a gust cued before the chunk loaded from its offset once it loads: only the grains to come, silent at the last landing", async () => {
    landing();
    boot();
    cueFlight("gust", longFlight);
    // 1.2 s of the 3 s flight go by before the chunk arrives
    vi.advanceTimersByTime(1200);
    ctx.advance(1.2);
    await vi.dynamicImportSettled();
    const sources = ctx.started("bufferSource");
    // the sweep and the two grains at 1.5 s and 2.5 s, now 0.3 s and 1.3 s ahead
    expect(sources).toHaveLength(3);
    const now = ctx.currentTime;
    expect(
      sources
        .map((s) => s.startedAt)
        .slice(1)
        .sort(),
    ).toEqual([
      expect.closeTo(now + 0.005 + 0.3, 6),
      expect.closeTo(now + 0.005 + 1.3, 6),
    ]);
    const guard = ctx.nodes.find(
      (n) =>
        n.gain.of("linearRampToValueAtTime").length === 1 &&
        n.gain.of("setValueAtTime").length === 2,
    );
    // 3 s - 1.2 s = 1.8 s of flight remain, from now + 5 ms
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args[0]).toBe(0);
    expect(guard?.gain.of("linearRampToValueAtTime")[0].args[1]).toBeCloseTo(
      now + 0.005 + 1.8,
      6,
    );
  });

  it("plays nothing for a gust whose leaves have all landed before the chunk loads", async () => {
    landing();
    boot();
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(3000);
    await vi.dynamicImportSettled();
    expect(ctx.started("bufferSource")).toHaveLength(0);
  });

  it("remembers only the newest cue: a stage that was superseded is not joined", async () => {
    landing();
    boot();
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(500);
    cueFlight("change", { ...longFlight, stage: "graph", grains: [] });
    await vi.dynamicImportSettled();
    // only the change's sweep, 0 grains: not the gust's three
    expect(ctx.started("bufferSource")).toHaveLength(1);
  });

  it("does not play a stage twice: a live cue is not joined again", async () => {
    landing();
    boot();
    await vi.dynamicImportSettled();
    cueFlight("gust", longFlight);
    const heard = ctx.started("bufferSource").length;
    expect(heard).toBe(4);
    engine?.attach(ctx as unknown as AudioContext);
    expect(ctx.started("bufferSource")).toHaveLength(heard);
  });

  it("joins nothing while muted", async () => {
    landing();
    boot({ muted: true });
    cueFlight("gust", longFlight);
    await vi.dynamicImportSettled();
    expect(ctx.started("bufferSource")).toHaveLength(0);
  });

  it("never loads the leaves anywhere but the landing", async () => {
    boot();
    await vi.dynamicImportSettled();
    cueFlight("gust", flightDetail);
    await vi.dynamicImportSettled();
    cueFlight("gust", flightDetail);
    rustle(0.5, 0);
    expect(ctx.started("bufferSource")).toHaveLength(0);
  });

  it("is silent while muted", async () => {
    landing();
    boot({ muted: true });
    await vi.dynamicImportSettled();
    cueFlight("gust", flightDetail);
    rustle(0.5, 0);
    expect(ctx.started("bufferSource")).toHaveLength(0);
  });

  it("makes one rustle for a whole drag and lets it go when the speed reaches 0", async () => {
    landing();
    boot();
    await vi.dynamicImportSettled();
    ctx.advance(1);
    rustle(0.4, -0.5);
    ctx.advance(0.016);
    rustle(0.8, -0.4);
    ctx.advance(0.016);
    rustle(0.6, -0.3);
    const [voice] = ctx.started("bufferSource");
    expect(ctx.started("bufferSource")).toHaveLength(1);
    expect(voice.stoppedAt).toBeUndefined();
    const gain = ctx.nodes.find(
      (n) => n.gain.of("setTargetAtTime").length === 3,
    );
    expect(gain?.gain.of("setTargetAtTime").map((c) => c.args[0])).toEqual([
      0.008, 0.016, 0.012,
    ]);
    ctx.advance(0.1);
    rustle(0, 0);
    // let go: stopped within 0.5 s of now (1.132)
    expect(voice.stoppedAt).toBeCloseTo(1.632);
    // a second touch is a new voice
    rustle(0.5, 0);
    expect(ctx.started("bufferSource")).toHaveLength(2);
  });

  it("lets the rustle go when the reader mutes", async () => {
    landing();
    boot();
    await vi.dynamicImportSettled();
    rustle(0.5, 0);
    const [voice] = ctx.started("bufferSource");
    writeSound({ muted: true });
    expect(voice.stoppedAt).toBeDefined();
  });
});

describe("the aura", () => {
  // Expected values: plan #352 Phase 7 Done-when and D14. The aura is wanted only where <html> has `data-aura` (the
  // landing), the reader is unmuted and the stored aura is on; a fresh visitor has it off (D6), so unmuting alone starts
  // nothing. A track change crossfades 1.5 s; switching off or muting stops it; `pagehide` stops it at once. The bus is
  // the one node that feeds the master.
  const setAura = (present: boolean) => {
    if (present) document.documentElement.setAttribute("data-aura", "");
    else document.documentElement.removeAttribute("data-aura");
  };
  const bus = (master: ReturnType<typeof boot>) =>
    ctx.nodes.find((n) => n.outputs.includes(master)) as (typeof ctx.nodes)[0];
  /** The master and the ceiling are the only nodes the engine makes on its own, and a page with no aura makes no more. */
  const baseline = 2;
  const sounding = () => ctx.started("bufferSource").length;
  const settle = () => vi.dynamicImportSettled();

  // A cold module graph can outlast one settle; the engine's own import then finds the module ready.
  beforeAll(async () => {
    await import("./aura");
  });
  beforeEach(() => setAura(true));
  afterEach(() => setAura(false));

  it("is silent for a fresh visitor who unmutes: the switch is off, so nothing is imported or started", async () => {
    boot();
    await settle();
    expect(ctx.nodes).toHaveLength(baseline);
    expect(sounding()).toBe(0);
  });

  it("starts the stored track on the landing, fading in over 2 s", async () => {
    writeAura({ on: true });
    const master = boot();
    await settle();
    expect(sounding()).toBe(2); // Forest air: two bands, no ticks
    expect(bus(master).gain.of("linearRampToValueAtTime")[0].args).toEqual([
      0.25, 2,
    ]);
  });

  it("starts Leaves overhead when that is the stored track", async () => {
    writeAura({ on: true, track: "overhead" });
    boot();
    await settle();
    expect(sounding()).toBe(3); // the two bands and the first tick
  });

  it("imports nothing on a page without data-aura, though the aura is on and the reader unmuted", async () => {
    setAura(false);
    writeAura({ on: true });
    boot();
    await settle();
    expect(ctx.nodes).toHaveLength(baseline);
  });

  it("imports nothing while muted, and starts when the reader unmutes", async () => {
    writeAura({ on: true });
    const master = boot({ muted: true });
    await settle();
    expect(ctx.nodes).toHaveLength(baseline);
    writeSound({ muted: false });
    await settle();
    expect(sounding()).toBe(2);
    expect(bus(master).gain.of("linearRampToValueAtTime").at(-1)?.args[0]).toBe(
      0.25,
    );
  });

  it("starts when the reader switches it on, with the engine already loaded", async () => {
    boot();
    await settle();
    writeAura({ on: true });
    await settle();
    expect(sounding()).toBe(2);
  });

  it("crossfades over 1.5 s on a track change, and the bus holds", async () => {
    writeAura({ on: true });
    const master = boot();
    await settle();
    ctx.advance(10);
    const busCalls = bus(master).gain.calls.length;
    writeAura({ track: "overhead" });
    const gains = ctx.nodes.filter((n) => n.outputs.includes(bus(master)));
    expect(gains).toHaveLength(2);
    expect(gains[0].gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      0, 11.5,
    ]);
    expect(gains[1].gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual([
      1, 11.5,
    ]);
    expect(bus(master).gain.calls).toHaveLength(busCalls);
  });

  it("stops when it is switched off, fading out", async () => {
    writeAura({ on: true });
    const master = boot();
    await settle();
    ctx.advance(10);
    writeAura({ on: false });
    expect(bus(master).gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual(
      [0, 10.6],
    );
  });

  it("stops when the reader mutes, and does not come back as a blip when they unmute", async () => {
    writeAura({ on: true });
    const master = boot();
    await settle();
    ctx.advance(10);
    writeSound({ muted: true });
    expect(bus(master).gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual(
      [0, 10],
    );
    vi.advanceTimersByTime(100);
    writeSound({ muted: false });
    await settle();
    expect(bus(master).gain.of("linearRampToValueAtTime").at(-1)?.args[0]).toBe(
      0.25,
    );
  });

  it("stops at once on pagehide, with the context asleep behind it", async () => {
    writeAura({ on: true, track: "overhead" });
    const master = boot();
    await settle();
    ctx.advance(10);
    window.dispatchEvent(new Event("pagehide"));
    expect(bus(master).gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual(
      [0, 10],
    );
    expect(ctx.calls).toContain("suspend");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops when the tab is hidden and starts again when it is back", async () => {
    writeAura({ on: true });
    const master = boot();
    await settle();
    ctx.advance(10);
    setVisibility("hidden");
    expect(bus(master).gain.of("linearRampToValueAtTime").at(-1)?.args).toEqual(
      [0, 10.6],
    );
    setVisibility("visible");
    await settle();
    expect(sounding()).toBe(4);
  });

  it("is reached only by a dynamic import, so no page carries it up front", () => {
    const source = readFileSync("src/lib/sound/engine.ts", "utf8");
    const imports = [
      ...source.matchAll(/^import\s[^;]*?from\s+"\.\/aura";/gms),
    ];
    expect(imports.map((m) => m[0])).toEqual([
      'import type { Aura } from "./aura";',
    ]);
    expect(source).toContain('import("./aura")');
  });

  it("never changes dox:sound's aura or track, whatever the reader does here", async () => {
    saveSound({ level: 7, aura: false, track: "deep" });
    boot({ level: 7, aura: false, track: "deep" });
    await settle();
    writeAura({ on: true, track: "overhead" });
    writeAura({ on: false });
    writeSound({ muted: true });
    const record = JSON.parse(localStorage.getItem(SOUND_KEY) ?? "{}");
    expect(record.aura).toBe(false);
    expect(record.track).toBe("deep");
  });
});

describe("sound starting at the first press", () => {
  // Expected values: plan #352 Phase 10 Done-when. On a refresh with sound and aura on no context is made at load; a link
  // arrival that the browser keeps suspended (the fake is gated on `userActivation`) sounds nothing either, until the first press.
  // That press resumes it; the aura starts (Forest air: 2 sources, as the aura block counts); a stage still in flight
  // is joined from its offset (the sweep and the 2 grains of `longFlight` to come after 1.2 s, as 'the leaves' counts);
  // a stage that has landed plays no leaves; nothing happens while muted.
  const longFlight: FlightDetail = {
    stage: "leaf",
    duration: 3,
    grains: [
      { at: 0.5, pan: -0.5 },
      { at: 1.5, pan: 0.2 },
      { at: 2.5, pan: 0.7 },
    ],
  };
  const nextChange: FlightDetail = { ...longFlight, grains: [], duration: 1 };
  let stop: (() => void) | undefined;
  const sounding = () => FakeAudioContext.instances[0].started("bufferSource");

  /** A press: activation is live for the dispatch only, as the browser's is. */
  const press = () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: true },
    });
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    document.body.dispatchEvent(new Event("pointerup", { bubbles: true }));
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: false },
    });
  };

  /**
   * Load the landing as startCue sees it. A "reload" (the scenario of most tests here) makes no context until the first
   * press, because Chrome refuses one at load; a "push" is a link arrival from another page, which makes the context at
   * load, and with no activation (Safari) it stays suspended: the gated fake.
   */
  const load = async (
    type: "reload" | "push" = "reload",
    saved: Record<string, unknown> = {},
  ) => {
    FakeAudioContext.gated = true;
    vi.stubGlobal("navigator", {
      ...navigator,
      userActivation: { isActive: false },
    });
    vi.stubGlobal("navigation", {
      activation: {
        from: {
          url: type === "reload" ? location.href : `${location.origin}/gmt/`,
        },
        navigationType: type,
      },
    });
    document.documentElement.setAttribute("data-aura", "");
    const art = document.createElement("div");
    art.dataset.heroArt = "";
    document.body.append(art);
    saveSound(saved);
    writeAura({ on: true });
    stop = startCue();
    await vi.dynamicImportSettled();
  };

  beforeAll(async () => {
    await import("./aura");
    await import("./leaves");
  });
  afterEach(() => {
    stop?.();
    stop = undefined;
    document.documentElement.removeAttribute("data-aura");
    document.body.replaceChildren();
  });

  it("makes no context on a refresh, and so is silent, until the first press", async () => {
    await load("reload");
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(1200);
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("is silent on a link arrival the browser did not let run, until the first press", async () => {
    await load("push");
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(1200);
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances[0].state).toBe("suspended");
    expect(sounding()).toHaveLength(0);
    press();
    await vi.dynamicImportSettled();
    expect(sounding()).toHaveLength(5); // the aura's 2 bands, the sweep and the 2 grains to come
  });

  it("resumes on the first press, starts the aura, joins a stage in flight, and lets the next change play", async () => {
    await load("reload");
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(1200);
    await vi.dynamicImportSettled();
    press();
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances[0].state).toBe("running");
    // the aura's 2 bands, the sweep and the 2 grains still to come
    expect(sounding()).toHaveLength(5);
    cueFlight("change", { ...nextChange, grains: [{ at: 0.5, pan: 0 }] });
    expect(sounding()).toHaveLength(7); // a sweep and a grain
  });

  it("starts the aura but plays no leaves when the press comes after the stage has landed", async () => {
    await load("reload");
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(3200);
    press();
    await vi.dynamicImportSettled();
    expect(sounding()).toHaveLength(2);
  });

  it("makes no cue sound of its own: the press only unlocks", async () => {
    await load("reload");
    press();
    await vi.dynamicImportSettled();
    // nothing but the aura's two bands: no notch, no key
    expect(sounding()).toHaveLength(2);
  });

  it("joins the stage and starts the aura when the browser lets the context run after a press it refused", async () => {
    // #353: Safari refuses the press's resume(); the context runs later, with no gesture of its own.
    await load("reload");
    cueFlight("gust", longFlight);
    vi.advanceTimersByTime(1200);
    FakeAudioContext.refuse = true;
    press();
    await vi.dynamicImportSettled();
    expect(sounding()).toHaveLength(0);
    FakeAudioContext.refuse = false;
    FakeAudioContext.instances[0].become("running");
    await vi.dynamicImportSettled();
    // the aura's 2 bands, the sweep and the 2 grains still to come
    expect(sounding()).toHaveLength(5);
  });

  it("does nothing on a press while muted", async () => {
    await load("reload", { muted: true });
    cueFlight("gust", longFlight);
    press();
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});
