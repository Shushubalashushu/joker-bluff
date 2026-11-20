import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { C2S, S2C } from '../constants/events';
import { createSocket, destroySocket, emitAck, measureClockOffset, reconnectNow } from '../services/socket';
import { useProfile } from './ProfileContext';

const GameContext = createContext(null);

const initialState = {
  connection: 'connecting', // 'connecting' | 'online' | 'offline'
  connectError: null, // last connect_error message (shown in the banner)
  playerId: null,
  room: null, // public lobby state (same for everyone)
  game: null, // MY redacted view of the game (server decides what I can see)
  clockOffset: 0, // serverNow - Date.now()
  events: [], // public events emitted together for one server state update
  notice: null, // sticky message for the lobby, e.g. "Bob left - match ended"
  knownPlayers: {}, // id -> {nickname, avatarId}: keeps names of players who already left
  concealed: false, // Anti-spy: my hand is flipped face-down (local only, never sent)
};

function rememberPlayers(known, room, game) {
  const players = {};
  for (const p of room?.players ?? []) players[p.id] = { nickname: p.nickname, avatarId: p.avatarId };
  for (const { id } of game?.seats ?? []) {
    if (!players[id] && known[id]) players[id] = known[id];
  }
  return players;
}

function reducer(state, action) {
  switch (action.type) {
    case 'connection':
      return {
        ...state,
        connection: action.value,
        connectError: action.value === 'online' ? null : action.error ?? state.connectError,
      };
    case 'session':
      if (state.playerId && state.playerId !== action.playerId) {
        return { ...initialState, connection: state.connection, playerId: action.playerId, concealed: state.concealed };
      }
      return { ...state, playerId: action.playerId };
    case 'room': {
      const room = action.room;
      const sameRoom = room && room.code === state.room?.code;
      const game = sameRoom && state.game?.matchId === room.lifecycleId ? state.game : null;
      const started = action.events.some((e) => e.type === 'game_started');
      const aborted = action.events.find((e) => e.type === 'game_aborted');
      return {
        ...state,
        room,
        game,
        events: action.events.length ? action.events : sameRoom ? state.events : [],
        notice: aborted ? { ...aborted, id: `${aborted.type}-${aborted.at}` } : sameRoom && !started ? state.notice : null,
        knownPlayers: rememberPlayers(state.knownPlayers, room, game),
      };
    }
    case 'game': {
      const game = action.game;
      if (game && game.matchId !== state.room?.lifecycleId) return state;
      return { ...state, game, knownPlayers: rememberPlayers(state.knownPlayers, state.room, game) };
    }
    case 'clock':
      return { ...state, clockOffset: action.offset };
    case 'clearNotice':
      return { ...state, notice: null };
    case 'concealed':
      return { ...state, concealed: typeof action.value === 'boolean' ? action.value : !state.concealed };
    default:
      return state;
  }
}

/**
 * Owns the socket connection and mirrors the server's "source of truth".
 * Screens never mutate game state locally - they emit intents and wait for
 * the server to push the new redacted state back.
 */
