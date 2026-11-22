import { io } from 'socket.io-client';
import { SERVER_URL } from '../config';

let socket = null;
let lastConnectError = null;

/**
 * Creates the singleton Socket.IO client.
 * `getAuth` is called on EVERY (re)connect so the latest session token and
 * profile are always sent - that's what lets a guest resume their seat.
 *
 * Try WebSocket first and fall back to polling on networks that block upgrades.
 */
export function createSocket(getAuth) {
  if (socket) return socket;
  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4000,
    timeout: 10000,
    auth: (cb) => cb(getAuth()),
  });
  socket.on('connect', () => (lastConnectError = null));
  socket.on('connect_error', (err) => (lastConnectError = err?.message || 'connect_error'));
  return socket;
}

export function getSocket() {
  return socket;
}

export function getLastConnectError() {
  return lastConnectError;
}

/** Manual "tap to retry" from the connection banner. */
export function reconnectNow() {
  if (!socket) return;
  if (socket.connected) return;
  socket.disconnect();
  socket.connect();
}

export function destroySocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

/** Emit with ack. Always resolves to `{ ok, ... }` - never throws. */
export async function emitAck(event, payload = {}, timeoutMs = 6000) {
  if (!socket?.connected) {
    const why = lastConnectError ? ` (${lastConnectError})` : '';
    return { ok: false, code: 'OFFLINE', error: `Not connected to the server${why}` };
  }
  try {
    return await socket.timeout(timeoutMs).emitWithAck(event, payload);
  } catch {
    return { ok: false, code: 'TIMEOUT', error: 'Server did not respond' };
  }
}

/**
 * NTP-style clock sync: several round trips, keep the one with the lowest RTT.
 * offset = serverTime - localTime, so `Date.now() + offset` ≈ server clock.
 */
export async function measureClockOffset(samples = 5) {
  const connection = socket;
  const socketId = connection?.id;
  let best = null;
  for (let i = 0; i < samples; i++) {
    if (!socketId || socket !== connection || connection.id !== socketId) break;
    const t0 = Date.now();
    const res = await emitAck('time_sync', {}, 3000);
    const t1 = Date.now();
    if (!res.ok) continue;
    const rtt = t1 - t0;
    const offset = res.serverNow - (t0 + rtt / 2);
    if (!best || rtt < best.rtt) best = { rtt, offset };
  }
  return best ? best.offset : 0;
}
