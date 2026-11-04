import { useEffect, useEffectEvent } from "react";
import { matchesShortcut, type Shortcut } from "../shortcut";

interface UseGlobalKeyDownProps extends Shortcut {
  callback: () => void;
}

export function useGlobalKeyDown({
  callback,
  ...shortcut
}: UseGlobalKeyDownProps) {
  // useEffectEvent captures the latest shortcut/callback on every
  // render without requiring them as useEffect deps. The listener is only
  // attached once (no unnecessary remove/re-add on every render).
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (matchesShortcut(e, shortcut)) {
      e.preventDefault();
      callback();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []); // stable — onKey always reads latest values via useEffectEvent
}
