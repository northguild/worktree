/**
 * The one sound module on every page's critical path: `cue(name)` fires a sound, and `startCue` arms the unlock.
 *
 * Ported from gmt apps/dox/src/lib/sound/cue.ts at d6031ecd, cut down (plan #352, D7): the sidebar's arrival cue and
 * every cue of a press are gone, and the event is `worktree:cue`, not GMT's.
 *
 * Nothing here makes a sound. `cue` dispatches `worktree:cue` on the document; the engine (./engine.ts) listens once it
 * has loaded and a gesture has unlocked the audio context, and until then the event is unheard, which drops the cue.
 * Nothing queues, with one exception: `cueFlight` remembers its latest stage (`latestFlight`), which the engine joins
 * from its offset when it is ready. The engine is only ever reached through `import()` here, never a static import,
 * so the first paint carries this file and the settings and none of the audio code.
 *
 * Unlock, in order of a page's life:
 * 1. Muted: no context and no engine. Unmuting is itself a gesture, so it unlocks.
 * 2. Not muted: capture-phase listeners for `pointerdown`, `pointerup`, `keydown` and `touchend`. Each one creates or
 *    resumes the context synchronously; Safari does not count a resume after an `await`. The listeners stay until the
 *    context is running: a page reached without a link (a refresh, back or forward, a typed address) makes no context
 *    at load, and the first press or key makes and resumes it; one a browser keeps suspended (Safari) is resumed by
 *    the first press. When it runs, the engine is told, and starts the aura and joins the opening's stage if still in
 *    flight.
 * 3. After an in-site arrival, unlock at load unless the browser says autoplay is not allowed. Chrome has no
 *    `getAutoplayPolicy` but lets a document reached by a same-origin navigation after a gesture start audio; a link
 *    from any page of this origin is one, but a reload or back/forward is not, and waits for step 2; where it
 *    refuses (Safari) the context stays suspended and the gesture listeners of step 2 keep waiting, so nothing is
 *    heard and nothing is logged.
 *
 * Every schedule is on the audio clock. The one other clock this file reads is `performance.now()`, in `cueFlight`:
 * it stamps its stage with it because no audio clock exists yet when the opening is cued, so the engine can work out
 * how far into the stage it is and join it from its offset.
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
 * What the leaves of one stage do, computed once when the stage starts (`hero/flight.ts`, plan #352 D10): the seconds
 * from the stage's start to the last landing, and the places and times of a few landings. Every time is on the audio
 * clock, from the stage's start.
 */
export interface FlightDetail {
  stage: FlightStage;
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

/** The latest stage of the leaves and when it started, on `performance.now()` (the page's clock, in ms). */
export interface RememberedFlight {
  name: "gust" | "change";
  flight: FlightDetail;
  at: number;
}

let latest: RememberedFlight | undefined;

/**
 * The latest stage cued, heard or not, for an engine that attaches after it started (the opening is cued before the
 * engine exists). A newer cue replaces it, so a superseded stage is forgotten. Nothing here makes a sound.
 */
export function latestFlight(): RememberedFlight | undefined {
  return latest;
}

/** Forget the remembered stage. */
export function forgetFlight(): void {
  latest = undefined;
}

/**
 * Play the sound of one stage of the leaves: `gust` for the opening, `change` for each later stage. Starts at the stage's
 * start on the audio clock and is silent when its last leaf lands. Heard only on the landing, with the engine running; a stage that starts before the engine has loaded is remembered
 * (`latestFlight`) and joined from its offset.
 */
export function cueFlight(name: "gust" | "change", flight: FlightDetail): void {
  latest = { name, flight, at: performance.now() };
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

const wanted = new Set<LoopName>();

/**
 * The loops a caller has asked for and not stopped. A loop asked for before the engine exists, or while the context is
 * not running, is not lost: the engine reads this when it attaches and when the context runs. Nothing here makes a sound.
 */
export function wantedLoops(): ReadonlySet<LoopName> {
  return wanted;
}

/** Forget every wanted loop (the engine's end). */
export function forgetLoops(): void {
  wanted.clear();
}

/**
 * Start a loop. Returns the stop function. Heard only while the engine runs, but remembered (`wantedLoops`) until the
 * caller stops it, so it starts when the engine and a running context are there.
 */
export function loop(name: LoopName): () => void {
  const send = (on: boolean) =>
    document.dispatchEvent(
      new CustomEvent<LoopDetail>(LOOP_EVENT, { detail: { name, on } }),
    );
  wanted.add(name);
  send(true);
  return () => {
    wanted.delete(name);
    send(false);
  };
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

/**
 * Whether this document was reached by a link click, from the Navigation API's `activation`: a "push" or "replace" from
 * a page of this origin (northguild.dev's root, a GMT docs page, another worktree page, or this page itself, as the logo
 * links). A click is a gesture, so Chrome lets that arrival's context run. A "reload" or a "traverse" (back, forward)
 * is no gesture on the page, and a context made then logs "The AudioContext was not allowed to start"; the first press
 * starts everything. A browser with no `navigation.activation` (Safari, Firefox) or no `navigationType` gets no unlock
 * at load.
 */
function arrivedByLink(): boolean {
  const activation = (
    window as Window & {
      navigation?: {
        activation?: {
          from?: { url?: string } | null;
          navigationType?: string;
        };
      };
    }
  ).navigation?.activation;
  const type = activation?.navigationType;
  const from = activation?.from?.url;
  if (!from || (type !== "push" && type !== "replace")) return false;
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
      // The engine waits for a running context (the aura, the opening's stage): tell it when this one runs, whether the
      // press that resumed it or the browser's late grant did it.
      ctx.onstatechange = () => {
        if (ctx?.state !== "running") return;
        disarm();
        attach();
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
    void import("./engine")
      .then((mod) => {
        if (dead) return;
        engine = mod.createEngine();
        attach();
      })
      .catch(() => {
        // The chunk did not load (a network error): wait for the next press, which tries again (the listeners left once the
        // context ran), and stay silent meanwhile.
        loading = false;
        if (!readSound().muted) arm();
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
    if (arrivedByLink() && (policy === undefined || policy === "allowed"))
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
