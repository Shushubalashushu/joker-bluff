'use strict';

const config = require('../config');
const { C2S, S2C } = require('../shared/events');
const { GameError } = require('../game/JokerBluffGame');
const { sanitizeNickname, sanitizeAvatarId, sanitizeRoomCode } = require('../utils/sanitize');

// (No `declare_win`: victory is automatic, see JokerBluffGame#_checkAutoWin.)
const GAME_ACTIONS = [C2S.REQUEST_CARD, C2S.OFFER_CARD, C2S.PLAYER_DECISION, C2S.USE_LIE_DEYE];

function applyProfile(session, payload = {}) {
  if (payload.nickname !== undefined) session.nickname = sanitizeNickname(payload.nickname);
  if (payload.avatarId !== undefined) session.avatarId = sanitizeAvatarId(payload.avatarId);
  if (!session.nickname) session.nickname = sanitizeNickname('');
}

/**
 * Wires Socket.IO to the session store and room manager.
 * Every client->server event uses an ack callback: `{ ok: true, ...data }` or `{ ok: false, code, error }`.
 */
function registerSocketHandlers(io, { sessions, rooms }) {
  // ---- Guest "login": resume by secret token or mint a new guest session.
  io.use((socket, next) => {
    const auth = socket.handshake.auth || {};
    const session = sessions.getByToken(auth.token) || sessions.create();
    applyProfile(session, auth);
    socket.data.session = session;
    next();
  });

  io.on('connection', (socket) => {
    const session = socket.data.session;

    // One live socket per guest: newest connection wins (e.g. app was reopened).
    const previousSocketId = session.socketId;
    session.socketId = socket.id;
    session.lastSeen = Date.now();
    if (previousSocketId && previousSocketId !== socket.id) io.sockets.sockets.get(previousSocketId)?.disconnect(true);

    socket.emit(S2C.SESSION, {
      token: session.token,
      playerId: session.playerId,
      nickname: session.nickname,
      avatarId: session.avatarId,
    });

    if (!rooms.restore(session)) {
      socket.emit(S2C.ROOM_STATE, null);
      socket.emit(S2C.GAME_STATE, null);
    }

    // ---- tiny flood guard
    let windowStart = Date.now();
    let count = 0;
    socket.use((packet, next) => {
      const now = Date.now();
      if (now - windowStart > config.RATE_LIMIT.WINDOW_MS) {
        windowStart = now;
        count = 0;
      }
      if (++count > config.RATE_LIMIT.MAX_EVENTS) {
        const ack = packet[packet.length - 1];
        if (typeof ack === 'function') ack({ ok: false, code: 'RATE_LIMITED', error: 'Slow down!' });
        return; // drop silently
      }
      next();
    });

    const currentRoom = () => {
      const room = session.roomCode && rooms.get(session.roomCode);
      if (!room) throw new GameError('NO_ROOM', 'You are not in a lobby');
      return room;
    };

    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') {
          ack = payload;
          payload = {};
        }
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          const data = handler(payload && typeof payload === 'object' ? payload : {}) || {};
          reply({ ok: true, ...data });
        } catch (err) {
          if (err instanceof GameError) {
            reply({ ok: false, code: err.code, error: err.message });
          } else {
            console.error(`[socket ${socket.id}] ${event} failed`, err);
            reply({ ok: false, code: 'INTERNAL', error: 'Something went wrong' });
          }
        }
      });
    };

    on(C2S.TIME_SYNC, () => ({ serverNow: Date.now() }));

    on(C2S.UPDATE_PROFILE, (p) => {
      applyProfile(session, p);
      if (session.roomCode) rooms.get(session.roomCode)?.updateProfile(session);
      return { nickname: session.nickname, avatarId: session.avatarId };
    });

    on(C2S.CREATE_ROOM, (p) => {
      applyProfile(session, p);
      const room = rooms.createRoom(session);
      return { code: room.code };
    });

    on(C2S.JOIN_ROOM, (p) => {
      applyProfile(session, p);
      const code = sanitizeRoomCode(p.code);
      if (code.length !== config.ROOM_CODE_LENGTH) throw new GameError('BAD_CODE', 'Room codes are 5 characters');
      rooms.joinRoom(session, code);
      return { code };
    });

    on(C2S.LEAVE_ROOM, () => {
      rooms.leaveRoom(session);
    });

    on(C2S.START_GAME, () => {
      currentRoom().startGame(session.playerId);
    });

    on(C2S.PLAY_AGAIN, () => {
      currentRoom().startGame(session.playerId);
    });

    on(C2S.END_GAME, () => {
      currentRoom().endGame(session.playerId);
    });

    // Private, available any time during a match (not subject to the phase deadline).
    // Payload: { order?: string[] } -> ack { ok, order }
    on(C2S.SHUFFLE_HAND, (p) => ({ order: currentRoom().shuffleHand(session.playerId, p.order) }));

    for (const event of GAME_ACTIONS) {
      on(event, (p) => {
        currentRoom().act(session.playerId, event, p);
      });
    }

    socket.on('disconnect', () => {
      if (session.socketId !== socket.id) return; // superseded by a newer socket
      session.socketId = null;
      session.lastSeen = Date.now();
      if (session.roomCode) rooms.get(session.roomCode)?.onPlayerDisconnected(session.playerId);
    });
  });
}

module.exports = { registerSocketHandlers };
