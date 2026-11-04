/**
 * Leaf particles for the landing hero (D18). Ported from the approved prototype (`particles.js`, round 3, 552b23f):
 * the algorithm, timings and constants are the prototype's. Changed on purpose:
 *  - the holds are equal, 5 s each, and the sequence loops (leaf → graph → wordmark → leaf) for as long as the page is
 *    visible; the gust of leaves from the viewport's edges plays once, on load. The prototype's Settle/Loop toggle,
 *    toolbar, `?dpr`, fps counter and event log are gone;
 *  - the wordmark flows straight back into the leaf (stem first, veins before blade) rather than going round;
 *  - the copy's quiet zone is gone: the prototype shipped it switched off (`QUIET.floor = 1`) after the user's review;
 *  - reduced motion is a still SVG (HeroLeaves.astro) instead of a still canvas, so the loader never imports this;
 *  - OGL comes from the bundled package.
 *
 * One canvas covers the whole viewport, behind the header and the copy, for the entrance: gusts of small leaves sweep in
 * from every edge (and from behind the header), tumbling as they fly, and gather into one large leaf in the art box:
 * the midrib and veins first, then the blade, the margin last. Then the leaf becomes the git graph (its midrib
 * straightens into `main`, its right-hand veins into the branches, its left-hand veins and blade into the commits and
 * the ambient field), the graph writes itself into the "worktree" wordmark, and the wordmark becomes the leaf again.
 * The pointer pushes leaves away over the art box; they spring back.
 *
 * Rendering is OGL (Renderer, Program, Geometry, Mesh only) with the simulation on the CPU: two Float32Arrays are
 * uploaded per frame. Everything is drawn in CSS pixels with the origin at the centre of the viewport and y up; a
 * shape's targets are kept relative to the art box's centre (the anchor), re-measured on scroll and resize.
 */

import { Geometry, Mesh, Program, Renderer } from "ogl";
import { clamp01, shapeScale } from "./geometry";
import { fragment, vertex } from "./shaders";
import { buildTargets, LeafKind } from "./targets";

export interface HeroHost {
  canvas: HTMLCanvasElement;
  /** The art box: the shapes are anchored to its centre and sized to it. */
  art: HTMLElement;
  /** The site's fixed header, whose glass the leaves fly behind. */
  header: HTMLElement | null;
}

export interface HeroHandle {
  /** Stop or resume drawing (reduced motion toggled while the page is open). */
  setActive(active: boolean): void;
}

type Stage = "leaf" | "graph" | "word";

