/**
 * Wires the sound controls in the header's settings panel (`components/SettingsControl.astro`) to the reader's choice in
 * `dox:sound` (plan #352, D9). The panel itself (its button, open state and focus) is `lib/settings-control.ts`'s.
 *
 * - The mute button toggles mute and keeps the level. It makes no sound: no press does (the plan's constraints).
 * - The fader is a native `<input type="range">`; the stem drawn over it is CSS, from the `--level` property this sets
 *   on its wrapper. A change of its value writes the level, and moving it while muted unmutes at the new level. Each
 *   change plays one `notch`, at the new level: the level is written first, because the engine reads it when the cue
 *   is dispatched.
 * - Nothing is written, and nothing is played, on mount. A change here or in another tab repaints the control, and
 *   keeps `data-sound` on `<html>` true to the mute, which draws the speaker. A repaint plays nothing: only the
 *   fader's own `input` event does.
 *
 * Every listener is on one `AbortController`; the returned function is `destroy()`.
 *
 * - The aura (#352 phase 7, D6/D14): an "Aura" switch and, only while it is on, an "Aura track" radio pair, written to
 *   `worktree:aura` (never to `dox:sound`, whose `aura` and `track` are GMT's). A change here or in another tab repaints
 *   them. They make no sound. Where the page has no `data-aura` CSS hides them; the wiring is the same everywhere.
 *
 * Ported from GMT, apps/dox/src/lib/sound/control.ts at commit d6031ecd, without its press sounds (its toggle cue), its
 * Ice/Deep track select (the tracks and their markup are this site's) or its `gmt-range` widget.
 */
import { cue } from "./cue";
import {
  type AuraSettings,
  isAuraTrack,
  onAuraChange,
  onSoundChange,
  readAura,
  readSound,
  type SoundSettings,
  writeAura,
  writeSound,
} from "./settings";

/** The aura switch and track pair, wired on `signal`. Nothing is written on mount. */
function mountAuraControl(root: ParentNode, signal: AbortSignal): void {
  const toggle = root.querySelector<HTMLInputElement>("#settings-aura");
  const group = root.querySelector<HTMLElement>("[aria-label='Aura track']");
  const radios = [
    ...root.querySelectorAll<HTMLInputElement>("input[type=radio][value]"),
  ].filter((r) => isAuraTrack(r.value));
  if (!toggle || !group) return;

  const paint = (s: AuraSettings) => {
    toggle.checked = s.on;
    group.hidden = !s.on;
    for (const r of radios) r.checked = r.value === s.track;
  };
  paint(readAura());
  signal.addEventListener("abort", onAuraChange(paint), { once: true });

  toggle.addEventListener("change", () => writeAura({ on: toggle.checked }), {
    signal,
  });
  for (const r of radios)
    r.addEventListener(
      "change",
      () => {
        if (r.checked && isAuraTrack(r.value)) writeAura({ track: r.value });
      },
      { signal },
    );
}

export function mountSoundControl(root: ParentNode = document): () => void {
  const mute = root.querySelector<HTMLButtonElement>("#settings-sound-mute");
  const fader = root.querySelector<HTMLInputElement>("#settings-sound-volume");
  if (!mute || !fader) return () => {};

  const controller = new AbortController();
  const { signal } = controller;
  let muted = false;

  const paint = (s: SoundSettings) => {
    muted = s.muted;
    mute.setAttribute("aria-pressed", String(s.muted));
    document.documentElement.dataset.sound = s.muted ? "off" : "on";
    fader.value = String(s.level);
    fader.setAttribute(
      "aria-valuetext",
      `Volume ${s.level} of 11${s.muted ? ", muted" : ""}`,
    );
    fader.parentElement?.style.setProperty("--level", String(s.level));
  };
  paint(readSound());
  signal.addEventListener("abort", onSoundChange(paint), { once: true });

  mute.addEventListener(
    "click",
    () => {
      writeSound({ muted: !muted });
    },
    { signal },
  );

  fader.addEventListener(
    "input",
    () => {
      const wasMuted = muted;
      writeSound({ level: Number(fader.value), muted: false });
      if (!wasMuted) {
        cue("notch");
        return;
      }
      // Unmuting is what loads the engine, a moment later, so a cue now is dropped. Cue one task after it has loaded,
      // by which time `cue.ts` has attached it, whichever of the two imports settled first (GMT's rule for its toggle).
      void import("./engine").then(() => setTimeout(() => cue("notch"), 0));
    },
    { signal },
  );

  mountAuraControl(root, signal);

  return () => controller.abort();
}
