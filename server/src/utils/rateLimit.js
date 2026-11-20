'use strict';

/** Bounded fixed-window counters for connections and room-code lookups. */
function createRateLimiter({ windowMs, maxAttempts, maxKeys = 10000 }) {
  const buckets = new Map();
  let nextCleanup = 0;

  return function allow(key, now = Date.now()) {
    if (now >= nextCleanup) {
      for (const [id, bucket] of buckets) {
        if (bucket.expires <= now) buckets.delete(id);
      }
      nextCleanup = now + windowMs;
    }

    let bucket = buckets.get(key);
    if (!bucket || bucket.expires <= now) {
      if (!bucket && buckets.size >= maxKeys) return false;
      bucket = { count: 0, expires: now + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= maxAttempts) return false;
    bucket.count += 1;
    return true;
  };
}

module.exports = { createRateLimiter };
