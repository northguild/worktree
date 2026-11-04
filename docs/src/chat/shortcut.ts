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
 * It is matched on the physical key (`code`): Option+Shift+C types "Ç" on macOS, so `key` is not "c" there. For the
 * same reason it stands down while focus is in a text field (`isTextEntry`), so typing is never swallowed.
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

/**
 * The chat shortcut as `aria-keyshortcuts` writes it (WAI-ARIA 1.2): modifiers first, then the key, joined by "+";
 * "Alt" is the Option key on Apple keyboards. Both launcher buttons carry it; keep it in step with `CHAT_SHORTCUT`.
 */
export const CHAT_SHORTCUT_ARIA = "Alt+Shift+C";

/** `<input>` types that take no typed characters (HTML Standard, input type states); every other type, or none, is a text-like field. */
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Whether characters typed with focus on `target` would be entered into it: a text-like `<input>`, a `<textarea>`,
 * a `<select>` (type-ahead) or an editing host (`contenteditable`, inherited, the nearest value wins).
 */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLInputElement)
    return !NON_TEXT_INPUT_TYPES.has(target.type);
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  const host = target.closest("[contenteditable]");
  return host !== null && host.getAttribute("contenteditable") !== "false";
}

/**
 * An exact match: a combination that adds or drops a modifier is a different shortcut. Never a match while focus is
 * in a text field, where the combination may be a character being typed.
 */
export function matchesShortcut(
  e: KeyboardEvent,
  { code, ctrlOrMeta, alt, shift }: Shortcut,
): boolean {
  return (
    !isTextEntry(e.target) &&
    e.code === code &&
    (e.ctrlKey || e.metaKey) === ctrlOrMeta &&
    e.altKey === alt &&
    e.shiftKey === shift
  );
}
