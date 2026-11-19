/**
 * The audio engine: owns the master gain and plays the voices. Loaded by `cue.ts` on idle or on the first gesture,
 * never on the first-paint path.
 *
 * Ported from gmt apps/dox/src/lib/sound/engine.ts at d6031ecd, cut down (plan #352, D7): no press hooks, no native
 * panel, code-copy or typing watcher. Phase 6 adds the leaves: on the landing only (the art box, `[data-hero-art]`), the engine imports `leaves.ts`, a chunk of its own, and
 * plays the hero's `gust` and `change` cues (which carry the leaves' flight; both in the change's voice, and a stage already in flight when the chunk arrives is joined from its offset) and the pointer's rustle with it.
 * Phase 7 adds the aura (D14), as GMT's engine does: where `<html>` has `data-aura` (the landing), while the reader is
 * unmuted and has switched the aura on (`worktree:aura`, D6), the engine imports `aura.ts`, a chunk of its own, and keeps
 * it playing the stored track; it stops on a mute, a switch off, a hidden tab and `pagehide`.
 *
 * It is handed an `AudioContext` that a gesture or an in-site arrival has created and resumed (`attach`), and only
 * then listens for `worktree:cue`: a cue before that is unheard, which drops it (except a leaves' stage,
 * which `joinLate` takes up). A cue while the context is suspended is dropped too, unless a gesture is starting it (`live`). Every schedule, gap and fade is on `ctx.currentTime`.
 */

import type { Aura } from "./aura";
import {
  CUE_EVENT,
  type CueDetail,
  type CueName,
  forgetFlight,
  LOOP_EVENT,
  type LoopDetail,
  type LoopName,
  latestFlight,
  type RememberedFlight,
  RUSTLE_EVENT,
  type RustleDetail,
} from "./cue";
import { ceiling, setMaster } from "./kit";
import type { Rustle } from "./leaves";
import {
  type AuraSettings,
  onAuraChange,
  onSoundChange,
  readAura,
  readSound,
  type SoundSettings,
} from "./settings";
import { LOOPS, VOICES } from "./voices";

/**
 * How long a hidden tab keeps sounding before its context sleeps, in ms: what is sounding
 * rings out first (a voice's tail in its space). A tab hidden at once by a link that opens a new tab is heard to the
 * end; a tail cut short would play its rest on the way back.
 */
export const HIDE_TAIL_MS = 1200;

/** The aura fades in over 2 s and a change of track crossfades over 1.5 s (D14); it fades out over 0.6 s, as GMT's. */
const AURA_FADE_IN = 2;
const AURA_CROSSFADE = 1.5;
const AURA_OUT_FADE = 0.6;

const MAX_GAIN = 0.6;
const MUTE_RAMP = 0.05;
/**
 * Seconds ahead of "now" a cue starts, so its attack is not clipped. A cue that reads the clock
 * less than this after the one before starts with it: the clock moves in audio blocks of about
 * 2.7 ms, so two cues of one press (a key's blip and the send it makes) can read it either side of
 * a block. Their shared start is still ahead of the clock.
 */
const LEAD = 0.005;
const DEFAULT_GAP = 0.03;
/** The shortest gap between two steps of a run: an answer's chunks. */
const STEP_GAP = 0.06;
/** Cues that repeat faster than the default gap allows keep their own. */
const GAPS: Partial<Record<CueName, number>> = {
  stream: STEP_GAP,
  key: 0.025,
};

/** The one element only the landing has: the hero's art box. Where it is absent, nothing of the leaves loads. */
const LANDING = "[data-hero-art]";

export interface Engine {
  attach(ctx: AudioContext): void;
  destroy(): void;
}

type ActivationNavigator = Navigator & {
  userActivation?: { isActive: boolean };
};

/**
 * Whether a sound may be scheduled now. On a running context, yes. A suspended context's clock
 * is stopped (an arrival the browser did not let start, a hidden tab), and everything scheduled on
 * it would play at once when it starts: the landing's paints and glints on the reader's first
 * press, or a background answer's cues on their return. So a suspended context takes a sound only
 * inside a reader's gesture, which is starting it: WebKit runs a context a moment after the press
 * that resumed it, and that press's own cue belongs to it. A browser with no `userActivation`
 * cannot tell a press from the rest, so it drops them all until the context runs: a lost first
 * click is better than a burst of late ones.
 */
function live(c: AudioContext): boolean {
  if (c.state === "running") return true;
  if (c.state !== "suspended") return false;
  return (navigator as ActivationNavigator).userActivation?.isActive ?? false;
}

const levelGain = (s: SoundSettings): number =>
  s.muted ? 0 : (s.level / 11) * MAX_GAIN;

