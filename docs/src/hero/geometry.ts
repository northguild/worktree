/**
 * The hero's shapes, in design units: a 380×470 box with y down, like a 2D canvas. Ported from the approved
 * prototype (`particles.js`, round 3, 552b23f); the numbers are the prototype's.
 *
 * Everything here is pure, so the particles sample it and the still SVG (`HeroLeaves.astro`) draws it: one geometry,
 * two renderings (D18).
 */

export type Point = readonly [number, number];

/** A point on a path and the unit normal there: x, y, nx, ny. */
export type PathSample = readonly [number, number, number, number];

export interface Path {
  readonly length: number;
  readonly points: readonly Point[];
  at(t: number): PathSample;
}

export const DESIGN = { width: 380, height: 470 } as const;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** A polyline with arc-length parameterisation: `at(t)` gives a point and its unit normal. */
export function makePath(points: readonly Point[]): Path {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    cum.push(cum[i - 1] + Math.hypot(x1 - x0, y1 - y0));
  }
  const length = cum[cum.length - 1];
  return {
    length,
    points,
    at(t) {
      const target = clamp01(t) * length;
      let i = 1;
      while (i < cum.length - 1 && cum[i] < target) i++;
      const seg = cum[i] - cum[i - 1] || 1;
      const k = (target - cum[i - 1]) / seg;
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const dx = (x1 - x0) / seg;
      const dy = (y1 - y0) / seg;
      return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k, -dy, dx];
    },
  };
}

function cubic(p0: Point, p1: Point, p2: Point, p3: Point, n = 24): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    const at = (a: 0 | 1) =>
      u ** 3 * p0[a] +
      3 * u * u * t * p1[a] +
      3 * u * t * t * p2[a] +
      t ** 3 * p3[a];
    return [at(0), at(1)] as const;
  });
}

function quad(p0: Point, p1: Point, p2: Point, n = 20): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    const at = (a: 0 | 1) => u * u * p0[a] + 2 * u * t * p1[a] + t * t * p2[a];
    return [at(0), at(1)] as const;
  });
}

function elbow(x0: number, y0: number, x1: number, y1: number): Point[] {
  const m = (y0 + y1) / 2;
  return cubic([x0, y0], [x0, m], [x1, m], [x1, y1]);
}

function line(x0: number, y0: number, x1: number, y1: number): Point[] {
  return [
    [x0, y0],
    [x1, y1],
  ];
}

function join(...parts: Point[][]): Point[] {
  return parts.reduce<Point[]>(
    (all, p) => all.concat(all.length ? p.slice(1) : p),
    [],
  );
}

/** Lanes: main, then three branch lanes. */
export const L = [-112, -37, 38, 113] as const;

// The graph: main, a long branch to HEAD (feat), a short one off it (fix), and one that merges back (chore).
// Each line is a strand a leaf vein becomes; the order of BRANCHES is the order of the leaf's right-hand veins.
export const TRUNK = makePath(line(L[0], 190, L[0], -215));
export const BRANCHES: readonly Path[] = [
  makePath(join(elbow(L[0], 150, L[2], 88), line(L[2], 88, L[2], 40))), // feat, low
  makePath(join(elbow(L[0], 80, L[1], 28), line(L[1], 28, L[1], -8))), // chore, out
  makePath(elbow(L[0], -60, L[1], -8)), // chore, the merge (drawn from main outwards, as a vein grows)
  makePath(join(elbow(L[2], 40, L[3], -22), line(L[3], -22, L[3], -95))), // fix
  makePath(line(L[2], 40, L[2], -150)), // feat, high, up to HEAD
];
export const LINE_WIDTH = 7;

// Commits. Main has five, not seven, so it reads as a line with commits on it rather than a dotted one.
export const RINGS: readonly Point[] = [
  [L[0], 190],
  [L[0], 150],
  [L[0], 80],
  [L[0], -60],
  [L[0], -198],
  [L[1], 10],
  [L[2], 40],
  [L[2], -48],
  [L[3], -95],
];
export const RING = { inner: 8.75, outer: 14.25 } as const;
export const HEAD = {
  at: [L[2], -150] as Point,
  disc: 10,
  inner: 17,
  outer: 21,
} as const;

/** A line runs right up to a commit's outer edge, so the trunk is continuous rather than broken at every commit. */
export function insideCommit(x: number, y: number): boolean {
  return (
    RINGS.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < RING.outer ** 2) ||
    (x - HEAD.at[0]) ** 2 + (y - HEAD.at[1]) ** 2 < HEAD.outer ** 2
  );
}

// The leaf: ovate, pointed, a little asymmetric, tilted right, its stem ending on main's first commit.
export const LEAF = {
  stem: [L[0], 190] as Point,
  base: [L[0] + 16, 146] as Point,
  angle: (21 * Math.PI) / 180,
  length: 405,
  width: 124,
  bend: 9,
} as const;
const leafAxis = [Math.sin(LEAF.angle), -Math.cos(LEAF.angle)] as const;
const leafNormal = [Math.cos(LEAF.angle), Math.sin(LEAF.angle)] as const; // points to the leaf's right-hand side

export function halfWidth(u: number, side: number): number {
  return (
    LEAF.width *
    Math.sin(Math.PI * clamp01(u) ** 0.62) ** 0.85 *
    (side > 0 ? 1.06 : 0.93)
  );
}

/** A point of the leaf: `u` along the axis (0 base .. 1 tip), `v` across it. */
export function leafPoint(u: number, v: number): Point {
  const off = v + LEAF.bend * Math.sin(Math.PI * u);
  return [
    LEAF.base[0] + leafAxis[0] * u * LEAF.length + leafNormal[0] * off,
    LEAF.base[1] + leafAxis[1] * u * LEAF.length + leafNormal[1] * off,
  ];
}

export const STEM = makePath(quad(LEAF.stem, [L[0] + 2, 166], LEAF.base));
export const MIDRIB_END = 0.97;

// Lateral veins: arcs from the midrib out towards the margin, curving forward. Right and left alternate slightly.
const VEIN_U = [0.15, 0.29, 0.43, 0.57, 0.71];
function vein(u: number, side: number): Path {
  const uc = u + 0.035;
  const ue = Math.min(0.93, u + 0.2);
  return makePath(
    quad(
      leafPoint(u, 0),
      leafPoint(uc, side * 0.5 * halfWidth(uc, side)),
      leafPoint(ue, side * 0.86 * halfWidth(ue, side)),
    ),
  );
}
export const RIGHT_VEINS: readonly Path[] = VEIN_U.map((u) => vein(u, 1));
export const LEFT_VEINS: readonly Path[] = VEIN_U.map((u) =>
  vein(u + 0.045, -1),
);

/** The shapes fill this share of the art box (the prototype's, round 2). */
export const FIT = 0.86;
/** The art box's width over its height (6:7, as the SVG tree had). */
export const ART_ASPECT = 6 / 7;

/** The design box's scale into an art box of `width` × `height` CSS px. */
export function shapeScale(width: number, height: number): number {
  return Math.min(width / DESIGN.width, height / DESIGN.height) * FIT;
}
