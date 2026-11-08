/**
 * The handle on the examples rail's left edge (plan #309 Phase 3, §4.1 row 26; ported from gmt's `RailResizer`). Drag it, or
 * focus it and use the arrow keys, to make the rail wider; double-click it to reset the width.
 *
 * The width lives in one CSS custom property on the container the parent passes (`--gmt-hive-rail-width`), set on the
 * element and not through React, so a render never undoes it. The reader's last width is remembered in this browser only.
 *
 * Desktop only: below 60rem the rail is a bottom sheet and the handle is hidden (`dox-hive.css`).
 */
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  clampRailWidth,
  type RailBounds,
  railBounds,
  railWidthForKey,
} from "./rail-width";

export const WIDTH_PROPERTY = "--gmt-hive-rail-width";
export const STORAGE_KEY = "northguild-dox-rail-width";

function readStoredWidth(): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function storeWidth(width: number | undefined): void {
  try {
    if (width === undefined) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(Math.round(width)));
  } catch {
    // Storage blocked: the width still applies for this visit.
  }
}

/**
 * What the server markup says before the browser has measured anything: the rail's default (22rem) at its narrowest, up to
 * a plausible half page. A splitter must carry its value from the first render; the measured one replaces this as soon as
 * the page mounts.
 */
const SERVER_VALUE = { min: 352, now: 352, max: 704 };

interface Measured {
  width: number;
  bounds: RailBounds;
  bodyWidth: number;
}

interface RailResizerProps {
  /** The rail's id. */
  railId: string;
  /** The element that holds the chat and the rail: it carries the width property and the dragging flag. */
  container: RefObject<HTMLElement | null>;
}

export function RailResizer({ railId, container }: RailResizerProps) {
  const [measured, setMeasured] = useState<Measured | null>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);
  const frame = useRef(0);
  /** The width the last pointer move asked for, until its frame is drawn. */
  const pending = useRef<number | undefined>(undefined);

  const elements = useCallback(() => {
    const body = container.current;
    const rail = document.getElementById(railId);
    return body && rail ? { body, rail } : null;
  }, [railId, container]);

  const measure = useCallback((): Measured | null => {
    const found = elements();
    if (!found) return null;
    const bodyWidth = found.body.getBoundingClientRect().width;
    const rem =
      Number.parseFloat(getComputedStyle(document.documentElement).fontSize) ||
      16;
    return {
      width: found.rail.getBoundingClientRect().width,
      bounds: railBounds({ viewportWidth: window.innerWidth, bodyWidth, rem }),
      bodyWidth,
    };
  }, [elements]);

  /** Sets the width, clamped, or clears it back to the default. */
  const apply = useCallback(
    (width: number | undefined) => {
      const found = elements();
      if (!found) return;
      const current = measure();
      if (width === undefined || !current) {
        found.body.style.removeProperty(WIDTH_PROPERTY);
      } else {
        const clamped = clampRailWidth(width, current.bounds);
        found.body.style.setProperty(WIDTH_PROPERTY, `${clamped}px`);
      }
      setMeasured(measure());
    },
    [elements, measure],
  );

  // After mount only: the server knows neither the window nor the reader's stored width. Measured again on resize so the
  // handle's value stays true.
  useEffect(() => {
    apply(readStoredWidth());
    const onResize = () => setMeasured(measure());
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame.current);
    };
  }, [apply, measure]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const current = measure();
    if (!current) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: current.width };
    elements()?.body.setAttribute("data-resizing", "");
    event.currentTarget.setAttribute("data-resizing", "");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    // The rail is on the right: moving the pointer left widens it.
    const width = start.startWidth + (start.startX - event.clientX);
    pending.current = width;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      pending.current = undefined;
      apply(width);
    });
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    elements()?.body.removeAttribute("data-resizing");
    event.currentTarget.removeAttribute("data-resizing");
    // A move whose frame has not run yet would otherwise be lost, and the width stored below would be one frame old.
    cancelAnimationFrame(frame.current);
    if (pending.current !== undefined) {
      apply(pending.current);
      pending.current = undefined;
    }
    const width = measure()?.width;
    if (width !== undefined) storeWidth(width);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = measure();
    if (!current) return;
    const width = railWidthForKey(
      event.key,
      event.shiftKey,
      current.width,
      current.bounds,
    );
    if (width === undefined) return;
    event.preventDefault();
    apply(width);
    storeWidth(width);
  };

  const onDoubleClick = () => {
    apply(undefined);
    storeWidth(undefined);
  };

  // A focusable separator is the ARIA Authoring Practices window splitter, an interactive widget: `<hr>` is
  // non-interactive and cannot take focus or key handlers.
  return (
    // biome-ignore lint/a11y/useSemanticElements: the window splitter is the separator role, focusable; <hr> cannot be
    <div
      className="gmt-hive-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-controls={railId}
      aria-label="Resize the examples panel"
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      aria-valuemin={Math.round(measured?.bounds.min ?? SERVER_VALUE.min)}
      aria-valuemax={Math.round(measured?.bounds.max ?? SERVER_VALUE.max)}
      aria-valuenow={Math.round(measured?.width ?? SERVER_VALUE.now)}
      {...(measured && {
        "aria-valuetext": `${Math.round((measured.width / measured.bodyWidth) * 100) || 0}% of the page`,
      })}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onDoubleClick={onDoubleClick}
    />
  );
}
