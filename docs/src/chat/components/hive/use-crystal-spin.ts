/**
 * The crystal's spin and its landing (ported from gmt, plan #309 D5).
 *
 * CSS alone cannot land it: an infinite `animation` stopped by removing the class snaps to 0deg, and
 * `animation-play-state: paused` freezes it mid-turn. The Web Animations API can: read the angle the spin reached, then
 * run a decelerating animation from there to the next whole turn. The mark never jumps.
 *
 * Positive `rotateZ` is clockwise in CSS (the Y axis points down); the constant `rotateX` tilt keeps the facets reading
 * as a solid while it turns.
 */
import { useEffect, useRef } from "react";

const TILT = "rotateX(10deg)";
/** One full turn while working. */
const SPIN_MS = 2600;
/** The entrance turn: slower than a spin cycle, so it reads as an arrival. */
const ENTER_MS = 1100;
/** The decelerating finish. */
const LAND_MS = 900;
/** Ease-out that decays hard at the end: the "settling" feel. */
const LAND_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

function frame(deg: number): Keyframe {
  return { transform: `${TILT} rotateZ(${deg}deg)` };
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * @param spinning - true while Dox is working. Going false lands the crystal.
 * @param enter - play the one-turn entrance on mount. A turn's marker does (a new question spins its own crystal in).
 */
export function useCrystalSpin(spinning: boolean, enter = true) {
  const ref = useRef<HTMLDivElement | null>(null);
  /** The angle the spin had reached when it was torn down, in degrees (`null`: there was no spin to land from).
   * Captured in the cleanup, not read from the Animation afterwards: React runs the previous effect's cleanup before
   * the next effect body, and a cancelled Animation reports `currentTime === null`. */
  const landFromRef = useRef<number | null>(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;

    // With reduced motion the crystal sits at rest; the waiting state is carried by the halo and the scanline, which
    // have still fallbacks in dox-hive.css.
    if (prefersReducedMotion()) return;

    const isFirstRun = !mountedRef.current;
    mountedRef.current = true;

    if (spinning) {
      const animation = el.animate([frame(0), frame(360)], {
        duration: SPIN_MS,
        iterations: Number.POSITIVE_INFINITY,
        easing: "linear",
      });
      return () => {
        // The only moment the reached angle is still readable.
        const elapsed = Number(animation.currentTime ?? 0) % SPIN_MS;
        landFromRef.current = (elapsed / SPIN_MS) * 360;
        animation.cancel();
      };
    }

    const landFrom = landFromRef.current;
    if (landFrom !== null) {
      landFromRef.current = null;
      el.animate([frame(landFrom), frame(360)], {
        duration: LAND_MS,
        easing: LAND_EASING,
      });
      return;
    }

    if (isFirstRun && enter) {
      el.animate(
        [
          { ...frame(-360), opacity: 0, scale: "0.6" },
          { ...frame(0), opacity: 1, scale: "1" },
        ],
        { duration: ENTER_MS, easing: LAND_EASING },
      );
    }
  }, [spinning, enter]);

  return ref;
}
