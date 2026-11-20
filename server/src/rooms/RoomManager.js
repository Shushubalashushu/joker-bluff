'use strict';

const crypto = require('crypto');
const config = require('../config');
const { S2C } = require('../shared/events');
const { GameError } = require('../game/JokerBluffGame');
const { Room } = require('./Room');

// No 0/O/1/I/L - codes get read out loud between friends.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** In-memory registry of every active private lobby. */
class RoomManager {
  /**
   * @param {{sessions: import('../sessions/SessionStore').SessionStore, transport: {toRoom: Function, toPlayer: Function, joinChannel: Function, leaveChannel: Function}}} deps
   */
  constructor({ sessions, transport }) {
    this.sessions = sessions;
    this.transport = transport;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
  }

  get(code) {
    return this.rooms.get(code) || null;
  }

  _generateCode() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let code = '';
      for (let i = 0; i < config.ROOM_CODE_LENGTH; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError('NO_CODES', 'Server is busy, try again');
  }

  createRoom(session) {
    this.leaveRoom(session);
    const room = new Room({ code: this._generateCode(), sessions: this.sessions, transport: this.transport });
    this.rooms.set(room.code, room);
    this._seat(session, room);
    return room;
  }

  joinRoom(session, code) {
    const room = this.get(code);
    if (!room) throw new GameError('ROOM_NOT_FOUND', 'No lobby with that code');
    if (session.roomCode && session.roomCode !== code) this.leaveRoom(session);
    this._seat(session, room);
    return room;
  }

  leaveRoom(session) {
    const room = session.roomCode ? this.get(session.roomCode) : null;
    session.roomCode = null;
    if (!room) return;
    if (session.socketId) this.transport.leaveChannel(session.socketId, room.code);
    room.removePlayer(session.playerId); // mid-match: terminates the match for everyone else
    this.transport.toPlayer(session.playerId, S2C.ROOM_STATE, null);
    this.transport.toPlayer(session.playerId, S2C.GAME_STATE, null);
    if (room.isEmpty) this._delete(room);
  }

  /** Re-attaches a reconnecting socket to the room it was seated in. */
  restore(session) {
    const room = session.roomCode ? this.get(session.roomCode) : null;
    if (!room || !room.hasPlayer(session.playerId)) {
      session.roomCode = null;
      return null;
    }
    this.transport.joinChannel(session.socketId, room.code);
    room.addPlayer(session);
    return room;
  }

  /** Delete rooms nobody has been connected to for a while. */
  cleanup(now = Date.now()) {
    let removed = 0;
    for (const room of this.rooms.values()) {
      if (room.emptySince && now - room.emptySince > config.EMPTY_ROOM_TTL_MS) {
        for (const p of room.players) {
          const s = this.sessions.getByPlayerId(p.id);
          if (s && s.roomCode === room.code) s.roomCode = null;
        }
        this._delete(room);
        removed++;
      }
    }
    return removed;
  }

  stats() {
    let playing = 0;
    for (const r of this.rooms.values()) if (r.status === 'playing') playing++;
    return { rooms: this.rooms.size, playing };
  }

  _seat(session, room) {
    room.addPlayer(session); // throws if full / in progress
    session.roomCode = room.code;
    if (session.socketId) this.transport.joinChannel(session.socketId, room.code);
    room.broadcast(); // re-broadcast now that the socket is in the channel
  }

  _delete(room) {
    room.destroy();
    this.rooms.delete(room.code);
  }
}

module.exports = { RoomManager };
