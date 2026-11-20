import Constants from 'expo-constants';

// =============================================================================
//  🔌 SERVER CONNECTION - paste your public ngrok URL here
// -----------------------------------------------------------------------------
//  1. Start the server:   cd server && npm start          (port 3001)
//  2. Expose it:          ngrok http 3001
//  3. Paste the "Forwarding" https URL below (no trailing slash) and reload.
//
//  Leave it as an empty string ("") to fall back to EXPO_PUBLIC_SERVER_URL or
//  to your laptop's LAN IP (auto-detected from Metro) on port 3001.
// =============================================================================
const PUBLIC_SERVER_URL = 'https://creasing-axis-edition.ngrok-free.dev';

const SERVER_PORT = 3001;

/**
 * Server URL resolution:
 * 1. PUBLIC_SERVER_URL above (ngrok / any public tunnel or deployed host)
 * 2. EXPO_PUBLIC_SERVER_URL (set this for staging/production builds)
 * 3. In development, the same LAN host Metro is served from (so a phone
 *    running Expo Go reaches the Node server on your laptop automatically)
 * 4. localhost (simulator / web)
 */
function resolveServerUrl() {
  const pasted = PUBLIC_SERVER_URL.trim().replace(/\/+$/, '');
  if (pasted) return pasted;
  if (process.env.EXPO_PUBLIC_SERVER_URL) return process.env.EXPO_PUBLIC_SERVER_URL.replace(/\/+$/, '');
  const hostUri = Constants.expoConfig?.hostUri; // e.g. "192.168.1.20:8081"
  const host = hostUri ? hostUri.split(':')[0] : null;
  return `http://${host || 'localhost'}:${SERVER_PORT}`;
}

export const SERVER_URL = resolveServerUrl();

/** True for ngrok tunnels - they need a header to skip the browser warning page. */
export const IS_NGROK = /ngrok/i.test(SERVER_URL);

export const STORAGE_KEYS = {
  profile: '@jokerbluff/profile',
  audio: '@jokerbluff/audio',
  antiSpy: '@jokerbluff/antiSpy',
  language: '@jokerbluff/language',
};

export const ROOM_CODE_LENGTH = 5;
export const NICKNAME_MAX = 16;

/** Lie Deye economy (mirrors server/src/config.js - the server is authoritative). */
export const LIE_DEYE = Object.freeze({ STARTING_TOKENS: 4, MAX_USES_PER_GAME: 3, WIN_BONUS: 1 });

/** A match needs at least this many players (mirrors server HARD_MIN_PLAYERS; server enforces it). */
export const MIN_PLAYERS = 4;

/** Touch telemetry recorded while YOU choose which card to offer (Lie Deye heatmap). */
export const TOUCH_TELEMETRY = Object.freeze({ THROTTLE_MS: 40, MAX_SAMPLES: 300 });
