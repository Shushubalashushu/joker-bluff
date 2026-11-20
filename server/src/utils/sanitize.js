'use strict';

const crypto = require('crypto');

const AVATAR_COUNT = 12; // must match app/src/constants/avatars.js
const NICKNAME_MAX = 16;

function sanitizeNickname(raw) {
  const clean = String(raw ?? '')
    // strip control chars & zero-width/bidi tricks
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(clean).slice(0, NICKNAME_MAX).join(''); // emoji-safe truncation
  return chars || `Guest-${crypto.randomInt(1000, 9999)}`;
}

function sanitizeAvatarId(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < AVATAR_COUNT ? n : 0;
}

function sanitizeRoomCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 8);
}

module.exports = { sanitizeNickname, sanitizeAvatarId, sanitizeRoomCode, AVATAR_COUNT, NICKNAME_MAX };
