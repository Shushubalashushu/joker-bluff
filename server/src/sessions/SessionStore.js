'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * In-memory guest sessions (no auth, no DB).
 *
 * The client stores a secret `token` and presents it on (re)connect.
 * The public `playerId` is what other clients see - never the token,
 * so nobody can hijack a seat by reading the room state.
 */
class SessionStore {
  constructor() {
    /** @type {Map<string, Session>} token -> session */
    this.byToken = new Map();
    /** @type {Map<string, Session>} playerId -> session */
    this.byPlayerId = new Map();
  }

  create() {
    if (this.size >= config.MAX_SESSIONS) return null;
    const session = {
      token: crypto.randomBytes(24).toString('base64url'),
      playerId: `p_${crypto.randomBytes(8).toString('hex')}`,
      nickname: '',
      avatarId: 0,
      socketId: null,
      roomCode: null,
      lastSeen: Date.now(),
    };
    this.byToken.set(session.token, session);
    this.byPlayerId.set(session.playerId, session);
    return session;
  }

  getByToken(token) {
    return typeof token === 'string' ? this.byToken.get(token) || null : null;
  }

  getByPlayerId(playerId) {
    return this.byPlayerId.get(playerId) || null;
  }

  socketIdOf(playerId) {
    return this.byPlayerId.get(playerId)?.socketId || null;
  }

  isConnected(playerId) {
    return !!this.socketIdOf(playerId);
  }

  delete(session) {
    this.byToken.delete(session.token);
    this.byPlayerId.delete(session.playerId);
  }

  /** Drop guest sessions that are offline and not seated anywhere. */
  cleanup(ttlMs, now = Date.now()) {
    let removed = 0;
    for (const s of this.byToken.values()) {
      if (!s.socketId && !s.roomCode && now - s.lastSeen > ttlMs) {
        this.delete(s);
        removed++;
      }
    }
    return removed;
  }

  get size() {
    return this.byToken.size;
  }
}

/**
 * @typedef {{token: string, playerId: string, nickname: string, avatarId: number,
 *   socketId: string|null, roomCode: string|null, lastSeen: number}} Session
 */

module.exports = { SessionStore };
