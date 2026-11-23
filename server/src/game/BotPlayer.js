'use strict';

const { C2S, PHASES } = require('../shared/events');
const { isJoker, findWinningRank } = require('./deck');

const PERSONALITIES = Object.freeze({
  strategist: { bluff: 0.06, feed: 12, read: 0.34, reject: 0.08, rejectSecond: 0.08, pace: 0 },
  detective: { bluff: 0.10, feed: 8, read: 0.80, reject: 0.15, rejectSecond: 0.18, pace: 0.035 },
  bluffer: { bluff: 0.23, feed: 7, read: 0.28, reject: 0.13, rejectSecond: 0.12, pace: -0.025 },
});

function countRank(cards, rank) {
  return cards.filter((card) => card.rank === rank).length;
}

function weightedPick(choices, weight, random) {
  const weights = choices.map(weight);
  let point = random() * weights.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < choices.length; i++) {
    point -= weights[i];
    if (point < 0) return choices[i];
  }
  return choices[choices.length - 1];
}

/** The policy receives only its seat's redacted view and the room's public events. */
class BotPlayer {
  constructor(personality, random = Math.random) {
    this.personality = personality;
    this.traits = PERSONALITIES[personality];
    this.random = random;
    this.knownLieCounts = new Map();
  }

  /** Sample the pause before choosing an action, using independent randomness. */
  thinkDelay(state, budget, random = Math.random) {
    const ceiling = Math.min(15500, Math.max(0, budget) * 0.84);
    if (ceiling === 0) return 0;
    const scale = Math.min(1, ceiling / 12000);
    // Every situation can use every range. Private cards change the odds only slightly.
    const deliberate = Math.min(0.60, 0.13 + this.traits.pace + this._timingPressure(state));
    const roll = random();
    if (roll < deliberate) return Math.round(3200 * scale + random() * (ceiling - 3200 * scale));
    if (roll < deliberate + 0.20) return Math.round((1800 + random() * 5000) * scale);
    return Math.round((1000 + random() * 2300) * scale);
  }

  _timingPressure(state) {
    if (state.phase === PHASES.REQUEST) {
      return state.ranks.some((rank) => countRank(state.hand, rank) >= 2) ? 0 : 0.06;
    }
    if (state.phase === PHASES.OFFER) {
      return 0.08 * state.offers.length + (state.hand.some(isJoker) ? 0.06 : 0);
    }
    const pending = state.offers.at(-1);
    const claim = pending.claimedNoCard ? (state.canUseLieDeye ? 0.19 : 0.10) : 0;
    const secondOffer = state.offers.length === 2 ? 0.20 : 0;
    const review = state.timeFrozen ? 0.24 : 0;
    return claim + secondOffer + review;
  }

  choose(state, history) {
    switch (state.phase) {
      case PHASES.REQUEST: return this._request(state, history);
      case PHASES.OFFER: return this._offer(state, history);
      case PHASES.DECISION: return this._decide(state, history);
      default: throw new Error('Bot cannot act in this phase');
    }
  }

  _request(state, history) {
    const available = state.ranks.map((rank) => ({ rank, matching: countRank(state.hand, rank) }))
      .filter(({ matching }) => matching < 4);
    const likelyRank = history.findLast((event) => event.type === 'card_requested' && event.playerId === state.holderId)?.rank;
    const feint = this.personality === 'bluffer' && !available.some(({ matching }) => matching === 3) && this.random() < 0.12;
    const { rank } = weightedPick(available, ({ rank, matching }) => {
      return feint ? 4 - matching : (9 ** matching) * (rank === likelyRank ? 1.5 : 1);
    }, this.random);
    return { event: C2S.REQUEST_CARD, payload: { rank } };
  }

