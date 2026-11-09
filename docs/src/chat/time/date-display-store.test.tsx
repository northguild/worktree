import { act, renderHook } from "@testing-library/react";
import {
  type DateDisplayStorage,
  DEFAULT_DATE_DISPLAY,
  getDateDisplay,
  hydrateDateDisplay,
  resetDateDisplay,
  setDateFormat,
  setDateZone,
  useDateDisplay,
} from "./date-display-store";

// Expected values: plan #309 D13 (gmt's store: the calendar format in the reader's own zone by default, picks remembered
// across loads, set once the page is mounted and never during render) and §4.1 row 21. The storage keys are gmt's own
// (`dox:date-format`, `dox:date-zone`), so the two Dox pages on northguild.dev remember one pick.

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: DateDisplayStorage & { data: Map<string, string> } = {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
  return storage;
}

beforeEach(() => resetDateDisplay());

describe("the date display store", () => {
  it("starts on the calendar format in the reader's own zone", () => {
    expect(getDateDisplay()).toEqual({ formatId: "calendar", zone: null });
    expect(DEFAULT_DATE_DISPLAY.formatId).toBe("calendar");
  });

  it("applies the reader's stored picks on hydration", () => {
    hydrateDateDisplay(
      memoryStorage({
        "dox:date-format": "iso-zoned",
        "dox:date-zone": "Asia/Tokyo",
      }),
    );
    expect(getDateDisplay()).toEqual({
      formatId: "iso-zoned",
      zone: "Asia/Tokyo",
    });
  });

  it("ignores a stored format this build does not know", () => {
    hydrateDateDisplay(memoryStorage({ "dox:date-format": "relative-medium" }));
    expect(getDateDisplay().formatId).toBe("calendar");
  });

  it("saves changes once hydrated, and forgets a zone set back to the reader's own", () => {
    const storage = memoryStorage();
    hydrateDateDisplay(storage);

    setDateFormat("http");
    setDateZone("Europe/London");
    expect(storage.data.get("dox:date-format")).toBe("http");
    expect(storage.data.get("dox:date-zone")).toBe("Europe/London");

    setDateZone(null);
    expect(storage.data.has("dox:date-zone")).toBe(false);
  });

  it("hydrates once, so a second consumer mounting cannot reset the picks", () => {
    hydrateDateDisplay(memoryStorage({ "dox:date-format": "utc" }));
    setDateFormat("unix-s");
    hydrateDateDisplay(memoryStorage({ "dox:date-format": "http" }));
    expect(getDateDisplay().formatId).toBe("unix-s");
  });

  it("falls back to the defaults when storage throws, and a pick still holds for the session", () => {
    const broken: DateDisplayStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    hydrateDateDisplay(broken);
    expect(getDateDisplay()).toEqual(DEFAULT_DATE_DISPLAY);
    expect(() => setDateFormat("http")).not.toThrow();
    expect(getDateDisplay().formatId).toBe("http");
  });

  it("does not touch storage before hydration: a pick made earlier is not saved", () => {
    const storage = memoryStorage();
    setDateFormat("http");
    hydrateDateDisplay(storage);
    // Hydration replaces the state with what is stored, and nothing was.
    expect(getDateDisplay().formatId).toBe("calendar");
    expect(storage.data.size).toBe(2 - 2);
  });
});

describe("useDateDisplay", () => {
  it("re-renders a consumer when a pick changes", () => {
    const { result } = renderHook(() => useDateDisplay((s) => s.formatId));
    expect(result.current).toBe("calendar");
    act(() => setDateFormat("unix-ms"));
    expect(result.current).toBe("unix-ms");
  });

  it("reads the defaults for the server's render, whatever the store holds", async () => {
    // `renderToString` is the server's pass: it uses the hook's server snapshot, which is never a stored pick.
    const { renderToString } = await import("react-dom/server");
    setDateFormat("http");
    function Probe() {
      return <span>{useDateDisplay((s) => s.formatId)}</span>;
    }
    expect(renderToString(<Probe />)).toContain("calendar");
  });
});
