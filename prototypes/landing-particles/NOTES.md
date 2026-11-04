# Landing particles: prototype notes

**The question:** would a hero of leaf-shaped particles that form shapes look professional enough to replace
`docs/src/components/HeroBranches.astro`? The user found the SVG tree amateurish and pointed at
https://arkt.dev/, which lazy-loads three.js and morphs about 20k WebGL points between shapes sampled from its logo
and digits.

**Round 1's verdict (the user):** "That's on the right track! It's a bit glitchy at first but rolls over nicely to
the branch thing. What if it initially forms a large leaf, morphing into the branch?" Then: "it morphs into
'worktree' text also! Very nice touch!" Round 2 below answers both.

**Open it:** serve the repository root (`python3 -m http.server 8123`) and go to
`http://localhost:8123/prototypes/landing-particles/`. The page needs the server because it reads the font from
`docs/public/fonts/`. The toolbar in the bottom right shows the stage and the fps, and has:
- **Settle / Loop**: Settle is the default. Settle plays leaf → graph → wordmark, then rests on the wordmark. Loop
  plays leaf → graph → wordmark → leaf, and repeats.
- **Replay**
- **Theme**

**Deviation from `/prototype`:** that command allows only plain HTML and CSS with no dependencies. A particle
effect can't be judged as a still sketch, so this mockup has a JavaScript file (`particles.js`) and loads one
library from a CDN. It's still throwaway: nothing in `docs/` imports it.

## Round 2: what changed

### The glitch at the start, and its cause

I recorded the first seconds frame by frame from navigation and after Replay, in both themes. In the same runs I
logged long tasks, gaps between frames, and every write to the canvas size. Three real causes came out:

1. **The canvas blinked about 120 ms after it appeared, then stalled.**
   - The ResizeObserver fires once on `observe()` even though nothing has changed, and round 1 treated that as a
     resize.
   - It called `renderer.setSize()` from a timer. Setting a canvas's width clears it, and because the clear came
     from a timer rather than inside a frame, the empty canvas reached the screen before the next frame redrew it.
     That's a one-frame blink of every leaf.
   - It then re-sampled both shapes, which here caused a 100 ms frame gap.
   - The log showed the canvas width set twice in 150 ms, and a 100 ms frame gap straight after.
2. **The opening was a half-visible smear.**
   - The vortex faded in over 1.2 s but began morphing into the graph after 0.5 s.
   - So the first second was leaves at 40% opacity already crossing each other on long paths.
3. **Replay snapped.** It set every leaf straight to its vortex position in one frame, from wherever it was.

