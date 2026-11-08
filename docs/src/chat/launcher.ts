import { CHAT_SHORTCUT, matchesShortcut } from "./shortcut";

/** What the lazily imported chat entry (`components/Chat.tsx`) exposes. */
export interface ChatModule {
  mountChat: (options: { open: boolean }) => void;
}

/** A page control that opens the chat, wherever it sits: the landing's "Ask Dox" (Hero.astro). */
export const CHAT_OPENER_SELECTOR = "[data-chat-open]";

/** Asks the mounted chat to open its drawer. `ChatDrawer` listens for it on `window`. */
export const OPEN_CHAT_EVENT = "docs-chat:open";

const LOAD_ERROR =
  "The chat could not be loaded. Check your connection and try again.";

/**
 * Wires the static launcher: the first activation, by click or by the chat shortcut, imports the chat,
 * mounts it already open and hands the page over to the chat's own trigger and shortcut. A failed load
 * is announced in the status region and leaves the button usable for another try.
 *
 * An opener (`CHAT_OPENER_SELECTOR`) does what the launcher does until the chat has mounted, and from then on asks the
 * mounted chat to open (`OPEN_CHAT_EVENT`), since it has no trigger of its own to hand over to.
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
  let mounted = false;

  async function activate() {
    if (busy || !button || !status) return;
    busy = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "";
    try {
      const { mountChat } = await load();
      mountChat({ open: true });
      mounted = true;
      // The chat now has its own trigger (and shortcut); keeping this one would leave two.
      handOver();
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

  // Delegated, so an opener anywhere on the page counts, and a click on its icon too.
  function onOpenerClick(e: MouseEvent) {
    if (!(e.target instanceof Element)) return;
    if (!e.target.closest(CHAT_OPENER_SELECTOR)) return;
    if (mounted) window.dispatchEvent(new Event(OPEN_CHAT_EVENT));
    else void activate();
  }

  function handOver() {
    button?.removeEventListener("click", onClick);
    window.removeEventListener("keydown", onKeyDown);
  }

  button.addEventListener("click", onClick);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("click", onOpenerClick);
  return () => {
    handOver();
    document.removeEventListener("click", onOpenerClick);
  };
}
