/**
 * Where each particle goes in the leaf and in the graph, paired particle by particle (round 2's `buildTargets`,
 * ported unchanged apart from taking its random source as a parameter):
 *  - main's leaves sit on the stem and midrib at the same fraction of the way up;
 *  - each branch's leaves sit on one right-hand vein, at the same fraction of the way out;
 *  - the commits' leaves sit on the left-hand veins and the blade, paired bottom to top;
 *  - most ambient leaves fill the rest of the blade, and drift off again when the leaf becomes the graph.
 *
 * Targets are CSS px relative to the art box's centre, y up.
 */

import {
  BRANCHES,
  HEAD,
  halfWidth,
  insideCommit,
  LEAF,
  LEFT_VEINS,
  LINE_WIDTH,
  leafPoint,
  MIDRIB_END,
  type Path,
  RIGHT_VEINS,
  RING,
  RINGS,
  STEM,
  TRUNK,
} from "./geometry";

const TAU = Math.PI * 2;

/** What a particle is in the leaf: not in it (ambient), a midrib or vein, the blade, or the blade's margin. */
export const LeafKind = { None: 0, Vein: 1, Blade: 2, Margin: 3 } as const;

export interface TargetInput {
  count: number;
  /** 1 for the particles that form the graph and the wordmark. */
  isShape: Uint8Array;
  /** 1 for the ambient particles that join the big leaf's blade. */
  joinsLeaf: Uint8Array;
  /** Design units to CSS px. */
  scale: number;
  random: () => number;
}

export interface Targets {
  graphX: Float32Array;
  graphY: Float32Array;
  leafX: Float32Array;
  leafY: Float32Array;
  leafKind: Uint8Array;
}

type Sample = [number, number];
type Source = { p: [number, number, boolean?]; kind: number };

function jitter(
  path: Path,
  t: number,
  width: number,
  random: () => number,
): Sample {
  const [x, y, nx, ny] = path.at(t);
  const o = (random() - 0.5) * width;
  return [x + nx * o, y + ny * o];
}

/** n points along a graph strand, sorted by t, none inside a commit. */
function strandPoints(path: Path, n: number, random: () => number) {
  const out: { t: number; x: number; y: number }[] = [];
  while (out.length < n) {
    const t = random();
    const [x, y] = jitter(path, t, LINE_WIDTH, random);
    if (!insideCommit(x, y)) out.push({ t, x, y });
  }
  return out.sort((a, b) => a.t - b.t);
}

function ringPoints(n: number, random: () => number) {
  const ringArea = Math.PI * (RING.outer ** 2 - RING.inner ** 2);
  const headDisc = Math.PI * HEAD.disc ** 2;
  const headRing = Math.PI * (HEAD.outer ** 2 - HEAD.inner ** 2);
  const total = ringArea * RINGS.length + headDisc + headRing;
  const out: { x: number; y: number }[] = [];
  const annulus = (
    [x0, y0]: readonly [number, number],
    ri: number,
    ro: number,
  ) => {
    const r = Math.sqrt(random() * (ro * ro - ri * ri) + ri * ri);
    const a = random() * TAU;
    out.push({ x: x0 + Math.cos(a) * r, y: y0 + Math.sin(a) * r });
  };
  for (let k = 0; k < n; k++) {
    const pick = random() * total;
    const ring = Math.floor(pick / ringArea);
    if (ring < RINGS.length) annulus(RINGS[ring], RING.inner, RING.outer);
    else if (pick - ringArea * RINGS.length < headDisc)
      annulus(HEAD.at, 0, HEAD.disc);
    else annulus(HEAD.at, HEAD.inner, HEAD.outer);
  }
  return out;
}

const stemShare = STEM.length / (STEM.length + LEAF.length * MIDRIB_END);

/** The midrib, with the stem below it: one strand for main, parameterised from the stem's foot to the tip. */
function midribPoint(t: number, random: () => number): Sample {
  if (t < stemShare) return jitter(STEM, t / stemShare, 6, random);
  const u = ((t - stemShare) / (1 - stemShare)) * MIDRIB_END;
  const band = 7.5 * (1 - 0.6 * u);
  return [...leafPoint(u, (random() - 0.5) * band)] as Sample;
}

function veinPoint(path: Path, t: number, random: () => number): Sample {
  return jitter(path, t, 5 * (1 - 0.55 * t), random);
}

