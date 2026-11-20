'use strict';

const { randomInt } = require('node:crypto');
const { PHASES } = require('../shared/events');
const { buildDeck, shuffle, isJoker, findWinningRank, JOKER } = require('./deck');
const { sanitizeTouches } = require('./telemetry');
const config = require('../config');

const DEFAULT_TIMERS = config.TIMERS;
const RANDOM_RANGE = 2 ** 47;

class GameError extends Error {
  constructor(code, message, params) {
    super(message);
    this.name = 'GameError';
    this.code = code;
    this.params = params;
  }
}

const MAX_OFFERS = 3; // the 3rd offer is chosen deliberately by the holder and is auto-accepted

/**
 * Pure, transport-agnostic Joker Bluff state machine.
 *
 * - No sockets, no timers: the Room schedules `handleTimeout()` at `deadline`.
 * - Every mutating method returns an array of *public* events (no hidden card info)
 *   that the transport layer can broadcast for animations / toasts.
 * - `getStateFor(playerId)` is the ONLY way state leaves the engine, and it
 *   redacts everything that player is not allowed to see.
 *
 * Turn model:
 *   holder  = the player currently holding 5 cards (gives a card away)
 *   active  = the seat right after the holder (asks for a rank, accepts/rejects)
 *   After a successful transfer the receiver has 5 cards and becomes the new holder;
 *   the seat after them becomes the new active player.
 *
 * Lie Deye tokens: balances are OWNED BY THE ROOM (they carry over between matches)
 * and passed in via `opts.tokenBalances`. The engine spends from them and enforces
 * the per-match cap (`maxLieDeyeUses`). During DECISION the active player may spend
 * one to (a) reset the clock to a full minute and (b) see the giver's telemetry for
 * the pending offer (decision time, shuffles, touch heatmap).
 */
class JokerBluffGame {
  /**
   * @param {string[]} playerIds seat order
   * @param {{rng?: () => number, now?: () => number, timers?: object,
   *          tokenBalances?: Map<string, number>|Record<string, number>, maxLieDeyeUses?: number,
   *          isConnected?: (id: string) => boolean}} [opts]
   */
  constructor(playerIds, opts = {}) {
    if (!Array.isArray(playerIds) || new Set(playerIds).size !== playerIds.length) {
      throw new GameError('BAD_PLAYERS', 'playerIds must be unique');
    }
    this.seats = [...playerIds];
    this.rng = opts.rng ?? (() => randomInt(RANDOM_RANGE) / RANDOM_RANGE);
    this.now = opts.now || Date.now;
    this.timers = { ...DEFAULT_TIMERS, ...(opts.timers || {}) };
    this.isConnected = opts.isConnected || (() => true);

    const balances = opts.tokenBalances instanceof Map ? opts.tokenBalances : new Map(Object.entries(opts.tokenBalances || {}));
    /** @type {Map<string, number>} Lie Deye balance (carried in from the room) */
    this.tokens = new Map(this.seats.map((id) => [id, balances.get(id) ?? config.LIE_DEYE.STARTING_TOKENS]));
    /** @type {Map<string, number>} Lie Deye uses in THIS match */
    this.lieDeyeUses = new Map(this.seats.map((id) => [id, 0]));
    this.maxLieDeyeUses = opts.maxLieDeyeUses ?? config.LIE_DEYE.MAX_USES_PER_GAME;

    this.ranks = [];
    this.hands = new Map();
    this.holderId = null;
    this.activeId = null;
    this.phase = null;
    this.requestedRank = null;
    /**
     * Face-down cards on the table, plus the giver telemetry captured when each was offered.
     * @type {{card: object, status: 'pending'|'rejected'|'accepted', decisionMs: number, phaseLimitMs: number,
     *         handSize: number, offeredSlot: number, touches: object[], shuffles: number, auto: boolean,
     *         lieDeyeUsed: boolean}[]}
     */
    this.offers = [];
    this.offerPhaseShuffles = 0; // how often the holder shuffled while choosing the current offer
    this.turn = 0;
    this.step = 0;
    this.deadline = null;
    this.phaseDuration = 0;
    this.phaseStartedAt = null;
    this.lastTransfer = null;
    this.result = null;
  }