export function GameProvider({ children }) {
  const profile = useProfile();
  const [state, dispatch] = useReducer(reducer, initialState);

  // Latest profile for the socket auth callback (read on every reconnect).
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useEffect(() => {
    if (!profile.ready) return undefined;

    const socket = createSocket(() => ({
      token: profileRef.current.token,
      nickname: profileRef.current.nickname,
      avatarId: profileRef.current.avatarId,
    }));

    socket.on('connect', async () => {
      const socketId = socket.id;
      dispatch({ type: 'connection', value: 'online' });
      const offset = await measureClockOffset();
      if (socket.id === socketId) dispatch({ type: 'clock', offset });
    });
    const pendingEvents = [];
    socket.on('disconnect', () => {
      pendingEvents.length = 0;
      dispatch({ type: 'connection', value: 'offline' });
    });
    socket.on('connect_error', (err) =>
      dispatch({ type: 'connection', value: 'offline', error: { code: err?.data?.code || 'CONNECT_FAILED' } })
    );

    socket.on(S2C.SESSION, (s) => {
      profileRef.current.setToken(s.token);
      dispatch({ type: 'session', playerId: s.playerId });
    });
    socket.on(S2C.ROOM_STATE, (room) => dispatch({ type: 'room', room, events: pendingEvents.splice(0) }));
    socket.on(S2C.GAME_STATE, (game) => dispatch({ type: 'game', game }));
    socket.on(S2C.GAME_EVENT, (event) => pendingEvents.push(event));

    socket.connect();
    return () => destroySocket();
  }, [profile.ready]);

  // Keep the lobby in sync when the player edits their profile mid-lobby.
  useEffect(() => {
    if (!state.room || state.connection !== 'online') return undefined;
    const t = setTimeout(() => {
      emitAck(C2S.UPDATE_PROFILE, { nickname: profile.nickname, avatarId: profile.avatarId });
    }, 600);
    return () => clearTimeout(t);
  }, [profile.nickname, profile.avatarId, state.room?.code, state.connection]); // eslint-disable-line react-hooks/exhaustive-deps

  const profilePayload = () => ({ nickname: profileRef.current.nickname, avatarId: profileRef.current.avatarId });
  const code = state.room?.code;
  const lifecycleId = state.room?.lifecycleId;
  const matchId = state.game?.matchId;
  const step = state.game?.step;

  const createRoom = useCallback(() => emitAck(C2S.CREATE_ROOM, profilePayload()), []);
  const joinRoom = useCallback((roomCode) => emitAck(C2S.JOIN_ROOM, { ...profilePayload(), code: roomCode }), []);
  const leaveRoom = useCallback(() => emitAck(C2S.LEAVE_ROOM, { code }), [code]);
  const startGame = useCallback(() => emitAck(C2S.START_GAME, { lifecycleId }), [lifecycleId]);
  const playAgain = useCallback(() => emitAck(C2S.PLAY_AGAIN, { lifecycleId }), [lifecycleId]);
  const endGame = useCallback(() => emitAck(C2S.END_GAME, { lifecycleId }), [lifecycleId]);
  const requestCard = useCallback((rank) => emitAck(C2S.REQUEST_CARD, { matchId, step, rank }), [matchId, step]);
  /**
   * `touches` = my touch trail while choosing (Lie Deye telemetry for the receiver).
   * `noCard`  = "I don't have it" (System Verified Forced Bluff) - the server checks it.
   */
  const offerCard = useCallback(
    (cardId, touches = [], noCard = false) =>
      emitAck(C2S.OFFER_CARD, { matchId, step, cardId, touches, noCard }),
    [matchId, step]
  );
  const decide = useCallback((accept) => emitAck(C2S.PLAYER_DECISION, { matchId, step, accept }), [matchId, step]);
  // Not called `useLieDeye` on purpose: the `use` prefix is reserved for React hooks.
  const spendLieDeye = useCallback(() => emitAck(C2S.USE_LIE_DEYE, { matchId, step }), [matchId, step]);
  // `order` (optional) = client-proposed permutation of hand card ids; the server
  // validates it (falls back to its own random shuffle) and acks { order }.
  const shuffleHand = useCallback(
    (order) => emitAck(C2S.SHUFFLE_HAND, { matchId, order }),
    [matchId]
  );
  // (No declareWin: the server ends the game automatically when someone passes
  // their 5th card away and is left with 4 of a kind.)
  const clearNotice = useCallback(() => dispatch({ type: 'clearNotice' }), []);
  const setConcealed = useCallback((value) => dispatch({ type: 'concealed', value }), []);
  const retryConnection = useCallback(() => reconnectNow(), []);

  const value = useMemo(
    () => ({
      ...state,
      createRoom,
      joinRoom,
      leaveRoom,
      startGame,
      playAgain,
      endGame,
      requestCard,
      offerCard,
      decide,
      spendLieDeye,
      shuffleHand,
      clearNotice,
      setConcealed,
      retryConnection,
    }),
    [
      state,
      createRoom,
      joinRoom,
      leaveRoom,
      startGame,
      playAgain,
      endGame,
      requestCard,
      offerCard,
      decide,
      spendLieDeye,
      shuffleHand,
      clearNotice,
      setConcealed,
      retryConnection,
    ]
  );

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside <GameProvider>');
  return ctx;
}
