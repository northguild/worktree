# Landing particles: prototype notes

**The question:** would a hero of leaf-shaped particles that form shapes look professional enough to replace
`docs/src/components/HeroBranches.astro`? The user found the SVG tree amateurish and pointed at
https://arkt.dev/, which lazy-loads three.js and morphs about 20k WebGL points between shapes sampled from its logo
and digits.

**Open it:** serve the repository root (`python3 -m http.server 8123`) and go to
`http://localhost:8123/prototypes/landing-particles/`. The page needs the server because it reads the font from
`docs/public/fonts/`. The toolbar in the bottom right shows the stage and the fps, and has Replay and a theme toggle.

**Deviation from `/prototype`:** that command allows only plain HTML and CSS with no dependencies. A particle
effect can't be judged as a still sketch, so this mockup has a JavaScript file (`particles.js`) and loads one
library from a CDN. It's still throwaway: nothing in `docs/` imports it.

## What was built

- **The hero after phase 15:** the title, the tagline from `index.mdx` and one "Get started" button, copy on the
  left and the canvas on the right. It uses `Hero.astro`'s grid: 1.05fr / 1fr from 50rem up, stacked below that.
- **Leaves, not dots.**
  - Each particle is a point sprite. The fragment shader cuts it into a leaf shape, pointed at both ends, with one
    half shaded as if folded along the midrib. The rib itself shows on sprites of 10 device px or larger.
  - Every leaf has its own rotation, spin, flutter, size and depth.
  - About 5% of the ambient leaves are "near": larger (10–16 px), fainter and softened, which gives a depth-of-field
    look.
  - Pointer parallax moves leaves by their depth.
- **The sequence, looping:**
  1. A three-armed vortex of leaves, held for 0.5 s on load and 1.4 s on each loop after that.
  2. The leaves gather into a **git graph**, growing from the bottom of `main` upward. The graph is the trunk, a
     long branch ending at HEAD (filled, with a ring), a short branch forking off that, and one that merges back.
     Commits are rings, with a gap where each line meets a commit. Held 5 s.
  3. The leaves morph into the **`worktree` wordmark** in Michroma, writing left to right. Held 4 s.
  4. The leaves scatter back into the vortex.
- **How the morphs flow:**
  - Particles and targets are paired in order along the axis the shape builds on: y for the graph, x for the
    wordmark. That keeps paths short and coherent.
  - Each particle has its own delay along that axis, eases with an in-out cubic, and arcs slightly sideways so the
    motion swirls rather than slides.
- **Interaction:** the pointer pushes leaves within 80 px; a damped spring brings each one home.
- **Behaviour:**
  - It starts after the first paint, behind a requestAnimationFrame and a setTimeout.
  - It pauses when the canvas is off screen (IntersectionObserver) or the tab is hidden, and its clock pauses with it.
  - DPR is capped at 2, and the canvas is `aria-hidden`.
  - With `prefers-reduced-motion: reduce`, it draws the formed graph once and stays still.
  - Without WebGL, it shows a plain message for now. The real page needs a still image there (see below).
  - It re-tints when `data-theme` changes and re-fits the shapes when the box resizes.
- **Shapes** are drawn with Canvas 2D on an offscreen canvas at the box's size, then sampled pixel by pixel. The
  graph and the wordmark go through the same sampler, so any new shape is one draw function.

## Numbers

