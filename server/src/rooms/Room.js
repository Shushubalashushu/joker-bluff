'use strict';

const { randomInt, randomUUID } = require('node:crypto');
const config = require('../config');
const { S2C, C2S } = require('../shared/events');
const { AVATAR_COUNT } = require('../utils/sanitize');
const { shuffle } = require('../game/deck');
const { JokerBluffGame, GameError } = require('../game/JokerBluffGame');
const { BotPlayer, PERSONALITIES } = require('../game/BotPlayer');

const ROOM_STATUS = Object.freeze({ WAITING: 'waiting', PLAYING: 'playing', FINISHED: 'finished' });
const ACTION_GRACE_MS = 250; // latency allowance before the server auto-plays
const BOT_DEADLINE_BUFFER_MS = 650;
const BOT_HISTORY_LIMIT = 192;
const BOT_NAMES = [
  ['Bamba', 'במבה'], ['Boba', 'בובה'], ['Coco', 'קוקו'], ['Gigi', 'ג׳יג׳י'],
  ['Kiwi', 'קיווי'], ['Lola', 'לולה'], ['Mika', 'מיקה'], ['Mochi', 'מוצ׳י'],
  ['Nori', 'נורי'], ['Peanut', 'בוטן'], ['Pip', 'פיפ'], ['Sunny', 'סאני'], ['Zuzu', 'זוזו'],
].map(([en, he]) => Object.freeze({ en, he }));

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
 *  - mid-match:   a bot takes the departing player's seat while any humans remain.
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
  constructor({ code, sessions, transport, botRandom = Math.random, botDelay, setupRandom = Math.random,
    disconnectGraceMs = config.DISCONNECT_GRACE_MS }) {
    this.code = code;
    this.lifecycleId = randomUUID();
    this.sessions = sessions;
    this.transport = transport;
    this.hostId = null;
    /** @type {{id: string, nickname: string, avatarId: number, isBot?: boolean, botName?: {en: string, he: string}}[]} lobby order */
    this.players = [];
    this.moderation = new Map();
    this.status = ROOM_STATUS.WAITING;
    this.turnSpeed = config.DEFAULT_TURN_SPEED;
    /** @type {JokerBluffGame|null} */
    this.game = null;
    this.timer = null;
    this.botJob = null;
    this.botBrains = new Map();
    this.botHistory = [];
    this.botRandom = botRandom;
    this.botDelay = botDelay;
    this.setupRandom = setupRandom;
    this.disconnectGraceMs = disconnectGraceMs;
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

  hasHumanSeat(playerId) {
    return this.players.some((p) => p.id === playerId && !p.isBot);
  }

  get isEmpty() {
    return this.players.length === 0;
  }

  get connectedCount() {
    return this.players.filter((p) => !p.isBot && this.sessions.isConnected(p.id)).length;
  }

  _ready(player) {
    return !!player && (!!player.isBot || this.sessions.isConnected(player.id));
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
    if (this.hasHumanSeat(playerId)) return;
    if (this.moderation.get(playerId)?.banned || this.hasPlayer(playerId)) {
      throw new GameError('ROOM_UNAVAILABLE', 'Could not join that lobby');
    }
    this.assertWaiting();
    if (this.players.length >= config.MAX_PLAYERS) throw new GameError('ROOM_FULL', 'This lobby is full');
  }

  assertWaiting() {
    if (this.status !== ROOM_STATUS.WAITING) throw new GameError('IN_PROGRESS', 'That game has already started');
  }

  _assertCanModerate(hostId) {
    if (hostId !== this.hostId) throw new GameError('NOT_HOST', 'Only the host can moderate this lobby');
    this.assertWaiting();
  }

  recordRemoval(hostId, playerId, { ban = false } = {}) {
    this._assertCanModerate(hostId);
    if (playerId === hostId) throw new GameError('CANNOT_KICK_SELF', 'The host cannot remove themself');
    const player = this.players.find((seat) => seat.id === playerId && !seat.isBot);
    if (!player) throw new GameError('PLAYER_NOT_FOUND', 'That player is no longer in the lobby');
    const kicks = (this.moderation.get(playerId)?.kicks ?? 0) + Number(!ban);
    this.moderation.set(playerId, { kicks, banned: ban || kicks >= 2, nickname: player.nickname });
  }

  unbanPlayer(hostId, playerId) {
    this._assertCanModerate(hostId);
    if (!this.moderation.get(playerId)?.banned) throw new GameError('PLAYER_NOT_FOUND', 'That player is no longer banned');
    this.moderation.delete(playerId);
    this._sendRoomState(this.hostId, this.publicState());
  }

  addBot(byPlayerId) {
    this._assertCanManageBots(byPlayerId);
    const id = `b_${randomUUID()}`;
    this.assertCanSeat(id);
    this.players.push(this._botSeat(id));
    this.broadcast();
    return id;
  }

  _botSeat(id) {
    const availableNames = BOT_NAMES.filter(({ en, he }) => !this.players.some((p) => p.nickname === en || p.nickname === he));
    const botName = availableNames[randomInt(availableNames.length)];
    return { id, nickname: botName.en, avatarId: randomInt(AVATAR_COUNT), isBot: true, botName };
  }

  removeBot(byPlayerId, botId) {
    this._assertCanManageBots(byPlayerId);
    if (!this.players.some((p) => p.id === botId && p.isBot)) {
      throw new GameError('BOT_NOT_FOUND', 'That bot is no longer in the lobby');
    }
    this.removePlayer(botId);
  }

  _assertCanManageBots(byPlayerId) {
    if (byPlayerId !== this.hostId) throw new GameError('NOT_HOST', 'Only the host can manage bots');
    this.assertWaiting();
  }

  /**
   * Removes a guest or converts their seat to a bot for the rest of the match.
   * @param {string} playerId
   * @param {string} [reason] one of ABORT_REASONS (used when a match is aborted)
   */
  removePlayer(playerId, reason = ABORT_REASONS.PLAYER_LEFT) {
    const idx = this.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const leaver = this.players[idx];
    this._clearGrace(playerId);
    if (this.status === ROOM_STATUS.PLAYING && !leaver.isBot && this.players.some((p) => p.id !== playerId && !p.isBot)) {
      this.players[idx] = { ...this._botSeat(playerId), temporary: true };
      const personalities = Object.keys(PERSONALITIES);
      this.botBrains.set(playerId, new BotPlayer(personalities[randomInt(personalities.length)], this.botRandom));
      this._replaceHost(playerId);
      this.transport.toRoom(this.code, S2C.GAME_EVENT, { type: 'seat_taken_over', playerId, nickname: leaver.nickname, at: Date.now() });
      this.onConnectionChanged();
      return;
    }

    this.players.splice(idx, 1);
    if (leaver.isBot && !leaver.temporary) this.tokenBank.delete(playerId);
    if (this.hostId === playerId) {
      this._replaceHost(playerId);
      if (!this.hostId) {
        for (const bot of this.players) this.tokenBank.delete(bot.id);
        this.players = [];
      }
    }

    if (this.status === ROOM_STATUS.PLAYING) {
      this._abortGame({ reason, playerId, nickname: leaver.nickname });
    } else {
      this.onConnectionChanged();
    }
  }

  _replaceHost(playerId) {
    if (this.hostId !== playerId) return;
    const humans = this.players.filter((p) => !p.isBot);
    const next = humans.find((p) => this.sessions.isConnected(p.id)) || humans[0];
    this.hostId = next?.id ?? null;
  }

  assertCanUpdateProfile(session, profile) {
    if (profile.nickname !== undefined && profile.nickname !== session.nickname && this.hasHumanSeat(session.playerId)) {
      this.assertWaiting();
    }
  }

  updateProfile(session, profile) {
    this.assertCanUpdateProfile(session, profile);
    Object.assign(session, profile);
    const p = this.players.find((x) => x.id === session.playerId && !x.isBot);
    if (!p || (p.nickname === session.nickname && p.avatarId === session.avatarId)) return;
    p.nickname = session.nickname;
    p.avatarId = session.avatarId;
    this.broadcast();
  }

  /** Socket dropped (not an explicit leave): keep the seat for a grace period. */
  onPlayerDisconnected(playerId) {
    if (!this.hasHumanSeat(playerId)) return;
    this._clearGrace(playerId);
    const t = setTimeout(() => {
      this.graceTimers.delete(playerId);
      if (!this.hasHumanSeat(playerId) || this.sessions.isConnected(playerId)) return;
      const session = this.sessions.getByPlayerId(playerId);
      if (session?.roomCode === this.code) {
        session.roomCode = null;
        session.lastSeen = Date.now();
      }
      this.removePlayer(playerId, ABORT_REASONS.PLAYER_DISCONNECTED);
    }, this.disconnectGraceMs);
    t.unref?.();
    this.graceTimers.set(playerId, t);
    this.onConnectionChanged();
  }

  onConnectionChanged() {
    if (this.connectedCount === 0) this.emptySince = this.emptySince || Date.now();
    else this.emptySince = null;
    if (this.game && this.game.onConnectionChanged()) this._schedule();
    else this._scheduleBot();
    this.broadcast();
  }

  // ------------------------------------------------------------ lifecycle

  setTurnSpeed(byPlayerId, speed) {
    if (byPlayerId !== this.hostId) throw new GameError('NOT_HOST', 'Only the host can change turn speed');
    this.assertWaiting();
    if (typeof speed !== 'string' || !Object.hasOwn(config.TURN_SPEEDS, speed)) {
      throw new GameError('BAD_TURN_SPEED', 'Choose Fast or Standard turn speed');
    }
    if (speed === this.turnSpeed) return;
    this.turnSpeed = speed;
    this.broadcast();
  }

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
    if (!this.players.every((player) => this._ready(player))) {
      throw new GameError('PLAYERS_OFFLINE', 'Wait for offline players to reconnect or leave the lobby');
    }

    // A rematch keeps the lineup, but its replacement bots get independent identities and wallets.
    this.players = this.players.map((p) => {
      if (!p.temporary) return p;
      const { temporary, ...bot } = p;
      return { ...bot, id: `b_${randomUUID()}` };
    });
    const seatIds = shuffle(this.players.map((p) => p.id), this.setupRandom);
    const moveMs = config.TURN_SPEEDS[this.turnSpeed];
    const game = new JokerBluffGame(
      seatIds,
      {
        isConnected: (id) => this._ready(this.players.find((p) => p.id === id)),
        timers: { REQUEST: moveMs, OFFER: moveMs, DECISION: moveMs, LIE_DEYE: moveMs },
        // Carry-over: each player brings their current room balance into the match.
        tokenBalances: new Map(this.players.map((p) => [p.id, this.tokenBalance(p.id)])),
      }
    );
    const events = game.start();
    this.game = game;
    this.botHistory = [];
    this.botBrains = new Map();
    let personalities = [];
    for (const player of this.players) {
      if (!player.isBot) continue;
      if (personalities.length === 0) personalities = shuffle(Object.keys(PERSONALITIES), this.setupRandom);
      this.botBrains.set(player.id, new BotPlayer(personalities.pop(), this.botRandom));
    }
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
        events = this.game.offerCard(playerId, payload.cardId, {
          touches: payload.touches,
          pressDurationMs: payload.pressDurationMs,
          substituteRank: payload.substituteRank,
        });
        break;
      case C2S.PLAYER_DECISION:
        events = this.game.decide(playerId, payload.accept, payload.offerIndex);
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
    if (!this.game || !this.hasHumanSeat(playerId)) throw new GameError('NOT_PLAYING', 'No game in progress');
    this.game.shuffleHand(playerId, order);
    const state = this._matchStateFor(playerId);
    this.transport.toPlayer(playerId, S2C.GAME_STATE, state);
    return state.hand.map((c) => c.id);
  }

  destroy() {
    clearTimeout(this.timer);
    this.timer = null;
    this._clearBotJob();
    this.botBrains.clear();
    this.botHistory = [];
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.game = null;
  }

  pruneTokenBank() {
    const botIds = new Set(this.players.filter((p) => p.isBot && !p.temporary).map((p) => p.id));
    for (const id of this.tokenBank.keys()) {
      if (!botIds.has(id) && !this.sessions.getByPlayerId(id)) this.tokenBank.delete(id);
    }
  }

  pruneModeration() {
    let bansChanged = false;
    for (const [id, record] of this.moderation) {
      if (this.sessions.getByPlayerId(id)) continue;
      this.moderation.delete(id);
      bansChanged ||= record.banned;
    }
    if (bansChanged && this.status === ROOM_STATUS.WAITING) this._sendRoomState(this.hostId, this.publicState());
  }

  // ------------------------------------------------------------ broadcasting

  publicState() {
    return {
      code: this.code,
      lifecycleId: this.lifecycleId,
      hostId: this.hostId,
      status: this.status,
      turnSpeed: this.turnSpeed,
      minPlayers: config.MIN_PLAYERS,
      maxPlayers: config.MAX_PLAYERS,
      players: this.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        avatarId: p.avatarId,
        isHost: p.id === this.hostId,
        connected: this._ready(p),
        ...(p.isBot ? { isBot: true, botName: p.botName } : {}),
        tokens: p.temporary ? this.game.tokens.get(p.id) : this.tokenBalance(p.id),
      })),
      lieDeye: { ...config.LIE_DEYE },
    };
  }

  _sendRoomState(playerId, state) {
    if (playerId === this.hostId && state.status === ROOM_STATUS.WAITING) {
      const bannedPlayers = [];
      for (const [id, { banned, nickname }] of this.moderation) {
        if (banned) bannedPlayers.push({ id, nickname });
      }
      this.transport.toPlayer(playerId, S2C.ROOM_STATE, { ...state, bannedPlayers });
    } else {
      this.transport.toPlayer(playerId, S2C.ROOM_STATE, state);
    }
  }

  /** Each guest gets their own redacted views, including host-only moderation data. */
  broadcast() {
    const state = this.publicState();
    for (const p of this.players) {
      if (p.isBot) continue;
      this._sendRoomState(p.id, state);
      this.transport.toPlayer(p.id, S2C.GAME_STATE, this._matchStateFor(p.id));
    }
  }

  _matchStateFor(playerId) {
    return this.game ? { ...this.game.getStateFor(playerId), matchId: this.lifecycleId } : null;
  }

  _abortGame(info) {
    clearTimeout(this.timer);
    this.timer = null;
    this._clearBotJob();
    this.botBrains.clear();
    this.botHistory = [];
    this.players = this.players.filter((p) => !p.temporary);
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
    if (this.botBrains.size) {
      const turn = events.some((event) => event.type === 'card_transferred') ? this.game.lastTransfer.turn : this.game.turn;
      // Record only facts already published to the table.
      for (const event of events) {
        if (event.type === 'card_requested' || event.type === 'card_offered') {
          this.botHistory.push({ type: event.type, playerId: event.playerId, rank: event.rank, declaration: event.declaration, turn });
        }
      }
      if (this.botHistory.length > BOT_HISTORY_LIMIT) this.botHistory.splice(0, this.botHistory.length - BOT_HISTORY_LIMIT);
    }
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
    for (const { id, temporary } of this.players) {
      if (!temporary && this.game.tokens.has(id)) this.tokenBank.set(id, this.game.tokens.get(id));
    }
  }

  /** Winner gets +WIN_BONUS for the next match. Guarded so it's paid once per match. */
  _settleWinBonus() {
    if (this.tokensSettled || !this.game?.result?.winnerId) return null;
    this.tokensSettled = true;
    const winnerId = this.game.result.winnerId;
    if (this.players.some((p) => p.id === winnerId && p.temporary)) return null;
    const amount = config.LIE_DEYE.WIN_BONUS;
    const balance = this.tokenBalance(winnerId) + amount;
    this.tokenBank.set(winnerId, balance);
    this.game.tokens.set(winnerId, balance); // so the results screen shows the new balance
    return { type: 'lie_deye_bonus', playerId: winnerId, amount, balance };
  }

  _schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    this._scheduleBot();
    const game = this.game;
    if (!game || game.isFinished || !game.deadline) return;
    const step = game.step;
    const delay = Math.max(0, game.deadline + ACTION_GRACE_MS - Date.now());
    this.timer = setTimeout(() => {
      if (this.game === game && game.step === step) this._onTimeout();
    }, delay);
    this.timer.unref?.();
  }

  _clearBotJob() {
    if (this.botJob) clearTimeout(this.botJob.timer);
    this.botJob = null;
  }

  _scheduleBot() {
    const game = this.game;
    const playerId = game?.actorId;
    const brain = this.botBrains.get(playerId);
    if (!brain || this.connectedCount === 0) return this._clearBotJob();
    const step = game.step;
    if (this.botJob?.game === game && this.botJob.step === step) return;
    this._clearBotJob();
    const remaining = Math.max(0, game.deadline - Date.now() - BOT_DEADLINE_BUFFER_MS);
    const delay = this.botDelay
      ? Math.min(this.botDelay(remaining), remaining)
      : brain.thinkDelay(game.getStateFor(playerId), remaining);
    const job = { game, step, timer: null };
    job.timer = setTimeout(() => {
      if (this.botJob !== job) return;
      this.botJob = null;
      if (this.game !== game || game.step !== step || this.connectedCount === 0) return;
      try {
        const { event, payload } = brain.choose(game.getStateFor(playerId), this.botHistory);
        this.act(playerId, event, payload);
      } catch (err) {
        console.error(`[room ${this.code}] bot move failed`, err);
        if (this.game === game && game.step === step) this._autoPlay();
      }
    }, delay);
    job.timer.unref?.();
    this.botJob = job;
  }

  _onTimeout() {
    this.timer = null;
    if (!this.game || this.game.isFinished) return;
    if (Date.now() < this.game.deadline + ACTION_GRACE_MS) return this._schedule();
    this._autoPlay();
  }

  _autoPlay() {
    try {
      this._afterGameChange(this.game.handleTimeout());
    } catch (err) {
      console.error(`[room ${this.code}] timeout handling failed`, err);
      this._abortGame({ reason: ABORT_REASONS.SERVER_ERROR });
    }
  }
}

module.exports = { Room, ROOM_STATUS, ABORT_REASONS };
