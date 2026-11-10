import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import {
  MARK_INNER,
  MARK_OUTER,
  MARK_SHEEN,
  MARK_SPOKES,
  MARK_VIEWBOX,
} from "../../../lib/dox-mark";
import { HiveGlyph } from "./HiveGlyph";
import { HiveHub } from "./HiveHub";
import { HiveNode } from "./HiveNode";
import { useCrystalSpin } from "./use-crystal-spin";

// Expected values: the crystal is "ported unchanged" (plan #309 D5), so its geometry is gmt's `src/lib/dox-mark.ts`
// at d479dca8, written out below from that file, not read back from the module under test: a flat-top hexagon in a
// 100 x 87 box (87 is 100 x 0.866, a regular hexagon), an inner table, a top facet and six spokes. The motion values
// are gmt's `use-crystal-spin.ts`: a 2600 ms clockwise turn while working, a 900 ms ease-out landing from the angle
// reached to 360, a 1100 ms entrance only where asked; none of it under reduced motion (§4.1 rows 5 and 10).

describe("dox-mark geometry", () => {
  it("is gmt's crystal, unchanged", () => {
    expect(MARK_VIEWBOX).toBe("0 0 100 87");
    expect(MARK_OUTER).toBe("25,0 75,0 100,43.5 75,87 25,87 0,43.5");
    expect(MARK_INNER).toBe("37,21.8 63,21.8 76,43.5 63,65.2 37,65.2 24,43.5");
    expect(MARK_SHEEN).toBe("25,0 75,0 63,21.8 37,21.8");
    expect(MARK_SPOKES).toEqual([
      [25, 0, 37, 21.8],
      [75, 0, 63, 21.8],
      [100, 43.5, 76, 43.5],
      [75, 87, 63, 65.2],
      [25, 87, 37, 65.2],
      [0, 43.5, 24, 43.5],
    ]);
  });
});

describe("HiveGlyph", () => {
  it("draws the crystal hidden from assistive technology, in currentColor", () => {
    const { container } = render(<HiveGlyph idSuffix="a" />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveAttribute("viewBox", "0 0 100 87");
    expect(container.querySelectorAll("polygon")).toHaveLength(4);
    expect(container.querySelectorAll("line")).toHaveLength(6);
    expect(
      container.querySelector(
        "polygon[points='25,0 75,0 100,43.5 75,87 25,87 0,43.5']",
      ),
    ).not.toBeNull();
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });

  it("gives each mark its own gradient ids, so a second mark never reuses the first's stops", () => {
    const { container } = render(
      <>
        <HiveGlyph idSuffix="one" />
        <HiveGlyph idSuffix="two" />
      </>,
    );
    const ids = [...container.querySelectorAll("linearGradient")].map(
      (g) => g.id,
    );
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
  });
});

describe("HiveNode", () => {
  it.each([
    ["assistant", "Dox"],
    ["user", "You"],
  ] as const)("labels the %s turn %s", (speaker, label) => {
    render(<HiveNode speaker={speaker} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("marks the stage pending only while waiting", () => {
    const { container, rerender } = render(
      <HiveNode speaker="assistant" pending />,
    );
    expect(container.querySelector("[data-pending]")).not.toBeNull();
    rerender(<HiveNode speaker="assistant" />);
    expect(container.querySelector("[data-pending]")).toBeNull();
  });
});

describe("HiveHub", () => {
  it("is the same crystal as the transcript's, with no role label", () => {
    const { container } = render(<HiveHub />);
    expect(container.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.queryByText("Dox")).toBeNull();
  });
});

describe("useCrystalSpin", () => {
  const animate = vi.fn();
  let reducedMotion = false;

  function Probe({ spinning, enter }: { spinning: boolean; enter?: boolean }) {
    const ref = useCrystalSpin(spinning, enter);
    return <div ref={ref} data-testid="crystal" />;
  }

  beforeEach(() => {
    animate.mockReset();
    animate.mockImplementation(() => ({ currentTime: 650, cancel: vi.fn() }));
    reducedMotion = false;
    Object.defineProperty(HTMLElement.prototype, "animate", {
      configurable: true,
      writable: true,
      value: animate,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: reducedMotion && query.includes("reduce"),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as { animate?: unknown }).animate;
  });

  it("turns a full circle every 2600 ms, for as long as Dox works", () => {
    render(<Probe spinning />);
    const [frames, options] = animate.mock.calls[0];
    expect(frames).toEqual([
      { transform: "rotateX(10deg) rotateZ(0deg)" },
      { transform: "rotateX(10deg) rotateZ(360deg)" },
    ]);
    expect(options).toMatchObject({
      duration: 2600,
      iterations: Number.POSITIVE_INFINITY,
      easing: "linear",
    });
  });

  it("lands from the angle it reached: 650 ms of 2600 is a quarter turn, 90 degrees", () => {
    const { rerender } = render(<Probe spinning />);
    animate.mockClear();
    rerender(<Probe spinning={false} />);
    const [frames, options] = animate.mock.calls[0];
    expect(frames).toEqual([
      { transform: "rotateX(10deg) rotateZ(90deg)" },
      { transform: "rotateX(10deg) rotateZ(360deg)" },
    ]);
    expect(options).toMatchObject({ duration: 900 });
  });

  it("plays one entrance turn on first mount when asked", () => {
    render(<Probe spinning={false} />);
    const [frames, options] = animate.mock.calls[0];
    expect(frames[0]).toMatchObject({ opacity: 0, scale: "0.6" });
    expect(frames[1]).toMatchObject({ opacity: 1, scale: "1" });
    expect(options).toMatchObject({ duration: 1100 });
  });

  it("does not spin in a logo that is not working (the hub passes enter false)", () => {
    render(<Probe spinning={false} enter={false} />);
    expect(animate).not.toHaveBeenCalled();
  });

  it("sits at rest under reduced motion", () => {
    reducedMotion = true;
    render(<Probe spinning />);
    expect(animate).not.toHaveBeenCalled();
  });
});