/** A point of the blade: [x, y, onMargin]. The margin is a little denser, so the silhouette is crisp. */
function bladePoint(random: () => number): [number, number, boolean] {
  if (random() < 0.2) {
    const u = 0.03 + random() * 0.94;
    const side = random() < 0.5 ? -1 : 1;
    const [x, y] = leafPoint(
      u,
      side * halfWidth(u, side) * (0.9 + 0.1 * random()),
    );
    return [x, y, true];
  }
  for (;;) {
    const u = random();
    const v = (random() * 2 - 1) * LEAF.width * 1.06;
    if (Math.abs(v) < halfWidth(u, Math.sign(v))) {
      const [x, y] = leafPoint(u, v);
      return [x, y, false];
    }
  }
}

export function buildTargets({
  count,
  isShape,
  joinsLeaf,
  scale,
  random,
}: TargetInput): Targets {
  const graphX = new Float32Array(count);
  const graphY = new Float32Array(count);
  const leafX = new Float32Array(count);
  const leafY = new Float32Array(count);
  const leafKind = new Uint8Array(count);
  const toX = (x: number) => x * scale;
  const toY = (y: number) => -y * scale;

  const shapeIndex = Array.from({ length: count }, (_, i) => i).filter(
    (i) => isShape[i],
  );
  const shapeCount = shapeIndex.length;
  const strands = [TRUNK, ...BRANCHES];
  const areas = strands.map((p) => p.length * LINE_WIDTH);
  const ringsArea =
    Math.PI * (RING.outer ** 2 - RING.inner ** 2) * RINGS.length +
    Math.PI * HEAD.disc ** 2 +
    Math.PI * (HEAD.outer ** 2 - HEAD.inner ** 2);
  const total = areas.reduce((a, b) => a + b, 0) + ringsArea;
  const counts = areas.map((a) => Math.round((shapeCount * a) / total));
  const ringCount = shapeCount - counts.reduce((a, b) => a + b, 0);

  const order = shapeIndex.slice();
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let next = 0;
  strands.forEach((path, s) => {
    const points = strandPoints(path, counts[s], random);
    points.forEach(({ x, y }, k) => {
      const i = order[next++];
      graphX[i] = toX(x);
      graphY[i] = toY(y);
      // The leaf side is spaced by rank, not by the graph's t: the graph's line skips its commits, the vein must not.
      const t = (k + random()) / points.length;
      const [lx, ly] =
        s === 0
          ? midribPoint(t, random)
          : veinPoint(RIGHT_VEINS[s - 1], t, random);
      leafX[i] = toX(lx);
      leafY[i] = toY(ly);
      leafKind[i] = LeafKind.Vein;
    });
  });

  // Left-hand veins at about the right-hand ones' density, shared between the commits' leaves and the ambient.
  const rightLength = RIGHT_VEINS.reduce((a, p) => a + p.length, 0);
  const density = counts.slice(1).reduce((a, b) => a + b, 0) / rightLength;
  const leftPoints: Sample[] = [];
  for (const path of LEFT_VEINS) {
    const n = Math.round(path.length * density * 0.85);
    for (let k = 0; k < n; k++)
      leftPoints.push(veinPoint(path, random(), random));
  }
  const ringsFromVeins = Math.min(
    leftPoints.length,
    Math.round(ringCount * 0.45),
  );
  const commitSources: Source[] = [];
  for (let k = 0; k < ringCount; k++) {
    if (k < ringsFromVeins)
      commitSources.push({ p: leftPoints[k], kind: LeafKind.Vein });
    else {
      const b = bladePoint(random);
      commitSources.push({
        p: b,
        kind: b[2] ? LeafKind.Margin : LeafKind.Blade,
      });
    }
  }
  const commits = ringPoints(ringCount, random).sort((a, b) => b.y - a.y);
  commitSources.sort((a, b) => b.p[1] - a.p[1]);
  for (let k = 0; k < ringCount; k++) {
    const i = order[next++];
    graphX[i] = toX(commits[k].x);
    graphY[i] = toY(commits[k].y);
    leafX[i] = toX(commitSources[k].p[0]);
    leafY[i] = toY(commitSources[k].p[1]);
    leafKind[i] = commitSources[k].kind;
  }
  let left = ringsFromVeins;
  for (let i = 0; i < count; i++) {
    if (isShape[i]) continue;
    if (!joinsLeaf[i]) {
      leafKind[i] = LeafKind.None;
      continue;
    }
    if (left < leftPoints.length) {
      const [lx, ly] = leftPoints[left++];
      leafX[i] = toX(lx);
      leafY[i] = toY(ly);
      leafKind[i] = LeafKind.Vein;
    } else {
      const [lx, ly, margin] = bladePoint(random);
      leafX[i] = toX(lx);
      leafY[i] = toY(ly);
      leafKind[i] = margin ? LeafKind.Margin : LeafKind.Blade;
    }
  }
  return { graphX, graphY, leafX, leafY, leafKind };
}
