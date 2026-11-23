'use strict';

const config = require('../config');
const { C2S, S2C } = require('../shared/events');
const { GameError } = require('../game/JokerBluffGame');
const { MAX_INPUT_SAMPLES } = require('../game/telemetry');
const { sanitizeNickname, isAvatarId, sanitizeRoomCode } = require('../utils/sanitize');
const { containsProfanity } = require('../utils/profanityFilter');
const {
  createRateLimiter, ADDRESS_JOIN_LIMIT, GUEST_JOIN_LIMIT, ADDRESS_NEW_GUEST_LIMIT, GLOBAL_NEW_GUEST_LIMIT,
} = require('../utils/rateLimit');

// (No `declare_win`: victory is automatic, see JokerBluffGame#_checkAutoWin.)
const GAME_ACTIONS = [C2S.REQUEST_CARD, C2S.OFFER_CARD, C2S.PLAYER_DECISION, C2S.USE_LIE_DEYE];

const CARD_ID = /^c_[0-9a-f]{12}$/;
const PLAYER_ID = /^p_[0-9a-f]{16}$/;
const SESSION_TOKEN = /^[A-Za-z0-9_-]{32}$/;
const isObject = (value) => value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;

function readProfile(payload, { auth = false, requireNickname = false } = {}) {
  const profile = {};
  if (payload.nickname !== undefined) {
    if (typeof payload.nickname !== 'string' || payload.nickname.length > 128) {
      throw new GameError('BAD_PAYLOAD', 'Invalid nickname');
    }
    const nickname = sanitizeNickname(payload.nickname, { fallback: !requireNickname });
    if (!nickname) throw new GameError('NICKNAME_REQUIRED', 'Choose a nickname');
    if (!containsProfanity(nickname)) {
      profile.nickname = nickname;
    } else if (!auth) {
      throw new GameError('NICKNAME_PROFANITY', 'Choose a nickname without offensive language');
    }
  }
  if (payload.avatarId !== undefined) {
    if (!isAvatarId(payload.avatarId)) throw new GameError('BAD_PAYLOAD', 'Invalid avatar');
    profile.avatarId = payload.avatarId;
  }
  return profile;
}

function validateOffer({ cardId, touches, claimedNoCard }) {
  if (typeof cardId !== 'string' || !CARD_ID.test(cardId)) throw new GameError('BAD_CARD', 'Invalid card');
  if (touches !== undefined && (!Array.isArray(touches) || touches.length > MAX_INPUT_SAMPLES)) {
    throw new GameError('BAD_PAYLOAD', 'Invalid touch samples');
  }
  if (claimedNoCard !== undefined && typeof claimedNoCard !== 'boolean') {
    throw new GameError('BAD_PAYLOAD', 'Invalid bluff claim');
  }
}

/**
 * Wires Socket.IO to the session store and room manager.
 * Every client->server event uses an ack callback: `{ ok: true, ...data }` or `{ ok: false, code, error }`.
 */
