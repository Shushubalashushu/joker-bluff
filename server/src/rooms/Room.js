'use strict';

const { randomUUID } = require('node:crypto');
const config = require('../config');
const { S2C, C2S } = require('../shared/events');
const { JokerBluffGame, GameError } = require('../game/JokerBluffGame');

const ROOM_STATUS = Object.freeze({ WAITING: 'waiting', PLAYING: 'playing', FINISHED: 'finished' });
const ACTION_GRACE_MS = 250; // latency allowance before the server auto-plays

/** Why a match was terminated early (sent to clients in a `game_aborted` event). */
const ABORT_REASONS = Object.freeze({
  PLAYER_LEFT: 'player_left',
  PLAYER_DISCONNECTED: 'player_disconnected',
  HOST_ENDED: 'host_ended',
  SERVER_ERROR: 'server_error',
});

/**
 * One private lobby + its (optional) running game.
 * Owns the phase timer, disconnect-grace timers, and decides who receives
 * which redacted state.
 *
 * Leaving rules:
 *  - waiting room: the player simply loses their seat.
 *  - mid-match:   the deck size depends on the player count, so the match is
 *                 TERMINATED; everyone remaining returns to the waiting room.
 *  - disconnect:  the seat is kept (server auto-plays) for DISCONNECT_GRACE_MS;
 *                 if they don't come back it's treated as leaving.
 *  - host:        can End Game at any time -> everyone back to the waiting room.
 */
class Room {
  /**
   * @param {object} deps
   * @param {string} deps.code
   * @param {import('../sessions/SessionStore').SessionStore} deps.sessions
   * @param {{toRoom: Function, toPlayer: Function}} deps.transport
   */
  constructor({ code, sessions, transport }) {
    this.code = code;
    this.lifecycleId = randomUUID();
    this.sessions = sessions;
    this.transport = transport;
    this.hostId = null;
    /** @type {{id: string, nickname: string, avatarId: number}[]} seat order */
    this.players = [];
    this.status = ROOM_STATUS.WAITING;
    /** @type {JokerBluffGame|null} */
    this.game = null;
    this.timer = null;
    /** @type {Map<string, NodeJS.Timeout>} playerId -> disconnect grace timer */
    this.graceTimers = new Map();
    /**
     * Lie Deye balances, owned by the ROOM so they carry over between matches.
     * Entries are kept even if a player leaves, so leaving + rejoining can't reset
     * a spent balance back to the starting amount.
     * @type {Map<string, number>}
     */
    this.tokenBank = new Map();
    this.tokensSettled = false; // win bonus paid for the current finished match
    this.createdAt = Date.now();
    this.emptySince = Date.now();
  }

  /** Current Lie Deye balance (first-time players get the starting amount). */
  tokenBalance(playerId) {
    if (!this.tokenBank.has(playerId)) this.tokenBank.set(playerId, config.LIE_DEYE.STARTING_TOKENS);
    return this.tokenBank.get(playerId);
  }

  // ------------------------------------------------------------ membership

  hasPlayer(playerId) {
    return this.players.some((p) => p.id === playerId);
  }

  get isEmpty() {
    return this.players.length === 0;
  }

  get connectedCount() {
    return this.players.filter((p) => this.sessions.isConnected(p.id)).length;
  }

  nicknameOf(playerId) {
    return this.players.find((p) => p.id === playerId)?.nickname ?? 'A player';
  }

  /** Adds a new seat, or re-seats a returning player (reconnect). */
  addPlayer(session) {
    this.assertCanSeat(session.playerId);
    const existing = this.players.find((p) => p.id === session.playerId);
    if (existing) {
      existing.nickname = session.nickname;
      existing.avatarId = session.avatarId;
    } else {
      this.players.push({ id: session.playerId, nickname: session.nickname, avatarId: session.avatarId });
    }
    if (!this.hostId) this.hostId = session.playerId;
    this.tokenBalance(session.playerId);
    this._clearGrace(session.playerId);
    this.emptySince = null;
    this.onConnectionChanged();
  }

  assertCanSeat(playerId) {
    if (this.hasPlayer(playerId)) return;
    if (this.status !== ROOM_STATUS.WAITING) throw new GameError('IN_PROGRESS', 'That game has already started');
    if (this.players.length >= config.MAX_PLAYERS) throw new GameError('ROOM_FULL', 'This lobby is full');
  }

  /**
   * Removes a player. Mid-match this terminates the match for everyone.
   * @param {string} playerId
   * @param {string} [reason] one of ABORT_REASONS (used when a match is aborted)
   */
  removePlayer(playerId, reason = ABORT_REASONS.PLAYER_LEFT) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const [leaver] = this.players.splice(idx, 1);
    this._clearGrace(playerId);

    if (this.hostId === playerId) {
      const next = this.players.find((p) => this.sessions.isConnected(p.id)) || this.players[0];
      this.hostId = next ? next.id : null;
    }

