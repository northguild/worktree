/**
 * The Dox crystal, React side: a faceted hexagonal ice crystal drawn as SVG (ported from gmt's `HiveGlyph`, plan #309
 * D5). SVG rather than a flat `clip-path` hexagon because facet strokes must meet cleanly at the vertices, the
 * gradient has to run across real geometry to read as ice, and one vector serves a 28px turn marker and the 6rem hub.
 *
 * Geometry is `lib/dox-mark`; presentation is the `.gmt-dox-mark` rules in `styles/dox-hive.css`. Every colour is
 * `currentColor` or a token, so the mark takes the colour of whatever it sits in (`--gmt-hive-role` in a turn).
 */
import {
  MARK_INNER,
  MARK_OUTER,
  MARK_SHEEN,
  MARK_SPOKES,
  MARK_VIEWBOX,
} from "../../../lib/dox-mark";

interface HiveGlyphProps {
  idSuffix: string;
}

export function HiveGlyph({ idSuffix }: HiveGlyphProps) {
  // Gradient ids are unique per document: two marks sharing an id would make the second reuse the first one's stops.
  const faceId = `gmt-dox-face-${idSuffix}`;
  const sheenId = `gmt-dox-sheen-${idSuffix}`;

  return (
    <svg
      className="gmt-dox-mark"
      viewBox={MARK_VIEWBOX}
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={faceId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.4" />
        </linearGradient>
        {/* The specular streak: steep and narrow, so it reads as light caught on a facet and not a second fill. */}
        <linearGradient id={sheenId} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="var(--gmt-ice)" stopOpacity="0.75" />
          <stop offset="45%" stopColor="var(--gmt-ice)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="var(--gmt-ice)" stopOpacity="0" />
        </linearGradient>
      </defs>

      <polygon points={MARK_OUTER} fill={`url(#${faceId})`} />
      <polygon points={MARK_OUTER} className="gmt-dox-mark-edge" />

      {/* Spokes first, so the table's stroke caps them at the facet edge. */}
      <g className="gmt-dox-mark-facet">
        {MARK_SPOKES.map(([x1, y1, x2, y2]) => (
          <line key={`${x1},${y1}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        ))}
      </g>

      <polygon points={MARK_INNER} className="gmt-dox-mark-table" />
      <polygon points={MARK_SHEEN} fill={`url(#${sheenId})`} />
    </svg>
  );
}
