/**
 * The role marker: the Dox crystal on a 3D stage (ported from gmt, plan #309 D5). The geometry lives in `HiveGlyph`;
 * this file owns the stage, a `perspective` wrapper whose inner element carries `transform-style: preserve-3d`, so the
 * crystal turns as a solid. The turning itself is `useCrystalSpin`, Web Animations and not CSS, because a CSS spin
 * cannot stop gracefully.
 */
import { useId } from "react";
import { HiveGlyph } from "./HiveGlyph";
import { useCrystalSpin } from "./use-crystal-spin";

export type HiveRole = "assistant" | "user";

const LABELS: Record<HiveRole, string> = {
  assistant: "Dox",
  user: "You",
};

interface HiveNodeProps {
  /** Named `speaker`, not gmt's `role`: Biome's `useValidAriaRole` reads any `role` prop as an ARIA role. */
  speaker: HiveRole;
  /** Waiting on the first token: the crystal keeps turning and the halo pulses, then it lands square. */
  pending?: boolean;
  /** Names the label, so the turn's `<article>` can be labelled by it (`aria-labelledby`). */
  labelId?: string;
}

export function HiveNode({ speaker, pending = false, labelId }: HiveNodeProps) {
  const id = useId();
  const spinRef = useCrystalSpin(pending);

  return (
    <div className="gmt-hive-node-col">
      <div className="gmt-hive-stage" data-pending={pending || undefined}>
        {/* The halo is a box-shadow and the crystal an SVG with transparent corners, so the shadow would trace a
            rectangle: a separate layer, same centre. */}
        <span className="gmt-hive-halo" aria-hidden="true" />
        <div className="gmt-hive-node" data-role={speaker} ref={spinRef}>
          <HiveGlyph idSuffix={id} />
        </div>
      </div>
      <span id={labelId} className="gmt-hive-label">
        {LABELS[speaker]}
      </span>
    </div>
  );
}
