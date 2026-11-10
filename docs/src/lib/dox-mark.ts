/**
 * The Dox mark, as pure geometry, ported unchanged from gmt (`src/lib/dox-mark.ts`, gmt d479dca8; plan #309 D5).
 *
 * The crystal is drawn by `chat/components/hive/HiveGlyph.tsx` and, from Phase 4, the header and the hero's link. A
 * plain data file keeps those from holding copies of the path data to keep in step by hand.
 *
 * Flat-top, pointy-sided, in a 100 x 87 box (a regular hexagon: 87 is about 100 x 0.866). Presentation is the
 * `.gmt-dox-mark` rules in `styles/dox-hive.css`.
 */

/** Outer silhouette. */
export const MARK_OUTER = "25,0 75,0 100,43.5 75,87 25,87 0,43.5";

/** The crystal's "table": an inner facet ring at about 52%, sharing the centre. */
export const MARK_INNER = "37,21.8 63,21.8 76,43.5 63,65.2 37,65.2 24,43.5";

/** The top facet, which catches the specular streak. */
export const MARK_SHEEN = "25,0 75,0 63,21.8 37,21.8";

/** Spokes from each outer vertex to its inner counterpart, as [x1,y1,x2,y2]. */
export const MARK_SPOKES: readonly (readonly [
  number,
  number,
  number,
  number,
])[] = [
  [25, 0, 37, 21.8],
  [75, 0, 63, 21.8],
  [100, 43.5, 76, 43.5],
  [75, 87, 63, 65.2],
  [25, 87, 37, 65.2],
  [0, 43.5, 24, 43.5],
];

export const MARK_VIEWBOX = "0 0 100 87";
