/**
 * Wires the header's settings control (`components/SettingsControl.astro`; plan #352, D1-D4).
 *
 * - The gear button opens the popover (`popovertarget`, the browser's). Its `aria-expanded` follows the popover's
 *   `toggle` event, and opening moves focus to the first control, the "Dark theme" switch; Escape and the return of
 *   focus to the gear are the browser's.
 * - The switch is `theme.ts`'s (`mountThemeSwitch`). It makes no sound.
 * - The mute button and the volume fader are `sound/control.ts`'s (`mountSoundControl`; D9).
 *
 * Every listener is on one `AbortController`; the returned function is `destroy()`.
 *
 * Ported from GMT, apps/dox/src/lib/settings-control.ts at commit d6031ecd; the sound control is this site's own `sound/control.ts`, mounted here.
 */
import { mountSoundControl } from "./sound/control";
import { mountThemeSwitch } from "./theme";

export function mountSettingsControl(root: ParentNode = document): () => void {
  const pop = root.querySelector<HTMLElement>("#settings-pop");
  const theme = root.querySelector<HTMLInputElement>("#settings-theme-dark");
  if (!pop || !theme) return () => {};
  const trigger = root.querySelector<HTMLButtonElement>(
    "[popovertarget='settings-pop']",
  );

  const controller = new AbortController();
  const { signal } = controller;
  mountThemeSwitch(theme, signal);
  signal.addEventListener("abort", mountSoundControl(root), { once: true });

  pop.addEventListener(
    "toggle",
    (event) => {
      const open = (event as ToggleEvent).newState === "open";
      trigger?.setAttribute("aria-expanded", String(open));
      // A popover does not take focus by itself: the first control is where a keyboard reader goes next.
      if (open) theme.focus();
    },
    { signal },
  );

  return () => controller.abort();
}
