import { useEffect, useRef } from "react";
import {
  REQUEST_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_MS,
} from "../lib/chat-constants";

interface UseIdleTimeoutOptions {
  /** True while an answer is being fetched. Both clocks run only then. */
  active: boolean;
  /** Any value that changes whenever the answer makes progress. */
  signal: unknown;
  onTimeout: () => void;
  idleMs?: number;
  totalMs?: number;
}

/**
 * Calls `onTimeout` when an answer goes silent for `idleMs`, or runs for
 * `totalMs` however steadily it arrives (plan #257 D16). Both are timers on an
 * external clock, which is what an effect is for; the callback is read through
 * a ref so a new function each render does not restart them.
 */
export function useIdleTimeout({
  active,
  signal,
  onTimeout,
  idleMs = STREAM_IDLE_TIMEOUT_MS,
  totalMs = REQUEST_TIMEOUT_MS,
}: UseIdleTimeoutOptions): void {
  const onTimeoutRef = useRef(onTimeout);
  onTimeoutRef.current = onTimeout;

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => onTimeoutRef.current(), totalMs);
    return () => clearTimeout(timer);
  }, [active, totalMs]);

  // `signal` is a dependency on purpose: each change restarts the idle clock.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => onTimeoutRef.current(), idleMs);
    return () => clearTimeout(timer);
  }, [active, signal, idleMs]);
}