const TAU = Math.PI * 2;

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function smooth(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function easeInOutCubic(p: number): number {
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}

/** Decelerates into place and overshoots by about 2% of the path, then settles back. */
function easeOutBack(p: number): number {
  const c1 = 0.8;
  const c3 = c1 + 1;
  return 1 + c3 * (p - 1) ** 3 + c1 * (p - 1) ** 2;
}

// ---- Tuning (the prototype's numbers) ----
const PHONE = innerWidth < 760;
const SHAPE_COUNT = PHONE ? 2400 : 6400; // the leaves that form the graph and the wordmark
const AMBIENT_COUNT = PHONE ? 1100 : 2800; // the drift round the shape; most fill the big leaf's blade first
const COUNT = SHAPE_COUNT + AMBIENT_COUNT;
const NEAR_COUNT = Math.round(COUNT * 0.05); // ambient leaves close to the viewer: large, soft, faint
/** Seconds each formed picture holds, once its last leaf has landed (the user, 2026-11-04: equal, about 5 s). */
const HOLD = 5;
/**
 * How much slower than the wall clock the simulation runs. The prototype's clock lost each frame's own work (about a
 * fifth on an M1 Pro), so everything the user approved, the morphs and the entrance as much as the flutter, spin, drift
 * and the pointer's spring, ran at about 1/1.25 of its constants. Here the clock is right and runs at 1/PACE, which
 * keeps the approved feel; the holds alone are measured on the wall clock (HOLD seconds on screen).
 */
const PACE = 1.25;
const POINTER = { sigma: 42, push: 950, swirl: 0.45, spring: 30, damping: 7.5 };
/** A full-viewport canvas at DPR 2 is 4× the pixels of DPR 1; 1.5 keeps the leaves crisp (D18). */
const DPR_CAP = 1.5;
const GUSTS = 12;
const NEXT_STAGE: Record<Stage, Stage> = {
  leaf: "graph",
  graph: "word",
  word: "leaf",
};
const WORD = "worktree";

interface Gust {
  x: number;
  y: number;
  ex: number;
  ey: number;
  spread: number;
  offset: number;
  curl: number;
  header?: boolean;
}

interface EnterOptions {
  quick?: boolean;
  gustIn?: boolean;
}

/** Runs the effect on `host`; returns null when no WebGL context can be made (the caller shows the still). */
export function startParticles(host: HeroHost): HeroHandle | null {
  const { canvas, art, header } = host;
  const root = document.documentElement;
  const dpr = Math.min(DPR_CAP, devicePixelRatio || 1);
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
  if (!gl) return null;

  // The wordmark's face is the display face the landing's own heading already uses, so by the time the wordmark is
  // sampled, seconds in, it is loaded. (Not `document.fonts.load()`: it would also fetch the vendored @font-face whose
  // URL is overridden in theme.css, a 404.) Otherwise the wordmark falls back to monospace.
  const wordFont = () =>
    document.fonts.check('400 100px "Michroma"') ? "Michroma" : "monospace";

  // ---- Particles: static attributes, sorted far to near so the near leaves draw last ----
  const toneWeights = [0.3, 0.22, 0.16, 0.14, 0.12, 0.06];
  function pickTone(): number {
    let r = Math.random();
    for (let i = 0; i < toneWeights.length; i++) {
      r -= toneWeights[i];
      if (r <= 0) return i;
    }
    return 0;
  }
  interface Spec {
    shape: boolean;
    depth: number;
    size: number;
    tone: number;
  }
  const specs: Spec[] = [];
  for (let i = 0; i < COUNT; i++) {
    const shape = i < SHAPE_COUNT;
    const near = !shape && i >= COUNT - NEAR_COUNT;
    const depth = shape
      ? (Math.random() * 2 - 1) * 0.4
      : near
        ? 0.8 + Math.random() * 0.2
        : Math.random() * 1.5 - 0.9;
    const size = shape
      ? 2.6 + 3.4 * Math.random() ** 1.7
      : near
        ? 10 + 6 * Math.random()
        : 2.4 + 3.8 * Math.random() ** 1.4;
    specs.push({ shape, depth, size, tone: pickTone() });
  }
  specs.sort((a, b) => a.depth - b.depth);

  const position = new Float32Array(COUNT * 3);
  const dyn = new Float32Array(COUNT * 4);
  const aRand = new Float32Array(COUNT * 4);
  const aSize = new Float32Array(COUNT);
  const aDepth = new Float32Array(COUNT);
  const aTone = new Float32Array(COUNT);
  const isShape = new Uint8Array(COUNT);
  const pushScale = new Float32Array(COUNT); // each leaf yields to the pointer a little differently: a soft edge
  const angle = new Float32Array(COUNT); // rotation, integrated on the CPU so a leaf can tumble fast in flight
  const spin = new Float32Array(COUNT);
  const flip = new Float32Array(COUNT); // the phase of its turning edge-on, in flight
  const flipRate = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const s = specs[i];
    aRand.set(
      [Math.random(), Math.random(), Math.random(), Math.random()],
      i * 4,
    );
    aSize[i] = s.size;
    aDepth[i] = s.depth;
    aTone[i] = s.tone;
    isShape[i] = s.shape ? 1 : 0;
    pushScale[i] = 0.4 + Math.random() * 1.2;
    angle[i] = Math.random() * TAU;
    spin[i] = (Math.random() - 0.5) * 1.1;
    flip[i] = Math.random() * TAU;
    flipRate[i] = 4 + Math.random() * 6;
  }
  const shapeIndex = Int32Array.from({ length: COUNT }, (_, i) => i).filter(
    (i) => isShape[i],
  );
  // Ambient leaves that join the big leaf's blade: not the near, out-of-focus ones, and not the deepest. The rest
  // fly straight to the ambient field: the leaves the gust leaves behind.
  const joinsLeaf = new Uint8Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    if (!isShape[i] && Math.abs(aDepth[i]) < 0.8 && Math.random() < 0.85)
      joinsLeaf[i] = 1;
  }

  // ---- Per-particle simulation state ----
  const px = new Float32Array(COUNT); // base position (no pointer offset), viewport coordinates
  const py = new Float32Array(COUNT);
  const pa = new Float32Array(COUNT); // alpha, shade, size multiplier as last drawn
  const ps = new Float32Array(COUNT);
  const pz = new Float32Array(COUNT).fill(1);
  const sx = new Float32Array(COUNT); // where the current transition started (viewport)
  const sy = new Float32Array(COUNT);
  const sa = new Float32Array(COUNT);
  const ss = new Float32Array(COUNT);
  const sz = new Float32Array(COUNT);
  const gx = new Float32Array(COUNT); // where it is going, relative to the anchor (unless it drifts)
  const gy = new Float32Array(COUNT);
  const ga = new Float32Array(COUNT);
  const gs = new Float32Array(COUNT);
  const gz = new Float32Array(COUNT);
  const cx = new Float32Array(COUNT); // the gust's control point (viewport), for the fly-in's curved path
  const cy = new Float32Array(COUNT);
  const drifts = new Uint8Array(COUNT); // 1: the goal is the ambient field, which moves
  const gust = new Uint8Array(COUNT); // 1: this move is the fly-in (curved path, tumbling, overshoot)
  const dips = new Uint8Array(COUNT); // 1: fade a little mid-move (the blade dissolving into the graph)
  const delay = new Float32Array(COUNT);
  const dur = new Float32Array(COUNT);
  const swirl = new Float32Array(COUNT);
  const ox = new Float32Array(COUNT); // pointer offset and its velocity
  const oy = new Float32Array(COUNT);
  const vx = new Float32Array(COUNT);
  const vy = new Float32Array(COUNT);
  // Per-stage targets, in CSS px relative to the anchor (y up), filled by applySize().
  let leafX: Float32Array = new Float32Array(COUNT);
  let leafY: Float32Array = new Float32Array(COUNT);
  let leafKind: Uint8Array = new Uint8Array(COUNT);
  let graphX: Float32Array = new Float32Array(COUNT);
  let graphY: Float32Array = new Float32Array(COUNT);
  // The ambient field: a slow, calm annulus round the shape, clear in the middle so the shapes stand out.
  const dr = new Float32Array(COUNT);
  const da = new Float32Array(COUNT);
  const dph = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    dr[i] = 0.45 + 0.55 * Math.sqrt(Math.random());
    da[i] = Math.random() * TAU;
    dph[i] = Math.random() * TAU;
  }

  // Layout, in viewport coordinates (centre origin, y up), re-measured on scroll and resize.
  let W = 1; // the viewport
  let H = 1;
  let AW = 1; // the art box, whose centre is the anchor
  let AH = 1;
  let ax = 0;
  let ay = 0;
  let headerH = 56;
  let driftR = 1;
  let ambientAlpha = 0.5;

  const driftX = (i: number, t: number) =>
    ax +
    Math.cos(da[i] + t * 0.025) * driftR * dr[i] +
    Math.sin(t * 0.31 + dph[i] * 2) * 9;
  const driftY = (i: number, t: number) =>
    ay +
    Math.sin(da[i] + t * 0.025) * driftR * dr[i] * 0.9 +
    Math.cos(t * 0.23 + dph[i] * 3) * 9;
  const ambientAlphaOf = (i: number) =>
    ambientAlpha * (0.55 + 0.45 * (1 - Math.abs(aDepth[i])));

  /** Once landed: a soft edge round the art box (radial, opaque to 84%, clear at the box's edge). */
  function artMask(x: number, y: number): number {
    const e = Math.hypot((x - ax) / (AW * 0.5), (y - ay) / (AH * 0.5));
    return 1 - clamp01((e - 0.84) / 0.16);
  }

  function measureLayout() {
    const r = art.getBoundingClientRect();
    // The viewport, not the canvas: OGL writes the canvas's CSS size itself, so the canvas cannot be the measure.
    W = root.clientWidth;
    H = root.clientHeight;
    AW = r.width;
    AH = r.height;
    ax = r.left + r.width / 2 - W / 2;
    ay = H / 2 - (r.top + r.height / 2);
    headerH = header?.getBoundingClientRect().height ?? 56;
  }

  // The wordmark: drawn to an offscreen canvas at the art box's size, sampled pixel by pixel, when its stage begins.
  function sampleWord(n: number): Float32Array {
    const w = Math.max(1, Math.ceil(AW));
    const h = Math.max(1, Math.ceil(AH));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    const out = new Float32Array(n * 2);
    if (!ctx) return out;
    ctx.font = `400 100px "${wordFont()}"`;
    const size = (100 * w * 0.84) / (ctx.measureText(WORD).width || 1);
    ctx.font = `400 ${size}px "${wordFont()}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(WORD, w / 2, h / 2);
    // Michroma has one weight; a thin stroke round the glyphs gives the leaves a little more room.
    ctx.lineWidth = size * 0.035;
    ctx.lineJoin = "round";
    ctx.strokeText(WORD, w / 2, h / 2);
    const data = ctx.getImageData(0, 0, w, h).data;
    const filled: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 128) filled.push(x, y);
      }
    }
    const cells = filled.length / 2;
    if (cells === 0) return out;
    const order = Int32Array.from({ length: cells }, (_, i) => i);
    for (let i = cells - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
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
    aDyn: { size: 4, data: dyn, usage: gl.DYNAMIC_DRAW },
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
      // No leaf smaller than this many device pixels, so the smallest stay leaves on a 1× screen.
      uMinPx: { value: dpr >= 1.25 ? 5 : 4.5 },
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

  // Colours come from the site's theme (HeroLeaves.astro defines the --leaf-* tokens), so the picker re-tints the leaves.
  const probe = document.createElement("canvas").getContext("2d");
  function rgb(value: string, fallbackColour: string): number[] {
    if (!probe) return [0, 0, 0];
    probe.fillStyle = "#000";
    probe.fillStyle = value.trim() || fallbackColour;
    const css = probe.fillStyle;
    if (css.startsWith("#"))
      return [1, 3, 5].map(
        (k) => Number.parseInt(css.slice(k, k + 2), 16) / 255,
      );
    const channels = css
      .match(/[\d.]+/g)
      ?.slice(0, 3)
      .map(Number) ?? [0, 0, 0];
    return channels.map((c) => c / 255);
  }
  function readTheme() {
    const css = getComputedStyle(root);
    program.uniforms.uPalette.value = Array.from({ length: 6 }, (_, k) =>
      rgb(css.getPropertyValue(`--leaf-${k + 1}`), "#4ade80"),
    ).flat();
    program.uniforms.uVein.value = rgb(
      css.getPropertyValue("--leaf-vein"),
      "#bbf7d0",
    );
    program.uniforms.uDeep.value = rgb(
      css.getPropertyValue("--leaf-deep"),
      "#15803d",
    );
    program.uniforms.uFold.value =
      Number.parseFloat(css.getPropertyValue("--leaf-fold")) || 0.8;
    ambientAlpha =
      Number.parseFloat(css.getPropertyValue("--leaf-ambient-alpha")) || 0.5;
  }

  // ---- The timeline ----
  let T = 0; // our own clock: it stops while the tab is hidden or the art box is off screen
  let stage: Stage = "leaf";
  let stageStart = 0;
  let stageLength = Number.POSITIVE_INFINITY;

  function alongOf(
    values: Float32Array,
    idx: ArrayLike<number>,
  ): (i: number) => number {
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let k = 0; k < idx.length; k++) {
      const v = values[idx[k]];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return (i) => (values[i] - lo) / (hi - lo || 1);
  }
  const all = Int32Array.from({ length: COUNT }, (_, i) => i);

  /**
   * The gusts: a dozen sources round the edges of the viewport (and two behind the header), each launching its leaves
   * as one ribbon, a little apart in time and each bent its own way, so the opening reads as several gusts carrying
   * leaves in rather than a uniform implosion. A source is a point on the perimeter, chosen by the edges' lengths.
   */
  let gusts: Gust[] = [];
  function makeGusts() {
    const onEdge = (k: number): [number, number, number, number] => {
      const m = 40;
      if (k < W) return [k - W / 2, H / 2 + m, 1, 0]; // top: [x, y, along-edge x, along-edge y]
      k -= W;
      if (k < W) return [k - W / 2, -H / 2 - m, 1, 0]; // bottom
      k -= W;
      if (k < H) return [-W / 2 - m, k - H / 2, 0, 1]; // left
      return [W / 2 + m, k - H - H / 2, 0, 1]; // right
    };
    const per = 2 * (W + H);
    gusts = Array.from({ length: GUSTS }, (_, g) => {
      const [x, y, ex, ey] = onEdge(((g + Math.random() * 0.8) / GUSTS) * per);
      return {
        x,
        y,
        ex,
        ey,
        spread: 60 + Math.random() * 120,
        offset: Math.random() * 0.35,
        curl: (g % 3 === 2 ? -1 : 1) * (0.2 + Math.random() * 0.3),
      };
    });
    // Two from behind the header: the leaves appear from under the glass.
    for (let h = 0; h < 2; h++) {
      gusts.push({
        x: (Math.random() - 0.5) * W * 0.8,
        y: H / 2 - headerH * 0.5,
        ex: 1,
        ey: 0,
        spread: 160,
        offset: 0.1 + Math.random() * 0.2,
        curl: 0.25,
        header: true,
      });
    }
  }
  function spawnFrom(g: Gust): [number, number] {
    const s = (Math.random() + Math.random() - 1) * g.spread;
    const out = g.header ? 0 : Math.random() * 50;
    // Outward from the edge: away from the viewport's centre.
    const offX = g.ex ? 0 : Math.sign(g.x) * out;
    const offY = g.ey ? 0 : Math.sign(g.y) * out;
    return [g.x + g.ex * s + offX, g.y + g.ey * s + offY];
  }

  /**
   * Begin a stage: every leaf starts from where it is now and heads for that stage's goal. `quick` re-fits after a
   * resize (no stagger); `gustIn` is the opening, where the leaves sweep in from every edge of the page.
   */
  function enter(
    name: Stage,
    { quick = false, gustIn = false }: EnterOptions = {},
  ) {
    stage = name;
    stageStart = T;
    for (let i = 0; i < COUNT; i++) {
      sx[i] = px[i];
      sy[i] = py[i];
      sa[i] = pa[i];
      ss[i] = ps[i];
      sz[i] = pz[i];
      gust[i] = 0;
      dips[i] = 0;
    }
    let longest = 0;
    const set = (i: number, d: number, du: number, sw: number) => {
      delay[i] = quick ? 0 : d;
      dur[i] = quick ? 0.6 : du;
      swirl[i] = quick ? 0 : sw;
      longest = Math.max(longest, delay[i] + dur[i]);
    };

    if (name === "leaf") {
      const along = alongOf(
        leafY,
        all.filter((i) => leafKind[i]),
      );
      for (let i = 0; i < COUNT; i++) {
        const k = leafKind[i];
        drifts[i] = k ? 0 : 1;
        gx[i] = leafX[i];
        gy[i] = leafY[i];
        ga[i] = k === LeafKind.Vein ? 1 : k ? 0.92 : ambientAlphaOf(i);
        gs[i] = k === LeafKind.Vein ? 1 : k ? -0.18 : 0;
        gz[i] = k === LeafKind.Vein ? 1.15 : k ? 2.3 : 1;
        const a = k ? along(i) : 0;
        // The structure first, stem to tip, then the blade, the margin last; the ambient leaves throughout.
        const order =
          k === LeafKind.Vein
            ? a * 0.5 + Math.random() * 0.2
            : k === LeafKind.Blade
              ? 0.5 + a * 0.35 + Math.random() * 0.35
              : k === LeafKind.Margin
                ? 0.8 + Math.random() * 0.3
                : Math.random() * 1.2;
        if (gustIn) {
          // The gust: from every edge on a curved path.
          const g = gusts[Math.floor(Math.random() * gusts.length)];
          const [x0, y0] = spawnFrom(g);
          sx[i] = x0;
          sy[i] = y0;
          sa[i] = 0;
          ss[i] = 0; // in flight a leaf is its own green; it lights up as a vein, or deepens as blade, as it lands
          sz[i] = 1;
          gust[i] = 1;
          const tx = k ? ax + gx[i] : driftX(i, T);
          const ty = k ? ay + gy[i] : driftY(i, T);
          const dx = tx - x0;
          const dy = ty - y0;
          // A gust's leaves bend the same way, give or take a little.
          const curl = g.curl + (Math.random() - 0.5) * 0.12;
          cx[i] = x0 + dx * 0.5 - dy * curl;
          cy[i] = y0 + dy * 0.5 + dx * curl;
          // Each gust sets off at its own moment, the top left a little before the rest of the page.
          const wave =
            g.offset * 0.6 +
            0.12 * clamp01((x0 / W + 0.5) * 0.5 + (0.5 - y0 / H) * 0.5);
          set(
            i,
            wave + order,
            (k === LeafKind.Vein ? 1.2 : k ? 1.0 : 1.5) + Math.random() * 0.3,
            0,
          );
        } else {
          // The wordmark flowing back into the leaf: the same order as the entrance, each letter's leaf sweeping in
          // on its own arc, so the leaf builds stem-up from the text rather than collapsing onto it.
          set(i, order, 1.2 + Math.random() * 0.6, (Math.random() - 0.5) * 0.6);
        }
      }
    } else if (name === "graph") {
      const along = alongOf(graphY, shapeIndex);
      const alongLeaf = alongOf(
        leafY,
        all.filter((i) => leafKind[i]),
      );
      for (let i = 0; i < COUNT; i++) {
        if (isShape[i]) {
          drifts[i] = 0;
          gx[i] = graphX[i];
          gy[i] = graphY[i];
          ga[i] = 1;
          // A shorter stagger, so the top of the graph settles sooner; the blade's leaves fade a little mid-move,
          // so the dissolving upper leaf is a haze rather than a cloud.
          dips[i] = leafKind[i] >= LeafKind.Blade ? 1 : 0;
          set(
            i,
            along(i) * 0.8 + Math.random() * 0.2,
            1.0 + Math.random() * 0.5,
            (Math.random() - 0.5) * (leafKind[i] === LeafKind.Vein ? 0.1 : 0.3),
          );
        } else {
          drifts[i] = 1;
          ga[i] = ambientAlphaOf(i);
          set(
            i,
            (leafKind[i] ? alongLeaf(i) * 0.6 : 0) + Math.random() * 0.4,
            1.6 + Math.random() * 0.9,
            (Math.random() - 0.5) * 0.4,
          );
        }
        gs[i] = 0;
        gz[i] = 1;
      }
    } else {
      // The wordmark, written left to right: leaves and letters paired in order of x.
      const target = sampleWord(shapeIndex.length);
      const bySource = Array.from(shapeIndex).sort((a, b) => px[a] - px[b]);
      const byTarget = Int32Array.from(
        { length: shapeIndex.length },
        (_, k) => k,
      ).sort((a, b) => target[a * 2] - target[b * 2]);
      let lo = Number.POSITIVE_INFINITY;
      let hi = Number.NEGATIVE_INFINITY;
      for (let k = 0; k < byTarget.length; k++) {
        lo = Math.min(lo, target[k * 2]);
        hi = Math.max(hi, target[k * 2]);
      }
      for (let k = 0; k < bySource.length; k++) {
        const i = bySource[k];
        const j = byTarget[k];
        drifts[i] = 0;
        gx[i] = target[j * 2];
        gy[i] = target[j * 2 + 1];
        ga[i] = 1;
        gs[i] = 0;
        gz[i] = 1;
        set(
          i,
          ((gx[i] - lo) / (hi - lo || 1)) * 1.0 + Math.random() * 0.3,
          1.2 + Math.random() * 0.7,
          (Math.random() - 0.5) * 0.5,
        );
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
    // HOLD is wall-clock seconds; T runs at 1/PACE of the wall clock.
    stageLength = longest + HOLD / PACE;
  }

  // ---- Pointer: over the art box and a 40 px margin round it ----
  const pointer = { x: 0, y: 0, active: false, nx: 0, ny: 0 };
  const parallax = [0, 0];
  addEventListener(
    "pointermove",
    (event) => {
      pointer.x = event.clientX - W / 2;
      pointer.y = H / 2 - event.clientY;
      pointer.active =
        Math.abs(pointer.x - ax) < AW / 2 + 40 &&
        Math.abs(pointer.y - ay) < AH / 2 + 40;
      pointer.nx = Math.max(-1, Math.min(1, (pointer.x - ax) / (AW / 2)));
      pointer.ny = Math.max(-1, Math.min(1, (pointer.y - ay) / (AH / 2)));
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    pointer.active = false;
  });

  // ---- One simulation step ----
  function step(dt: number) {
    if (T - stageStart > stageLength) enter(NEXT_STAGE[stage]);
    const local = T - stageStart;
    const reach = (3 * POINTER.sigma) ** 2;
    const inv2s2 = 1 / (2 * POINTER.sigma * POINTER.sigma);

    for (let i = 0; i < COUNT; i++) {
      const p = clamp01((local - delay[i]) / dur[i]);
      const goalX = drifts[i] ? driftX(i, T) : ax + gx[i];
      const goalY = drifts[i] ? driftY(i, T) : ay + gy[i];
      let x: number;
      let y: number;
      let flight: number;
      if (gust[i]) {
        // A quadratic path from the edge, bent by the gust: picking up speed, then decelerating into place with a
        // slight overshoot, so the sweep across the page is seen rather than over in a blink.
        const e = easeOutBack(p ** 1.5);
        const q = Math.min(e, 1);
        const u = 1 - q;
        x = u * u * sx[i] + 2 * u * q * cx[i] + q * q * goalX;
        y = u * u * sy[i] + 2 * u * q * cy[i] + q * q * goalY;
        if (e > 1) {
          const tx = goalX - cx[i];
          const ty = goalY - cy[i];
          const tl = Math.hypot(tx, ty) || 1;
          x += (tx / tl) * (e - 1) * tl;
          y += (ty / tl) * (e - 1) * tl;
        }
        // The wind: a slow, coherent wobble, strongest mid-flight, shared by leaves that set off near each other.
        const w = Math.sin(Math.PI * q) * 26;
        x += Math.sin(sx[i] * 0.005 + T * 1.4 + dph[i] * 0.5) * w;
        y += Math.cos(sy[i] * 0.005 + T * 1.1 + dph[i] * 0.5) * w;
        flight = 1 - q;
      } else {
        const e = easeInOutCubic(p);
        const dx = goalX - sx[i];
        const dy = goalY - sy[i];
        const arc = Math.sin(Math.PI * e) * swirl[i];
        x = sx[i] + dx * e - dy * arc;
        y = sy[i] + dy * e + dx * arc;
        flight = Math.sin(Math.PI * e) * 0.35;
      }
      const flutter = 0.6 + 1.6 * flight;
      x += Math.sin(T * 1.3 + dph[i] * 5) * flutter;
      y += Math.cos(T * 1.1 + dph[i] * 7) * flutter;
      px[i] = x;
      py[i] = y;
      // Colour, size and opacity change early in each move (in the first quarter of the fly-in), so a leaf arriving
      // is visible at once and a dissolving blade thins out early.
      const early = clamp01(
        (local - delay[i]) / (dur[i] * (gust[i] ? 0.25 : 0.55)),
      );
      pa[i] = sa[i] + (ga[i] - sa[i]) * early;
      let shown = pa[i];
      if (dips[i]) shown *= 1 - 0.45 * Math.sin(Math.PI * p);
      // How far down a fly-in leaf is: landed, a leaf is inside the art box's soft edge.
      const down = gust[i] ? smooth(0.85, 1, p) : 1;
      // In the fly-in, colour and size follow the landing, not the clock: a vein lights up as its leaves arrive.
      const look = gust[i] ? clamp01((p - 0.55) / 0.45) : early;
      ps[i] = ss[i] + (gs[i] - ss[i]) * look;
      pz[i] = sz[i] + (gz[i] - sz[i]) * look;
      // Tumbling: fast spin and turning edge-on in flight, slowing as the leaf lands.
      angle[i] += spin[i] * (1 + 9 * flight) * dt;
      flip[i] += flipRate[i] * flight * dt;
      const width = 1 - 0.85 * flight * Math.abs(Math.sin(flip[i]));

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

      const fx = x + ox[i];
      const fy = y + oy[i];
      position[i * 3] = fx;
      position[i * 3 + 1] = fy;
      position[i * 3 + 2] = shown * (1 - down + down * artMask(fx, fy));
      dyn[i * 4] = ps[i];
      dyn[i * 4 + 1] = pz[i];
      dyn[i * 4 + 2] = angle[i];
      dyn[i * 4 + 3] = width;
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

  // ---- Size ----
  // A resize runs only when a size really changed, and inside a frame, so the clear and the redraw land together.
  // A scroll only moves the anchor; it never resizes the canvas.
  let pendingResize = false;
  function applySize() {
    measureLayout();
    makeGusts();
    renderer.setSize(W, H);
    program.uniforms.uRes.value = [W, H];
    driftR = Math.min(AW, AH) * 0.5;
    ({ graphX, graphY, leafX, leafY, leafKind } = buildTargets({
      count: COUNT,
      isShape,
      joinsLeaf,
      scale: shapeScale(AW, AH),
      random: Math.random,
    }));
  }

  // ---- Loop control: a hidden tab, an off-screen art box or reduced motion pauses it, and the clock with it ----
  let raf = 0;
  let last = 0;
  let hidden = document.hidden;
  let offScreen = false;
  let active = true;

  // `last` is the previous frame's timestamp, so T follows the wall clock (at 1/PACE) frame by frame. (The prototype
  // reset it after each frame's own work, which made its clock lose that work's share of every frame: about a fifth on
  // a real GPU, so a "5 s" hold lasted 6 s.) It is reset only on resuming, so a visitor coming back to the tab
  // sees no skipped or rushed transition: the stall adds nothing to T.
  function frame(now: number) {
    raf = 0;
    const dt = clamp(0, 0.05, (now - last) / 1000) / PACE;
    last = now;
    T += dt;
    if (pendingResize) {
      pendingResize = false;
      applySize();
      enter(stage, { quick: true });
    }
    step(dt);
    draw();
    if (running()) raf = requestAnimationFrame(frame);
  }
  const running = () => active && !hidden && !offScreen;
  function schedule() {
    if (raf || !running()) return;
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
  enter("leaf", { gustIn: true });
  schedule();

  const sizes = () =>
    [
      root.clientWidth,
      root.clientHeight,
      art.clientWidth,
      art.clientHeight,
    ].join("x");
  let lastSizes = sizes();
  function onResize() {
    const now = sizes();
    if (now === lastSizes) return; // the first notification on observe() is not a change
    lastSizes = now;
    pendingResize = true;
    schedule();
  }
  new ResizeObserver(onResize).observe(art);
  addEventListener("resize", onResize);
  addEventListener("scroll", measureLayout, { passive: true });
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
    if (hidden) pause();
    else schedule();
  });
  new IntersectionObserver((entries) => {
    offScreen = !entries[entries.length - 1].isIntersecting;
    if (offScreen) pause();
    else schedule();
  }).observe(art);
  new MutationObserver(readTheme).observe(root, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  return {
    setActive(next) {
      active = next;
      if (active) schedule();
      else pause();
    },
  };
}
