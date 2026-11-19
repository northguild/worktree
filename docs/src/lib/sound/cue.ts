/**
 * The one sound module on every page's critical path: `cue(name)` fires a sound, and `startCue` arms the unlock.
 *
 * Ported from gmt apps/dox/src/lib/sound/cue.ts at d6031ecd, cut down (plan #352, D7): the sidebar's arrival cue and
 * every cue of a press are gone, and the event is `worktree:cue`, not GMT's.
 *
 * Nothing here makes a sound. `cue` dispatches `worktree:cue` on the document; the engine (./engine.ts) listens once it
 * has loaded and a gesture has unlocked the audio context, and until then the event is unheard, which drops the cue.
 * Nothing queues. The engine is only ever reached through `import()` here, never a static import, so the first paint
 * carries this file and the settings and none of the audio code.
 *
 * Unlock, in order of a page's life:
 * 1. Muted: no context and no engine. Unmuting is itself a gesture, so it unlocks.
 * 2. Not muted: capture-phase listeners for `pointerdown`, `pointerup`, `keydown` and `touchend`. The first one
 *    creates and resumes the context synchronously; Safari does not count a resume after an `await`. The listeners go
 *    once the context is running.
 * 3. After an in-site arrival, unlock at load unless the browser says autoplay is not allowed. Chrome has no
 *    `getAutoplayPolicy` but lets a document reached by a same-origin navigation after a gesture start audio; where it
 *    refuses (Safari) the context stays suspended and the gesture listeners of step 2 keep waiting, so nothing is
 *    heard and nothing is logged.
 *
 * Every time is on the audio clock; this file reads no other.
 */
import { onSoundChange, readSound } from "./settings";

/** The cues the site plays. A cue with no voice in `voices.ts` is silent. */
export type CueName =
  | "notch"
  | "key"
  | "send"
  | "stream"
  | "done"
  | "error"
  | "loading"
  | "gust"
  | "change";

/** A sound that runs until stopped. */
export type LoopName = "thinking";

export const CUE_EVENT = "worktree:cue";
export const LOOP_EVENT = "worktree:loop";
export const RUSTLE_EVENT = "worktree:rustle";

/** A leaf picture a stage can be, as the hero names them. */
export type FlightStage = "leaf" | "graph" | "word";

/**
 * What the leaves of one stage do, computed once when the stage starts (`hero/flight.ts`, plan #352 D10): the share of
 * leaves in flight and the side of the page they are on every `step` seconds, the seconds from the first take-off to the
 * last landing, and the places and times of a few landings. Every time is on the audio clock, from the stage's start.
 */
export interface FlightDetail {
  stage: FlightStage;
  curve: Float32Array;
  panCurve: Float32Array;
  step: number;
  duration: number;
  grains: { at: number; pan: number }[];
}

export interface CueDetail {
  name: CueName;
  /** The cue's place on its scale, absent means 0: in a run of like cues. */
  rank?: number;
  /** The leaves' flight, on `gust` and `change` only. */
  flight?: FlightDetail;
  /** Set by the engine when it plays the cue. */
  heard?: boolean;
}
export interface LoopDetail {
  name: LoopName;
  on: boolean;
}

/**
 * Play a cue now. Heard only when the engine is running; otherwise dropped. `rank` is its place on its scale, for a
 * voice that climbs. Returns whether it was heard: the engine plays it in the dispatch, so the answer is known on
 * return.
 */
export function cue(name: CueName, rank?: number): boolean {
  const detail: CueDetail = rank === undefined ? { name } : { name, rank };
  document.dispatchEvent(new CustomEvent<CueDetail>(CUE_EVENT, { detail }));
  return detail.heard === true;
}

/**
 * Play the sound of one stage of the leaves: `gust` for the opening, `change` for each later stage. Starts at the stage's
 * start on the audio clock and is silent when its last leaf lands. Heard only on the landing, with the engine running.
 */
export function cueFlight(name: "gust" | "change", flight: FlightDetail): void {
  document.dispatchEvent(
    new CustomEvent<CueDetail>(CUE_EVENT, { detail: { name, flight } }),
  );
}