  // ---------------------------------------------------------------- setup

  /** Builds the dynamic deck, deals 5 cards to one random player and 4 to everyone else. */
  start() {
    const n = this.seats.length;
    const { ranks, cards } = buildDeck(n); // (n * 4) + 1 cards
    this.ranks = ranks;

    // Re-deal in the (rare) case somebody is dealt an instant win - it makes for a dull round.
    for (let attempt = 0; attempt < 50; attempt++) {
      shuffle(cards, this.rng);
      const holderIndex = Math.floor(this.rng() * n);
      let cursor = 0;
      this.hands = new Map();
      this.seats.forEach((id, i) => {
        const count = i === holderIndex ? 5 : 4;
        this.hands.set(id, cards.slice(cursor, cursor + count));
        cursor += count;
      });
      this.holderId = this.seats[holderIndex];
      if (!this.seats.some((id) => findWinningRank(this.hands.get(id)))) break;
    }

    this.activeId = this._nextSeat(this.holderId);
    this.turn = 1;
    this._enterPhase(PHASES.REQUEST);
    return [{ type: 'game_started', holderId: this.holderId, activeId: this.activeId, ranks: this.ranks }];
  }

  // ---------------------------------------------------------------- actions

  /** Event `request_card`: active player names the rank they want from the holder. */
  requestCard(playerId, rank) {
    this._assertPhase(PHASES.REQUEST);
    this._assertActor(playerId, this.activeId);
    if (typeof rank !== 'string' || !this.ranks.includes(rank)) {
      throw new GameError('BAD_RANK', `Rank must be one of: ${this.ranks.join(', ')}`);
    }
    this.requestedRank = rank;
    this._enterPhase(PHASES.OFFER);
    return [{ type: 'card_requested', playerId, targetId: this.holderId, rank }];
  }

  /**
   * Event `offer_card`: holder places ANY card from their hand face-down.
   * Offers 1 & 2 can be rejected. Offer 3 is picked deliberately from the 3
   * remaining cards and is auto-accepted.
   *
   * `opts.touches` is the giver's touch trail while choosing (see telemetry.js).
   * Decision time is measured by the SERVER (phase start -> offer received).
   *
   * `opts.noCard` = "I don't have it" (System Verified Forced Bluff). The server
   * checks that the holder owns NO card of the requested rank (hand + their own
   * face-down cards already on the table). If the claim is true the offer is
   * stamped `verifiedNoCard` for everyone; if it's false the offer is refused.
   */
  offerCard(playerId, cardId, opts = {}) {
    this._assertPhase(PHASES.OFFER);
    this._assertActor(playerId, this.holderId);
    const hand = this.hands.get(playerId);
    const idx = hand.findIndex((c) => c.id === cardId);
    if (idx === -1) throw new GameError('BAD_CARD', 'That card is not in your hand');
    const verifiedNoCard = opts.noCard === true;
    if (verifiedNoCard && !this._lacksRequestedRank(playerId)) {
      throw new GameError('HAS_RANK', `You do have a ${this.requestedRank} - the system can't verify that claim`);
    }

    const handSize = hand.length;
    const slotOf = new Map(hand.map((c, i) => [c.id, i])); // final order at offer time
    const decisionMs = Math.max(0, this.now() - this.phaseStartedAt);
    const [card] = hand.splice(idx, 1);
    this.offers.push({
      card,
      status: 'pending',
      decisionMs,
      phaseLimitMs: this.phaseDuration,
      handSize,
      offeredSlot: idx,
      touches: opts.auto ? [] : sanitizeTouches(opts.touches, { handSize, maxT: decisionMs + 2000, slotOf }),
      shuffles: this.offerPhaseShuffles,
      auto: !!opts.auto,
      lieDeyeUsed: false,
      verifiedNoCard,
    });
    const offerNumber = this.offers.length;
    const forced = offerNumber === MAX_OFFERS;

    const events = [
      {
        type: 'card_offered',
        playerId,
        targetId: this.activeId,
        offerNumber,
        forced,
        verifiedNoCard,
        rank: verifiedNoCard ? this.requestedRank : undefined,
      },
    ];
    if (forced) {
      // CRITICAL RULE: the receiving player MUST take the 3rd card.
      events.push(...this._transfer(true));
    } else {
      this._enterPhase(PHASES.DECISION);
    }
    return events;
  }

