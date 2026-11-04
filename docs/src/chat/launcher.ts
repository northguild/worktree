import { CHAT_SHORTCUT, matchesShortcut } from "./shortcut";

/** What the lazily imported chat entry (`components/Chat.tsx`) exposes. */
export interface ChatModule {
  mountChat: (options: { open: boolean }) => void;
}

const LOAD_ERROR =
  "The chat could not be loaded. Check your connection and try again.";

/**
 * Wires the static launcher: the first activation, by click or by the chat shortcut, imports the chat,
 * mounts it already open and hands the page over to the chat's own trigger and shortcut. A failed load
 * is announced in the status region and leaves the button usable for another try.
 *
 * Imports nothing heavy at the top level on purpose: this module runs on every page.
 * Returns a function that removes the listeners.
 */
export function initChatLauncher(
  root: HTMLElement,
  load: () => Promise<ChatModule>,
): () => void {
  const button = root.querySelector<HTMLButtonElement>("[data-chat-launcher]");
  const status = root.querySelector<HTMLElement>("[data-chat-launcher-status]");
  if (!button || !status) return () => {};

  let busy = false;

  async function activate() {
    if (busy || !button || !status) return;
    busy = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      const { mountChat } = await load();
      mountChat({ open: true });
      // The chat now has its own trigger (and shortcut); keeping this one would leave two.
      dispose();
      root.hidden = true;
    } catch (error) {
      console.error("Chat failed to load", error);
      status.textContent = LOAD_ERROR;
    } finally {
      busy = false;
      button.removeAttribute("aria-busy");
    }
  }

  function onClick() {
    void activate();
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!matchesShortcut(e, CHAT_SHORTCUT)) return;
    e.preventDefault();
    void activate();
  }

  function dispose() {
    button?.removeEventListener("click", onClick);
    window.removeEventListener("keydown", onKeyDown);
  }

  button.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);
  return dispose;
}
