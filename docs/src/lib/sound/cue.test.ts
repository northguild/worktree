import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAudioContext, installFakeAudio } from "../../test/fake-audio";
import { saveSound, stubStorage } from "../../test/sound-storage";
import { cue, loop, startCue } from "./cue";
import { SOUND_KEY, writeSound } from "./settings";

const engine = { attach: vi.fn(), destroy: vi.fn() };
const createEngine = vi.fn(() => engine);
vi.mock("./engine", () => ({ createEngine: () => createEngine() }));

let teardown: (() => void) | undefined;

function start() {
  teardown = startCue();
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeAudio();
  stubStorage();
  // Sound is opt-in: these tests stand for a reader who turned it on; "muted" clears it.
  saveSound();
  engine.attach.mockClear();
  engine.destroy.mockClear();
  createEngine.mockClear();
});

afterEach(() => {
  teardown?.();
  teardown = undefined;
  localStorage.clear();
  vi.unstubAllGlobals();
  expect(vi.getTimerCount()).toBe(0);
});

/**
 * A gesture on the page. The unlock listens for the activation events themselves, and no user-event library is
 * installed in this package, so a press is the `pointerdown` and `pointerup` a mouse press makes, dispatched on the
 * body, and a key press is a `keydown`.
 */
function fire(type: string) {
  document.body.dispatchEvent(new Event(type, { bubbles: true }));
}
function press(kind: "pointer" | "keydown" = "pointer") {
  if (kind === "keydown") fire("keydown");
  else {
    fire("pointerdown");
    fire("pointerup");
  }
}

/** Another tab's write: no user action in this page produces a `storage` event. */
function storageChanged() {
  window.dispatchEvent(new StorageEvent("storage", { key: SOUND_KEY }));
}

describe("before a gesture", () => {
  it("makes no audio context", async () => {
    start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("drops a cue, and a loop, with nobody listening", () => {
    start();
    expect(cue("notch")).toBe(false);
    loop("thinking")();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("loads the engine on idle when not muted", async () => {
    start();
    await vi.advanceTimersByTimeAsync(10);
    await vi.dynamicImportSettled();
    expect(createEngine).toHaveBeenCalledTimes(1);
  });
});

describe("the first gesture", () => {
  it("creates and resumes the context inside the event, before anything awaits", async () => {
    start();
    press();
    const [ctx] = FakeAudioContext.instances;
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(ctx.calls).toEqual(["resume"]);
    expect(ctx.options).toEqual({ latencyHint: "interactive" });
  });

  it("unlocks on a key press too", async () => {
    start();
    press("keydown");
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("unlocks on the release of a press that began before it listened", async () => {
    fire("pointerdown");
    start();
    fire("pointerup");
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("unlocks on a touch ending", () => {
    start();
    fire("touchend");
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("hands the context to the engine once it has loaded", async () => {
    start();
    press();
    await vi.dynamicImportSettled();
    expect(engine.attach).toHaveBeenCalledWith(FakeAudioContext.instances[0]);
  });

  it("removes its listeners once the context is running", async () => {
    start();
    press();
    press();
    press("keydown");
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].calls).toEqual(["resume"]);
  });

  it("keeps waiting when the browser refuses, with no error", async () => {
    FakeAudioContext.refuse = true;
    start();
    press();
    press("keydown");
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].state).toBe("suspended");
    // The mouse press is a pointerdown and a pointerup; the key press is a keydown.
    expect(FakeAudioContext.instances[0].calls).toEqual([
      "resume",
      "resume",
      "resume",
    ]);
  });
});

describe("muted", () => {
  it.each([
    ["a visitor who never chose", () => localStorage.clear()],
    ["a saved mute", () => saveSound({ muted: true })],
  ])("makes no context and loads no engine, gesture or not: %s", async (_name, set) => {
    set();
    start();
    press();
    await vi.advanceTimersByTimeAsync(10);
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances).toHaveLength(0);
    expect(createEngine).not.toHaveBeenCalled();
  });

  it("unlocks the moment the reader unmutes, which is itself a gesture", async () => {
    saveSound({ muted: true });
    start();
    writeSound({ muted: false });
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].calls).toEqual(["resume"]);
    await vi.dynamicImportSettled();
    expect(createEngine).toHaveBeenCalledTimes(1);
  });

  it("waits for a gesture when another tab unmutes", async () => {
    saveSound({ muted: true });
    start();
    saveSound({ muted: false });
    storageChanged();
    expect(FakeAudioContext.instances).toHaveLength(0);
    press();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});

describe("an in-site arrival", () => {
  function arrival(from: string | null, policy?: string) {
    vi.stubGlobal("navigation", {
      activation: { from: from ? { url: from } : null },
    });
    if (policy) {
      Object.defineProperty(navigator, "getAutoplayPolicy", {
        value: () => policy,
        configurable: true,
      });
    }
  }
  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).getAutoplayPolicy;
  });

  it("unlocks at load where autoplay is allowed", async () => {
    arrival(`${location.origin}/guides/`, "allowed");
    start();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("unlocks at load where the API is absent, as Chrome has none", async () => {
    arrival(`${location.origin}/guides/`);
    start();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("waits for a gesture where the browser disallows autoplay", async () => {
    arrival(`${location.origin}/guides/`, "disallowed");
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("stays silent and logs nothing where the context stays suspended", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    FakeAudioContext.refuse = true;
    arrival(`${location.origin}/guides/`);
    start();
    await vi.dynamicImportSettled();
    expect(FakeAudioContext.instances[0].state).toBe("suspended");
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    error.mockRestore();
    warn.mockRestore();
  });

  it("waits for a gesture when the page came from elsewhere", async () => {
    arrival("https://example.org/", "allowed");
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });
});

describe("teardown", () => {
  it("closes the context, destroys the engine and leaves no listener", async () => {
    FakeAudioContext.refuse = true;
    start();
    press();
    await vi.dynamicImportSettled();
    teardown?.();
    teardown = undefined;
    expect(FakeAudioContext.instances[0].state).toBe("closed");
    expect(engine.destroy).toHaveBeenCalled();
    press("keydown");
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});
