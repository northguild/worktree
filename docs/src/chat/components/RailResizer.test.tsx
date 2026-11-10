import { fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, vi } from "vitest";
import { RailResizer, STORAGE_KEY, WIDTH_PROPERTY } from "./RailResizer";
import { KEY_BIG_STEP_PX, KEY_STEP_PX } from "./rail-width";

// Expected values: plan #309 Phase 3 ("clamps, takes arrow keys, resets on double-click and remembers the width") and the
// arithmetic of `rail-width.test.ts`. jsdom lays nothing out, so the body is stubbed 1440px wide and the rail as wide as the
// width property says (489.6px, the narrowest, when it has none), at a 1440px window: bounds 489.6..720.

const MIN = 489.6;
const MAX = 720;

let storage: Map<string, string>;

function Harness() {
  const body = useRef<HTMLDivElement>(null);
  return (
    <div ref={body} data-testid="body">
      <RailResizer railId="rail" container={body} />
      <aside id="rail">rail</aside>
    </div>
  );
}

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.stubGlobal("innerWidth", 1440);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      let width = 0;
      if (this.getAttribute("data-testid") === "body") width = 1440;
      if (this.id === "rail") {
        const set = this.parentElement?.style.getPropertyValue(WIDTH_PROPERTY);
        width = set ? Number.parseFloat(set) : MIN;
      }
      return { width } as DOMRect;
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const handle = () => screen.getByRole("separator");
const widthSet = () =>
  screen.getByTestId("body").style.getPropertyValue(WIDTH_PROPERTY);

describe("RailResizer", () => {
  it("is a vertical separator for the rail, with the bounds and the width as its value", () => {
    render(<Harness />);
    expect(handle()).toHaveAttribute("aria-orientation", "vertical");
    expect(handle()).toHaveAttribute("aria-controls", "rail");
    expect(handle()).toHaveAttribute("aria-valuemin", String(Math.round(MIN)));
    expect(handle()).toHaveAttribute("aria-valuemax", String(MAX));
    expect(handle()).toHaveAttribute("aria-valuenow", String(Math.round(MIN)));
    expect(handle()).toHaveAttribute("tabindex", "0");
  });

  it("widens by one step on ArrowLeft and by the big step with Shift", () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(Number.parseFloat(widthSet())).toBeCloseTo(MIN + KEY_STEP_PX, 5);
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true });
    expect(Number.parseFloat(widthSet())).toBeCloseTo(
      MIN + KEY_STEP_PX + KEY_BIG_STEP_PX,
      5,
    );
  });

  it("will not narrow below the narrowest or widen past the widest", () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: "ArrowRight" });
    expect(Number.parseFloat(widthSet())).toBeCloseTo(MIN, 5);
    fireEvent.keyDown(handle(), { key: "End" });
    expect(Number.parseFloat(widthSet())).toBe(MAX);
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true });
    expect(Number.parseFloat(widthSet())).toBe(MAX);
    expect(handle()).toHaveAttribute("aria-valuenow", String(MAX));
  });

  it("remembers the width it was given, rounded, for the next visit", () => {
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: "ArrowLeft", shiftKey: true });
    // 489.6 + 64 = 553.6, stored as 554.
    expect(storage.get(STORAGE_KEY)).toBe("554");
  });

  it("applies the remembered width on mount, clamped", () => {
    storage.set(STORAGE_KEY, "600");
    render(<Harness />);
    expect(widthSet()).toBe("600px");
    expect(handle()).toHaveAttribute("aria-valuenow", "600");
  });

  it("clamps a remembered width that no longer fits", () => {
    storage.set(STORAGE_KEY, "5000");
    render(<Harness />);
    expect(Number.parseFloat(widthSet())).toBe(MAX);
  });

  it("goes back to the default and forgets the width on a double-click", () => {
    storage.set(STORAGE_KEY, "600");
    render(<Harness />);
    fireEvent.doubleClick(handle());
    expect(widthSet()).toBe("");
    expect(storage.has(STORAGE_KEY)).toBe(false);
  });

  describe("with the pointer", () => {
    // jsdom has no PointerEvent (testing-library's `fireEvent.pointerDown` then sends a bare Event, with no `button` or
    // `clientX`) and no pointer capture. A MouseEvent named for the pointer event carries both, and React reads them off it;
    // the handle only needs the three capture calls to exist.
    const pointer = (type: string, clientX: number) =>
      fireEvent(
        handle(),
        new MouseEvent(type, { bubbles: true, button: 0, clientX }),
      );
    beforeEach(() => {
      Object.assign(Element.prototype, {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => false),
      });
    });
    afterEach(() => {
      for (const name of [
        "setPointerCapture",
        "releasePointerCapture",
        "hasPointerCapture",
      ])
        Reflect.deleteProperty(Element.prototype, name);
    });

    it("remembers the width a drag ends at", () => {
      render(<Harness />);
      pointer("pointerdown", 1000);
      pointer("pointermove", 900);
      pointer("pointerup", 900);
      // 100px left of where it started: 489.6 + 100 = 589.6, stored as 590.
      expect(Number.parseFloat(widthSet())).toBeCloseTo(MIN + 100, 5);
      expect(storage.get(STORAGE_KEY)).toBe("590");
    });

    it("follows a drag back to where it began, and remembers that width", () => {
      render(<Harness />);
      pointer("pointerdown", 1000);
      pointer("pointermove", 900);
      pointer("pointermove", 1000);
      pointer("pointerup", 1000);
      // Back at the start: the narrowest, 489.6, stored as 490 (not the 590 of the move before).
      expect(Number.parseFloat(widthSet())).toBeCloseTo(MIN, 5);
      expect(storage.get(STORAGE_KEY)).toBe("490");
    });

    it("stores nothing for a click that never moved, so the rail keeps following the default", () => {
      render(<Harness />);
      pointer("pointerdown", 1000);
      pointer("pointermove", 1000);
      pointer("pointerup", 1000);
      expect(storage.has(STORAGE_KEY)).toBe(false);
      expect(widthSet()).toBe("");
    });
  });

  it("still works when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    render(<Harness />);
    fireEvent.keyDown(handle(), { key: "ArrowLeft" });
    expect(Number.parseFloat(widthSet())).toBeCloseTo(MIN + KEY_STEP_PX, 5);
  });
});
