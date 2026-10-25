import { ATTENDANCE_RATE_LIMIT, HOST_AUTH_RATE_LIMIT, MEETINGS_RATE_LIMIT, RATE_WINDOW_MS } from "@/lib/config";

type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Swap this for a distributed implementation (e.g. Upstash Redis) without
 * touching the routes: only `check` needs to be implemented.
 */
interface RateLimiter {
  check(key: string): Promise<RateLimitDecision>;
}

type Bucket = { count: number; resetAt: number };

/**
 * Fixed-window limiter kept in process memory.
 *
 * Limitation: on serverless each instance has its own counters, so the real
 * ceiling is (limit × running instances). That is enough to stop refresh loops
 * and naive scripts; use Redis when the limit must be global.
 */
function createMemoryRateLimiter(options: { limit: number; windowMs: number }): RateLimiter {
  const { limit, windowMs } = options;
  const buckets = new Map<string, Bucket>();

  return {
    async check(key: string): Promise<RateLimitDecision> {
      const now = Date.now();

      if (buckets.size > 5_000) {
        for (const [bucketKey, bucket] of buckets) {
          if (bucket.resetAt <= now) buckets.delete(bucketKey);
        }
      }

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true };
      }

      if (bucket.count >= limit) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
        };
      }

      bucket.count += 1;
      return { allowed: true };
    },
  };
}

export const attendanceRateLimiter = createMemoryRateLimiter({
  limit: ATTENDANCE_RATE_LIMIT,
  windowMs: RATE_WINDOW_MS,
});

export const meetingRateLimiter = createMemoryRateLimiter({
  limit: MEETINGS_RATE_LIMIT,
  windowMs: RATE_WINDOW_MS,
});

export const hostAuthRateLimiter = createMemoryRateLimiter({
  limit: HOST_AUTH_RATE_LIMIT,
  windowMs: RATE_WINDOW_MS,
});
