/*
 * Leaf particles for the landing hero: a prototype, not the implementation. Round 2.
 *
 * Several thousand leaf-shaped point sprites in a range of greens. On load they drift in and form one large leaf,
 * which then becomes the git graph: its midrib straightens into `main`, its right-hand veins into the branches, its
 * left-hand veins and its blade into the commits and the ambient drift. The graph then writes itself into the
 * "worktree" wordmark. "Settle" rests there; "Loop" goes back to the leaf and repeats. The pointer pushes leaves
 * away; they spring back.
 *
 * Rendering is OGL 1.0.11 (Renderer, Program, Geometry, Mesh only), with the simulation on the CPU: two
 * Float32Arrays are uploaded per frame. GLSL ES 1.00 so it runs on WebGL 1 as well as 2.
 *
 * Coordinates: shapes are designed in a 380×470 box with y down (like a 2D canvas), then scaled into the art box
 * in CSS pixels with the origin at its centre and y up.
 */

const OGL = "https://cdn.jsdelivr.net/npm/ogl@1.0.11/src/core/";

const canvas = document.getElementById("leaves");
const art = canvas.parentElement;
const fallback = document.getElementById("leaves-fallback");
const stageOut = document.getElementById("proto-stage");
const fpsOut = document.getElementById("proto-fps");
const replayButton = document.getElementById("proto-replay");
const modeButton = document.getElementById("proto-mode");
const root = document.documentElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);
const easeOutCubic = (p) => 1 - (1 - p) ** 3;

// Timings of start-up, for finding a glitch: window.__particles.events.
const events = [];
const mark = (name) => events.push(`${Math.round(performance.now())}ms ${name}`);

// ---- Tuning (every number here is a proposal) ----
const PHONE = innerWidth < 760;
const SHAPE_COUNT = PHONE ? 2400 : 6400; // the leaves that form the graph and the wordmark
const AMBIENT_COUNT = PHONE ? 1100 : 2800; // drift; most of them fill the big leaf's blade
const COUNT = SHAPE_COUNT + AMBIENT_COUNT;
const NEAR_COUNT = Math.round(COUNT * 0.05); // ambient leaves close to the viewer: large, soft, faint
const HOLD = { leaf: 2.0, graph: 4.5, word: 4.0 };
const POINTER = { sigma: 42, push: 950, swirl: 0.45, spring: 30, damping: 7.5 };

// ---- Shapes, in design units (380×470, y down) ----
const L = [-112, -37, 38, 113]; // lanes: main, then three branch lanes

/** A polyline with arc-length parameterisation: at(t) gives a point and its unit normal. */
function makePath(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  }
  const length = cum[cum.length - 1];
  return {
    length,
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
const cubic = (p0, p1, p2, p3, n = 24) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [0, 1].map((a) => u ** 3 * p0[a] + 3 * u * u * t * p1[a] + 3 * u * t * t * p2[a] + t ** 3 * p3[a]);
  });
const quad = (p0, p1, p2, n = 20) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [0, 1].map((a) => u * u * p0[a] + 2 * u * t * p1[a] + t * t * p2[a]);
  });
const elbow = (x0, y0, x1, y1) => {
  const m = (y0 + y1) / 2;
  return cubic([x0, y0], [x0, m], [x1, m], [x1, y1]);
};
const line = (x0, y0, x1, y1) => [
  [x0, y0],
  [x1, y1],
];
const join = (...parts) => parts.reduce((all, p) => all.concat(all.length ? p.slice(1) : p), []);

