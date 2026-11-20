'use strict';

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 🧪 DEVELOPER TESTING MODE (temporary)
 * Stretches every turn timer to DEV_TIMER_MS (10 minutes) so the UI can be
 * tested/debugged without the clock running out. The timer LOGIC is unchanged -
 * only the durations are. Set to `false` (or run with DEV_TESTING_MODE=0)
 * before shipping to restore the real 15s / 15s / 10s / 60s timers.
 */
const DEV_TESTING_MODE = process.env.DEV_TESTING_MODE ? process.env.DEV_TESTING_MODE !== '0' : true;
const DEV_TIMER_MS = 600 * 1000;
const timer = (envName, productionMs) => int(process.env[envName], DEV_TESTING_MODE ? DEV_TIMER_MS : productionMs);

/** Game design rule: a match needs at least 4 players. Env can only RAISE it. */
const HARD_MIN_PLAYERS = 4;

module.exports = Object.freeze({
  PORT: int(process.env.PORT, 3001),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  DEV_TESTING_MODE,
  MIN_PLAYERS: Math.max(HARD_MIN_PLAYERS, int(process.env.MIN_PLAYERS, HARD_MIN_PLAYERS)),
  MAX_PLAYERS: 8, // limited by the rank pool in game/deck.js

  // Phase timers (ms). The server is the only clock that matters.
  TIMERS: Object.freeze({
    REQUEST: timer('TIMER_REQUEST_MS', 15000),
    OFFER: timer('TIMER_OFFER_MS', 15000),
    DECISION: timer('TIMER_DECISION_MS', 10000),
    // Used instead of the above when the acting player is disconnected,
    // so the table isn't held hostage by someone who closed the app.
    AFK: int(process.env.TIMER_AFK_MS, 3000),
    // "Lie Deye" token: freezes the decision clock at a full minute
    // (dev mode: same 10 minutes, so a token never SHORTENS the clock).
    LIE_DEYE: timer('TIMER_LIE_DEYE_MS', 60000),
  }),

  // "Lie Deye" token economy (balances live on the Room, so they carry over between matches).
  LIE_DEYE: Object.freeze({
    STARTING_TOKENS: int(process.env.LIE_DEYE_STARTING_TOKENS, 4), // first game in a room
    MAX_USES_PER_GAME: int(process.env.LIE_DEYE_MAX_USES, 3), // cap per match, whatever the balance
    WIN_BONUS: int(process.env.LIE_DEYE_WIN_BONUS, 1), // winner's reward for the next match
  }),

  // A player who stays disconnected this long during a match is treated as
  // having left: the match is terminated and everyone returns to the lobby.
  DISCONNECT_GRACE_MS: int(process.env.DISCONNECT_GRACE_MS, 45000),

  ROOM_CODE_LENGTH: 5,
  // Rooms with nobody connected are deleted after this long.
  EMPTY_ROOM_TTL_MS: int(process.env.EMPTY_ROOM_TTL_MS, 5 * 60 * 1000),
  // Guest sessions not attached to a room and not connected expire after this long.
  SESSION_TTL_MS: int(process.env.SESSION_TTL_MS, 24 * 60 * 60 * 1000),
  CLEANUP_INTERVAL_MS: 60 * 1000,

  // Very small per-socket flood guard.
  RATE_LIMIT: Object.freeze({ WINDOW_MS: 5000, MAX_EVENTS: 40 }),
});
