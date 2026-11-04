# Landing particles: prototype notes

**The question:** would a hero of leaf-shaped particles that form shapes look professional enough to replace
`docs/src/components/HeroBranches.astro`? The user found the SVG tree amateurish and pointed at
https://arkt.dev/, which lazy-loads three.js and morphs about 20k WebGL points between shapes sampled from its logo
and digits.

**Round 1's verdict (the user):** "That's on the right track! It's a bit glitchy at first but rolls over nicely to
the branch thing. What if it initially forms a large leaf, morphing into the branch?" Then: "it morphs into
'worktree' text also! Very nice touch!" Round 2 below answers both.

**Round 2's verdict:** "Very nice! Could the whole page be the canvas and could the initial loading be more
impressive? Small leaves coming from all around, shaping the big leaf?" Then, to be clear: "I only want to use the
full canvas for the more impressive entrance. I want the leaf, branch and text to remain in the same position as
before." Round 3 below answers both.

**Open it:** serve the repository root (`python3 -m http.server 8123`) and go to
`http://localhost:8123/prototypes/landing-particles/` (`?dpr=2` lifts round 3's DPR cap, to compare). The page needs the server because it reads the font from
`docs/public/fonts/`. The toolbar in the bottom right shows the stage and the fps, and has:
- **Settle / Loop**: Settle is the default. Settle plays leaf → graph → wordmark, then rests on the wordmark. Loop
  plays leaf → graph → wordmark → leaf, and repeats.
- **Replay**
- **Theme**

**Deviation from `/prototype`:** that command allows only plain HTML and CSS with no dependencies. A particle
effect can't be judged as a still sketch, so this mockup has a JavaScript file (`particles.js`) and loads one
library from a CDN. It's still throwaway: nothing in `docs/` imports it.

## Round 3: what changed

### The whole page is the canvas, for the entrance only

- **One canvas** (`.field`) is fixed behind the whole page, at `z-index: 0`. The header and the hero copy paint
  over it.
- **The header** wears the site's glass: the `.gmt-glass` tint, `blur(4px)`, the saturate and brightness tokens.
  Leaves flying behind it show through as soft green blurs.
- **The shapes don't move.**
  - The leaf, the graph and the wordmark are anchored to the `.art` box's centre, re-measured on scroll and
    resize, at round 2's scale (`min(w/380, h/470) × 0.86`).
  - They land exactly where and as big as round 2's did: copy left and shape right on desktop, shape below the copy
    on a phone.
- **After the entrance, everything lives in the art box as in round 2:**
  - The ambient field is round 2's annulus round the shape.
  - Round 2's CSS edge mask (radial, opaque to 84%, clear at the box's edge) is now computed per leaf.
  - The pointer is live over the art box plus 40 px, as before.
- **What happens to the full-page canvas afterwards:** it stays full-page with nothing drawn outside the art box.
  - Shrinking it back to the art box would mean resizing it, which clears it, plus a change of coordinate space:
    exactly the kind of blink round 2 removed.
  - The cost of leaving it is one full-viewport clear per frame, the compositing of a transparent full-page layer,
    and its memory (about 9 MB at 1280×820 and DPR 1.5).
  - The leaves cost what they did in round 2: fill cost is per sprite, not per canvas pixel.
- **The copy stays readable.**
  - The `.copy` block is measured (on resize and scroll) into a quiet zone: its box plus 16 px, then a 56 px soft
    edge.
  - A leaf in flight is drawn at 6% of its opacity inside that zone, until it is nearly down (the last 15% of its
    move).
  - Leaves can only cross the copy in flight, briefly and faintly. Nothing lands on it: no target is within the
    zone, and after the entrance nothing is outside the art box.
  - Worst case, measured: two overlapping fly-in leaves at that floor behind the tagline leave it at **7.29:1**
    (dark, `#98b2be`) and **7.19:1** (light, `#4b4b4b`), against 9.05:1 and 8.72:1 on the bare page.
  - The title keeps 14.5:1 or more in both themes.
  - Checked by eye in both themes at 1280 and 390 wide.
- **DPR is capped at 1.5** (round 2 used 2; `?dpr=2` overrides it, to compare).
  - At 1280×820 that's 2.4 M canvas pixels instead of 4.2 M, about 44% fewer, and each sprite covers about 44%
    fewer device pixels.
  - Side by side on a 2× screen, the leaves at 1.5 are a touch softer at the edge than at 2 but keep their shape.
    That's visible only zoomed in.
  - On a 1× screen nothing changes.
- **Resizes** still apply only on a real size change (of the viewport or the art box), inside a frame. A scroll
  only re-measures the anchor and the quiet zone.

### The entrance: a gust of leaves gathering into the big leaf

- **12 gusts** start just outside the viewport's edges, spaced round the perimeter by the edges' lengths, plus 2
  from behind the header, whose leaves appear from under the glass.
  - Each gust launches its leaves as one ribbon, spread along its edge.
  - Each sets off at its own moment, the top left slightly first.
  - Each bends its own way: two in three clockwise, one in three the other way.