export function createEngine(): Engine {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let settings = readSound();
  let auraChoice: AuraSettings = readAura();
  let aura: Aura | null = null;
  let auraLoading = false;
  let dead = false;
  let hidden = false;
  let suspendTimer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const lastPlayed = new Map<CueName, number>();
  /** The clock reading the latest cues start from, shared by every cue less than LEAD after it. */
  let together = -Infinity;
  const loops = new Map<LoopName, () => void>();
  let stopWaiting: (() => void) | undefined;
  /** The landing's voices, once their chunk has arrived; a cue before then is not played live, but `joinLate` takes it up. */
  let leaves: typeof import("./leaves") | undefined;
  let leavesLoading = false;
  /** The pointer's rustle: one voice for a whole drag. */
  let rustleVoice: Rustle | undefined;

  /** The remembered stage this engine has already played, live or joined late: a stage is heard once. */
  let heardStage: RememberedFlight | undefined;

  /**
   * A stage that started before the leaves' chunk had loaded (the opening always does) is joined from its offset, if
   * its leaves are still in flight, and not at all once the last has landed. Only on a context a gesture started.
   */
  const joinLate = () => {
    const stage = latestFlight();
    if (!stage || stage === heardStage) return;
    if (!ctx || !master || !leaves || settings.muted || !live(ctx)) return;
    heardStage = stage;
    const rest = leaves.fromOffset(
      stage.flight,
      (performance.now() - stage.at) / 1000,
    );
    if (rest) leaves.change(ctx, master, ctx.currentTime + LEAD, rest);
  };

  const loadLeaves = () => {
    if (leaves || leavesLoading || !document.querySelector(LANDING)) return;
    leavesLoading = true;
    void import("./leaves")
      .then((mod) => {
        leaves = mod;
        joinLate();
      })
      .catch(() => {
        // A chunk that will not load leaves the landing as silent as before this phase.
        leavesLoading = false;
      });
  };

  const letRustleGo = () => {
    rustleVoice?.stop();
    rustleVoice = undefined;
  };

  const fade = (to: number, over: number) => {
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(master.gain.value, now);
    master.gain.linearRampToValueAtTime(to, now + over);
  };

  /** The landing sets `data-aura` on `<html>`; no other page does. */
  const wantsAura = () =>
    !!ctx &&
    !hidden &&
    !settings.muted &&
    auraChoice.on &&
    document.documentElement.hasAttribute("data-aura");

  const stopAura = (over: number) => {
    aura?.stop(over);
    aura = null;
  };

  /**
   * Start or stop the aura to match what the page and the reader ask for. A mute stops it at once: the master is
   * already fading and the context sleeps a moment later, so a longer fade would finish on the way back.
   */
  const syncAura = () => {
    if (!wantsAura()) return stopAura(settings.muted ? 0 : AURA_OUT_FADE);
    if (aura || auraLoading) return;
    auraLoading = true;
    void import("./aura").then(
      (mod) => {
        auraLoading = false;
        if (dead || !ctx || !master || aura || !wantsAura()) return;
        aura = mod.startAura(ctx, master, AURA_FADE_IN, auraChoice.track);
      },
      () => {
        // A chunk that will not load leaves the landing without its aura, as before this phase.
        auraLoading = false;
      },
    );
  };

  const applyAura = (next: AuraSettings) => {
    const was = auraChoice;
    auraChoice = next;
    if (next.on !== was.on) syncAura();
    if (next.track !== was.track) aura?.switchTo(next.track, AURA_CROSSFADE);
  };

  const stopLoops = () => {
    for (const stop of loops.values()) stop();
    loops.clear();
    letRustleGo();
  };

  const apply = (next: SoundSettings) => {
    const was = settings;
    settings = next;
    if (!ctx || !master) return;
    clearTimeout(suspendTimer);
    suspendTimer = undefined;
    if (next.muted) {
      stopLoops();
      fade(0, MUTE_RAMP);
      suspendTimer = setTimeout(
        () => {
          suspendTimer = undefined;
          if (ctx && settings.muted) void ctx.suspend().catch(() => {});
        },
        MUTE_RAMP * 1000 + 10,
      );
    } else if (was.muted) {
      if (!hidden) void ctx.resume().catch(() => {});
      fade(levelGain(next), MUTE_RAMP);
    } else {
      master.gain.setTargetAtTime(levelGain(next), ctx.currentTime, 0.015);
    }
    if (next.muted !== was.muted) syncAura();
  };

  const onCue = (event: Event) => {
    if (!ctx || !master || settings.muted) return;
    const detail = (event as CustomEvent<CueDetail>).detail;
    const name = detail?.name;
    const flight = detail.flight;
    // The leaves' cues carry their flight and are played by the landing's chunk, not by `voices.ts`.
    const voice =
      flight && (name === "gust" || name === "change")
        ? undefined
        : VOICES[name];
    if (!voice && !flight) return;
    if (flight) {
      loadLeaves();
      if (!leaves) return;
    }
    if (!live(ctx)) return;
    const now = ctx.currentTime;
    const last = lastPlayed.get(name);
    if (last !== undefined && now - last < (GAPS[name] ?? DEFAULT_GAP)) return;
    lastPlayed.set(name, now);
    if (!(now - together < LEAD)) together = now;
    const at = together + LEAD;
    if (flight && leaves) {
      (name === "gust" ? leaves.gust : leaves.change)(ctx, master, at, flight);
      heardStage = latestFlight();
    } else if (voice) {
      voice(ctx, master, at, detail.rank ?? 0);
    }
    detail.heard = true;
  };

  /** The pointer: a speed above 0 follows it with one rustle; 0 lets the rustle go. */
  const onRustle = (event: Event) => {
    if (!ctx || !master || settings.muted) return;
    const { speed, pan } = (event as CustomEvent<RustleDetail>).detail;
    if (!(speed > 0)) {
      letRustleGo();
      return;
    }
    loadLeaves();
    if (!leaves || !live(ctx)) return;
    rustleVoice ??= leaves.startRustle(ctx, master);
    rustleVoice.set(speed, pan);
  };

  const onLoop = (event: Event) => {
    if (!ctx || !master || settings.muted) return;
    const { name, on } = (event as CustomEvent<LoopDetail>).detail;
    if (on) {
      const start = LOOPS[name];
      if (start && !loops.has(name) && live(ctx))
        loops.set(name, start(ctx, master));
    } else {
      loops.get(name)?.();
      loops.delete(name);
    }
  };

  const onVisibility = () => {
    if (!ctx) return;
    hidden = document.visibilityState === "hidden";
    clearTimeout(hideTimer);
    hideTimer = undefined;
    if (hidden) {
      stopAura(AURA_OUT_FADE);
      // What is sounding finishes first: the aura's fade.
      hideTimer = setTimeout(() => {
        hideTimer = undefined;
        if (ctx && hidden) void ctx.suspend().catch(() => {});
      }, HIDE_TAIL_MS);
    } else if (!settings.muted) {
      void ctx
        .resume()
        .catch(() => {})
        .then(syncAura);
    }
  };

  /** The back/forward cache froze the page: the aura goes, the context sleeps. */
  const onPageHide = () => {
    stopAura(0);
    if (ctx) void ctx.suspend().catch(() => {});
  };

  /** Restored from the cache: resume at once if the browser lets it, else on the next gesture. */
  const onPageShow = (event: PageTransitionEvent) => {
    if (!event.persisted || !ctx || settings.muted) return;
    const c = ctx;
    const revive = () => {
      void c
        .resume()
        .catch(() => {})
        .then(() => {
          if (c.state === "running") syncAura();
        });
    };
    revive();
    if (c.state === "running") return;
    stopWaiting?.();
    const drop = () => {
      window.removeEventListener("pointerdown", again, true);
      window.removeEventListener("keydown", again, true);
      stopWaiting = undefined;
    };
    const again = () => {
      drop();
      revive();
    };
    window.addEventListener("pointerdown", again, true);
    window.addEventListener("keydown", again, true);
    stopWaiting = drop;
  };

  const unsubscribe = onSoundChange(apply);
  const unsubscribeAura = onAuraChange(applyAura);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  return {
    attach(next) {
      if (ctx === next) return;
      ctx = next;
      settings = readSound();
      auraChoice = readAura();
      master = next.createGain();
      master.gain.value = levelGain(settings);
      // Nothing reaches the speakers over the ceiling, whatever a voice does.
      master.connect(ceiling(next)).connect(next.destination);
      setMaster(next, master);
      // Honour the phone's silent switch where the browser lets a page say so.
      const session = (
        navigator as Navigator & { audioSession?: { type: string } }
      ).audioSession;
      if (session) session.type = "ambient";
      document.addEventListener(CUE_EVENT, onCue);
      document.addEventListener(LOOP_EVENT, onLoop);
      document.addEventListener(RUSTLE_EVENT, onRustle);
      loadLeaves();
      joinLate();
      syncAura();
    },
    destroy() {
      unsubscribe();
      unsubscribeAura();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      stopWaiting?.();
      dead = true;
      stopAura(0);
      document.removeEventListener(CUE_EVENT, onCue);
      document.removeEventListener(LOOP_EVENT, onLoop);
      document.removeEventListener(RUSTLE_EVENT, onRustle);
      clearTimeout(suspendTimer);
      clearTimeout(hideTimer);
      stopLoops();
      forgetFlight();
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
      ctx = null;
      master = null;
    },
  };
}
