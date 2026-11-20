'use strict';

const crypto = require('crypto');

/** Highest ranks first: a 3-player game uses A, K, Q; a 5-player game adds J and 10. */
const RANK_POOL = Object.freeze(['A', 'K', 'Q', 'J', '10', '9', '8', '7']);
const SUITS = Object.freeze(['hearts', 'diamonds', 'clubs', 'spades']);
const JOKER = 'JOKER';

/**
 * Opaque card id. Ids must NOT encode rank/suit, otherwise a face-down card's
 * id would leak its identity to the client.
 */
const cardId = () => `c_${crypto.randomBytes(6).toString('hex')}`;

/**
 * Dynamic deck: N ranks x 4 suits + exactly 1 Joker  =>  (N * 4) + 1 cards.
 * @param {number} playerCount
 */
function buildDeck(playerCount) {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > RANK_POOL.length) {
    throw new RangeError(`playerCount must be an integer between 2 and ${RANK_POOL.length}`);
  }
  const ranks = RANK_POOL.slice(0, playerCount);
  const cards = [];
  for (const rank of ranks) {
    for (const suit of SUITS) cards.push({ id: cardId(), rank, suit });
  }
  cards.push({ id: cardId(), rank: JOKER, suit: 'joker' });
  return { ranks, cards };
}

/** Unbiased in-place Fisher-Yates shuffle. */
function shuffle(array, rng = Math.random) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const isJoker = (card) => card.rank === JOKER;

/**
 * Returns the rank of a 4-of-a-kind in `cards`, or null.
 * A hand containing the Joker can never win.
 */
function findWinningRank(cards) {
  if (cards.some(isJoker)) return null;
  const counts = new Map();
  for (const c of cards) {
    const n = (counts.get(c.rank) || 0) + 1;
    if (n === 4) return c.rank;
    counts.set(c.rank, n);
  }
  return null;
}

module.exports = { RANK_POOL, SUITS, JOKER, buildDeck, shuffle, isJoker, findWinningRank };