// The graph: main, a long branch to HEAD (feat), a short one off it (fix), and one that merges back (chore).
// Each line is a strand a leaf vein becomes; the order of BRANCHES is the order of the leaf's right-hand veins.
const TRUNK = makePath(line(L[0], 190, L[0], -215));
const BRANCHES = [
  makePath(join(elbow(L[0], 150, L[2], 88), line(L[2], 88, L[2], 40))), // feat, low
  makePath(join(elbow(L[0], 80, L[1], 28), line(L[1], 28, L[1], -8))), // chore, out
  makePath(elbow(L[0], -60, L[1], -8)), // chore, the merge (drawn from main outwards, as a vein grows)
  makePath(join(elbow(L[2], 40, L[3], -22), line(L[3], -22, L[3], -95))), // fix
  makePath(line(L[2], 40, L[2], -150)), // feat, high, up to HEAD
];
const LINE_WIDTH = 7;
// Commits. Main has five, not seven, so it reads as a line with commits on it rather than a dotted one.
const RINGS = [
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
const RING = { inner: 8.75, outer: 14.25 };
const HEAD = { at: [L[2], -150], disc: 10, inner: 17, outer: 21 };
// A line runs right up to a commit's outer edge, so the trunk is continuous rather than broken at every commit.
const insideCommit = (x, y) =>
  RINGS.some(([cx, cy]) => (x - cx) ** 2 + (y - cy) ** 2 < RING.outer ** 2) ||
  (x - HEAD.at[0]) ** 2 + (y - HEAD.at[1]) ** 2 < HEAD.outer ** 2;

// The leaf: ovate, pointed, a little asymmetric, tilted right, its stem ending on main's first commit.
const LEAF = { stem: [L[0], 190], base: [L[0] + 16, 146], angle: (21 * Math.PI) / 180, length: 405, width: 124, bend: 9 };
const leafAxis = [Math.sin(LEAF.angle), -Math.cos(LEAF.angle)];
const leafNormal = [Math.cos(LEAF.angle), Math.sin(LEAF.angle)]; // points to the leaf's right-hand side
const halfWidth = (u, side) => LEAF.width * Math.sin(Math.PI * clamp01(u) ** 0.62) ** 0.85 * (side > 0 ? 1.06 : 0.93);
const leafPoint = (u, v) => {
  const off = v + LEAF.bend * Math.sin(Math.PI * u);
  return [
    LEAF.base[0] + leafAxis[0] * u * LEAF.length + leafNormal[0] * off,
    LEAF.base[1] + leafAxis[1] * u * LEAF.length + leafNormal[1] * off,
  ];
};
const STEM = makePath(quad(LEAF.stem, [L[0] + 2, 166], LEAF.base));
const MIDRIB_END = 0.97;
// Lateral veins: arcs from the midrib out towards the margin, curving forward. Right and left alternate slightly.
const VEIN_U = [0.15, 0.29, 0.43, 0.57, 0.71];
const vein = (u, side) => {
  const uc = u + 0.035;
  const ue = Math.min(0.93, u + 0.2);
  return makePath(quad(leafPoint(u, 0), leafPoint(uc, side * 0.5 * halfWidth(uc, side)), leafPoint(ue, side * 0.86 * halfWidth(ue, side))));
};
const RIGHT_VEINS = VEIN_U.map((u) => vein(u, 1));
const LEFT_VEINS = VEIN_U.map((u) => vein(u + 0.045, -1));

const vertex = /* glsl */ `
  attribute vec3 position; // x, y (CSS px, centred, y up), alpha
  attribute vec2 aDyn;     // shade (-1 deep .. 0 own tone .. 1 vein-bright), size multiplier
  attribute vec4 aRand;    // rotation phase, spin, flutter phase, brightness
  attribute float aSize;   // CSS px
  attribute float aDepth;  // -1 far .. 1 near
  attribute float aTone;   // palette index 0..5

  uniform vec2 uRes;
  uniform float uDpr;
  uniform float uMinPx;
  uniform float uTime;
  uniform float uFade;
  uniform vec2 uParallax;
  uniform vec3 uPalette[6];
  uniform vec3 uVein;
  uniform vec3 uDeep;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vAngle;
  varying float vPx;
  varying float vBlur;

  void main() {
    vec2 p = position.xy + aDepth * uParallax;
    gl_Position = vec4(p / (uRes * 0.5), 0.0, 1.0);

    float near = smoothstep(0.78, 1.0, aDepth);
    vPx = max(aSize * (1.0 + 0.22 * aDepth) * aDyn.y * uDpr, uMinPx);
    gl_PointSize = vPx;

    vec3 own = uPalette[int(aTone + 0.5)] * (0.88 + 0.24 * aRand.w);
    vColor = aDyn.x >= 0.0 ? mix(own, uVein, aDyn.x * 0.85) : mix(own, uDeep, -aDyn.x);
    vAlpha = position.z * uFade * mix(1.0, 0.4, near);
    vBlur = 1.0 + near * 6.0;

    float spin = (aRand.y - 0.5) * 1.1;
    vAngle = aRand.x * 6.2831853 + uTime * spin + sin(uTime * 1.6 + aRand.z * 6.2831853) * 0.4;
  }
`;

const fragment = /* glsl */ `
  precision highp float;

  uniform float uFold;

  varying vec3 vColor;
  varying float vAlpha;
  varying float vAngle;
  varying float vPx;
  varying float vBlur;

  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;
    float c = cos(vAngle);
    float s = sin(vAngle);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);

    // A leaf along +y: pointed at both ends, widest a little below the middle.
    float t = (p.y + 0.92) / 1.84;
    if (t <= 0.0 || t >= 1.0) discard;
    float halfWidth = 0.46 * sin(3.14159265 * pow(t, 0.72));
    float d = abs(p.x) - halfWidth;

    float aa = 2.0 / vPx * vBlur; // one device pixel in sprite units, widened for out-of-focus leaves
    float a = smoothstep(aa, -aa, d);
    if (a < 0.004) discard;

    // One half in shade, as if folded along the midrib; the rib itself shows on the larger leaves.
    float side = mix(uFold, 1.0, smoothstep(-aa, aa, p.x));
    float rib = 1.0 - 0.22 * smoothstep(aa * 1.3, 0.0, abs(p.x)) * step(10.0, vPx) * step(t, 0.92);
    float alpha = a * vAlpha;
    gl_FragColor = vec4(vColor * side * rib * alpha, alpha);
  }
`;

function showFallback(reason) {
  fallback.hidden = false;
  canvas.hidden = true;
  stageOut.value = "fallback";
  console.warn("[particles] fallback:", reason);
}

async function main() {
  mark("module start");
  // Nothing runs before the page has painted: the copy and the button are the LCP, not the canvas.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

  let Renderer;
  let Program;
  let Geometry;
  let Mesh;
  try {
    [{ Renderer }, { Program }, { Geometry }, { Mesh }] = await Promise.all(
      ["Renderer", "Program", "Geometry", "Mesh"].map((name) => import(`${OGL}${name}.js`)),
    );
  } catch (error) {
    showFallback(error);
    return;
  }
  mark("ogl imported");

  const dpr = Math.min(2, devicePixelRatio || 1);
  const renderer = new Renderer({
    canvas,
    dpr,
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    powerPreference: "high-performance",
  });
  const gl = renderer.gl;
  if (!gl) {
    showFallback("no WebGL context");
    return;
  }
  mark("webgl context");

  // The wordmark's face. The leaf and the graph do not need it, so nothing waits for it: the wordmark is sampled
  // when its stage begins, seconds later.
  let wordFont = "monospace";
  document.fonts
    .load('400 100px "Michroma"')
    .then(() => {
      if (document.fonts.check('400 100px "Michroma"')) wordFont = "Michroma";
      mark("michroma ready");
    })
    .catch(() => {});

  // ---- Particles: static attributes, sorted far to near so the near leaves draw last ----
  const toneWeights = [0.3, 0.22, 0.16, 0.14, 0.12, 0.06];
  const pickTone = () => {
    let r = Math.random();
    for (let i = 0; i < toneWeights.length; i++) {
      r -= toneWeights[i];
      if (r <= 0) return i;
    }
    return 0;
  };
  const specs = [];
  for (let i = 0; i < COUNT; i++) {
    const shape = i < SHAPE_COUNT;
    const near = !shape && i >= COUNT - NEAR_COUNT;
    const depth = shape ? (Math.random() * 2 - 1) * 0.4 : near ? 0.8 + Math.random() * 0.2 : Math.random() * 1.5 - 0.9;
    const size = shape
      ? 2.6 + 3.4 * Math.random() ** 1.7
      : near
        ? 10 + 6 * Math.random()
        : 2.4 + 3.8 * Math.random() ** 1.4;
    specs.push({ shape, near, depth, size, tone: pickTone() });
  }
  specs.sort((a, b) => a.depth - b.depth);

  const position = new Float32Array(COUNT * 3);
  const dyn = new Float32Array(COUNT * 2);
  const aRand = new Float32Array(COUNT * 4);
  const aSize = new Float32Array(COUNT);
  const aDepth = new Float32Array(COUNT);
  const aTone = new Float32Array(COUNT);
  const isShape = new Uint8Array(COUNT);
  const pushScale = new Float32Array(COUNT); // each leaf yields to the pointer a little differently: a soft edge
  for (let i = 0; i < COUNT; i++) {
    const s = specs[i];
    aRand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    aSize[i] = s.size;
    aDepth[i] = s.depth;
    aTone[i] = s.tone;
    isShape[i] = s.shape ? 1 : 0;
    pushScale[i] = 0.4 + Math.random() * 1.2;
  }
  const shapeIndex = Int32Array.from({ length: COUNT }, (_, i) => i).filter((i) => isShape[i]);
  // Ambient leaves that join the big leaf's blade: not the near, out-of-focus ones, and not the deepest.
  const joinsLeaf = new Uint8Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    if (!isShape[i] && Math.abs(aDepth[i]) < 0.8 && Math.random() < 0.95) joinsLeaf[i] = 1;
  }

  // ---- Per-particle simulation state ----
  const px = new Float32Array(COUNT); // base position (no pointer offset)
  const py = new Float32Array(COUNT);
  const pa = new Float32Array(COUNT); // alpha, shade, size multiplier as last drawn
  const ps = new Float32Array(COUNT);
  const pz = new Float32Array(COUNT).fill(1);
  const sx = new Float32Array(COUNT); // where the current transition started
  const sy = new Float32Array(COUNT);
  const sa = new Float32Array(COUNT);
  const ss = new Float32Array(COUNT);
  const sz = new Float32Array(COUNT);
  const gx = new Float32Array(COUNT); // where it is going (unless it drifts)
  const gy = new Float32Array(COUNT);
  const ga = new Float32Array(COUNT);
  const gs = new Float32Array(COUNT);
  const gz = new Float32Array(COUNT);
  const drifts = new Uint8Array(COUNT); // 1: the goal is the ambient drift, which moves
  const delay = new Float32Array(COUNT);
  const dur = new Float32Array(COUNT);
  const swirl = new Float32Array(COUNT);
  const ox = new Float32Array(COUNT); // pointer offset and its velocity
  const oy = new Float32Array(COUNT);
  const vx = new Float32Array(COUNT);
  const vy = new Float32Array(COUNT);
  // Per-stage targets, in CSS px (y up), filled by buildTargets().
  const leafX = new Float32Array(COUNT);
  const leafY = new Float32Array(COUNT);
  const leafKind = new Uint8Array(COUNT); // 0 none (keeps drifting), 1 midrib or vein, 2 blade
  const graphX = new Float32Array(COUNT);
  const graphY = new Float32Array(COUNT);
  const wordX = new Float32Array(COUNT);
  const wordY = new Float32Array(COUNT);
  // The ambient drift: a slow, calm field, no spiral.
  const dr = new Float32Array(COUNT);
  const da = new Float32Array(COUNT);
  const dph = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    dr[i] = 0.45 + 0.55 * Math.sqrt(Math.random()); // clear in the middle, so the shapes stand out
    da[i] = Math.random() * TAU;
    dph[i] = Math.random() * TAU;
  }

  let W = 1;
  let H = 1;
  let scale = 1;
  let driftR = 1;
  let ambientAlpha = 0.5;
  const driftX = (i, t) => Math.cos(da[i] + t * 0.025) * driftR * dr[i] + Math.sin(t * 0.31 + dph[i] * 2) * 9;
  const driftY = (i, t) => Math.sin(da[i] + t * 0.025) * driftR * dr[i] * 0.9 + Math.cos(t * 0.23 + dph[i] * 3) * 9;
  const ambientAlphaOf = (i) => ambientAlpha * (0.55 + 0.45 * (1 - Math.abs(aDepth[i])));

  // Design units (y down) to CSS px (y up, centred).
  const toX = (x) => x * scale;
  const toY = (y) => -y * scale;

  // ---- Sampling ----
  const jitter = (path, t, width) => {
    const [x, y, nx, ny] = path.at(t);
    const o = (Math.random() - 0.5) * width;
    return [x + nx * o, y + ny * o];
  };
  /** n points along a graph strand, sorted by t, none inside a commit. */
  function strandPoints(path, n) {
    const out = [];
    while (out.length < n) {
      const t = Math.random();
      const [x, y] = jitter(path, t, LINE_WIDTH);
      if (!insideCommit(x, y)) out.push({ t, x, y });
    }
    return out.sort((a, b) => a.t - b.t);
  }
  function ringPoints(n) {
    const ringArea = Math.PI * (RING.outer ** 2 - RING.inner ** 2);
    const headDisc = Math.PI * HEAD.disc ** 2;
    const headRing = Math.PI * (HEAD.outer ** 2 - HEAD.inner ** 2);
    const total = ringArea * RINGS.length + headDisc + headRing;
    const out = [];
    const annulus = ([cx, cy], ri, ro) => {
      const r = Math.sqrt(Math.random() * (ro * ro - ri * ri) + ri * ri);
      const a = Math.random() * TAU;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    };
    for (let k = 0; k < n; k++) {
      let pick = Math.random() * total;
      const ring = Math.floor(pick / ringArea);
      if (ring < RINGS.length) annulus(RINGS[ring], RING.inner, RING.outer);
      else if ((pick -= ringArea * RINGS.length) < headDisc) annulus(HEAD.at, 0, HEAD.disc);
      else annulus(HEAD.at, HEAD.inner, HEAD.outer);
    }
    return out;
  }
  /** The midrib, with the stem below it: one strand for main, parameterised from the stem's foot to the tip. */
  const stemShare = STEM.length / (STEM.length + LEAF.length * MIDRIB_END);
  function midribPoint(t) {
    if (t < stemShare) return jitter(STEM, t / stemShare, 6);
    const u = ((t - stemShare) / (1 - stemShare)) * MIDRIB_END;
    const band = 7.5 * (1 - 0.6 * u);
    return leafPoint(u, (Math.random() - 0.5) * band);
  }
  const veinPoint = (path, t) => jitter(path, t, 5 * (1 - 0.55 * t));
  function bladePoint() {
    if (Math.random() < 0.2) {
      // The margin, a little denser, so the silhouette is crisp.
      const u = 0.03 + Math.random() * 0.94;
      const side = Math.random() < 0.5 ? -1 : 1;
      return leafPoint(u, side * halfWidth(u, side) * (0.9 + 0.1 * Math.random()));
    }
    for (;;) {
      const u = Math.random();
      const v = (Math.random() * 2 - 1) * LEAF.width * 1.06;
      if (Math.abs(v) < halfWidth(u, Math.sign(v))) return leafPoint(u, v);
    }
  }

  /**
   * The leaf and the graph, paired particle by particle:
   *  - main's leaves sit on the stem and midrib at the same fraction of the way up;
   *  - each branch's leaves sit on one right-hand vein, at the same fraction of the way out;
   *  - the commits' leaves sit on the left-hand veins and the blade, paired bottom to top;
   *  - most ambient leaves fill the rest of the blade, and drift off again when the leaf becomes the graph.
   */
  function buildTargets() {
    const t0 = performance.now();
    scale = Math.min(W / 380, H / 470) * 0.86;
    driftR = Math.min(W, H) * 0.5;
    const strands = [TRUNK, ...BRANCHES];
    const areas = strands.map((p) => p.length * LINE_WIDTH);
    const ringsArea =
      Math.PI * (RING.outer ** 2 - RING.inner ** 2) * RINGS.length +
      Math.PI * HEAD.disc ** 2 +
      Math.PI * (HEAD.outer ** 2 - HEAD.inner ** 2);
    const total = areas.reduce((a, b) => a + b, 0) + ringsArea;
    const counts = areas.map((a) => Math.round((SHAPE_COUNT * a) / total));
    const ringCount = SHAPE_COUNT - counts.reduce((a, b) => a + b, 0);

    const order = Array.from(shapeIndex);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    let next = 0;
    strands.forEach((path, s) => {
      const points = strandPoints(path, counts[s]);
      points.forEach(({ x, y }, k) => {
        const i = order[next++];
        graphX[i] = toX(x);
        graphY[i] = toY(y);
        // The leaf side is spaced by rank, not by the graph's t: the graph's line skips its commits, the vein must not.
        const t = (k + Math.random()) / points.length;
        const [lx, ly] = s === 0 ? midribPoint(t) : veinPoint(RIGHT_VEINS[s - 1], t);
        leafX[i] = toX(lx);
        leafY[i] = toY(ly);
        leafKind[i] = 1;
      });
    });

    // Left-hand veins at about the right-hand ones' density, shared between the commits' leaves and the ambient.
    const rightLength = RIGHT_VEINS.reduce((a, p) => a + p.length, 0);
    const density = counts.slice(1).reduce((a, b) => a + b, 0) / rightLength;
    const leftPoints = [];
    LEFT_VEINS.forEach((path) => {
      const n = Math.round(path.length * density * 0.85);
      for (let k = 0; k < n; k++) leftPoints.push(veinPoint(path, Math.random()));
    });
    const ringsFromVeins = Math.min(leftPoints.length, Math.round(ringCount * 0.45));
    const commitSources = [];
    for (let k = 0; k < ringCount; k++) {
      commitSources.push(k < ringsFromVeins ? { p: leftPoints[k], kind: 1 } : { p: bladePoint(), kind: 2 });
    }
    const commits = ringPoints(ringCount).sort((a, b) => b.y - a.y);
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
    for (let i = 0; i < COUNT; i++) {
      if (isShape[i]) continue;
      if (!joinsLeaf[i]) {
        leafKind[i] = 0;
        continue;
      }
      const vein = left < leftPoints.length;
      const [lx, ly] = vein ? leftPoints[left++] : bladePoint();
      leafX[i] = toX(lx);
      leafY[i] = toY(ly);
      leafKind[i] = vein ? 1 : 2;
    }
    mark(`targets built in ${Math.round(performance.now() - t0)}ms`);
  }

  // The wordmark: drawn to an offscreen canvas at the box's size, sampled pixel by pixel, when its stage begins.
  function sampleWord(n) {
    const w = Math.max(1, Math.ceil(W));
    const h = Math.max(1, Math.ceil(H));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    const text = "worktree";
    ctx.font = `400 100px "${wordFont}"`;
    const size = (100 * w * 0.84) / (ctx.measureText(text).width || 1);
    ctx.font = `400 ${size}px "${wordFont}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
    // Michroma has one weight; a thin stroke round the glyphs gives the leaves a little more room.
    ctx.lineWidth = size * 0.035;
    ctx.lineJoin = "round";
    ctx.strokeText(text, w / 2, h / 2);
    const data = ctx.getImageData(0, 0, w, h).data;
    const filled = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 128) filled.push(x, y);
      }
    }
    const cells = filled.length / 2;
    const order = Int32Array.from({ length: cells }, (_, i) => i);
    for (let i = cells - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const out = new Float32Array(n * 2);
    for (let k = 0; k < n; k++) {
      const c = order[k % cells];
      out[k * 2] = filled[c * 2] + Math.random() - w / 2;
      out[k * 2 + 1] = h / 2 - (filled[c * 2 + 1] + Math.random());
    }
    return out;
  }

  // ---- GL ----
  const geometry = new Geometry(gl, {
    position: { size: 3, data: position, usage: gl.DYNAMIC_DRAW },
    aDyn: { size: 2, data: dyn, usage: gl.DYNAMIC_DRAW },
    aRand: { size: 4, data: aRand },
    aSize: { size: 1, data: aSize },
    aDepth: { size: 1, data: aDepth },
    aTone: { size: 1, data: aTone },
  });
  const program = new Program(gl, {
    vertex,
    fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uRes: { value: [1, 1] },
      uDpr: { value: dpr },
      // Round 2: no leaf smaller than this many device pixels, so the smallest stay leaves on a 1× screen.
      uMinPx: { value: dpr >= 1.5 ? 5 : 4.5 },
      uTime: { value: 0 },
      uFade: { value: 1 },
      uParallax: { value: [0, 0] },
      uPalette: { value: new Array(18).fill(0) },
      uVein: { value: [1, 1, 1] },
      uDeep: { value: [0, 0, 0] },
      uFold: { value: 0.8 },
    },
  });
  const mesh = new Mesh(gl, { mode: gl.POINTS, geometry, program });
  mark("program created");

  // Colours come from theme.css, so the toggle (and the real site's picker) re-tints the leaves.
  const probe = document.createElement("canvas").getContext("2d");
  const rgb = (value, fallbackColour) => {
    probe.fillStyle = "#000";
    probe.fillStyle = value.trim() || fallbackColour;
    const hex = probe.fillStyle;
    return [1, 3, 5].map((k) => Number.parseInt(hex.slice(k, k + 2), 16) / 255);
  };
  function readTheme() {
    const css = getComputedStyle(root);
    program.uniforms.uPalette.value = Array.from({ length: 6 }, (_, k) => rgb(css.getPropertyValue(`--leaf-${k + 1}`), "#4ade80")).flat();
    program.uniforms.uVein.value = rgb(css.getPropertyValue("--leaf-vein"), "#bbf7d0");
    program.uniforms.uDeep.value = rgb(css.getPropertyValue("--leaf-deep"), "#15803d");
    program.uniforms.uFold.value = Number.parseFloat(css.getPropertyValue("--leaf-fold")) || 0.8;
    ambientAlpha = Number.parseFloat(css.getPropertyValue("--leaf-ambient-alpha")) || 0.5;
  }

  // ---- The timeline ----
  let mode = "settle"; // settle: leaf → graph → wordmark, then rest; loop: … → wordmark → leaf, repeating
  const nextStage = { leaf: "graph", graph: "word", word: "leaf" };
  let T = 0; // our own clock: it stops while the canvas is off screen or the tab is hidden
  let stage = "leaf";
  let stageStart = 0;
  let stageLength = Infinity;
  let intro = true;

  const ALONG_Y = (values, idx) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const i of idx) {
      if (values[i] < lo) lo = values[i];
      if (values[i] > hi) hi = values[i];
    }
    return (i) => (values[i] - lo) / (hi - lo || 1);
  };
  const all = Int32Array.from({ length: COUNT }, (_, i) => i);

  /**
   * Begin a stage: every leaf starts from where it is now and heads for that stage's goal. `quick` re-fits after a
   * resize (no stagger); `fromNothing` is the intro, where the leaves drift in from just above their places.
   */
  function enter(name, { quick = false, fromNothing = false } = {}) {
    stage = name;
    stageStart = T;
    intro = fromNothing;
    for (let i = 0; i < COUNT; i++) {
      sx[i] = px[i];
      sy[i] = py[i];
      sa[i] = pa[i];
      ss[i] = ps[i];
      sz[i] = pz[i];
    }
    let longest = 0;
    const set = (i, d, du, sw) => {
      delay[i] = quick ? 0 : d;
      dur[i] = quick ? 0.6 : du;
      swirl[i] = quick ? 0 : sw;
      longest = Math.max(longest, delay[i] + dur[i]);
    };

    if (name === "leaf") {
      const along = ALONG_Y(leafY, all.filter((i) => leafKind[i]));
      for (let i = 0; i < COUNT; i++) {
        const k = leafKind[i];
        drifts[i] = k ? 0 : 1;
        gx[i] = leafX[i];
        gy[i] = leafY[i];
        ga[i] = k === 2 ? 0.92 : k === 1 ? 1 : ambientAlphaOf(i);
        gs[i] = k === 1 ? 1 : k === 2 ? -0.18 : 0;
        gz[i] = k === 1 ? 1.15 : k === 2 ? 2.3 : 1;
        if (fromNothing) {
          // Drift in from a little above and to the side, invisible at first.
          const a = Math.random() * TAU;
          const dist = (40 + Math.random() * 90) * Math.max(0.7, scale);
          sx[i] = (k ? gx[i] : driftX(i, T)) + Math.cos(a) * dist;
          sy[i] = (k ? gy[i] : driftY(i, T)) + Math.abs(Math.sin(a)) * dist * 0.6 + 30;
          sa[i] = 0;
          ss[i] = gs[i];
          sz[i] = gz[i];
          set(i, (k ? along(i) * 0.35 : 0.2) + Math.random() * 0.2, 0.7 + Math.random() * 0.35, (Math.random() - 0.5) * 0.15);
        } else {
          set(i, (k ? along(i) * 0.9 : 0) + Math.random() * 0.3, 1.2 + Math.random() * 0.6, (Math.random() - 0.5) * 0.3);
        }
      }
    } else if (name === "graph") {
      const along = ALONG_Y(graphY, shapeIndex);
      const alongLeaf = ALONG_Y(leafY, all.filter((i) => leafKind[i]));
      for (let i = 0; i < COUNT; i++) {
        if (isShape[i]) {
          drifts[i] = 0;
          gx[i] = graphX[i];
          gy[i] = graphY[i];
          ga[i] = 1;
          // The veins fade to their own tone as they straighten; vein leaves barely swirl, so the straightening reads.
          set(i, along(i) * 1.1 + Math.random() * 0.25, 1.15 + Math.random() * 0.6, (Math.random() - 0.5) * (leafKind[i] === 1 ? 0.1 : 0.3));
        } else {
          drifts[i] = 1;
          ga[i] = ambientAlphaOf(i);
          set(i, (leafKind[i] ? alongLeaf(i) * 0.7 : 0) + Math.random() * 0.4, 1.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.4);
        }
        gs[i] = 0;
        gz[i] = 1;
      }
    } else {
      // The wordmark, written left to right: leaves and letters paired in order of x (round 1, unchanged).
      const target = sampleWord(shapeIndex.length);
      const bySource = Array.from(shapeIndex).sort((a, b) => px[a] - px[b]);
      const byTarget = Int32Array.from({ length: shapeIndex.length }, (_, k) => k).sort((a, b) => target[a * 2] - target[b * 2]);
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < byTarget.length; k++) {
        lo = Math.min(lo, target[k * 2]);
        hi = Math.max(hi, target[k * 2]);
      }
      for (let k = 0; k < bySource.length; k++) {
        const i = bySource[k];
        const j = byTarget[k];
        wordX[i] = target[j * 2];
        wordY[i] = target[j * 2 + 1];
        drifts[i] = 0;
        gx[i] = wordX[i];
        gy[i] = wordY[i];
        ga[i] = 1;
        gs[i] = 0;
        gz[i] = 1;
        set(i, ((wordX[i] - lo) / (hi - lo || 1)) * 1.0 + Math.random() * 0.3, 1.2 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5);
      }
      for (let i = 0; i < COUNT; i++) {
        if (isShape[i]) continue;
        drifts[i] = 1;
        ga[i] = ambientAlphaOf(i);
        gs[i] = 0;
        gz[i] = 1;
        set(i, 0, 0.6, 0);
      }
    }
    const rests = name === "word" && mode === "settle";
    stageLength = rests ? Infinity : longest + HOLD[name];
    stageOut.value = rests ? "word (resting)" : name;
  }

  // ---- Pointer ----
  const pointer = { x: 0, y: 0, active: false, nx: 0, ny: 0 };
  const parallax = [0, 0];
  addEventListener(
    "pointermove",
    (event) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = event.clientX - rect.left - rect.width / 2;
      pointer.y = rect.height / 2 - (event.clientY - rect.top);
      pointer.active = Math.abs(pointer.x) < rect.width / 2 + 40 && Math.abs(pointer.y) < rect.height / 2 + 40;
      pointer.nx = Math.max(-1, Math.min(1, pointer.x / (rect.width / 2)));
      pointer.ny = Math.max(-1, Math.min(1, pointer.y / (rect.height / 2)));
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    pointer.active = false;
  });

  // ---- One simulation step ----
  function step(dt) {
    if (T - stageStart > stageLength) enter(nextStage[stage]);
    const local = T - stageStart;
    const ease = intro ? easeOutCubic : easeInOutCubic;
    const reach = (3 * POINTER.sigma) ** 2;
    const inv2s2 = 1 / (2 * POINTER.sigma * POINTER.sigma);

    for (let i = 0; i < COUNT; i++) {
      const e = ease(clamp01((local - delay[i]) / dur[i]));
      const goalX = drifts[i] ? driftX(i, T) : gx[i];
      const goalY = drifts[i] ? driftY(i, T) : gy[i];
      const dx = goalX - sx[i];
      const dy = goalY - sy[i];
      const arc = Math.sin(Math.PI * e) * swirl[i];
      const flutter = 0.6 + 1.6 * Math.sin(Math.PI * e);
      const x = sx[i] + dx * e - dy * arc + Math.sin(T * 1.3 + dph[i] * 5) * flutter;
      const y = sy[i] + dy * e + dx * arc + Math.cos(T * 1.1 + dph[i] * 7) * flutter;
      px[i] = x;
      py[i] = y;
      // Colour, size and opacity change in the first half of each move, so a dissolving blade thins out early.
      const early = clamp01((local - delay[i]) / (dur[i] * 0.55));
      pa[i] = sa[i] + (ga[i] - sa[i]) * early;
      ps[i] = ss[i] + (gs[i] - ss[i]) * early;
      pz[i] = sz[i] + (gz[i] - sz[i]) * early;

      // The pointer pushes with a Gaussian falloff, so the hollow it makes has a soft edge; a spring brings each leaf home.
      if (pointer.active) {
        const ddx = x + ox[i] - pointer.x;
        const ddy = y + oy[i] - pointer.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < reach) {
          const d = Math.sqrt(d2) + 0.001;
          const f = Math.exp(-d2 * inv2s2) * POINTER.push * pushScale[i] * dt;
          // Mostly outward, partly round the pointer, so the leaves part and swirl rather than leave a clean disc.
          vx[i] += ((ddx - ddy * POINTER.swirl) / d) * f;
          vy[i] += ((ddy + ddx * POINTER.swirl) / d) * f;
        }
      }
      vx[i] += (-POINTER.spring * ox[i] - POINTER.damping * vx[i]) * dt;
      vy[i] += (-POINTER.spring * oy[i] - POINTER.damping * vy[i]) * dt;
      ox[i] += vx[i] * dt;
      oy[i] += vy[i] * dt;

      position[i * 3] = x + ox[i];
      position[i * 3 + 1] = y + oy[i];
      position[i * 3 + 2] = pa[i];
      dyn[i * 2] = ps[i];
      dyn[i * 2 + 1] = pz[i];
    }

    // Depth parallax follows the pointer, and sways slowly without one.
    const goalX = pointer.active ? pointer.nx * 12 : Math.sin(T * 0.21) * 4;
    const goalY = pointer.active ? pointer.ny * 9 : Math.cos(T * 0.17) * 3;
    parallax[0] += (goalX - parallax[0]) * Math.min(1, dt * 3);
    parallax[1] += (goalY - parallax[1]) * Math.min(1, dt * 3);
  }

  function draw() {
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aDyn.needsUpdate = true;
    program.uniforms.uTime.value = T;
    program.uniforms.uParallax.value = parallax;
    renderer.render({ scene: mesh });
  }

  // Reduced motion: the formed graph, drawn once, still.
  function drawStill() {
    for (let i = 0; i < COUNT; i++) {
      const shape = isShape[i];
      position[i * 3] = shape ? graphX[i] : driftX(i, 0);
      position[i * 3 + 1] = shape ? graphY[i] : driftY(i, 0);
      position[i * 3 + 2] = shape ? 1 : ambientAlphaOf(i);
      dyn[i * 2] = 0;
      dyn[i * 2 + 1] = 1;
    }
    parallax[0] = 0;
    parallax[1] = 0;
    program.uniforms.uTime.value = 0;
    draw();
    stageOut.value = "still (reduced motion)";
  }

  // ---- Size ----
  // Round 1 re-ran this from the ResizeObserver's first callback, 120 ms in: setting the canvas size clears it, and
  // from a timer that clear reached the screen before the next frame redrew it (a blink), then re-sampling stalled a
  // frame. Now it runs only when the size really changed, and inside a frame, so the clear and the redraw land together.
  let pendingResize = false;
  function measure() {
    return [art.clientWidth, art.clientHeight];
  }
  function applySize() {
    [W, H] = measure();
    renderer.setSize(W, H);
    program.uniforms.uRes.value = [W, H];
    buildTargets();
  }

  // ---- Loop control: off screen or hidden pauses it ----
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let frames = 0;
  let fpsSince = performance.now();
  let fps = 0;
  let logSince = performance.now();
  let firstFrame = true;
  // Replay fades the current picture out before the leaf drifts in again, instead of snapping every leaf to its start.
  let fadingOut = null;

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    T += dt;
    if (pendingResize) {
      pendingResize = false;
      applySize();
      enter(stage, { quick: true });
    }
    if (fadingOut) {
      const k = clamp01((now - fadingOut.since) / 300);
      program.uniforms.uFade.value = 1 - k;
      if (k >= 1) {
        fadingOut = null;
        program.uniforms.uFade.value = 1;
        enter("leaf", { fromNothing: true });
      }
    }
    step(dt);
    draw();
    if (firstFrame) {
      mark("first frame drawn");
      firstFrame = false;
    }
    frames++;
    if (now - fpsSince >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsSince));
      frames = 0;
      fpsSince = now;
      fpsOut.value = `${fps} fps · ${COUNT}`;
    }
    if (now - logSince >= 2000) {
      console.log(`[particles] fps=${fps} count=${COUNT} stage=${stage} mode=${mode} dpr=${dpr} box=${Math.round(W)}x${Math.round(H)}`);
      logSince = now;
    }
    schedule();
  }
  function schedule() {
    if (raf || reducedMotion.matches || !onScreen || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    cancelAnimationFrame(raf);
    raf = 0;
  }

  // ---- Start: everything is measured and sampled before the first frame ----
  readTheme();
  applySize();
  enter("leaf", { fromNothing: true });

  if (reducedMotion.matches) drawStill();
  schedule();

  new ResizeObserver(() => {
    const [w, h] = measure();
    if (w === W && h === H) return; // the first notification on observe() is not a change
    if (reducedMotion.matches) {
      applySize();
      drawStill();
    } else pendingResize = true;
  }).observe(art);
  new IntersectionObserver(([entry]) => {
    onScreen = entry.isIntersecting;
    onScreen ? schedule() : pause();
  }).observe(canvas);
  document.addEventListener("visibilitychange", () => (document.hidden ? pause() : schedule()));
  reducedMotion.addEventListener("change", () => (reducedMotion.matches ? (pause(), drawStill()) : schedule()));
  new MutationObserver(() => {
    readTheme();
    if (reducedMotion.matches) drawStill();
  }).observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  replayButton.addEventListener("click", () => {
    if (reducedMotion.matches) return;
    fadingOut = { since: performance.now() };
  });
  modeButton.addEventListener("click", () => {
    mode = mode === "settle" ? "loop" : "settle";
    modeButton.textContent = mode === "settle" ? "Settle" : "Loop";
    modeButton.setAttribute("aria-pressed", String(mode === "loop"));
    // Resting on the wordmark and switched to loop: hold a moment, then go back to the leaf.
    if (mode === "loop" && stage === "word" && stageLength === Infinity) {
      stageLength = T - stageStart + HOLD.word;
      stageOut.value = "word";
    }
  });

  // For screenshots: jump straight to a formed stage, or play one from where the leaves are.
  window.__particles = {
    get fps() {
      return fps;
    },
    get stage() {
      return stage;
    },
    get mode() {
      return mode;
    },
    count: COUNT,
    events,
    goto(name) {
      enter(name);
      stageStart = T - 30; // every leaf is past its delay and duration
      if (stageLength !== Infinity) stageLength = 30 + HOLD[name];
    },
    play(name) {
      enter(name);
    },
  };
}

main().catch((error) => showFallback(error));