  _offer(state, history) {
    // Only the giver's view contains the cards already on the table.
    const owned = [...state.hand, ...state.offers.map((offer) => offer.card).filter(Boolean)];
    const matching = countRank(owned, state.requestedRank);
    const joker = owned.find(isJoker);
    const freshJoker = joker && state.lastTransfer?.cardId === joker.id;
    const previousRequest = history.findLast((event) => event.type === 'card_requested' && event.playerId === state.activeId && event.turn < state.turn);
    const oddRequest = matching >= 3;
    const winningPass = state.hand.find((card) => findWinningRank(owned.filter((other) => other.id !== card.id)));
    const card = winningPass ?? weightedPick(state.hand, (candidate) => {
      // An automatic handoff just sends the Joker around the same clockwise ring.
      if (isJoker(candidate)) return (freshJoker ? 4 : 9) + 4 * state.offers.length;
      const base = !joker && candidate.rank === state.requestedRank && !oddRequest
        ? this.traits.feed + (previousRequest?.rank === candidate.rank ? 3 : 0)
        : 5;
      return base / (5 ** (countRank(owned, candidate.rank) - 1));
    }, this.random);
    // A false claim is more convincing when the offered card cannot disprove it on receipt.
    const claimChance = matching === 0 ? 0.38 : this.traits.bluff * (card.rank === state.requestedRank ? 0.1 : 1);
    const claimedNoCard = this.random() < claimChance;
    return { event: C2S.OFFER_CARD, payload: { cardId: card.id, claimedNoCard } };
  }

  _decide(state, history) {
    const pending = state.offers[state.offers.length - 1];
    const review = state.lieDeye;
    if (review?.giverId === state.holderId) this.knownLieCounts.set(state.holderId, review.lieCount);
    const knownLies = Math.min(3, this.knownLieCounts.get(state.holderId) ?? 0);
    const holdsJoker = state.hand.some(isJoker);
    const nearSet = countRank(state.hand, state.requestedRank) >= 3;
    const pastOffers = history.filter((e) => e.type === 'card_offered' && e.playerId === state.holderId && e.turn < state.turn).slice(-8);
    const repeatedClaims = pastOffers.filter((e) => e.claimedNoCard).length >= 2;
    const changedStory = state.offers.some((offer) => offer !== pending && offer.claimedNoCard !== pending.claimedNoCard);
    const suspicious = (pending.claimedNoCard && (knownLies > 0 || repeatedClaims || (pastOffers.length > 0 && nearSet))) ||
      changedStory || (knownLies >= 2 && nearSet);
    if (state.canUseLieDeye && !holdsJoker && suspicious && !state.offers.some((offer) => offer.lieDeyeUsed) && this.random() < this.traits.read) {
      return { event: C2S.USE_LIE_DEYE };
    }

    if (state.offers.length === 2) {
      // A change in wording alone is enough to check, but needs corroboration to force a third offer.
      const madeClaim = state.offers.some((offer) => offer.claimedNoCard);
      const suspiciousClaim = madeClaim && (knownLies > 0 || (repeatedClaims && (changedStory || nearSet)));
      if (!holdsJoker && (suspiciousClaim || (knownLies >= 2 && nearSet)) && this.random() < this.traits.rejectSecond) {
        return { event: C2S.PLAYER_DECISION, payload: { accept: false } };
      }
      const offer = weightedPick(state.offers, (candidate) => {
        if (candidate.claimedNoCard) return nearSet || knownLies ? 2 : 3;
        return candidate === pending ? 5 : 4;
      }, this.random);
      return { event: C2S.PLAYER_DECISION, payload: { accept: true, offerIndex: offer.number - 1 } };
    }

    const firstImpression = this.personality === 'strategist' && pastOffers.length === 0 && !suspicious;
    const rejectChance = holdsJoker || firstImpression ? 0.03 : this.traits.reject + (suspicious ? 0.17 : 0);
    return { event: C2S.PLAYER_DECISION, payload: { accept: this.random() >= rejectChance } };
  }
}

module.exports = { BotPlayer, PERSONALITIES };