  /** Event `player_decision`: active player accepts or rejects offer #1 / #2. */
  decide(playerId, accept) {
    this._assertPhase(PHASES.DECISION);
    this._assertActor(playerId, this.activeId);
    if (typeof accept !== 'boolean') throw new GameError('BAD_DECISION', '`accept` must be a boolean');

    if (accept) return this._transfer(false);

    const offer = this.offers[this.offers.length - 1];
    offer.status = 'rejected'; // stays face-down on the table until the transaction ends
    this._enterPhase(PHASES.OFFER);
    return [
      {
        type: 'offer_rejected',
        playerId,
        targetId: this.holderId,
        offerNumber: this.offers.length,
        nextIsForced: this.offers.length === MAX_OFFERS - 1,
      },
    ];
  }

  /**
   * Event `use_lie_deye`: spend 1 token on the pending offer.
   *  - Time freeze: the decision clock is reset to a full LIE_DEYE window (60s).
   *  - Stats reveal: the giver's telemetry for THIS offer becomes visible to the
   *    active player only (see `lieDeye` in getStateFor).
   * Limits: one per offer, `maxLieDeyeUses` per match, and you need a balance.
   */
  useLieDeye(playerId) {
    this._assertPhase(PHASES.DECISION);
    this._assertActor(playerId, this.activeId);
    const offer = this.offers[this.offers.length - 1];
    if (offer.lieDeyeUsed) throw new GameError('ALREADY_READ', 'You already used Lie Deye on this card');
    const used = this.lieDeyeUses.get(playerId) || 0;
    if (used >= this.maxLieDeyeUses) {
      throw new GameError('LIE_DEYE_LIMIT', `Max ${this.maxLieDeyeUses} Lie Deye uses per game`, { max: this.maxLieDeyeUses });
    }
    const balance = this.tokens.get(playerId) || 0;
    if (balance <= 0) throw new GameError('NO_TOKENS', 'No Lie Deye tokens left');

    this.tokens.set(playerId, balance - 1);
    this.lieDeyeUses.set(playerId, used + 1);
    offer.lieDeyeUsed = true;
    this.phaseDuration = this.timers.LIE_DEYE;
    this.deadline = this.now() + this.timers.LIE_DEYE;

    return [
      {
        type: 'lie_deye_used',
        playerId,
        targetId: this.holderId,
        offerNumber: this.offers.length,
        tokensLeft: balance - 1,
        usesLeft: this.maxLieDeyeUses - used - 1,
        durationMs: this.timers.LIE_DEYE,
      },
    ];
  }