    if (this.status === ROOM_STATUS.PLAYING) {
      this._abortGame({ reason, playerId, nickname: leaver.nickname });
    } else {
      this.onConnectionChanged();
    }
  }

  updateProfile(session) {
    const p = this.players.find((x) => x.id === session.playerId);
    if (!p) return;
    p.nickname = session.nickname;
    p.avatarId = session.avatarId;
    this.broadcast();
  }

  /** Socket dropped (not an explicit leave): keep the seat for a grace period. */
  onPlayerDisconnected(playerId) {
    if (!this.hasPlayer(playerId)) return;
    this._clearGrace(playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (!this.hasPlayer(playerId) || this.sessions.isConnected(playerId)) return;
      const session = this.sessions.getByPlayerId(playerId);
      if (session?.roomCode === this.code) session.roomCode = null;
      this.removePlayer(playerId, ABORT_REASONS.PLAYER_DISCONNECTED);
    }, config.DISCONNECT_GRACE_MS);
    t.unref?.();
    this.graceTimers.set(playerId, t);
    this.onConnectionChanged();
  }

  onConnectionChanged() {
    if (this.connectedCount === 0) this.emptySince = this.emptySince || Date.now();
    else this.emptySince = null;
    if (this.game && this.game.onConnectionChanged()) this._schedule();
    this.broadcast();
  }

  // ------------------------------------------------------------ lifecycle

  startGame(byPlayerId, { rematch = false } = {}) {
    if (byPlayerId !== this.hostId) throw new GameError('NOT_HOST', 'Only the host can start the game');
    const requiredStatus = rematch ? ROOM_STATUS.FINISHED : ROOM_STATUS.WAITING;
    if (this.status !== requiredStatus) {
      if (this.status === ROOM_STATUS.PLAYING) throw new GameError('IN_PROGRESS', 'Game already running');
      if (rematch) throw new GameError('NOT_FINISHED', 'Finish a game before starting a rematch');
      throw new GameError('REMATCH_REQUIRED', 'Use Play Again to start a rematch');
    }
    if (this.players.length < config.MIN_PLAYERS) {
      throw new GameError('NOT_ENOUGH_PLAYERS', `Need at least ${config.MIN_PLAYERS} players`, { min: config.MIN_PLAYERS });
    }
    if (this.connectedCount !== this.players.length) {
      throw new GameError('PLAYERS_OFFLINE', 'Wait for offline players to reconnect or leave the lobby');
    }

    const game = new JokerBluffGame(
      this.players.map((p) => p.id),
      {
        isConnected: (id) => this.hasPlayer(id) && this.sessions.isConnected(id),
        // Carry-over: each player brings their current room balance into the match.
        tokenBalances: new Map(this.players.map((p) => [p.id, this.tokenBalance(p.id)])),
      }
    );
    const events = game.start();
    this.game = game;
    this.lifecycleId = randomUUID();
    this.tokensSettled = false;
    this.status = ROOM_STATUS.PLAYING;
    this._afterGameChange(events);
  }

  /** Host-only: terminate the current match (or results screen) and return everyone to the lobby. */
  endGame(byPlayerId) {
    if (byPlayerId !== this.hostId) throw new GameError('NOT_HOST', 'Only the host can end the game');
    if (this.status === ROOM_STATUS.WAITING) throw new GameError('NOT_PLAYING', 'No game in progress');
    this._abortGame({ reason: ABORT_REASONS.HOST_ENDED, playerId: byPlayerId, nickname: this.nicknameOf(byPlayerId) });
  }

  /** Routes the in-game socket events to the engine. */
  act(playerId, event, payload = {}) {
    if (!this.hasPlayer(playerId)) throw new GameError('NO_ROOM', 'You are not in this lobby');
    if (this.status !== ROOM_STATUS.PLAYING || !this.game) throw new GameError('NOT_PLAYING', 'No game in progress');
    if (this.game.deadline && Date.now() > this.game.deadline + ACTION_GRACE_MS) {
      throw new GameError('TOO_LATE', 'Time is up!');
    }
    let events;
    switch (event) {
      case C2S.REQUEST_CARD:
        events = this.game.requestCard(playerId, payload.rank);
        break;
      case C2S.OFFER_CARD:
        // `noCard: true` = "I don't have it" (validated by the engine, never trusted).
        events = this.game.offerCard(playerId, payload.cardId, { touches: payload.touches, noCard: payload.noCard === true });
        break;
      case C2S.PLAYER_DECISION:
        events = this.game.decide(playerId, payload.accept);
        break;
      case C2S.USE_LIE_DEYE:
        events = this.game.useLieDeye(playerId);
        break;
      default:
        throw new GameError('UNKNOWN_ACTION', 'Unknown action');
    }
    this._afterGameChange(events);
  }

  assertLifecycle(id) {
    if (id !== this.lifecycleId) throw new GameError('STALE_ACTION', 'The lobby or match has changed');
  }

  assertStep(step) {
    if (!this.game || this.game.step !== step) throw new GameError('STALE_ACTION', 'That move is no longer current');
  }

  /**
   * Shuffle Hand: allowed at ANY time during a match (no deadline check, no turn check).
   * The order lives on the server so Lie Deye slot indices match what the player saw.
   * Only the shuffler's own state changes, so only they receive a new game_state.
   */
  shuffleHand(playerId, order) {
    if (!this.game || !this.hasPlayer(playerId)) throw new GameError('NOT_PLAYING', 'No game in progress');
    this.game.shuffleHand(playerId, order);
    const state = this._matchStateFor(playerId);
    this.transport.toPlayer(playerId, S2C.GAME_STATE, state);
    return state.hand.map((c) => c.id);
  }

  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.game = null;
  }

  pruneTokenBank() {
    for (const id of this.tokenBank.keys()) {
      if (!this.sessions.getByPlayerId(id)) this.tokenBank.delete(id);
    }
  }

  // ------------------------------------------------------------ broadcasting

  publicState() {
    return {
      code: this.code,
      lifecycleId: this.lifecycleId,
      hostId: this.hostId,
      status: this.status,
      minPlayers: config.MIN_PLAYERS,
      maxPlayers: config.MAX_PLAYERS,
      players: this.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        avatarId: p.avatarId,
        isHost: p.id === this.hostId,
        connected: this.sessions.isConnected(p.id),
        tokens: this.tokenBalance(p.id),
      })),
      lieDeye: { ...config.LIE_DEYE },
    };
  }

  /** Everyone gets the same room state, but each player gets their OWN redacted game state. */
  broadcast() {
    this.transport.toRoom(this.code, S2C.ROOM_STATE, this.publicState());
    for (const p of this.players) {
      this.transport.toPlayer(p.id, S2C.GAME_STATE, this._matchStateFor(p.id));
    }
  }

  _matchStateFor(playerId) {
    return this.game ? { ...this.game.getStateFor(playerId), matchId: this.lifecycleId } : null;
  }

  _abortGame(info) {
    clearTimeout(this.timer);
    this.timer = null;
    this.game = null;
    this.status = ROOM_STATUS.WAITING;
    this.lifecycleId = randomUUID();
    this.transport.toRoom(this.code, S2C.GAME_EVENT, { type: 'game_aborted', ...info, at: Date.now() });
    this.onConnectionChanged(); // broadcasts room_state (waiting) + game_state null
  }

  _clearGrace(playerId) {
    const t = this.graceTimers.get(playerId);
    if (t) clearTimeout(t);
    this.graceTimers.delete(playerId);
  }

  _afterGameChange(events) {
    this._syncTokenBank();
    if (this.game.isFinished) {
      this.status = ROOM_STATUS.FINISHED;
      const bonus = this._settleWinBonus();
      if (bonus) events = [...events, bonus];
    }
    for (const e of events) this.transport.toRoom(this.code, S2C.GAME_EVENT, { ...e, at: Date.now() });
    this.broadcast();
    this._schedule();
  }

  /** Spent tokens leave the room bank immediately (they stay spent even if the match is aborted). */
  _syncTokenBank() {
    if (!this.game) return;
    for (const id of this.game.seats) {
      if (this.game.tokens.has(id)) this.tokenBank.set(id, this.game.tokens.get(id));
    }
  }

  /** Winner gets +WIN_BONUS for the next match. Guarded so it's paid once per match. */
  _settleWinBonus() {
    if (this.tokensSettled || !this.game?.result?.winnerId) return null;
    this.tokensSettled = true;
    const winnerId = this.game.result.winnerId;
    const amount = config.LIE_DEYE.WIN_BONUS;
    const balance = this.tokenBalance(winnerId) + amount;
    this.tokenBank.set(winnerId, balance);
    this.game.tokens.set(winnerId, balance); // so the results screen shows the new balance
    return { type: 'lie_deye_bonus', playerId: winnerId, amount, balance };
  }

  _schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    const game = this.game;
    if (!game || game.isFinished || !game.deadline) return;
    const step = game.step;
    const delay = Math.max(0, game.deadline + ACTION_GRACE_MS - Date.now());
    this.timer = setTimeout(() => {
      if (this.game === game && game.step === step) this._onTimeout();
    }, delay);
    this.timer.unref?.();
  }

  _onTimeout() {
    this.timer = null;
    if (!this.game || this.game.isFinished) return;
    if (Date.now() < this.game.deadline + ACTION_GRACE_MS) return this._schedule();
    try {
      this._afterGameChange(this.game.handleTimeout());
    } catch (err) {
      console.error(`[room ${this.code}] timeout handling failed`, err);
      this._abortGame({ reason: ABORT_REASONS.SERVER_ERROR });
    }
  }
}

module.exports = { Room, ROOM_STATUS, ABORT_REASONS };
