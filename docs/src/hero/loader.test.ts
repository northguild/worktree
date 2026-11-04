import { describe, expect, it, vi } from "vitest";
import { type HeroDeps, mountHero } from "./loader";
import type { HeroHandle } from "./particles";

// Expected values: D18's "Still" and "Loading" bullets. Under `prefers-reduced-motion: reduce`, without WebGL, or
// without script the art box shows the still SVG and the library is never requested; otherwise a loader waits for
// the first paint and then imports the effect. The decision is observed at its seams: `data-hero` on the art box
// (which HeroLeaves.astro's CSS turns into canvas or SVG) and whether `importEffect` was called.

interface Fake {
  deps: HeroDeps;
  art: HTMLElement;
  canvas: HTMLCanvasElement;
  handle: HeroHandle & { setActive: ReturnType<typeof vi.fn> };
  importEffect: ReturnType<typeof vi.fn>;
  startParticles: ReturnType<typeof vi.fn>;
  calls: string[];
  setReduced(matches: boolean): void;
  releaseFirstPaint(): void;
}

function fake({ reduced = false, webgl = true, started = true } = {}): Fake {
  const art = document.createElement("div");
  const canvas = document.createElement("canvas");
  const calls: string[] = [];
  const handle = { setActive: vi.fn() };
  const startParticles = vi.fn(() => {
    calls.push("start");
    return started ? handle : null;
  });
  const importEffect = vi.fn(async () => {
    calls.push("import");
    return { startParticles };
  });
  let matches = reduced;
  let onChange = () => {};
  let releasePaint = () => {};
  const deps: HeroDeps = {
    host: { art, canvas, header: null },
    reducedMotion: {
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: unknown) => {
        onChange = listener as () => void;
      },
    },
    hasWebGL: () => {
      calls.push("probe");
      return webgl;
    },
    firstPaint: () =>
      new Promise<void>((resolve) => {
        releasePaint = () => {
          calls.push("paint");
          resolve();
        };
      }),
    importEffect,
  };
  return {
    deps,
    art,
    canvas,
    handle,
    importEffect,
    startParticles,
    calls,
    setReduced(next) {
      matches = next;
      onChange();
    },
    releaseFirstPaint: () => releasePaint(),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mountHero", () => {
  it("shows the still and never imports the effect under reduced motion", async () => {
    const f = fake({ reduced: true });
    await mountHero(f.deps);
    expect(f.art.dataset.hero).toBe("still");
    expect(f.importEffect).not.toHaveBeenCalled();
  });

  it("shows the still and never imports the effect without WebGL", async () => {
    const f = fake({ webgl: false });
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    expect(f.art.dataset.hero).toBe("still");
    expect(f.importEffect).not.toHaveBeenCalled();
  });

  // D18: the loader "waits for the first paint" before it touches the effect; probing WebGL makes a GPU context, so
  // it waits too (review of phase 16: the probe ran before the paint).
  it("does not probe for WebGL before the first paint", async () => {
    const f = fake();
    const mounted = mountHero(f.deps);
    await flush();
    expect(f.calls).toEqual([]);
    f.releaseFirstPaint();
    await mounted;
    expect(f.calls).toEqual(["paint", "probe", "import", "start"]);
  });

  it("imports the effect only after the first paint, then shows the canvas", async () => {
    const f = fake();
    const mounted = mountHero(f.deps);
    await flush();
    expect(f.importEffect).not.toHaveBeenCalled();
    expect(f.art.dataset.hero).toBeUndefined();
    f.releaseFirstPaint();
    await mounted;
    expect(f.calls).toEqual(["paint", "probe", "import", "start"]);
    expect(f.art.dataset.hero).toBe("live");
  });

  it("does not import if reduced motion was switched on while waiting for the first paint", async () => {
    const f = fake();
    const mounted = mountHero(f.deps);
    f.setReduced(true);
    f.releaseFirstPaint();
    await mounted;
    expect(f.importEffect).not.toHaveBeenCalled();
    expect(f.art.dataset.hero).toBe("still");
  });

  it("falls back to the still when the effect cannot be imported", async () => {
    const f = fake();
    f.importEffect.mockRejectedValueOnce(new Error("offline"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    expect(f.art.dataset.hero).toBe("still");
    warn.mockRestore();
  });

  // OGL's Renderer throws when it cannot make a context (it logs, then reads a property of null).
  it("falls back to the still when starting the effect throws", async () => {
    const f = fake();
    f.startParticles.mockImplementationOnce(() => {
      throw new TypeError("Cannot set properties of null (setting 'renderer')");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    expect(f.art.dataset.hero).toBe("still");
    warn.mockRestore();
  });

  // D18: "without WebGL ... the art box shows a static SVG". A context the browser takes back (a GPU reset, too many
  // contexts) is WebGL gone after the start: the canvas would stay blank and the loop would run for nothing.
  it("shows the still and stops the effect when the WebGL context is lost", async () => {
    const f = fake();
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    expect(f.art.dataset.hero).toBe("live");
    f.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(f.handle.setActive).toHaveBeenLastCalledWith(false);
    expect(f.art.dataset.hero).toBe("still");
  });

  it("does not go back to the lost canvas when reduced motion is switched off", async () => {
    const f = fake();
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    f.canvas.dispatchEvent(new Event("webglcontextlost"));
    f.setReduced(true);
    f.setReduced(false);
    expect(f.art.dataset.hero).toBe("still");
    expect(f.handle.setActive).not.toHaveBeenCalledWith(true);
  });

  it("still shows the still on a lost context when reduced motion was switched on and off during the import", async () => {
    const f = fake();
    let resolveImport = (_: { startParticles: typeof f.startParticles }) => {};
    f.importEffect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
    );
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await flush();
    f.setReduced(true);
    resolveImport({ startParticles: f.startParticles });
    await mounted;
    f.setReduced(false);
    expect(f.art.dataset.hero).toBe("live");
    f.canvas.dispatchEvent(new Event("webglcontextlost"));
    expect(f.art.dataset.hero).toBe("still");
    expect(f.handle.setActive).toHaveBeenLastCalledWith(false);
  });

  it("falls back to the still when the effect finds no WebGL context", async () => {
    const f = fake({ started: false });
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    expect(f.art.dataset.hero).toBe("still");
  });

  it("stops the effect and shows the still when reduced motion is switched on, and resumes it when switched off", async () => {
    const f = fake();
    const mounted = mountHero(f.deps);
    f.releaseFirstPaint();
    await mounted;
    f.setReduced(true);
    expect(f.handle.setActive).toHaveBeenLastCalledWith(false);
    expect(f.art.dataset.hero).toBe("still");
    f.setReduced(false);
    expect(f.handle.setActive).toHaveBeenLastCalledWith(true);
    expect(f.art.dataset.hero).toBe("live");
  });

  it("imports the effect when reduced motion is switched off for a visitor who never had it", async () => {
    const f = fake({ reduced: true });
    await mountHero(f.deps);
    f.setReduced(false);
    f.releaseFirstPaint();
    await flush();
    expect(f.importEffect).toHaveBeenCalledOnce();
    expect(f.art.dataset.hero).toBe("live");
  });
});
