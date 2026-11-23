'use strict';

const { C2S, PHASES } = require('../shared/events');
const { isJoker, findWinningRank } = require('./deck');

const PERSONALITIES = Object.freeze({
  strategist: { nickname: 'Strategist', avatarId: 0, bluff: 0.07, feed: 12, read: 0.34, reject: 0.08, rejectSecond: 0.08 },
  detective: { nickname: 'Detective', avatarId: 7, bluff: 0.10, feed: 8, read: 0.80, reject: 0.15, rejectSecond: 0.18 },
  bluffer: { nickname: 'Bluffer', avatarId: 4, bluff: 0.29, feed: 7, read: 0.28, reject: 0.13, rejectSecond: 0.12 },
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

  choose(state, history) {
    switch (state.phase) {
      case PHASES.REQUEST: return this._request(state, history);
      case PHASES.OFFER: return this._offer(state, history);
      case PHASES.DECISION: return this._decide(state, history);
      default: throw new Error('Bot cannot act in this phase');
    }
  }

  _request(state, history) {
    const available = state.ranks.filter((rank) => countRank(state.hand, rank) < 4);
    const likelyRank = history.findLast((event) => event.type === 'card_requested' && event.playerId === state.holderId)?.rank;
    const feint = this.personality === 'bluffer' && this.random() < 0.18;
    const rank = weightedPick(available, (candidate) => {
      const matching = countRank(state.hand, candidate);
      return feint ? 4 - matching : (3 ** matching) * (candidate === likelyRank ? 1.5 : 1);
    }, this.random);
    return { event: C2S.REQUEST_CARD, payload: { rank } };
  }

  _offer(state, history) {
    // Only the giver's view contains the cards already on the table.
    const owned = [...state.hand, ...state.offers.map((offer) => offer.card).filter(Boolean)];
    const matching = countRank(owned, state.requestedRank);
    const holdsJoker = owned.some(isJoker);
    const previousRequest = history.findLast((event) => event.type === 'card_requested' && event.playerId === state.activeId && event.turn < state.turn);
    const oddRequest = matching >= 3;
    const winningPass = state.hand.find((card) => findWinningRank(owned.filter((other) => other.id !== card.id)));
    const card = winningPass ?? weightedPick(state.hand, (candidate) => {
      // Pass the Joker when possible. Keep other ranks moving as well.
      if (isJoker(candidate)) return 14;
      if (!holdsJoker && candidate.rank === state.requestedRank && !oddRequest) {
        return this.traits.feed + (previousRequest?.rank === candidate.rank ? 3 : 0);
      }
      return 5 - countRank(owned, candidate.rank);
    }, this.random);
    const claimedNoCard = this.random() < (matching === 0 ? 0.65 : this.traits.bluff);
    return { event: C2S.OFFER_CARD, payload: { cardId: card.id, claimedNoCard } };
  }

  _decide(state, history) {
    const pending = state.offers[state.offers.length - 1];
    const review = state.lieDeye;
    if (review?.giverId === state.holderId) this.knownLieCounts.set(state.holderId, review.lieCount);
    const knownLies = Math.min(3, this.knownLieCounts.get(state.holderId) ?? 0);
    const holdsJoker = state.hand.some(isJoker);
    const nearSet = countRank(state.hand, state.requestedRank) >= 3;
    const early = state.turn <= 4;
    const pastOffers = history.filter((e) => e.type === 'card_offered' && e.playerId === state.holderId && e.turn < state.turn).slice(-8);
    const repeatedClaims = pastOffers.filter((e) => e.claimedNoCard).length >= 2;
    const changedStory = state.offers.some((offer) => offer !== pending && offer.claimedNoCard !== pending.claimedNoCard);
    const suspicious = (pending.claimedNoCard && (knownLies > 0 || repeatedClaims || (!early && nearSet))) || changedStory ||
      (!early && knownLies >= 2 && nearSet);
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

    const trustEarly = early && this.personality === 'strategist';
    const rejectChance = holdsJoker || trustEarly ? 0.03 : this.traits.reject + (suspicious ? 0.17 : 0);
    return { event: C2S.PLAYER_DECISION, payload: { accept: this.random() >= rejectChance } };
  }
}

module.exports = { BotPlayer, PERSONALITIES };
