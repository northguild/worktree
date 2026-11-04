/**
 * The chat's keyboard shortcut, shared by the static launcher and the loaded chat. No React here: the launcher ships on every page.
 *
 * Alt+Shift+C (Option+Shift+C on macOS). Ctrl/Cmd+K stays with Starlight's search. No other shortcut was
 * found for it in the vendors' own lists: Chrome (support.google.com/chrome/answer/157179), Edge
 * (support.microsoft.com, "Keyboard shortcuts in Microsoft Edge"), Firefox (support.mozilla.org,
 * "Keyboard shortcuts - Perform common Firefox tasks quickly", and the DevTools shortcut list) and Safari
 * (support.apple.com/guide/safari, "Keyboard and other shortcuts"), on Windows, Linux and macOS. The nearest
 * Alt+Shift combinations they use are Alt+Shift+A, B, I, N and T, and Alt+Shift+Enter. Starlight itself
 * binds only "/" and Ctrl/Cmd+K.
 *
 * It is matched on the physical key (`code`): Option+Shift+C types "Ç" on macOS, so `key` is not "c" there.
 */
export interface Shortcut {
  /** `KeyboardEvent.code`, e.g. "KeyC". */
  code: string;
  /** Ctrl or Meta (Cmd) must be held; when false, neither may be. */
  ctrlOrMeta: boolean;
  alt: boolean;
  shift: boolean;
}

export const CHAT_SHORTCUT: Shortcut = {
  code: "KeyC",
  ctrlOrMeta: false,
  alt: true,
  shift: true,
};

/** An exact match: a combination that adds or drops a modifier is a different shortcut. */
export function matchesShortcut(
  e: KeyboardEvent,
  { code, ctrlOrMeta, alt, shift }: Shortcut,
): boolean {
  return (
    e.code === code &&
    (e.ctrlKey || e.metaKey) === ctrlOrMeta &&
    e.altKey === alt &&
    e.shiftKey === shift
  );
}
