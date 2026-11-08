import {
  createRateLimiter,
  MAX_RATE_BUCKETS,
  retryAfterSeconds,
} from "./rate-limit";

// Expected values are worked by hand from the policy, not read from the limiter:
// a bucket opens on a client's first request and lasts `windowSeconds`; the
// request that finds `max` already counted is refused; a request at or after
// the bucket's reset instant opens a fresh bucket.
const ENV = {
  WORKER_RATE_LIMIT_MAX: "2",
  WORKER_RATE_LIMIT_WINDOW_SECONDS: "60",
};

describe("rate limiter — window", () => {
  it("allows `max` requests, refuses the next, and reports what remains", () => {
    const limiter = createRateLimiter();
    const first = limiter.check("chat:a", ENV, 0);
    const second = limiter.check("chat:a", ENV, 1_000);
    const third = limiter.check("chat:a", ENV, 2_000);

    expect(first).toEqual({ limited: false, remaining: 1, resetAtMs: 60_000 });
    expect(second).toEqual({ limited: false, remaining: 0, resetAtMs: 60_000 });
    expect(third).toEqual({ limited: true, remaining: 0, resetAtMs: 60_000 });
  });

  it("still refuses one millisecond before the window ends", () => {
    const limiter = createRateLimiter();
    limiter.check("chat:a", ENV, 0);
    limiter.check("chat:a", ENV, 0);
    expect(limiter.check("chat:a", ENV, 59_999).limited).toBe(true);
  });

  it("opens a fresh window exactly at the reset instant", () => {
    const limiter = createRateLimiter();
    limiter.check("chat:a", ENV, 0);
    limiter.check("chat:a", ENV, 0);
    const afterReset = limiter.check("chat:a", ENV, 60_000);
    expect(afterReset).toEqual({
      limited: false,
      remaining: 1,
      resetAtMs: 120_000,
    });
  });

  it("counts each bucket key on its own", () => {
    const limiter = createRateLimiter();
    limiter.check("chat:a", ENV, 0);
    limiter.check("chat:a", ENV, 0);
    expect(limiter.check("chat:a", ENV, 0).limited).toBe(true);
    expect(limiter.check("chat:b", ENV, 0).limited).toBe(false);
  });

  it("defaults to 30 requests per 60 seconds, and ignores unusable env values", () => {
    const limiter = createRateLimiter();
    const junk = {
      WORKER_RATE_LIMIT_MAX: "0",
      WORKER_RATE_LIMIT_WINDOW_SECONDS: "abc",
    };
    for (let i = 0; i < 30; i += 1) {
      expect(limiter.check("chat:a", junk, 0).limited).toBe(false);
    }
    const refused = limiter.check("chat:a", junk, 0);
    expect(refused).toEqual({ limited: true, remaining: 0, resetAtMs: 60_000 });
  });
});

describe("rate limiter — bucket ceiling", () => {
  it("is 10,000 buckets", () => {
    expect(MAX_RATE_BUCKETS).toBe(10_000);
  });

  it("refuses a new key once 10,000 live buckets exist, but keeps serving known keys", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 10_000; i += 1) {
      expect(limiter.check(`chat:ip-${i}`, ENV, 0).limited).toBe(false);
    }

    const stranger = limiter.check("chat:stranger", ENV, 1_000);
    expect(stranger).toEqual({
      limited: true,
      remaining: 0,
      resetAtMs: 61_000,
    });

    // A client already inside the ceiling is unaffected by it.
    expect(limiter.check("chat:ip-0", ENV, 1_000).limited).toBe(false);
  });

  it("sweeps expired buckets at the ceiling, so a new key fits once the window has passed", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 10_000; i += 1) limiter.check(`chat:ip-${i}`, ENV, 0);

    expect(limiter.check("chat:stranger", ENV, 60_000).limited).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  // Whole seconds, rounded up, and never below 1: Retry-After 0 would invite an
  // immediate retry into a window that has not reopened.
  const at = (resetAtMs: number) => ({
    limited: true,
    remaining: 0,
    resetAtMs,
  });

  it("rounds a partial second up", () => {
    expect(retryAfterSeconds(at(1_500), 0)).toBe(2);
  });

  it("is 1 when the reset is now or already past", () => {
    expect(retryAfterSeconds(at(1_000), 1_000)).toBe(1);
    expect(retryAfterSeconds(at(1_000), 5_000)).toBe(1);
  });
});
