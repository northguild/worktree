import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/**
 * Receiving Linear `AgentSessionEvent` webhooks (#115, D4-D7).
 *
 * Sources: https://linear.app/developers/webhooks ("Securing Webhooks") and
 * https://linear.app/developers/agent-interaction, with field names from the
 * `AgentSessionEventWebhookPayload` and `AgentSessionWebhookPayload` types in
 * https://raw.githubusercontent.com/linear/linear/refs/heads/master/packages/sdk/src/schema.graphql
 */

/** Linear recommends rejecting a webhook more than a minute from now (Securing Webhooks). */
export const WEBHOOK_REPLAY_WINDOW_MS = 60_000;

/** The identifier shape D4 allows to reach argv. Same shape as `parseLinearIssueReference`. */
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** A SHA-256 digest in hex is 64 characters. */
const SIGNATURE_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * True only when `header` is the hex HMAC-SHA256 of `rawBody` under `secret`.
 * Compares equal-length buffers in constant time and never throws.
 */
export function verifyWebhookSignature(
  rawBody: Uint8Array | string,
  header: string | undefined | null,
  secret: string,
): boolean {
  try {
    if (typeof header !== "string" || !SIGNATURE_PATTERN.test(header)) {
      return false;
    }
    if (typeof secret !== "string" || secret.length === 0) {
      return false;
    }
    const expected = createHmac("sha256", secret).update(rawBody).digest();
    const given = Buffer.from(header, "hex");
    return given.length === expected.length && timingSafeEqual(expected, given);
  } catch {
    return false;
  }
}

/**
 * True when `timestamp` (Unix milliseconds, as in the body's `webhookTimestamp`
 * and the `Linear-Timestamp` header) is within the replay window of `now`,
 * in either direction; the caller passes `now`. Anything that is not a finite number is refused.
 */
export function isTimestampFresh(timestamp: unknown, now: number): boolean {
  const value =
    typeof timestamp === "string" && /^\d+$/.test(timestamp.trim())
      ? Number(timestamp)
      : timestamp;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return false;
  }
  return Math.abs(now - value) <= WEBHOOK_REPLAY_WINDOW_MS;
}

const agentSessionEventSchema = z.object({
  action: z.enum(["created", "prompted"]),
  webhookTimestamp: z.number().finite(),
  promptContext: z.string().nullish(),
  agentSession: z.object({
    id: z.string().min(1),
    creator: z.object({ id: z.string().min(1) }).nullish(),
    issue: z.object({
      identifier: z.string().regex(IDENTIFIER_PATTERN),
      team: z.object({ key: z.string().min(1) }),
    }),
  }),
});

export interface AgentSessionEvent {
  action: "created" | "prompted";
  /** Unix milliseconds; check with `isTimestampFresh`. */
  webhookTimestamp: number;
  sessionId: string;
  /** Null when Linear sent no creator (for example a deleted user). */
  creatorId: string | null;
  issueIdentifier: string;
  teamKey: string;
  /** Untrusted text; only read behind `linear.agentContext` (Phase 6). */
  promptContext: string | null;
}

/** Parses an already signature-checked body. Returns null when it is not a usable event. */
export function parseAgentSessionEvent(
  json: unknown,
): AgentSessionEvent | null {
  const result = agentSessionEventSchema.safeParse(json);
  if (!result.success) {
    return null;
  }
  const { action, webhookTimestamp, promptContext, agentSession } = result.data;
  return {
    action,
    webhookTimestamp,
    sessionId: agentSession.id,
    creatorId: agentSession.creator?.id ?? null,
    issueIdentifier: agentSession.issue.identifier,
    teamKey: agentSession.issue.team.key,
    promptContext: promptContext ?? null,
  };
}

/** D5: a session with no creator is never allowed. */
export function isAllowedCreator(
  creatorId: string | null | undefined,
  allowed: readonly string[],
): boolean {
  return typeof creatorId === "string" && allowed.includes(creatorId);
}

export interface SessionLedger {
  /** Records `id` and returns false the first time; true for a repeat. */
  seen(id: string): boolean;
  readonly size: number;
}

/** D7: in-memory de-duplication on `agentSession.id`, oldest id evicted past `max`. */
export function createSessionLedger(max = 1000): SessionLedger {
  const ids = new Set<string>();
  return {
    seen(id) {
      if (ids.has(id)) {
        return true;
      }
      ids.add(id);
      if (ids.size > max) {
        const oldest = ids.values().next().value;
        if (oldest !== undefined) {
          ids.delete(oldest);
        }
      }
      return false;
    },
    get size() {
      return ids.size;
    },
  };
}