- **Every leaf flies a curved path** (a quadratic Bézier, bent by its gust) with a coherent wind wobble, strongest
  mid-flight.
  - It picks up speed, then decelerates into place with about a 2% overshoot and settles back (an ease-out-back on
  `p^1.5`).
- **They tumble.** The rotation is now integrated on the CPU: spin is up to 10× faster in flight and slows as the
  leaf lands. A flying leaf also turns edge-on (it narrows about its midrib) and flattens out as it lands.
- **In flight a leaf is its own green.** As it lands, a vein leaf lights up to the vein tint and a blade leaf
  deepens and grows. So the structure visibly draws itself as it arrives.
- **The stagger builds:**
  - The midrib and veins come first, stem to tip, and draw the structure (landing at about 1.2–2.4 s).
  - Then the blade fills in.
  - The margin comes last (about 2.7 s at the latest).
  - The ambient leaves come in throughout, to the field round the shape.
  - The leaf is formed at about 2.3–2.7 s.
- **Replay** fades out over 0.3 s, then the gust comes in again.

### The round-2 weak spot (the leaf's upper third going to a loose cloud)

Made cheaper, not solved:
- The leaf → graph stagger is shorter: 0.8 s instead of 1.1 s, with durations of 1.0–1.5 s instead of 1.15–1.75 s.
- The blade's leaves bound for commits dip to 55% opacity mid-move.

The top of the graph settles about half a second sooner, and what's left is a haze rather than a cloud.

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
| `particles.js` | 47.9 KB of source, unminified (38.4 KB in round 2, 23.5 KB in round 1). |
| Particles | **9,200** when `innerWidth` is 760 or more: 6,400 form the graph and the wordmark, 2,800 are ambient (about three quarters fill the leaf's blade). **3,500** below that: 2,400 + 1,100. |
| Frame rate | Round 3: 29–38 fps at 9,200 on a full 1280×820 canvas at DPR 1.5, and 26–59 at 3,500 on 390×844. Round 2: 50–60 and 56–60 on the art box alone. The drop is the full-viewport clear and composite, which is software-rendered here. **Not representative:** measured in headless Chromium on SwiftShader (software WebGL), and screenshots stall the GPU while they're taken. A real GPU needs measuring in phase 16. The simulation runs on the CPU: one loop over every particle per frame, then two buffer uploads. |
| Timeline | Round 3: the gust's first leaves land at about 1.2 s and the leaf is formed at about 2.3–2.7 s, then a 2 s hold. Leaf → graph ≈ 2.5 s. Round 2: first frame to formed leaf ≈ 1.5 s, then a 2 s hold. Leaf → graph ≈ 2.6 s, then a 4.5 s hold. Graph → wordmark ≈ 2.2 s, then it rests (Settle) or holds 4 s (Loop). |
| Art box | 544×635 CSS px at 1280 wide; 358×418 at 390 wide. Aspect ratio 6:7, as the SVG had. The shapes sit there in round 3 too. |
| Canvas | Round 3: the whole viewport, 1280×820 or 390×844 CSS px, at DPR 1.5. |

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

**Round 3:**
- **The entrance is the most striking part now.**
  - Ribbons of small leaves sweep in from several edges at slightly different moments, curving, tumbling and
    flashing edge-on, and pile into the art box. The midrib and veins light up first, then the blade fills in.
  - On a phone, the gusts from the top cross the copy faintly on their way down to the leaf below it.
- **Its weak spots:**
  - At DPR 1 the flying leaves are small enough to read as green sparks rather than leaves. They read as leaves
    once they land and grow.
  - Leaves dim as they cross the copy's quiet zone. In still frames this reads as a clear area round the text; in
    motion it may show as leaves fading out and back in.
  - In the frames captured, five or six distinct ribbons read rather than twelve: neighbouring gusts merge into
    broader streams.
- **The header's glass** shows the leaves going behind it as a soft green shimmer. In the light theme the glass is
  the site's pale green tint, so it's subtler.

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
6. **The morph's top third:** round 3 shortened it to a haze. Live with that, or route main's upper leaves round
   the blade (for example, pair the midrib's top with the trunk's top more locally).
10. **The full-page canvas after the entrance:** keep it (round 3: simplest, no resize, a full-viewport clear per
    frame), or hand over to an art-box canvas once the leaf has formed. That second option needs both canvases
    drawn in one frame to avoid a blink.
11. **The DPR cap:** 1.5 for the full-page canvas, or 2 once the entrance is over. Changing it means resizing the
    canvas, so it would need the same in-frame swap.
12. **The quiet zone's size:** it's the `.copy` block plus 16 px and a 56 px soft edge. The real page's copy block
    is Starlight's, so measure it there.
7. **Start-up on a real GPU:** time WebGL context creation and the first draw's shader compile on real hardware,
   and pre-warm the program with one invisible draw if the first frame hitches.
8. **Performance on low-end devices:** measure a real phone at 3,500, and decide whether to drop the count on a
   frame-time budget.
9. **The pointer on touch:** dragging pushes leaves, but check it doesn't fight page scroll on a phone, where the
   canvas sits below the copy.

**When the feature ships**, delete this folder and every citation of it.
