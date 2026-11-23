'use strict';

const int = (value, fallback, min = 1, max = 2147483647) => {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return fallback;
  const n = Number(value);
  return Number.isSafeInteger(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/**
 * Standalone game defaults. Private rooms override the online move and review
 * clocks with the selected speed.
 */
const DEV_TESTING_MODE = process.env.DEV_TESTING_MODE ? process.env.DEV_TESTING_MODE !== '0' : true;
const DEV_TIMER_MS = 600 * 1000;
const timer = (envName, productionMs) =>
  int(process.env[envName], DEV_TESTING_MODE ? DEV_TIMER_MS : productionMs, 1, 2147483000);

/** Game design rule: a match needs at least 4 players. Env can only RAISE it. */
const HARD_MIN_PLAYERS = 4;
const MAX_PLAYERS = 8; // limited by the rank pool in game/deck.js

const corsOrigins = (process.env.CORS_ORIGINS?.trim() || process.env.CORS_ORIGIN?.trim() || '')
  .split(',')
  .map((origin) => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);

module.exports = Object.freeze({
  PORT: int(process.env.PORT, 3001, 0, 65535),
  CORS_ORIGINS: Object.freeze(corsOrigins),

  DEV_TESTING_MODE,
  MIN_PLAYERS: int(process.env.MIN_PLAYERS, HARD_MIN_PLAYERS, HARD_MIN_PLAYERS, MAX_PLAYERS),
  MAX_PLAYERS,
  TURN_SPEEDS: Object.freeze({ fast: 15000, standard: 120000 }),
  DEFAULT_TURN_SPEED: 'standard',

  // Phase timers (ms). The server is the only clock that matters.
  TIMERS: Object.freeze({
    REQUEST: timer('TIMER_REQUEST_MS', 15000),
    OFFER: timer('TIMER_OFFER_MS', 15000),
    DECISION: timer('TIMER_DECISION_MS', 10000),
    // Used instead of the above when the acting player is disconnected,
    // so the table isn't held hostage by someone who closed the app.
    AFK: int(process.env.TIMER_AFK_MS, 3000, 1, 2147483000),
    // Standalone Lie Deye review clock. Rooms reset this to their move duration.
    LIE_DEYE: timer('TIMER_LIE_DEYE_MS', 60000),
  }),

  // "Lie Deye" token economy (balances live on the Room, so they carry over between matches).
  LIE_DEYE: Object.freeze({
    STARTING_TOKENS: int(process.env.LIE_DEYE_STARTING_TOKENS, 4, 0),
    MAX_USES_PER_GAME: int(process.env.LIE_DEYE_MAX_USES, 3, 0, 3),
    WIN_BONUS: int(process.env.LIE_DEYE_WIN_BONUS, 1, 0),
  }),

  // A player who stays disconnected this long during a match is treated as
  // having left: the match is terminated and everyone returns to the lobby.
  DISCONNECT_GRACE_MS: int(process.env.DISCONNECT_GRACE_MS, 45000),

  ROOM_CODE_LENGTH: 5,
  ROOM_CODE_ALPHABET: 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', // omit lookalike characters
  // Rooms with nobody connected are deleted after this long.
  EMPTY_ROOM_TTL_MS: int(process.env.EMPTY_ROOM_TTL_MS, 5 * 60 * 1000),
  // Guest sessions not attached to a room and not connected expire after this long.
  SESSION_TTL_MS: int(process.env.SESSION_TTL_MS, 24 * 60 * 60 * 1000),
  CLEANUP_INTERVAL_MS: 60 * 1000,
  MAX_SESSIONS: 10000,

  // Gameplay events have an independent budget for each socket, even on shared Wi-Fi.
  RATE_LIMIT: Object.freeze({ WINDOW_MS: 5000, MAX_EVENTS: 40 }),
});
