/**
 * The hero's loader (D18): a small static script on the landing alone. It decides between the effect and the still SVG,
 * and only loads the effect (OGL and the particles, a separate chunk) when the visitor will see it:
 *  - `prefers-reduced-motion: reduce`, or no WebGL, shows the still and never requests the effect;
 *  - otherwise it waits for the first paint, so the copy and the button are the LCP, and only then probes for WebGL
 *    (a probe makes a GPU context) and imports it;
 *  - a WebGL context the browser takes back later (a GPU reset, too many contexts) shows the still for good.
 * Without script nothing here runs; `HeroLeaves.astro`'s CSS shows the still (`@media (scripting: none)`).
 *
 * The state is `data-hero` on the art box: `live` shows the canvas, `still` shows the SVG.
 */

import type { HeroHandle, HeroHost } from "./particles";

export type HeroState = "live" | "still";

export interface HeroDeps {
  host: HeroHost;
  reducedMotion: Pick<MediaQueryList, "matches" | "addEventListener">;
  hasWebGL(): boolean;
  /** Resolves after the page's first paint. */
  firstPaint(): Promise<void>;
  /** The dynamic import of the effect: the only reference to it. */
  importEffect(): Promise<{
    startParticles(host: HeroHost): HeroHandle | null;
  }>;
}

export async function mountHero({
  host,
  reducedMotion,
  hasWebGL,
  firstPaint,
  importEffect,
}: HeroDeps): Promise<void> {
  const setState = (state: HeroState) => {
    host.art.dataset.hero = state;
  };
  let handle: HeroHandle | null = null;
  let started = false;
  let lost = false;

  function loseContext() {
    lost = true;
    handle?.setActive(false);
    setState("still");
  }

  async function start() {
    started = true;
    await firstPaint();
    if (reducedMotion.matches) {
      started = false;
      return;
    }
    if (!hasWebGL()) {
      setState("still");
      return;
    }
    try {
      const { startParticles } = await importEffect();
      handle = startParticles(host);
    } catch (error) {
      console.warn("[hero] the effect did not load; showing the still", error);
    }
    // Whenever the effect started, even if reduced motion was switched on meanwhile: switching it off later turns the
    // canvas live, and a lost context must still fall back to the still then.
    if (handle)
      host.canvas.addEventListener("webglcontextlost", loseContext, {
        once: true,
      });
    if (handle && !reducedMotion.matches) {
      setState("live");
    } else {
      handle?.setActive(false);
      setState("still");
    }
  }

  reducedMotion.addEventListener("change", () => {
    if (reducedMotion.matches) {
      handle?.setActive(false);
      setState("still");
    } else if (lost) {
      // A lost context leaves the canvas nothing to draw with, so the still stays.
      return;
    } else if (handle) {
      handle.setActive(true);
      setState("live");
    } else if (!started) void start();
  });

  if (reducedMotion.matches) {
    setState("still");
    return;
  }
  await start();
}

/** True when a WebGL context can be made. The throwaway context is released at once. */
export function webGLAvailable(): boolean {
  const probe = document.createElement("canvas");
  const gl = probe.getContext("webgl2") ?? probe.getContext("webgl");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  return gl !== null;
}

/** After the first paint: a frame has been drawn, and the main thread had a moment after it. */
export function afterFirstPaint(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => setTimeout(resolve, 0)),
  );
}
