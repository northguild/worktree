import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { useIdleTimeout } from "./useIdleTimeout";

// Expected values: plan #257 §4.4 and D16 -- "30 s between chunks and 120 s overall", the numbers the retired
// client used (useStreamChat.ts: STREAM_IDLE_TIMEOUT_MS = 30_000, REQUEST_TIMEOUT_MS = 120_000). Activity is the
// `signal` changing (the answer growing); the clock for either limit only runs while `active`.

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

interface Props {
  active: boolean;
  signal: number;
}

function setup(initial: Props) {
  const onTimeout = vi.fn();
  const hook = renderHook(
    (props: Props) => useIdleTimeout({ ...props, onTimeout }),
    { initialProps: initial },
  );
  return { onTimeout, ...hook };
}

describe("useIdleTimeout", () => {
  it("does nothing while the chat is idle", () => {
    const { onTimeout } = setup({ active: false, signal: 0 });

    act(() => vi.advanceTimersByTime(300_000));

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("fires after 30 s with no activity, and not a moment before", () => {
    const { onTimeout } = setup({ active: true, signal: 0 });

    act(() => vi.advanceTimersByTime(29_999));
    expect(onTimeout).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("restarts the 30 s whenever the signal changes", () => {
    const { onTimeout, rerender } = setup({ active: true, signal: 0 });

    act(() => vi.advanceTimersByTime(20_000));
    rerender({ active: true, signal: 1 });
    act(() => vi.advanceTimersByTime(29_999));
    expect(onTimeout).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("fires at 120 s overall however steady the activity", () => {
    const { onTimeout, rerender } = setup({ active: true, signal: 0 });

    // A change every 20 s keeps the idle limit from ever firing.
    for (let i = 1; i <= 5; i++) {
      act(() => vi.advanceTimersByTime(20_000));
      rerender({ active: true, signal: i });
    }
    expect(onTimeout).not.toHaveBeenCalled(); // 100 s

    act(() => vi.advanceTimersByTime(19_999));
    expect(onTimeout).not.toHaveBeenCalled(); // 119.999 s

    act(() => vi.advanceTimersByTime(1));
    expect(onTimeout).toHaveBeenCalledTimes(1); // 120 s
  });

  it("stops both clocks when the answer ends", () => {
    const { onTimeout, rerender } = setup({ active: true, signal: 0 });

    act(() => vi.advanceTimersByTime(10_000));
    rerender({ active: false, signal: 1 });
    act(() => vi.advanceTimersByTime(300_000));

    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("starts both clocks afresh for the next answer", () => {
    const { onTimeout, rerender } = setup({ active: true, signal: 0 });
    act(() => vi.advanceTimersByTime(25_000));
    rerender({ active: false, signal: 1 });
    rerender({ active: true, signal: 1 });

    act(() => vi.advanceTimersByTime(29_999));
    expect(onTimeout).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });
});
