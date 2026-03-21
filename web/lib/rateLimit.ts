// Simple in-memory sliding window rate limiter.
// Suitable for single-instance deployments (no Redis dependency).
// Each key gets its own fixed window; windows reset after windowMs elapses.

interface RateWindow {
  count: number;
  windowStart: number;
}

const store = new Map<string, RateWindow>();

// Prune expired entries every minute to prevent unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, win] of store) {
    // Remove entries idle for more than 1 hour
    if (now - win.windowStart > 3_600_000) {
      store.delete(key);
    }
  }
}, 60_000);

/**
 * Check whether a key is within the rate limit.
 *
 * @param key       Unique identifier — userId, IP address, etc.
 * @param limit     Maximum requests allowed within the window.
 * @param windowMs  Window duration in milliseconds.
 * @returns `allowed: true` if the request may proceed.
 *          `retryAfterMs` is the milliseconds until the window resets (only meaningful when denied).
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const existing = store.get(key);

  // Start a new window if none exists or the previous one has expired
  if (!existing || now - existing.windowStart >= windowMs) {
    store.set(key, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  if (existing.count >= limit) {
    const retryAfterMs = windowMs - (now - existing.windowStart);
    return { allowed: false, retryAfterMs };
  }

  existing.count++;
  return { allowed: true, retryAfterMs: 0 };
}