function registerSocketHandlers(io, { sessions, rooms, addressOf, maxOpenForNewGuests }) {
  const allowJoinFromAddress = createRateLimiter(ADDRESS_JOIN_LIMIT);
  const allowJoinForGuest = createRateLimiter(GUEST_JOIN_LIMIT);
  const allowNewGuestFromAddress = createRateLimiter(ADDRESS_NEW_GUEST_LIMIT);
  const allowNewGuestGlobally = createRateLimiter(GLOBAL_NEW_GUEST_LIMIT);
  const allowEvent = createRateLimiter({
    windowMs: config.RATE_LIMIT.WINDOW_MS,
    maxAttempts: config.RATE_LIMIT.MAX_EVENTS,
    maxKeys: config.MAX_SESSIONS,
  });

  // ---- Guest "login": resume by secret token or mint a new guest session.
  io.use((socket, next) => {
    try {
      const auth = socket.handshake.auth ?? {};
      if (!isObject(auth) || (auth.token != null && (typeof auth.token !== 'string' || !SESSION_TOKEN.test(auth.token)))) {
        throw new GameError('BAD_PAYLOAD', 'Invalid guest session');
      }
      const profile = readProfile(auth, { auth: true });
      const address = addressOf(socket.request);
      let session = sessions.getByToken(auth.token);
      if (!session) {
        if (io.engine.clientsCount > maxOpenForNewGuests) throw new GameError('SERVER_BUSY', 'Server is busy, try again');
        if (!allowNewGuestFromAddress(address) || !allowNewGuestGlobally('new-guests')) {
          throw new GameError('RATE_LIMITED', 'Too many new guests. Try again shortly');
        }
        session = sessions.create();
      }
      if (!session) throw new GameError('SERVER_BUSY', 'Server is busy, try again');
      // A seated guest's approved nickname survives reconnects and stale local profile data.
      if (session.roomCode) delete profile.nickname;
      Object.assign(session, profile);
      if (!session.nickname) session.nickname = sanitizeNickname('');
      socket.data.session = session;
      socket.data.address = address;
    } catch (err) {
      if (!(err instanceof GameError)) console.error('Guest handshake failed', err);
      const error = new Error(err instanceof GameError ? err.message : 'Could not connect');
      error.data = { code: err instanceof GameError ? err.code : 'INTERNAL' };
      return next(error);
    }
    return next();
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

    // Charge the guest's budget even after its transport is replaced.
    socket.use((packet, next) => {
      if (!allowEvent(session.playerId)) {
        const ack = packet[packet.length - 1];
        if (typeof ack === 'function') ack({ ok: false, code: 'RATE_LIMITED', error: 'Slow down!' });
        return; // drop silently
      }
      next();
    });

    const currentRoom = (lifecycleId) => {
      const room = session.roomCode && rooms.get(session.roomCode);
      if (!room?.hasHumanSeat(session.playerId)) throw new GameError('NO_ROOM', 'You are not in a lobby');
      if (lifecycleId !== undefined) room.assertLifecycle(lifecycleId);
      return room;
    };

    const on = (event, handler) => {
      socket.on(event, (...args) => {
        const reply = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
        const [payload] = args;
        try {
          if (session.socketId !== socket.id) throw new GameError('STALE_ACTION', 'This guest connection was replaced');
          if (args.length > 1 || (payload !== undefined && !isObject(payload))) {
            throw new GameError('BAD_PAYLOAD', 'Expected one payload object');
          }
          const data = handler(payload ?? {}) || {};
          reply({ ok: true, ...data });
        } catch (err) {
          if (err instanceof GameError) {
            reply({ ok: false, code: err.code, error: err.message, params: err.params });
          } else {
            console.error(`[socket ${socket.id}] ${event} failed`, err);
            reply({ ok: false, code: 'INTERNAL', error: 'Something went wrong' });
          }
        }
      });
    };

    on(C2S.TIME_SYNC, () => ({ serverNow: Date.now() }));

    on(C2S.UPDATE_PROFILE, (p) => {
      const scoped = p.lifecycleId !== undefined;
      const room = scoped ? currentRoom(p.lifecycleId ?? null) : rooms.get(session.roomCode);
      const profile = readProfile(p, { requireNickname: scoped });
      if (room) room.updateProfile(session, profile);
      else Object.assign(session, profile);
      return { nickname: session.nickname, avatarId: session.avatarId };
    });

    on(C2S.CREATE_ROOM, (p) => {
      const room = rooms.createRoom(session, readProfile(p));
      return { code: room.code };
    });

    on(C2S.JOIN_ROOM, (p) => {
      if (!allowJoinForGuest(session.playerId) || !allowJoinFromAddress(socket.data.address)) {
        throw new GameError('RATE_LIMITED', 'Too many join attempts. Try again shortly');
      }
      const code = sanitizeRoomCode(p.code);
      if (!code) throw new GameError('BAD_CODE', 'Enter a valid 5-character room code');
      rooms.joinRoom(session, code, readProfile(p));
      return { code };
    });

    on(C2S.LEAVE_ROOM, (p) => {
      if (currentRoom().code !== p.code) throw new GameError('STALE_ACTION', 'The lobby has changed');
      rooms.leaveRoom(session);
    });

    on(C2S.KICK_PLAYER, (p) => {
      if (typeof p.playerId !== 'string' || !PLAYER_ID.test(p.playerId)) throw new GameError('BAD_PAYLOAD', 'Invalid player');
      rooms.kickPlayer(currentRoom(p.lifecycleId ?? null), session.playerId, p.playerId);
    });

    on(C2S.ADD_BOT, (p) => ({ botId: currentRoom(p.lifecycleId ?? null).addBot(session.playerId) }));

    on(C2S.REMOVE_BOT, (p) => {
      if (typeof p.botId !== 'string' || !/^b_[0-9a-f-]{36}$/.test(p.botId)) {
        throw new GameError('BAD_PAYLOAD', 'Invalid bot seat');
      }
      currentRoom(p.lifecycleId ?? null).removeBot(session.playerId, p.botId);
    });

    on(C2S.SET_TURN_SPEED, (p) => {
      currentRoom(p.lifecycleId ?? null).setTurnSpeed(session.playerId, p.speed);
    });

    on(C2S.START_GAME, (p) => {
      currentRoom(p.lifecycleId ?? null).startGame(session.playerId);
    });

    on(C2S.PLAY_AGAIN, (p) => {
      currentRoom(p.lifecycleId ?? null).startGame(session.playerId, { rematch: true });
    });

    on(C2S.END_GAME, (p) => {
      currentRoom(p.lifecycleId ?? null).endGame(session.playerId);
    });

    // Private, available any time during a match (not subject to the phase deadline).
    on(C2S.SHUFFLE_HAND, (p) => {
      const room = currentRoom(p.matchId ?? null);
      const { order } = p;
      if (order !== undefined && (!Array.isArray(order) || order.length > 5 || !order.every((id) => typeof id === 'string' && CARD_ID.test(id)))) {
        throw new GameError('BAD_PAYLOAD', 'Invalid shuffle order');
      }
      return { order: room.shuffleHand(session.playerId, order) };
    });

    for (const event of GAME_ACTIONS) {
      on(event, (p) => {
        const room = currentRoom(p.matchId ?? null);
        room.assertStep(p.step);
        if (event === C2S.OFFER_CARD) validateOffer(p);
        if (event === C2S.PLAYER_DECISION && p.offerIndex !== undefined && !Number.isInteger(p.offerIndex)) {
          throw new GameError('BAD_DECISION', 'Offer index must be an integer');
        }
        room.act(session.playerId, event, p);
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
