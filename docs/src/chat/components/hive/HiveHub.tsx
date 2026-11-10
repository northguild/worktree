/**
 * The Dox mark at logo scale, for the empty page: the same crystal and stage as a turn's marker (`HiveNode`), without
 * the role label, because this one is the product's mark and not a speaker's (ported from gmt, plan #309 D5).
 *
 * It does not spin in: a logo that arrives spinning reads as a loading indicator. Its arrival is the CSS fade-and-scale
 * of `.gmt-hive-hub` in `styles/dox-hive.css`. `useCrystalSpin(false, false)` still runs so the hook stays the single
 * owner of the element's transform; `enter: false` is what suppresses the turn.
 */
import { HiveGlyph } from "./HiveGlyph";
import { useCrystalSpin } from "./use-crystal-spin";

export function HiveHub() {
  const spinRef = useCrystalSpin(false, false);

  return (
    <div className="gmt-hive-stage gmt-hive-hub">
      <span className="gmt-hive-halo" aria-hidden="true" />
      <div className="gmt-hive-node" data-role="assistant" ref={spinRef}>
        <HiveGlyph idSuffix="hub" />
      </div>
    </div>
  );
}
