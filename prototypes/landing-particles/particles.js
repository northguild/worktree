/*
 * Leaf particles for the landing hero: a prototype, not the implementation.
 *
 * Several thousand leaf-shaped point sprites in a range of greens. They drift as a slow vortex, gather into a git
 * graph (main as the trunk, branches forking off, commits as rings, HEAD filled), morph into the "worktree" wordmark,
 * scatter, and loop. The pointer pushes leaves away; they spring back.
 *
 * Rendering is OGL 1.0.11 (Renderer, Program, Geometry, Mesh only), with the simulation on the CPU: one Float32Array
 * of positions is uploaded per frame. GLSL ES 1.00 so it runs on WebGL 1 as well as 2.
 *
 * Coordinates: CSS pixels, origin at the centre of the canvas, y up.
 */

const OGL = "https://cdn.jsdelivr.net/npm/ogl@1.0.11/src/core/";

const canvas = document.getElementById("leaves");
const art = canvas.parentElement;
const fallback = document.getElementById("leaves-fallback");
const stageOut = document.getElementById("proto-stage");
const fpsOut = document.getElementById("proto-fps");
const replayButton = document.getElementById("proto-replay");
const root = document.documentElement;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutCubic = (p) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

// ---- Tuning (every number here is a proposal) ----
const PHONE = innerWidth < 760;
const COUNT = PHONE ? 3000 : 8000;
const SHAPE_SHARE = 0.8; // the rest drift as an ambient cloud and never join a shape
const NEAR_SHARE = 0.05; // ambient leaves close to the viewer: large, soft, faint (depth of field)
const HOLD = { cloud: 1.4, graph: 5.0, word: 4.0 };
const INTRO_HOLD = 0.5; // the first cloud is brief: the graph is the first impression
const SEQUENCE = ["graph", "word", "cloud"];
const POINTER = { radius: 80, push: 2600, spring: 30, damping: 7.5 };