| | |
|---|---|
| Library | **OGL 1.0.11** (`ogl@latest` on npm, published 2025-01-27). Only `Renderer`, `Program`, `Geometry` and `Mesh` are used. |
| OGL size, tree-shaken | **12.7 KB gzipped** (44.1 KB minified): esbuild 0.28.2 bundling only those four classes, `gzip -9`. |
| OGL size, whole | 39.3 KB gzipped: jsDelivr's `+esm` bundle of the whole library, for comparison. |
| What the prototype loads | 16 module files from jsDelivr, 30.0 KB of bodies as served, as a waterfall of relative imports. Fine for a sketch; the real page should bundle them. |
| `particles.js` | 23.5 KB of source, unminified. |
| Particles | **8,000** when `innerWidth` is 760 or more; **3,000** below that. 80% form the shapes, 20% are the ambient cloud. |
| Frame rate | 42–60 fps at 8,000 and 49–60 at 3,000 (1280×820 and 390×844, DPR 2). **Not representative:** measured in headless Chromium on SwiftShader (software WebGL), and screenshots stall the GPU while they're taken. A real GPU needs measuring in phase 16. The simulation runs on the CPU: one loop over every particle per frame, then one buffer upload. |
| Art box | 544×635 CSS px at 1280 wide; 358×418 at 390 wide. Aspect ratio 6:7, as the SVG had. |

Screenshots of every stage in both themes, at 1280 and 390 wide and under reduced motion, were taken while building
this. They are not kept in this folder.

## How it looks, honestly

- **The graph** reads as a git graph immediately in both themes, and the leaf texture shows at DPR 2. At DPR 1 the
  smallest leaves are only 3–5 device px and read as specks; the texture survives, but individual leaves don't.
- **The wordmark** reads clearly at desktop width. At 390 wide it's legible but its edges are fuzzy, because the
  letters are about 30 px tall and only a few leaves deep.
- **The vortex** looks good. It reads more like a galaxy than leaves in the wind, which may or may not be the mood
  wanted.
- **The light theme** works: the deep greens read on white, and the ambient leaves become a pale, airy wash.
- **The pointer** leaves a hard-edged round hole while it is still. That's typical of a repel effect; a softer edge
  would need a falloff or some noise.
- **The trunk looks dotted** because of the gaps between the line and each commit ring. That's deliberate, but with
  seven commits on `main` it's busy.

## Invented values

Every one is marked `INVENTED` in `theme.css`:

- the leaf palette (`--leaf-2` to `--leaf-6`, per theme; `--leaf-1` is `--gmt-spring`), with tone weights of
  30/22/16/14/12/6%;
- the shading on a leaf's folded half (`--leaf-fold`) and the ambient alpha;
- the art box's aspect ratio and the radial fade at its edges;
- the mockup's own header and toolbar.

The timings, counts, sizes, the pointer spring and the graph's layout are proposals, in the *Tuning* block and in
`drawGraph` in `particles.js`.

## What phase 16 must decide

1. **Bundle or CDN.** Import `ogl` through Vite so it's one hashed, tree-shaken chunk (about 12.7 KB gzipped)
   loaded with `import()` on the landing only, never on docs pages (D6). Or write raw WebGL2: about 3 KB, but
   it's our code to maintain. This prototype used OGL only as boilerplate (context, program, buffers), so either
   works.
2. **The landing's size budget.** Phase 14's done-when ("within 10% of 37,566 B plus the SVG") no longer holds. A
   new number is needed: roughly the page, plus OGL, plus the effect minified, minus the SVG's markup.
3. **The fallback without WebGL.** It should be a real still image of the formed graph: an SVG or an image
   generated from the same `drawGraph`. The reduced-motion path could use that image too, so motion-averse
   visitors don't load the library at all.
4. **The decision to record:** JavaScript on the landing, deferred until after the first paint, landing-only, with
   a still fallback. This reverses phase 14's "SVG and CSS only" and needs recording in plan #235.
5. **The shapes.** Does the graph match the sidebar's motif closely enough, or should it reuse the sidebar's
   diamond for a group? Should there be a third shape, for example the NorthGuild mark? And is a 10 s loop right,
   or should it form once and then idle?
6. **Leaf size at DPR 1:** raise the minimum size on 1× screens so the leaf shape survives, or accept specks.
7. **Performance on low-end devices:** measure a real phone. Then decide whether 3,000 is right, and whether to
   drop the count on a frame-time budget.
8. **The pointer on touch:** dragging pushes leaves, which is nice, but check it doesn't fight page scroll on a
   phone, where the canvas sits below the copy.

**When the feature ships**, delete this folder and every citation of it.
