/**
 * The Data blip for typing: one capture-phase `keydown` listener on the document that plays `key`
 * whenever the reader types into the one field it is given (the Dox composer; gmt's was any text field). Ported from gmt apps/dox/src/lib/sound/typing.ts at d6031ecd (plan #352,
 * D13), with two changes: the one field, and no blip on Enter.
 *
 * - A text field is a `<textarea>`, a contenteditable element, or an `<input>` of a text-entry
 *   type (`TYPED`). A read-only field takes no typing, so it is silent.
 * - A password field is silent: a sound per key tells anyone in earshot how long the password is.
 * - Printable keys and Backspace count. Enter never does (D13: the composer's Enter sends, and that has its own cue;
 *   gmt also blips an Enter that types a line in a `<textarea>`, which this site leaves out).
 * - A held key (`repeat`), an input method mid-composition (`isComposing`, so CJK stays quiet) and
 *   a Ctrl or Meta chord are silent.
 *
 * The Dox chat starts this while it is mounted and calls the returned function on unmount.
 */
import { cue } from "./cue";

/** The `<input>` types a reader types text into. `password` is left out on purpose (above). */
const TYPED = new Set(["text", "search", "email", "url", "tel", "number"]);

/** Whether the field takes typed text. */
function isTextField(target: EventTarget | undefined): boolean {
  if (target instanceof HTMLInputElement)
    return TYPED.has(target.type) && !target.readOnly;
  if (target instanceof HTMLTextAreaElement) return !target.readOnly;
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Listens for typing in `field` only: gmt's listener was site-wide, this site's is the Dox composer's alone (D13). */
export function watchTyping(field: HTMLElement): () => void {
  const controller = new AbortController();
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey)
        return;
      // The field itself, even inside a shadow root (the document sees its host).
      const target = event.composedPath()[0];
      if (target !== field || !isTextField(target)) return;
      if (event.key.length === 1 || event.key === "Backspace") cue("key");
    },
    { capture: true, signal: controller.signal },
  );
  return () => controller.abort();
}