const vertex = /* glsl */ `
  attribute vec3 position; // x, y (CSS px, centred, y up), alpha
  attribute vec4 aRand;    // rotation phase, spin, flutter phase, brightness
  attribute float aSize;   // CSS px
  attribute float aDepth;  // -1 far .. 1 near
  attribute float aTone;   // palette index 0..5

  uniform vec2 uRes;
  uniform float uDpr;
  uniform float uTime;
  uniform vec2 uParallax;
  uniform vec3 uPalette[6];

  varying vec3 vColor;
  varying float vAlpha;
  varying float vAngle;
  varying float vPx;
  varying float vBlur;

  void main() {
    vec2 p = position.xy + aDepth * uParallax;
    gl_Position = vec4(p / (uRes * 0.5), 0.0, 1.0);

    float near = smoothstep(0.78, 1.0, aDepth);
    vPx = aSize * (1.0 + 0.22 * aDepth) * uDpr;
    gl_PointSize = vPx;

    vColor = uPalette[int(aTone + 0.5)] * (0.88 + 0.24 * aRand.w);
    vAlpha = position.z * mix(1.0, 0.4, near);
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

  // The display face for the wordmark; the system mono if it will not load.
  let wordFont = "Michroma";
  try {
    await document.fonts.load('400 100px "Michroma"');
    if (!document.fonts.check('400 100px "Michroma"')) wordFont = "monospace";
  } catch {
    wordFont = "monospace";
  }

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
    const shape = i < COUNT * SHAPE_SHARE;
    const near = !shape && Math.random() < NEAR_SHARE / (1 - SHAPE_SHARE);
    const depth = shape ? (Math.random() * 2 - 1) * 0.4 : near ? 0.8 + Math.random() * 0.2 : Math.random() * 1.5 - 0.9;
    const size = shape
      ? 2.6 + 3.4 * Math.random() ** 1.7
      : near
        ? 10 + 6 * Math.random()
        : 2.4 + 3.8 * Math.random() ** 1.4;
    specs.push({ shape, depth, size, tone: pickTone() });
  }
  specs.sort((a, b) => a.depth - b.depth);

  const position = new Float32Array(COUNT * 3);
  const aRand = new Float32Array(COUNT * 4);
  const aSize = new Float32Array(COUNT);
  const aDepth = new Float32Array(COUNT);
  const aTone = new Float32Array(COUNT);
  const isShape = new Uint8Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const s = specs[i];
    aRand.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    aSize[i] = s.size;
    aDepth[i] = s.depth;
    aTone[i] = s.tone;
    isShape[i] = s.shape ? 1 : 0;
  }
  const shapeIndex = Int32Array.from({ length: COUNT }, (_, i) => i).filter((i) => isShape[i]);

  // ---- Per-particle simulation state ----
  const px = new Float32Array(COUNT); // base position (no pointer offset)
  const py = new Float32Array(COUNT);
  const sx = new Float32Array(COUNT); // where the current transition started
  const sy = new Float32Array(COUNT);
  const tx = new Float32Array(COUNT); // the shape target
  const ty = new Float32Array(COUNT);
  const ox = new Float32Array(COUNT); // pointer offset and its velocity
  const oy = new Float32Array(COUNT);
  const vx = new Float32Array(COUNT);
  const vy = new Float32Array(COUNT);
  const delay = new Float32Array(COUNT);
  const dur = new Float32Array(COUNT);
  const swirl = new Float32Array(COUNT);
  // The vortex: three loose spiral arms, turning faster near the centre.
  const cr = new Float32Array(COUNT);
  const ca = new Float32Array(COUNT);
  const cw = new Float32Array(COUNT);
  const cph = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const r = Math.sqrt(Math.random());
    const arm = Math.floor(Math.random() * 3);
    const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.45;
    cr[i] = isShape[i] ? 0.06 + 0.94 * r : 0.3 + 0.9 * r;
    ca[i] = (arm * TAU) / 3 + cr[i] * 4.2 + spread;
    cw[i] = 0.16 / (0.35 + cr[i]);
    cph[i] = Math.random() * TAU;
  }

  let W = 1;
  let H = 1;
  let cloudR = 1;

  const cloudX = (i, t) => {
    const a = ca[i] + t * cw[i];
    const r = cloudR * cr[i] * (1 + 0.05 * Math.sin(t * 0.5 + cph[i]));
    return Math.cos(a) * r + Math.sin(t * 0.37 + cph[i] * 2) * 5;
  };
  const cloudY = (i, t) => {
    const a = ca[i] + t * cw[i];
    const r = cloudR * cr[i] * (1 + 0.05 * Math.sin(t * 0.5 + cph[i]));
    return Math.sin(a) * r * 0.84 + Math.cos(t * 0.29 + cph[i] * 3) * 5;
  };

  // ---- Shapes: drawn to an offscreen 2D canvas at the box's size, then sampled pixel by pixel ----
  function sample(draw, n) {
    const w = Math.max(1, Math.ceil(W));
    const h = Math.max(1, Math.ceil(H));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    draw(ctx, w, h);
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

  // The git graph: main up the left, three branches, one merged back, HEAD at the top of the longest.
  function drawGraph(ctx, w, h) {
    const s = Math.min(w / 380, h / 470) * 0.86;
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    const L = [-112, -37, 38, 113];
    const elbow = (x0, y0, x1, y1) => {
      const m = (y0 + y1) / 2;
      ctx.bezierCurveTo(x0, m, x1, m, x1, y1);
    };
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 7;
    ctx.beginPath();
    // main
    ctx.moveTo(L[0], 215);
    ctx.lineTo(L[0], -215);
    // feat: forks low, runs longest, ends at HEAD
    ctx.moveTo(L[0], 150);
    elbow(L[0], 150, L[2], 88);
    ctx.lineTo(L[2], -150);
    // fix: forks off feat, short
    ctx.moveTo(L[2], 40);
    elbow(L[2], 40, L[3], -22);
    ctx.lineTo(L[3], -95);
    // chore: forks off main and merges back
    ctx.moveTo(L[0], 80);
    elbow(L[0], 80, L[1], 28);
    ctx.lineTo(L[1], -8);
    elbow(L[1], -8, L[0], -60);
    ctx.stroke();

    const rings = [
      [L[0], 190],
      [L[0], 150],
      [L[0], 80],
      [L[0], 10],
      [L[0], -60],
      [L[0], -130],
      [L[0], -198],
      [L[2], 40],
      [L[2], -48],
      [L[3], -95],
      [L[1], 10],
    ];
    const head = [L[2], -150];
    // A gap where each line meets a commit, then the commit itself.
    ctx.globalCompositeOperation = "destination-out";
    for (const [x, y] of rings) {
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(head[0], head[1], 25, 0, TAU);
    ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.lineWidth = 5.5;
    for (const [x, y] of rings) {
      ctx.beginPath();
      ctx.arc(x, y, 11.5, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(head[0], head[1], 10, 0, TAU);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(head[0], head[1], 19, 0, TAU);
    ctx.stroke();
  }

  function drawWord(ctx, w, h) {
    const text = "worktree";
    ctx.font = `400 100px "${wordFont}"`;
    const width = ctx.measureText(text).width || 1;
    const size = (100 * w * 0.84) / width;
    ctx.font = `400 ${size}px "${wordFont}"`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h / 2);
    // Michroma has one weight; a thin stroke round the glyphs gives the leaves a little more room.
    ctx.lineWidth = size * 0.035;
    ctx.lineJoin = "round";
    ctx.strokeText(text, w / 2, h / 2);
  }

  let targets = {};
  const buildTargets = () => {
    targets = {
      graph: sample(drawGraph, shapeIndex.length),
      word: sample(drawWord, shapeIndex.length),
    };
  };

  // ---- GL ----
  const geometry = new Geometry(gl, {
    position: { size: 3, data: position, usage: gl.DYNAMIC_DRAW },
    aRand: { size: 4, data: aRand },
    aSize: { size: 1, data: aSize },
    aDepth: { size: 1, data: aDepth },
    aTone: { size: 1, data: aTone },
  });
  const palette = Array.from({ length: 6 }, () => [0, 0, 0]);
  const program = new Program(gl, {
    vertex,
    fragment,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uRes: { value: [1, 1] },
      uDpr: { value: dpr },
      uTime: { value: 0 },
      uParallax: { value: [0, 0] },
      uPalette: { value: palette.flat() },
      uFold: { value: 0.8 },
    },
  });
  const mesh = new Mesh(gl, { mode: gl.POINTS, geometry, program });

  // Colours come from theme.css, so the toggle (and the real site's picker) re-tints the leaves.
  const probe = document.createElement("canvas").getContext("2d");
  let ambientAlpha = 0.5;
  function readTheme() {
    const css = getComputedStyle(root);
    const flat = [];
    for (let i = 1; i <= 6; i++) {
      probe.fillStyle = "#000";
      probe.fillStyle = css.getPropertyValue(`--leaf-${i}`).trim() || "#4ade80";
      const hex = probe.fillStyle; // normalised to #rrggbb
      flat.push(
        Number.parseInt(hex.slice(1, 3), 16) / 255,
        Number.parseInt(hex.slice(3, 5), 16) / 255,
        Number.parseInt(hex.slice(5, 7), 16) / 255,
      );
    }
    program.uniforms.uPalette.value = flat;
    program.uniforms.uFold.value = Number.parseFloat(css.getPropertyValue("--leaf-fold")) || 0.8;
    ambientAlpha = Number.parseFloat(css.getPropertyValue("--leaf-ambient-alpha")) || 0.5;
  }

  // ---- The timeline ----
  const shapeStage = (name) => name === "graph" || name === "word";
  let T = 0; // our own clock: it stops while the canvas is off screen or the tab is hidden
  let stage = "cloud";
  let previous = "cloud";
  let stageStart = 0;
  let stageLength = HOLD.cloud;
  let sequenceAt = -1;

  function enter(name, { quick = false } = {}) {
    previous = quick ? previous : stage;
    stage = name;
    stageStart = T;
    for (let i = 0; i < COUNT; i++) {
      sx[i] = px[i];
      sy[i] = py[i];
    }
    let longest = 0;
    if (shapeStage(name)) {
      const target = targets[name];
      const n = shapeIndex.length;
      // Pair particles and targets in the same order along the axis the shape builds along, so the flow is coherent:
      // the graph grows from the bottom (y), the word writes itself left to right (x).
      const axis = name === "graph" ? 1 : 0;
      const bySource = Array.from(shapeIndex).sort((a, b) => (axis ? py[a] - py[b] : px[a] - px[b]));
      const byTarget = Int32Array.from({ length: n }, (_, k) => k).sort((a, b) => target[a * 2 + axis] - target[b * 2 + axis]);
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = 0; k < n; k++) {
        const v = target[k * 2 + axis];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      for (let k = 0; k < n; k++) {
        const i = bySource[k];
        const j = byTarget[k];
        tx[i] = target[j * 2];
        ty[i] = target[j * 2 + 1];
        const along = (target[j * 2 + axis] - lo) / (hi - lo || 1);
        delay[i] = quick ? 0 : (name === "graph" ? along * 1.2 : along * 1.0) + Math.random() * 0.3;
        dur[i] = quick ? 0.7 : 1.2 + Math.random() * 0.7;
        swirl[i] = quick ? 0 : (Math.random() - 0.5) * 0.5;
        longest = Math.max(longest, delay[i] + dur[i]);
      }
    } else {
      for (const i of shapeIndex) {
        delay[i] = quick ? 0 : Math.random() * 0.5;
        dur[i] = quick ? 0.7 : 1.8 + Math.random() * 0.9;
        swirl[i] = quick ? 0 : (Math.random() - 0.5) * 0.7;
        longest = Math.max(longest, delay[i] + dur[i]);
      }
    }
    stageLength = longest + HOLD[name];
    stageOut.value = name;
  }

  function advance() {
    sequenceAt = (sequenceAt + 1) % SEQUENCE.length;
    enter(SEQUENCE[sequenceAt]);
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
    if (T - stageStart > stageLength) advance();
    const local = T - stageStart;
    const toShape = shapeStage(stage);
    const fromShape = shapeStage(previous);
    const fade = clamp01(T / 1.2);
    const R2 = POINTER.radius * POINTER.radius;

    for (let i = 0; i < COUNT; i++) {
      let x;
      let y;
      let alpha;
      if (!isShape[i]) {
        x = cloudX(i, T);
        y = cloudY(i, T);
        alpha = ambientAlpha * (0.55 + 0.45 * (1 - Math.abs(aDepth[i])));
      } else {
        const e = easeInOutCubic(clamp01((local - delay[i]) / dur[i]));
        const gx = toShape ? tx[i] : cloudX(i, T);
        const gy = toShape ? ty[i] : cloudY(i, T);
        const dx = gx - sx[i];
        const dy = gy - sy[i];
        const arc = Math.sin(Math.PI * e) * swirl[i];
        x = sx[i] + dx * e - dy * arc;
        y = sy[i] + dy * e + dx * arc;
        const formed = toShape ? (fromShape ? 1 : e) : fromShape ? 1 - e : 0;
        const flutter = 0.6 + 2.2 * (1 - formed);
        x += Math.sin(T * 1.3 + cph[i] * 5) * flutter;
        y += Math.cos(T * 1.1 + cph[i] * 7) * flutter;
        alpha = 0.72 + 0.28 * formed;
      }
      px[i] = x;
      py[i] = y;

      // The pointer pushes; a damped spring brings each leaf home.
      if (pointer.active) {
        const ddx = x + ox[i] - pointer.x;
        const ddy = y + oy[i] - pointer.y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < R2) {
          const d = Math.sqrt(d2) + 0.001;
          const f = (1 - d / POINTER.radius) ** 2 * POINTER.push * dt;
          vx[i] += (ddx / d) * f;
          vy[i] += (ddy / d) * f;
        }
      }
      vx[i] += (-POINTER.spring * ox[i] - POINTER.damping * vx[i]) * dt;
      vy[i] += (-POINTER.spring * oy[i] - POINTER.damping * vy[i]) * dt;
      ox[i] += vx[i] * dt;
      oy[i] += vy[i] * dt;

      position[i * 3] = x + ox[i];
      position[i * 3 + 1] = y + oy[i];
      position[i * 3 + 2] = alpha * fade;
    }

    // Depth parallax follows the pointer, and sways slowly without one.
    const goalX = pointer.active ? pointer.nx * 12 : Math.sin(T * 0.21) * 4;
    const goalY = pointer.active ? pointer.ny * 9 : Math.cos(T * 0.17) * 3;
    parallax[0] += (goalX - parallax[0]) * Math.min(1, dt * 3);
    parallax[1] += (goalY - parallax[1]) * Math.min(1, dt * 3);
  }

  function draw() {
    geometry.attributes.position.needsUpdate = true;
    program.uniforms.uTime.value = T;
    program.uniforms.uParallax.value = parallax;
    renderer.render({ scene: mesh });
  }

  // Reduced motion: the formed graph, drawn once, still.
  function drawStill() {
    const g = targets.graph;
    shapeIndex.forEach((i, k) => {
      position[i * 3] = g[k * 2];
      position[i * 3 + 1] = g[k * 2 + 1];
      position[i * 3 + 2] = 1;
    });
    for (let i = 0; i < COUNT; i++) {
      if (isShape[i]) continue;
      position[i * 3] = cloudX(i, 0);
      position[i * 3 + 1] = cloudY(i, 0);
      position[i * 3 + 2] = ambientAlpha * 0.6;
    }
    parallax[0] = 0;
    parallax[1] = 0;
    program.uniforms.uTime.value = 0;
    geometry.attributes.position.needsUpdate = true;
    renderer.render({ scene: mesh });
    stageOut.value = "still (reduced motion)";
  }

  // ---- Loop control: off screen or hidden pauses it ----
  let raf = 0;
  let last = 0;
  let onScreen = true;
  let frames = 0;
  let fpsSince = performance.now();
  let fps = 0;
  let logSince = performance.now();

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    T += dt;
    step(dt);
    draw();
    frames++;
    if (now - fpsSince >= 1000) {
      fps = Math.round((frames * 1000) / (now - fpsSince));
      frames = 0;
      fpsSince = now;
      fpsOut.value = `${fps} fps · ${COUNT}`;
    }
    if (now - logSince >= 2000) {
      console.log(`[particles] fps=${fps} count=${COUNT} stage=${stage} dpr=${dpr} box=${Math.round(W)}x${Math.round(H)}`);
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

  // ---- Size ----
  function resize() {
    W = art.clientWidth;
    H = art.clientHeight;
    renderer.setSize(W, H);
    program.uniforms.uRes.value = [W, H];
    cloudR = Math.min(W, H) * 0.44;
    buildTargets();
  }

  // ---- Start ----
  readTheme();
  resize();
  for (let i = 0; i < COUNT; i++) {
    px[i] = cloudX(i, 0);
    py[i] = cloudY(i, 0);
  }
  enter("cloud");
  stageLength = INTRO_HOLD;

  if (reducedMotion.matches) drawStill();
  schedule();

  let resizeTimer = 0;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resize();
      if (reducedMotion.matches) drawStill();
      else if (shapeStage(stage)) enter(stage, { quick: true });
    }, 120);
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
    for (let i = 0; i < COUNT; i++) {
      px[i] = cloudX(i, T);
      py[i] = cloudY(i, T);
    }
    sequenceAt = -1;
    stage = "cloud";
    enter("cloud");
    stageLength = INTRO_HOLD;
  });

  // For screenshots: jump straight to a formed stage.
  window.__particles = {
    get fps() {
      return fps;
    },
    get stage() {
      return stage;
    },
    count: COUNT,
    goto(name) {
      sequenceAt = SEQUENCE.indexOf(name);
      enter(name);
      stageStart = T - (stageLength - HOLD[name]);
    },
    play(name) {
      sequenceAt = SEQUENCE.indexOf(name);
      enter(name);
    },
  };
}

main().catch((error) => showFallback(error));