  /**
   * Event `shuffle_hand`: randomly reorder MY hand. Allowed any time during a match.
   * Order is server-side state so the telemetry slot indices always match what
   * the player actually sees. Returns no public events (private action).
   *
   * `order` (optional): the shuffled card-id order the client already shows
   * (optimistic UI). It's accepted only if it's an exact permutation of the
   * current hand; anything else falls back to a server-side random shuffle.
   */
  shuffleHand(playerId, order) {
    if (this.phase === PHASES.FINISHED) throw new GameError('GAME_OVER', 'The game is already over');
    const hand = this.hands.get(playerId);
    if (!hand) throw new GameError('NOT_IN_GAME', 'You are not in this game');
    if (hand.length > 1) {
      const before = hand.map((c) => c.id).join();
      const byId = new Map(hand.map((c) => [c.id, c]));
      const valid =
        Array.isArray(order) &&
        order.length === hand.length &&
        new Set(order).size === hand.length &&
        order.every((id) => byId.has(id));
      if (valid) {
        hand.splice(0, hand.length, ...order.map((id) => byId.get(id)));
      } else {
        for (let i = 0; i < 6 && hand.map((c) => c.id).join() === before; i++) shuffle(hand, this.rng);
      }
      if (this.phase === PHASES.OFFER && playerId === this.holderId && hand.map((c) => c.id).join() !== before) {
        this.offerPhaseShuffles += 1;
      }
    }
    return [];
  }

  // NOTE: there is no manual "declare win" any more. Victory is AUTOMATIC and is
  // checked only when a holder successfully passes their 5th card away (see
  // `_transfer` -> `_checkAutoWin`).

  /**
   * Called by the Room when `deadline` passes. Performs a sensible default
   * move for whoever was supposed to act.
   */
  handleTimeout() {
    if (this.phase === PHASES.FINISHED || this.phase === null) return [];
    const actorId = this.actorId;
    const events = [{ type: 'timeout', playerId: actorId, phase: this.phase }];

    if (this.phase === PHASES.REQUEST) {
      events.push(...this.requestCard(actorId, this._autoPickRank(actorId)));
    } else if (this.phase === PHASES.OFFER) {
      events.push(...this.offerCard(actorId, this._autoPickOffer(actorId).id, { auto: true }));
    } else if (this.phase === PHASES.DECISION) {
      events.push(...this.decide(actorId, true));
    }
    return events;
  }

