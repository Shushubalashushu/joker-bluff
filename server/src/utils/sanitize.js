'use strict';

const crypto = require('crypto');
const config = require('../config');

const AVATAR_COUNT = 12; // must match app/src/constants/avatars.js
const NICKNAME_MAX = 16;

function sanitizeNickname(raw) {
  const clean = (typeof raw === 'string' ? raw : '')
    // strip control chars & zero-width/bidi tricks
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = Array.from(clean).slice(0, NICKNAME_MAX).join(''); // emoji-safe truncation
  return chars || `Guest-${crypto.randomInt(1000, 9999)}`;
}

function isAvatarId(value) {
  return Number.isInteger(value) && value >= 0 && value < AVATAR_COUNT;
}

function sanitizeRoomCode(raw) {
  if (typeof raw !== 'string' || raw.length > 32) return '';
  const code = raw.trim();
  if (code.length !== config.ROOM_CODE_LENGTH || !/^[A-Za-z0-9]+$/.test(code)) return '';
  const upper = code.toUpperCase();
  return [...upper].every((ch) => config.ROOM_CODE_ALPHABET.includes(ch)) ? upper : '';
}

module.exports = { sanitizeNickname, isAvatarId, sanitizeRoomCode, AVATAR_COUNT, NICKNAME_MAX };
