import { describe, expect, it } from "vitest";
import { ART_ASPECT, DESIGN, FIT, shapeScale } from "./geometry";
import { buildTargets, LeafKind } from "./targets";

// Expected values: D18. "They cross behind the copy in flight and never land or rest on it", and "the leaf, the graph
// and the wordmark keep the art box's place and size". So no target (leaf or graph; a target is where a particle lands
// and rests) lies inside the copy box, and every one lies inside the art box. The boxes are the built landing's
// `.copy` and `[data-hero-art]` rectangles, measured in a browser on 2026-11-04 at each viewport: [left, top, width, height].
// The wordmark's targets are sampled from a 2D canvas the size of the art box (so inside it by construction); that
// needs a real canvas and is checked in the browser pass.
const LAYOUTS = [
  {
    name: "1280 wide",
    viewport: [1280, 820],
    copy: [100, 231, 529, 351],
    art: [677, 113, 503, 587],
  },
  {
    name: "390 wide",
    viewport: [390, 844],
    copy: [16, 96, 358, 285],
    art: [16, 413, 358, 418],
  },
  {
    name: "820 wide",
    viewport: [820, 1180],
    copy: [16, 156, 379, 335],
    art: [443, 113, 361, 421],
  },
] as const;

/** A small seeded random source, so a failure is reproducible. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function particles(count: number, shapeCount: number, random: () => number) {
  const isShape = new Uint8Array(count);
  const joinsLeaf = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    if (i < shapeCount) isShape[i] = 1;
    else if (random() < 0.85) joinsLeaf[i] = 1;
  }
  return { isShape, joinsLeaf };
}

describe.each(LAYOUTS)("targets at $name", ({ copy, art }) => {
  const [al, at, aw, ah] = art;
  const [cl, ct, cw, ch] = copy;
  const centre = [al + aw / 2, at + ah / 2];
  const random = seeded(235);
  const count = 3000;
  const { isShape, joinsLeaf } = particles(count, 2000, random);
  const t = buildTargets({
    count,
    isShape,
    joinsLeaf,
    scale: shapeScale(aw, ah),
    random,
  });
  const onPage = (x: number, y: number): [number, number] => [
    centre[0] + x,
    centre[1] - y,
  ]; // targets are y up
  const inside = ([x, y]: [number, number], [l, tp, w, h]: readonly number[]) =>
    x >= l && x <= l + w && y >= tp && y <= tp + h;

  it("starts from a layout where the art box and the copy do not overlap", () => {
    const overlap =
      al < cl + cw && cl < al + aw && at < ct + ch && ct < at + ah;
    expect(overlap).toBe(false);
  });

  it("puts no leaf or graph target inside the copy box", () => {
    let hits = 0;
    for (let i = 0; i < count; i++) {
      if (isShape[i]) {
        if (inside(onPage(t.graphX[i], t.graphY[i]), copy)) hits++;
      }
      if (
        t.leafKind[i] !== LeafKind.None &&
        inside(onPage(t.leafX[i], t.leafY[i]), copy)
      )
        hits++;
    }
    expect(hits).toBe(0);
  });

  it("keeps every leaf and graph target inside the art box", () => {
    let outside = 0;
    for (let i = 0; i < count; i++) {
      if (isShape[i] && !inside(onPage(t.graphX[i], t.graphY[i]), art))
        outside++;
      if (
        t.leafKind[i] !== LeafKind.None &&
        !inside(onPage(t.leafX[i], t.leafY[i]), art)
      )
        outside++;
    }
    expect(outside).toBe(0);
  });
});

describe("the art box", () => {
  it("is 6:7 and the shapes fill 86% of it, as the prototype's round 2 had them", () => {
    // 380x470 design units, fitted to the smaller axis: 6:7 is the box the SVG tree reserved, and 0.86 is the share the
    // approved prototype used. An arithmetic check by hand: a 600x700 box gives min(600/380, 700/470) * 0.86 = 1.2808.
    expect(ART_ASPECT).toBeCloseTo(6 / 7, 10);
    expect(FIT).toBe(0.86);
    expect(DESIGN).toEqual({ width: 380, height: 470 });
    expect(shapeScale(600, 700)).toBeCloseTo(
      Math.min(600 / 380, 700 / 470) * 0.86,
      10,
    );
    expect(shapeScale(600, 700)).toBeCloseTo(1.2808, 3);
  });
});
