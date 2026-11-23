'use strict';

const { isIP, SocketAddress } = require('node:net');

// A school NAT or reverse proxy can carry several full classrooms. Keep the shared
// budgets large enough for simultaneous reconnects and repeated room-code entry.
const ADDRESS_CONNECTION_LIMIT = Object.freeze({ windowMs: 10000, maxAttempts: 600 });
const ADDRESS_JOIN_LIMIT = Object.freeze({ windowMs: 60000, maxAttempts: 600 });
const GUEST_JOIN_LIMIT = Object.freeze({ windowMs: 60000, maxAttempts: 16 });
const ADDRESS_NEW_GUEST_LIMIT = Object.freeze({ windowMs: 60000, maxAttempts: 180 });
const GLOBAL_NEW_GUEST_LIMIT = Object.freeze({ windowMs: 1000, maxAttempts: 80 });

/** Only Render's managed public ingress overwrites this header. Ignore forwarded chains. */
function clientAddress(req, trustRenderIngress) {
  const forwarded = trustRenderIngress && req.headers['cf-connecting-ip'];
  const version = typeof forwarded === 'string' ? isIP(forwarded) : 0;
  if (!version) return req.socket.remoteAddress || 'unknown';
  const { address } = new SocketAddress({ address: forwarded, family: version === 6 ? 'ipv6' : 'ipv4' });
  return address.replace(/^::ffff:(?=\d+\.)/, '');
}

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

module.exports = {
  createRateLimiter, clientAddress, ADDRESS_CONNECTION_LIMIT, ADDRESS_JOIN_LIMIT, GUEST_JOIN_LIMIT,
  ADDRESS_NEW_GUEST_LIMIT, GLOBAL_NEW_GUEST_LIMIT,
};
