/**
 * Escape closes the layer the reader opened (plan #309 Phase 3; gmt's `use-esc-layer`, without gmt's site-wide Escape order:
 * this site has none, so the other Escape owners are told apart here, below). One document listener, registered once, reads the latest props through a ref.
 *
 * It leaves a press alone when the layer is not open, when something else already took it (`defaultPrevented`, an IME
 * candidate, a modifier), while a native `popover` is open, and while a `<dialog open>` is (Starlight's search): each closes
 * itself on that same press, and one Escape must shut one layer.
 */
import { useEffect, useRef } from "react";

export interface UseEscLayer {
  /** Whether the layer is open now. A function is read on each press, for a state the stylesheet can hide. */
  open: boolean | (() => boolean);
  /** Shuts the layer (sets its state to closed). */
  close: () => void;
  /** The control that opened it: focus goes there once the layer has shut, so it never falls to the page. */
  opener?: () => HTMLElement | null;
}

function popoverIsOpen(): boolean {
  try {
    return document.querySelector(":popover-open") !== null;
  } catch {
    // A browser that does not know the selector has no native popover to defer to.
    return false;
  }
}

function dialogIsOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

export function useEscLayer(layer: UseEscLayer): void {
  const latest = useRef(layer);
  useEffect(() => {
    latest.current = layer;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (event.isComposing) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const { open, close, opener } = latest.current;
      if (!(typeof open === "function" ? open() : open)) return;
      if (popoverIsOpen() || dialogIsOpen()) return;
      event.preventDefault();
      close();
      opener?.()?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