/** What the pointer does to the leaves: `speed` 0 to 1 and `pan` -1 to 1. A speed of 0 lets the rustle go. */
export interface RustleDetail {
  speed: number;
  pan: number;
}

/** Feed the pointer's rustle. Dispatched every simulated frame while the pointer moves over the art box. */
export function rustle(speed: number, pan: number): void {
  document.dispatchEvent(
    new CustomEvent<RustleDetail>(RUSTLE_EVENT, { detail: { speed, pan } }),
  );
}

/** Start a loop. Returns the stop function. Dropped like a cue when the engine is not running. */
export function loop(name: LoopName): () => void {
  const send = (on: boolean) =>
    document.dispatchEvent(
      new CustomEvent<LoopDetail>(LOOP_EVENT, { detail: { name, on } }),
    );
  send(true);
  return () => send(false);
}

/** The slice of the engine module `cue.ts` talks to. */
interface Engine {
  attach(ctx: AudioContext): void;
  destroy(): void;
}

const GESTURES = ["pointerdown", "pointerup", "keydown", "touchend"] as const;

type AutoplayNavigator = Navigator & {
  getAutoplayPolicy?: (type: string) => string;
};

/** Whether the browser reported this arrival as one from our own pages. */
function arrivedFromSite(): boolean {
  const nav = (
    window as Window & {
      navigation?: { activation?: { from?: { url?: string } | null } };
    }
  ).navigation;
  const from = nav?.activation?.from?.url;
  if (!from) return false;
  try {
    return new URL(from).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * Arm the sound for this page. Returns the teardown (listeners, timers, the context and the engine), which tests use;
 * the page never calls it.
 */
export function startCue(): () => void {
  let ctx: AudioContext | null = null;
  let engine: Engine | null = null;
  let loading = false;
  let dead = false;
  let idle: number | undefined;
  let idleIsCallback = false;
  let armed = false;

  const attach = () => {
    if (ctx && engine) engine.attach(ctx);
  };

  const disarm = () => {
    if (!armed) return;
    armed = false;
    for (const type of GESTURES)
      window.removeEventListener(type, onGesture, true);
  };

  /** Create or resume the context. Synchronous: it must run inside the activation event. */
  const unlock = () => {
    if (dead) return;
    try {
      ctx ??= new AudioContext({ latencyHint: "interactive" });
      ctx.onstatechange = () => {
        if (ctx?.state === "running") disarm();
      };
      void ctx.resume().catch(() => {});
    } catch {
      return;
    }
    loadEngine();
    attach();
    if (ctx.state === "running") disarm();
  };

  function onGesture() {
    if (!readSound().muted) unlock();
  }

  const arm = () => {
    if (armed || dead) return;
    armed = true;
    for (const type of GESTURES) window.addEventListener(type, onGesture, true);
  };

  /** Load the engine off the first-paint path. Never before it is needed: muted loads nothing. */
  function loadEngine() {
    if (loading || dead) return;
    loading = true;
    void import("./engine").then((mod) => {
      if (dead) return;
      engine = mod.createEngine();
      attach();
    });
  }

  const onIdle = () => {
    idle = undefined;
    if (!readSound().muted) loadEngine();
  };
  if (typeof requestIdleCallback === "function") {
    idleIsCallback = true;
    idle = requestIdleCallback(onIdle);
  } else {
    idle = setTimeout(onIdle, 1) as unknown as number;
  }

  if (!readSound().muted) {
    arm();
    const policy = (navigator as AutoplayNavigator).getAutoplayPolicy?.(
      "audiocontext",
    );
    if (arrivedFromSite() && (policy === undefined || policy === "allowed"))
      unlock();
  }

  const unsubscribe = onSoundChange((settings, origin) => {
    if (settings.muted) return; // The engine ramps down and suspends the context.
    // A reader's own unmute is a gesture; another tab's is not.
    if (origin === "local") unlock();
    else arm();
  });

  return () => {
    dead = true;
    unsubscribe();
    disarm();
    if (idle !== undefined) {
      if (idleIsCallback) cancelIdleCallback(idle);
      else clearTimeout(idle);
    }
    engine?.destroy();
    engine = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    ctx = null;
  };
}
