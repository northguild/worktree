import { getUnixNow } from "@northguild/gmt";
import {
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_WINDOW_SECONDS,
} from "../src/chat/lib/chat-constants";

// Application-level abuse protection.
const DEFAULT_RATE_LIMIT_MAX = RATE_LIMIT_MAX_REQUESTS;
const DEFAULT_RATE_LIMIT_WINDOW_SECONDS = RATE_LIMIT_WINDOW_SECONDS;

// Prune trigger: if the map exceeds this size, sweep expired entries.
// Prevents unbounded growth from high-cardinality / spoofed client IDs.
export const MAX_RATE_BUCKETS = 10_000;

export interface RateLimitVerdict {
  limited: boolean;
  remaining: number;
  resetAtMs: number;
}

interface RateBucket {
  count: number;
  resetAtMs: number;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getClientId(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cfConnectingIp) return cfConnectingIp;

  const xForwardedFor = request.headers.get("x-forwarded-for");
  if (xForwardedFor) {
    const first = xForwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  return "unknown";
}

// getUnixNow() returns null only if the clock itself fails (it cannot for a call without options).
// The project bans Date.now(), so a failed clock reads as 0: no bucket ever expires, which fails
// closed (the limiter keeps counting) instead of letting every request through.
export function nowMs(): number {
  return getUnixNow() ?? 0;
}

/** Seconds a limited client should wait, never below 1. */
export function retryAfterSeconds(
  verdict: RateLimitVerdict,
  now: number,
): number {
  return Math.max(1, Math.ceil((verdict.resetAtMs - now) / 1000));
}

export function createRateLimiter() {
  const buckets = new Map<string, RateBucket>();

  function check(
    bucketKey: string,
    env: Record<string, string>,
    now: number,
  ): RateLimitVerdict {
    const max = parsePositiveInt(
      env.WORKER_RATE_LIMIT_MAX,
      DEFAULT_RATE_LIMIT_MAX,
    );
    const windowSeconds = parsePositiveInt(
      env.WORKER_RATE_LIMIT_WINDOW_SECONDS,
      DEFAULT_RATE_LIMIT_WINDOW_SECONDS,
    );
    const windowMs = windowSeconds * 1000;
    const bucket = buckets.get(bucketKey);

    if (!bucket || now >= bucket.resetAtMs) {
      // Prune expired entries if the map is getting large. O(n) only at the cap.
      if (buckets.size >= MAX_RATE_BUCKETS) {
        for (const [id, b] of buckets) {
          if (now >= b.resetAtMs) buckets.delete(id);
        }
      }
      // Hard ceiling: if the map is still full after pruning, the isolate is
      // under a high-cardinality flood. Reject rather than grow unbounded.
      if (buckets.size >= MAX_RATE_BUCKETS) {
        return { limited: true, remaining: 0, resetAtMs: now + windowMs };
      }
      buckets.set(bucketKey, { count: 1, resetAtMs: now + windowMs });
      return { limited: false, remaining: max - 1, resetAtMs: now + windowMs };
    }

    if (bucket.count >= max) {
      return { limited: true, remaining: 0, resetAtMs: bucket.resetAtMs };
    }

    bucket.count += 1;
    return {
      limited: false,
      remaining: Math.max(0, max - bucket.count),
      resetAtMs: bucket.resetAtMs,
    };
  }

  /** One bucket per client for the whole chat, whichever route it used (D6). */
  function checkRequest(
    request: Request,
    env: Record<string, string>,
  ): RateLimitVerdict {
    return check(`chat:${getClientId(request)}`, env, nowMs());
  }

  return { check, checkRequest };
}

/** The isolate's limiter, shared by the legacy route and the chat route. */
export const chatRateLimiter = createRateLimiter();