  /** Room calls this when someone (dis)connects so an AFK actor doesn't stall the table. */
  onConnectionChanged() {
    if (this.phase === PHASES.FINISHED || this.phase === null) return false;
    if (!this.isConnected(this.actorId)) {
      const afkDeadline = this.now() + this.timers.AFK;
      if (afkDeadline < this.deadline) {
        this.deadline = afkDeadline;
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- views

  get actorId() {
    switch (this.phase) {
      case PHASES.REQUEST:
      case PHASES.DECISION:
        return this.activeId;
      case PHASES.OFFER:
        return this.holderId;
      default:
        return null;
    }
  }

  get isFinished() {
    return this.phase === PHASES.FINISHED;
  }

  /** Lie Deye uses this player still has in this match (min of balance and per-match cap). */
  lieDeyeUsesLeft(playerId) {
    const capLeft = this.maxLieDeyeUses - (this.lieDeyeUses.get(playerId) || 0);
    return Math.max(0, Math.min(capLeft, this.tokens.get(playerId) || 0));
  }

  /** Redacted view of the game for a single player. */
  getStateFor(viewerId) {
    const finished = this.phase === PHASES.FINISHED;
    const isHolder = viewerId === this.holderId;
    const inTransaction = viewerId === this.holderId || viewerId === this.activeId;
    const pending = this.offers[this.offers.length - 1];
    const pendingDecision = this.phase === PHASES.DECISION && pending && pending.status === 'pending';

    return {
      phase: this.phase,
      turn: this.turn,
      step: this.step,
      ranks: this.ranks,
      deckSize: this.ranks.length * 4 + 1,
      seats: this.seats.map((id) => ({
        id,
        cardCount: this.hands.get(id).length,
        isHolder: id === this.holderId,
        isActive: id === this.activeId,
        tokens: this.tokens.get(id) ?? 0,
        lieDeyeUsesLeft: this.lieDeyeUsesLeft(id),
      })),
      holderId: this.holderId,
      activeId: this.activeId,
      actorId: this.actorId,
      requestedRank: this.requestedRank,
      // Face-down cards on the table: only the holder (their owner) sees the faces.
      offers: this.offers.map((o, i) => ({
        number: i + 1,
        status: o.status,
        forced: i + 1 === MAX_OFFERS,
        lieDeyeUsed: o.lieDeyeUsed,
        // Public: the holder proved (server-checked) they own no card of the requested rank.
        verifiedNoCard: !!o.verifiedNoCard,
        card: isHolder || finished ? { ...o.card } : null,
      })),
      maxOffers: MAX_OFFERS,
      hand: (this.hands.get(viewerId) || []).map((c) => ({ ...c })),
      lieDeyeWallet: {
        balance: this.tokens.get(viewerId) ?? 0,
        usedThisGame: this.lieDeyeUses.get(viewerId) ?? 0,
        maxPerGame: this.maxLieDeyeUses,
        usesLeft: this.lieDeyeUsesLeft(viewerId),
      },
      canUseLieDeye: !!(
        pendingDecision &&
        viewerId === this.activeId &&
        !pending.lieDeyeUsed &&
        this.lieDeyeUsesLeft(viewerId) > 0
      ),
      // The 60s "time freeze" is running for the pending offer.
      timeFrozen: !!(pendingDecision && pending.lieDeyeUsed),
      // Giver telemetry - ONLY for the active player, ONLY after they spent a token on this offer.
      lieDeye:
        pendingDecision && pending.lieDeyeUsed && viewerId === this.activeId
          ? {
              offerNumber: this.offers.length,
              giverId: this.holderId,
              decisionMs: pending.decisionMs,
              phaseLimitMs: pending.phaseLimitMs,
              handSize: pending.handSize,
              offeredSlot: pending.offeredSlot,
              shuffles: pending.shuffles,
              auto: pending.auto,
              touches: pending.touches.map((t) => ({ ...t })),
            }
          : null,
      isolated: !finished && !inTransaction, // client dims the screen for inactive players
      // "I don't have it" (System Verified Forced Bluff): only the holder, only while
      // choosing an offer, only when the server confirms they own no card of that rank.
      canClaimNoCard: !!(isHolder && this.phase === PHASES.OFFER && this._lacksRequestedRank(viewerId)),
      deadline: this.deadline,
      phaseDuration: this.phaseDuration,
      phaseStartedAt: this.phaseStartedAt,
      serverNow: this.now(),
      lastTransfer: this.lastTransfer
        ? {
            ...this.lastTransfer,
            cardId: viewerId === this.lastTransfer.toId ? this.lastTransfer.cardId : null,
          }
        : null,
      result: finished
        ? {
            ...this.result,
            // Everyone sees every hand once the round is over.
            hands: Object.fromEntries(this.seats.map((id) => [id, this._ownedCards(id).map((c) => ({ ...c }))])),
          }
        : null,
    };
  }

  // ---------------------------------------------------------------- internals

  _transfer(forced) {
    const fromId = this.holderId;
    const toId = this.activeId;
    const offerNumber = this.offers.length;
    const accepted = this.offers[offerNumber - 1];
    const verifiedRank = accepted.verifiedNoCard ? this.requestedRank : null;
    const giverHand = this.hands.get(fromId);
    const passedFifthCard = giverHand.length + offerNumber === 5;
    accepted.status = 'accepted';

    this.hands.get(toId).push(accepted.card);
    // Rejected face-down cards go back into the giver's hand.
    for (const o of this.offers) if (o.status === 'rejected') giverHand.push(o.card);

    this.lastTransfer = {
      fromId,
      toId,
      offerNumber,
      forced,
      cardId: accepted.card.id,
      turn: this.turn,
      verifiedNoCard: !!accepted.verifiedNoCard,
      verifiedRank,
    };
    this.offers = [];
    this.requestedRank = null;

    // Receiver now holds 5 cards -> becomes the new holder; next seat asks them.
    this.holderId = toId;
    this.activeId = this._nextSeat(toId);
    this.turn += 1;

    const events = [
      {
        type: 'card_transferred',
        fromId,
        toId,
        offerNumber,
        forced,
        verifiedNoCard: !!accepted.verifiedNoCard,
        verifiedRank,
        nextHolderId: this.holderId,
        nextActiveId: this.activeId,
      },
    ];
    const win = passedFifthCard ? this._checkAutoWin(fromId) : null;
    if (win) events.push(win);
    else this._enterPhase(PHASES.REQUEST);
    return events;
  }

  /**
   * AUTOMATIC VICTORY (the only way to win): the giver has just passed their 5th
   * card away and is left with EXACTLY 4 cards that all share one rank (so no
   * Joker). Whoever owns the Joker at that moment loses.
   */
  _checkAutoWin(giverId) {
    const hand = this.hands.get(giverId);
    if (hand.length !== 4) return null;
    const winningRank = findWinningRank(hand);
    if (!winningRank) return null;
    const loserId = this.seats.find((id) => this._ownedCards(id).some(isJoker)) || null;
    this.phase = PHASES.FINISHED;
    this.deadline = null;
    this.phaseDuration = 0;
    this.phaseStartedAt = null;
    this.result = { winnerId: giverId, loserId, winningRank, auto: true };
    return { type: 'game_over', winnerId: giverId, loserId, winningRank, auto: true };
  }

  /** True when the holder owns NO card of the requested rank (hand + own face-down table cards). */
  _lacksRequestedRank(playerId) {
    if (!this.requestedRank) return false;
    return !this._ownedCards(playerId).some((c) => c.rank === this.requestedRank);
  }

  _enterPhase(phase) {
    this.phase = phase;
    this.step += 1;
    const actor = this.actorId;
    const duration = this.isConnected(actor) ? this.timers[phase] : this.timers.AFK;
    this.phaseDuration = duration;
    this.phaseStartedAt = this.now();
    this.deadline = this.phaseStartedAt + duration;
    if (phase === PHASES.OFFER) this.offerPhaseShuffles = 0;
  }

  _ownedCards(playerId) {
    const hand = this.hands.get(playerId) || [];
    if (playerId !== this.holderId) return [...hand];
    // Face-down table cards still belong to the holder until a transfer happens.
    return [...hand, ...this.offers.map((o) => o.card)];
  }

  _nextSeat(id) {
    const i = this.seats.indexOf(id);
    return this.seats[(i + 1) % this.seats.length];
  }

  _assertPhase(phase) {
    if (this.phase !== phase) throw new GameError('WRONG_PHASE', `Not allowed during ${this.phase}`);
  }

  _assertActor(playerId, expected) {
    if (playerId !== expected) throw new GameError('NOT_YOUR_TURN', "It's not your move");
  }

  /** Autopilot: ask for the rank we already hold the most of. */
  _autoPickRank(playerId) {
    const counts = new Map();
    for (const c of this.hands.get(playerId)) if (!isJoker(c)) counts.set(c.rank, (counts.get(c.rank) || 0) + 1);
    let best = null;
    for (const [rank, n] of counts) if (!best || n > counts.get(best)) best = rank;
    return best || this.ranks[Math.floor(this.rng() * this.ranks.length)];
  }

  /**
   * Timeout fallback for OFFER: a completely RANDOM card from the holder's hand.
   * (Deliberately dumb - it never favours the requested rank, the Joker or a
   * "weak" card, so running out the clock gives nobody an advantage.)
   */
  _autoPickOffer(playerId) {
    const hand = this.hands.get(playerId);
    return hand[Math.floor(this.rng() * hand.length)];
  }
}

module.exports = { JokerBluffGame, GameError, MAX_OFFERS, JOKER };
