'use strict';

const crypto = require('crypto');
const config = require('../config');
const { S2C } = require('../shared/events');
const { GameError } = require('../game/JokerBluffGame');
const { Room } = require('./Room');

const CODE_ALPHABET = config.ROOM_CODE_ALPHABET;

/** In-memory registry of every active private lobby. */
class RoomManager {
  /**
   * @param {{sessions: import('../sessions/SessionStore').SessionStore, transport: {toRoom: Function, toPlayer: Function, joinChannel: Function, leaveChannel: Function}}} deps
   */
  constructor({ sessions, transport, maxRooms = config.MAX_ROOMS }) {
    this.sessions = sessions;
    this.transport = transport;
    this.maxRooms = maxRooms;
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

  createRoom(session, profile) {
    if (this.rooms.size >= this.maxRooms) this.cleanup();
    if (this.rooms.size >= this.maxRooms) throw new GameError('SERVER_BUSY', 'Server is busy, try again');
    const room = new Room({ code: this._generateCode(), sessions: this.sessions, transport: this.transport });
    this.leaveRoom(session);
    Object.assign(session, profile);
    this.rooms.set(room.code, room);
    this._seat(session, room);
    return room;
  }

  joinRoom(session, code, profile = {}) {
    const room = this.get(code);
    if (!room) throw new GameError('ROOM_UNAVAILABLE', 'Could not join that lobby');
    try {
      room.assertCanSeat(session.playerId);
    } catch (err) {
      if (!(err instanceof GameError)) throw err;
      throw new GameError('ROOM_UNAVAILABLE', 'Could not join that lobby');
    }
    room.assertCanUpdateProfile(session, profile);
    if (session.roomCode && session.roomCode !== code) this.leaveRoom(session);
    Object.assign(session, profile);
    this._seat(session, room);
    return room;
  }

  leaveRoom(session) {
    const room = session.roomCode ? this.get(session.roomCode) : null;
    session.roomCode = null;
    if (!room) return;
    session.lastSeen = Date.now();
    if (session.socketId) this.transport.leaveChannel(session.socketId, room.code);
    room.removePlayer(session.playerId);
    this.transport.toPlayer(session.playerId, S2C.ROOM_STATE, null);
    this.transport.toPlayer(session.playerId, S2C.GAME_STATE, null);
    if (room.isEmpty) this._delete(room);
  }

  kickPlayer(room, hostId, playerId) {
    room.assertCanKick(hostId, playerId);
    room.kickedGuests.add(playerId);
    this.leaveRoom(this.sessions.getByPlayerId(playerId));
    this.transport.toPlayer(playerId, S2C.ROOM_KICKED);
  }

  /** Re-attaches a reconnecting socket to the room it was seated in. */
  restore(session) {
    const room = session.roomCode ? this.get(session.roomCode) : null;
    if (!room || !room.hasHumanSeat(session.playerId)) {
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
      if (room.isEmpty || (room.graceTimers.size === 0 && room.emptySince && now - room.emptySince > config.EMPTY_ROOM_TTL_MS)) {
        for (const p of room.players) {
          const s = this.sessions.getByPlayerId(p.id);
          if (!p.isBot && s?.roomCode === room.code) {
            s.roomCode = null;
            s.lastSeen = now;
          }
        }
        this._delete(room);
        removed++;
      } else {
        room.pruneTokenBank();
        room.pruneKickedGuests();
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
    session.roomCode = room.code;
    if (session.socketId) this.transport.joinChannel(session.socketId, room.code);
    room.addPlayer(session);
  }

  _delete(room) {
    room.destroy();
    this.rooms.delete(room.code);
  }
}

module.exports = { RoomManager };
