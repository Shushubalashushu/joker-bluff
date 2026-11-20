import { io } from 'socket.io-client';
import { IS_NGROK, SERVER_URL } from '../config';

let socket = null;
let lastConnectError = null;

/**
 * Creates the singleton Socket.IO client.
 * `getAuth` is called on EVERY (re)connect so the latest session token and
 * profile are always sent - that's what lets a guest resume their seat.
 *
 * ngrok notes:
 *  - The free tier answers unknown clients with an HTML "visit site" page.
 *    The `ngrok-skip-browser-warning` header bypasses it. React Native sends
 *    `extraHeaders` on BOTH the websocket upgrade and HTTP long-polling.
 *  - We try websocket first and fall back to polling (some mobile networks /
 *    proxies block upgrades) - `tryAllTransports` keeps trying the next one.
 */
export function createSocket(getAuth) {
  if (socket) return socket;
  const extraHeaders = IS_NGROK ? { 'ngrok-skip-browser-warning': 'true' } : undefined;
  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    extraHeaders,
    transportOptions: extraHeaders ? { polling: { extraHeaders }, websocket: { extraHeaders } } : undefined,
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

/** Resolves true once connected (or false after `ms`). Smooths over brief reconnects. */
function waitForConnection(ms) {
  if (!socket) return Promise.resolve(false);
  if (socket.connected) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (ok) => {
      clearTimeout(timer);
      socket?.off('connect', onConnect);
      resolve(ok);
    };
    const onConnect = () => done(true);
    const timer = setTimeout(() => done(false), ms);
    socket.on('connect', onConnect);
  });
}

/** Emit with ack. Always resolves to `{ ok, ... }` - never throws. */
export async function emitAck(event, payload = {}, timeoutMs = 6000) {
  if (!socket) return { ok: false, code: 'OFFLINE', error: 'Not connected to the server' };
  if (!socket.connected && !(await waitForConnection(5000))) {
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
  let best = null;
  for (let i = 0; i < samples; i++) {
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
