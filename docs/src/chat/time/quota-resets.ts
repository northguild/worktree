/**
 * Which reset matters to the reader right now (plan #309 D13; ported from gmt's `quota-resets.ts`).
 *
 * There is no single "Dox resets at midnight" to show. The visitor's own questions refill at the UTC midnight, the Gemini
 * brains at midnight Pacific and the Workers AI pool at 00:00 UTC. `GET /api/brains` sends every one of those instants and
 * this module picks between them. Pure, so the rules are tested without rendering anything.
 *
 * gmt's dev bypass (an unlimited visitor) is not here: this Worker has none (D11), so every visitor has a cap.
 */
import { convertUtcToUnix } from "@northguild/gmt/utc/convert";
import type { BrainsInfo } from "../lib/chat-types";

export interface QuotaReset {
  id: "visitor" | BrainsInfo["providers"][number]["id"];
  label: string;
  /** The instant the allowance refills. */
  resetsAt: string;
}

/** Sort key for an instant; an unparseable one sorts last rather than first. */
function epochOf(reset: QuotaReset): number {
  return convertUtcToUnix(reset.resetsAt) ?? Number.POSITIVE_INFINITY;
}

function visitorReset(info: BrainsInfo): QuotaReset {
  return {
    id: "visitor",
    label: "Your questions",
    resetsAt: info.visitor.resetsAt,
  };
}

function providerResets(info: BrainsInfo): QuotaReset[] {
  return info.providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    resetsAt: provider.resetsAt,
  }));
}

/** Every reset the reader can be waiting on: their own allowance first (the number they can act on), then each provider. */
export function listResets(info: BrainsInfo): QuotaReset[] {
  return [visitorReset(info), ...providerResets(info)];
}

/**
 * The one reset worth putting in the composer: whatever refills next that would let the reader ask again.
 *
 * - Pool spent (every brain at zero): the soonest provider refill, since Dox answers again as soon as any one comes back.
 *   If the reader's own questions are also gone, the later of that and their own reset.
 * - Only their questions spent: their own reset.
 * - Otherwise: their own allowance, the number beside it in the badge.
 */
export function nextReset(info: BrainsInfo): QuotaReset | undefined {
  const visitorSpent = info.visitor.remaining <= 0;
  const poolSpent =
    info.brains.length > 0 &&
    info.brains.every((brain) => brain.remaining <= 0);

  if (!poolSpent) return visitorReset(info);

  const soonest = providerResets(info).sort(
    (a, b) => epochOf(a) - epochOf(b),
  )[0];
  if (!visitorSpent) return soonest;
  const own = visitorReset(info);
  return !soonest || epochOf(own) >= epochOf(soonest) ? own : soonest;
}
