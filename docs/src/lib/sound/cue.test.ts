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
  // The page is the docs landing, so northguild.dev's root is another page of the origin.
  history.replaceState(null, "", "/worktree/");
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

describe("a context that starts suspended", () => {
  it("is resumed by each press until it runs, then the listeners go and the engine is told again", async () => {
    // A link arrival from northguild.dev's root (the page is /worktree/, so "/" is another page) that the browser will not
    // let run (Safari): the context is made at load and stays suspended. One resume at load, one per press, none once
    // it runs.
    vi.stubGlobal("navigation", {
      activation: {
        from: { url: `${location.origin}/` },
        navigationType: "push",
      },
    });
    FakeAudioContext.refuse = true;
    start();
    await vi.dynamicImportSettled();
    const [ctx] = FakeAudioContext.instances;
    expect(ctx.calls).toEqual(["resume"]);
    press("keydown");
    expect(ctx.calls).toEqual(["resume", "resume"]);
    FakeAudioContext.refuse = false;
    engine.attach.mockClear();
    press("keydown");
    expect(ctx.state).toBe("running");
    expect(engine.attach).toHaveBeenCalledWith(ctx);
    press("keydown");
    press();
    expect(ctx.calls).toEqual(["resume", "resume", "resume"]);
  });

  it("tells the engine when the browser lets the context run after the press has returned", async () => {
    // A real resume() settles later, as in Chromium and WebKit: the press's own attach sees a suspended context.
    FakeAudioContext.refuse = true;
    start();
    press("keydown");
    await vi.dynamicImportSettled();
    const [ctx] = FakeAudioContext.instances;
    expect(ctx.state).toBe("suspended");
    engine.attach.mockClear();
    ctx.become("running");
    expect(engine.attach).toHaveBeenCalledWith(ctx);
    press("keydown");
    expect(ctx.calls).toEqual(["resume"]);
  });

  it("does nothing while muted: no context, whatever the press", async () => {
    localStorage.clear();
    writeSound({ muted: true });
    start();
    press();
    expect(FakeAudioContext.instances).toHaveLength(0);
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
  /** The Navigation API's `activation`: where the entry left was, and how this document was reached. */
  function arrival(
    from: string | null,
    policy?: string,
    navigationType = "push",
  ) {
    vi.stubGlobal("navigation", {
      activation: { from: from ? { url: from } : null, navigationType },
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

  // Phase 11 notes: sound off is respected by a link arrival, and a cross-origin arrival (whose `from` the browser hides as
  // null) is not known to be this site's, so it waits for a press.
  it("makes no context at load for a muted reader, whatever the arrival", async () => {
    saveSound({ muted: true });
    arrival(`${location.origin}/guides/`, "allowed", "push");
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("makes no context at load on a push whose `from` the browser hides", async () => {
    arrival(null, "allowed", "push");
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("waits for a gesture when the page came from elsewhere", async () => {
    arrival("https://example.org/", "allowed");
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  // Phase 11, as the Chromium probe found it: Chrome carries a click across a link navigation but not across a refresh or
  // a back/forward, so a context made at load on those logs "The AudioContext was not allowed to start". They wait for
  // a press. `navigationType` tells the cases apart: "push" and "replace" are a link click, which is a gesture.
  it.each([
    ["reload", false],
    ["reload", true],
    ["traverse", false],
  ])("makes no context at load on a %s (a press before it: %s), and the first press makes and resumes it", async (type, pressedBefore) => {
    if (pressedBefore) {
      start();
      press();
      teardown?.();
      FakeAudioContext.instances.length = 0;
    }
    arrival(location.href, undefined, type);
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
    press();
    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].state).toBe("running");
  });

  it("makes no context at load where activation has no navigationType", async () => {
    vi.stubGlobal("navigation", {
      activation: { from: { url: `${location.origin}/` } },
    });
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it("makes no context at load where the browser has no Navigation API activation", async () => {
    vi.stubGlobal("navigation", undefined);
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
    vi.stubGlobal("navigation", {});
    teardown?.();
    start();
    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  // The owner: sound on at northguild.dev, or in localStorage, must play on landing at /worktree. A link click from any
  // page of this origin is a gesture, so Chrome lets the context run and logs nothing.
  it.each(
    ["push", "replace"].flatMap((type) => [
      [type, "northguild.dev's root", "/"],
      [type, "a GMT docs page", "/gmt/some-page"],
      [type, "another worktree page", "/worktree/guides/"],
    ]),
  )("makes the context at load on a %s arrival from %s", async (type, _name, path) => {
    arrival(`${location.origin}${path}`, undefined, type);
    start();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it("makes the context at load on a push from the page's own URL, a link to itself such as the logo", async () => {
    arrival(location.href, undefined, "push");
    start();
    expect(FakeAudioContext.instances).toHaveLength(1);
  });
});

describe("an engine chunk that fails to load", () => {
  // Phase 13: a failed `import()` must not leave `loading` true for good or reject unhandled; a later press tries again.
  // A fresh copy of cue.ts, whose first import of the engine rejects (its module factory throws) and whose second works.
  it("tries again on the next press, and hands the context over once it loads", async () => {
    vi.resetModules();
    vi.doMock("./engine", () => {
      throw new Error("Failed to fetch dynamically imported module");
    });
    const fresh = await import("./cue");
    const stop = fresh.startCue();
    try {
      press();
      await vi.advanceTimersByTimeAsync(10);
      await vi.dynamicImportSettled();
      expect(createEngine).not.toHaveBeenCalled();
      vi.resetModules();
      vi.doMock("./engine", () => ({ createEngine: () => createEngine() }));
      press();
      await vi.advanceTimersByTimeAsync(10);
      await vi.dynamicImportSettled();
      expect(createEngine).toHaveBeenCalledTimes(1);
      expect(engine.attach).toHaveBeenCalled();
    } finally {
      stop();
      // Leave the file's own mock in place for the tests after this one.
      vi.resetModules();
      vi.doMock("./engine", () => ({ createEngine: () => createEngine() }));
    }
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
