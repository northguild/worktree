# Settings gear and sound — audition notes (#352)

Open [`sound-audition.html`](sound-audition.html) from disk, pick one variant per step, and paste the picks
block from its last page back into the planning session. Picks are kept in the browser's `localStorage`
(`worktree-352-audition`).

## The questions it exists to answer

1. What the Dark theme switch and the volume control look like here, in a git-tree look that is
   deliberately *not* GMT's ice-and-bevel. (The header button is not a question: see below.)
2. Which tree-and-plant sound marks a volume notch.
3. Which sounds, if any, go with the leaf particles: the gust in, a picture forming, one picture becoming the
   next, and the pointer dragging through the leaves.
4. Which of GMT's Dox chat voices are carried over.

## Settled before the audition (the owner, 2026-11-19)

- **The gear is exactly GMT's and northguild.dev's**: the same SVG (gmt
  `apps/dox/src/components/settings-control.ts`, `GEAR`: Lucide `settings`, filled, even-odd hub, view box
  `1 1 22 22`, 20 px), in the same place, last in the bar after Dox, GitHub and Discord. Only the panel's
  contents take this site's git-tree look.

- **No sound on any press.** No button, link, switch, tab or the gear makes a sound. Baldur dislikes sound,
  so everything is very quiet and elegant. Sound comes only from: the volume control's notches, the leaf
  particles, and the Dox chat.
- **The sound choice carries across all three sites.** The worktree docs read and write the same
  `localStorage` key as GMT and northguild.dev, `dox:sound` (`{ v: 1, level: 1–11, muted, … }`). All three
  are served from northguild.dev (`/gmt*`, `/worktree*`, the root), so they share one origin. A reader who
  mutes on one site is muted on all three.
- **Sound is opt-in**, as on GMT: every visitor starts muted (GMT `tier-3-sound.md`, *Rules*).
- **The Dox chat voices are GMT's, unchanged**, so Dox sounds the same everywhere: typing (Data blip),
  thinking (Sonar idle), loading (Servo spin-up), answer arriving (Morse), complete (Ice bell). Send
  (Sonar launch) and error (Low double buzz) are left unticked until the owner decides, since send is a
  press. Source: gmt `apps/dox/src/lib/sound/voices.ts`.
- **The same leaves-blowing sound plays at every change**, leaf → git graph → "worktree" → leaf, not only on
  the opening gust. The sound is tied to the particles: on each `enter()` in
  `docs/src/hero/particles.ts`, the share of leaves in flight and their mean x are computed from the
  `delay[]` and `dur[]` arrays the animation already holds (a sample every 50 ms, about 60 numbers a change).
  Those curves drive the wind's loudness, brightness and pan on the audio clock. It is one voice for the
  flock, never one per leaf. Board: gust F/G ("Leaves in flight") and change S ("Same as the gust").
- **The wind stops when the leaves stop.** A gust or a change is silent the moment its last leaf lands
  (`stageLength` minus the hold, on the site). Nothing rings on into the hold. The board does this two ways:
  every envelope ends at the landing, and a bus (`untilLanded`) fades to zero over the last 0.25 s as a
  guard. Measured offline: −160 to −180 dB after the landing, for every gust voice.
- **The pointer's sound carries through the whole drag.** One continuous voice that follows the pointer's
  speed and side through the leaves, including mid-morph, never a run of separate sounds that stop and start.

## How the board relates to the site

- The kit is GMT's `kit.ts`, ported unchanged except for the noise buffer (3 s here, 1 s in GMT), because
  the gust swells run longer than a second. The port should take the 3 s buffer or loop-crossfade it.
- Level and gain follow GMT's engine: level 1–11, `gain = level / 11 × 0.6`, through GMT's −12 dBFS
  ceiling curve.
- The scene is a 2D sketch of `docs/src/hero/particles.ts`: the same stages, orders and 1.25 pace, with
  about 1,060 leaves rather than 9,200. The holds are 2.5 s on the board (a box restores the real 5 s). The
  sounds are scheduled from the scene's timeline. On the site they have to be scheduled from `enter()`
  (stage start, `stageLength`) and from each leaf's `delay + dur`.

## Invented (proposals, not borrowed)

Every control look on steps 1–2 (the checkout, turning-leaf and growing-branch switches, and
the commit-rail, growing-stem, branch-lanes and growth-rings faders), the `--branch*`, `--commit-hole`,
`--head-ring` and `--switch-track*` tokens in [`theme.css`](theme.css), `--radius-lg`, `--ease-grow`, the
small "glade" room (1.4 s), and every voice on steps 4–9. The colours, fonts and leaf palette are the
site's own.

## Still open

- The picks themselves.
- Send and error in the Dox chat.

## Throwaway

Delete this folder, and the plan's citation of it, when #352's feature closes.