The fixes, in the same order:
1. A resize now runs only when the size really changed, and inside a frame, so the clear and the redraw land in the
   same frame. On load the canvas size is written once: 300 (OGL's default), then the box width, before the first
   draw.
2. The vortex is gone. The opening is now the leaf, which drifts in calmly and invisibly at first (below).
3. Replay fades the picture out over 0.3 s, then the leaf drifts in again.

Two more changes are on the same path:
- The OGL modules are now `modulepreload`ed in parallel, where before they were discovered one import at a time.
- Nothing waits for the font any more: the wordmark is sampled when its stage begins.

Two things were not glitches in the effect:
- **A 1.0–1.3 s long task before the first frame.** That's WebGL context creation under SwiftShader. The event log
  in `window.__particles.events` puts it between "ogl imported" and "webgl context".
- **A 50–230 ms gap right after the first frame.** That's the shader being compiled on first draw. Both are typical
  of software GL. On a real GPU, check them in phase 16. The opening's leaves are near-invisible for their first
  frames anyway, so a hitch there doesn't show.

### Opening with a large leaf, which becomes the graph

- **The leaf:**
  - Ovate, pointed, a little asymmetric (the right half is 6% wider, the left 7% narrower), tilted 21° to the
    right, and filling most of the box.
  - A short stem ends exactly on `main`'s first commit, because the leaf and the graph share one coordinate system.
  - A midrib and **5 pairs of lateral veins**, arcing forward towards the margin. Its leaves are dense and lifted
    towards a pale tint (`--leaf-vein`).
  - The blade's leaves are drawn 2.3× larger and pressed slightly deeper (`--leaf-deep`), with a denser margin, so
    the silhouette reads as a solid shape.
- **On load** the leaves drift in from just above their places, fading in, with no spiral.
  - The leaf builds from the stem up, about 0.35 s from bottom to top, and is fully formed in about 1.3–1.6 s.
  - It holds for 2 s, then morphs.
- **How the leaf and the graph are paired, particle by particle** (`buildTargets`):
  - **Main's leaves** sit on the stem and midrib at the same fraction of the way up. The midrib straightens into
    `main` and the stem lands on the first commit.
  - **Each branch's leaves** sit on one right-hand vein, at the same fraction of the way out, bottom to top:
    feat (low) → chore (out) → the chore merge (drawn from `main` outwards) → fix → feat (high, up to HEAD). So
    each vein visibly swings round and straightens into its branch.
  - **The commits' leaves** sit on the left-hand veins (up to 45% of them) and the blade, both paired bottom to top.
    The left half of the leaf collapses onto the commits.
  - **About three quarters of the ambient leaves** (not the near, out-of-focus ones) fill the rest of the blade. When the leaf becomes the graph they drift off
    into the ambient field: they start a little ahead of the veins, and fade within the first half of their move.
  - The leaf side is spaced by rank, not by the graph's own `t`. The graph's lines skip the commits, but the veins
    must not, or the midrib would have gaps.
- **The stagger** is bottom-up, as the graph's growth was in round 1, which the user liked. Vein leaves barely
  swirl (±5% of the path), so the straightening reads; the rest arc ±15%.
- **The ambient field** is no longer a spiral. It's a calm annulus that drifts slowly and is clear in the middle,
  so the graph and the wordmark stand out against it.

### Loop or settle

The default is **Settle**: leaf → graph → wordmark, then it rests on the wordmark with its gentle flutter, depth
parallax and the pointer. **Loop** goes back to the leaf after the wordmark's 4 s hold, and repeats.
- Switching to Loop while resting holds 4 s more, then goes back to the leaf.
- Switching to Settle mid-loop rests at the next wordmark.
- The graph → wordmark morph, written left to right, is round 1's, unchanged.

### Round 1's weaknesses

- **The trunk read as dotted.**
  - `main` now has 5 commits, not 7.
  - Lines run right up to each commit ring's outer edge, where round 1 left a 4 px gap.
  - The trunk is one continuous line with rings on it.
- **A still pointer left a hard-edged hole.**
  - The push now falls off as a Gaussian (σ 42 px) and is weaker.
  - Each leaf yields differently (0.4–1.6×).
  - The force is partly tangential, so the leaves part and swirl round the pointer.
  - The hollow is smaller with a ragged edge. It is still a hollow.
- **The smallest leaves became specks on DPR 1.** No leaf is drawn smaller than 4.5 device px on 1× screens, or
  5 on 2×.
- **Reduced motion** still draws the formed graph once, still: checked in the light theme.

## Numbers

| | |
|---|---|
| Library | **OGL 1.0.11** (`ogl@latest` on npm, published 2025-01-27). Only `Renderer`, `Program`, `Geometry` and `Mesh` are used. |
| OGL size, tree-shaken | **12.7 KB gzipped** (44.1 KB minified): esbuild 0.28.2 bundling only those four classes, `gzip -9`. |
| OGL size, whole | 39.3 KB gzipped: jsDelivr's `+esm` bundle of the whole library, for comparison. |
| What the prototype loads | 16 module files from jsDelivr, 30.0 KB of bodies as served, preloaded in parallel since round 2. The real page should bundle them. |
| `particles.js` | 38.4 KB of source, unminified (23.5 KB in round 1). |
| Particles | **9,200** when `innerWidth` is 760 or more: 6,400 form the graph and the wordmark, 2,800 are ambient (about three quarters fill the leaf's blade). **3,500** below that: 2,400 + 1,100. |
| Frame rate | 50–60 fps at 9,200 and 56–60 at 3,500 (1280×820 and 390×844). **Not representative:** measured in headless Chromium on SwiftShader (software WebGL), and screenshots stall the GPU while they're taken. A real GPU needs measuring in phase 16. The simulation runs on the CPU: one loop over every particle per frame, then two buffer uploads. |
| Timeline | First frame to formed leaf ≈ 1.5 s, then a 2 s hold. Leaf → graph ≈ 2.6 s, then a 4.5 s hold. Graph → wordmark ≈ 2.2 s, then it rests (Settle) or holds 4 s (Loop). |
| Art box | 544×635 CSS px at 1280 wide; 358×418 at 390 wide. Aspect ratio 6:7, as the SVG had. |

Screenshots were taken while building this (the leaf, mid-morph, the graph and the wordmark, in both themes, at
1280 and 390 wide, the opening frame by frame, Replay, and reduced motion). They are not kept in this folder.

## How it looks, honestly

- **The leaf** reads as a leaf immediately, in both themes.
  - In the light theme it's the strongest frame of all: a dark green leaf with pale veins, much like a real one.
  - In the dark theme the veins glow pale mint. The blade is a dense mosaic of leaves rather than a flat fill; up
    close you can see the ground between them.
  - At 390 wide it still reads, but the veins are thinner and the blade more broken.
- **The morph** sells the idea in its first half. The lower veins swing round into the branches while the top of
  the leaf is still a leaf.
  - In its second half, the leaf's upper third becomes a loose cloud for about half a second before the top of the
    graph settles. That's main's upper leaves travelling from the tip, at the top right, to the top of the trunk,
    at the top left, through the dissolving blade.
- **The graph** reads as before and better: main is continuous.
  - Where a line runs into a commit, the ring's hollow sometimes catches a leaf or two, so the rings are slightly
    less crisp than in round 1.
- **The wordmark** is round 1's: crisp on desktop, fuzzy-edged at 390 wide.
- **The pointer** makes a smaller, softer, swirling hollow, but a still pointer still leaves a hole.
- **The mockup's toolbar** sits over the bottom of the canvas at 390 wide. That's mockup chrome, not the design.

## Invented values

Every one is marked `INVENTED` in `theme.css`:

- the leaf palette (`--leaf-2` to `--leaf-6`, per theme; `--leaf-1` is `--gmt-spring`), with tone weights of
  30/22/16/14/12/6%;
- the big leaf's vein and blade tints (`--leaf-vein`, `--leaf-deep`, per theme);
- the shading on a leaf's folded half (`--leaf-fold`) and the ambient alpha;
- the art box's aspect ratio and the radial fade at its edges;
- the mockup's own header and toolbar.

These are proposals in `particles.js`:

- the timings, counts and sizes, and the pointer, in the *Tuning* block;
- the graph's and the leaf's geometry, in *Shapes*: the lanes, the commits, the leaf's tilt, width and veins.

## What phase 16 must decide

1. **Settle or Loop.** The user hasn't chosen yet; the toolbar toggle is there to compare them.
2. **Bundle or CDN.** Import `ogl` through Vite so it's one hashed, tree-shaken chunk (about 12.7 KB gzipped)
   loaded with `import()` on the landing only, never on docs pages (D6). Or write raw WebGL2: about 3 KB, but
   it's our code to maintain. This prototype used OGL only as boilerplate (context, program, buffers), so either
   works.
3. **The landing's size budget.** Phase 14's done-when ("within 10% of 37,566 B plus the SVG") no longer holds. A
   new number is needed: roughly the page, plus OGL, plus the effect minified, minus the SVG's markup.
4. **The fallback without WebGL.** It should be a real still image of the formed graph, or perhaps the leaf. The
   reduced-motion path could use the same image, so motion-averse visitors don't load the library at all.
5. **The decision to record:** JavaScript on the landing, deferred until after the first paint, landing-only, with
   a still fallback. This reverses phase 14's "SVG and CSS only" and needs recording in plan #235.
6. **The morph's top third:** live with the brief cloud, or route main's upper leaves round the blade (for
   example, start them earlier, or pair the midrib's top with the trunk's top more locally).
7. **Start-up on a real GPU:** time WebGL context creation and the first draw's shader compile on real hardware,
   and pre-warm the program with one invisible draw if the first frame hitches.
8. **Performance on low-end devices:** measure a real phone at 3,500, and decide whether to drop the count on a
   frame-time budget.
9. **The pointer on touch:** dragging pushes leaves, but check it doesn't fight page scroll on a phone, where the
   canvas sits below the copy.

**When the feature ships**, delete this folder and every citation of it.
