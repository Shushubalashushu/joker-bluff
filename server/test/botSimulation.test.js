'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BotPlayer, PERSONALITIES } = require('../src/game/BotPlayer');
const { JokerBluffGame } = require('../src/game/JokerBluffGame');
const { findWinningRank, isJoker, shuffle } = require('../src/game/deck');
const { C2S, PHASES } = require('../src/shared/events');
const { TURN_SPEEDS } = require('../src/config');

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

// A consistent human-style opponent that pursues its best set and promptly passes the Joker.
function scriptedPlayer(state, random) {
  const count = (rank) => state.hand.filter((card) => card.rank === rank).length;
  switch (state.phase) {
    case PHASES.REQUEST: {
      const ranks = shuffle(state.ranks.filter((rank) => count(rank) < 4), random);
      const rank = ranks.reduce((best, next) => count(next) > count(best) ? next : best);
      return { event: C2S.REQUEST_CARD, payload: { rank } };
    }
    case PHASES.OFFER: {
      const owned = [...state.hand, ...state.offers.map((offer) => offer.card)];
      const cards = shuffle([...state.hand], random).sort((a, b) => count(a.rank) - count(b.rank));
      const card = cards.find((candidate) => findWinningRank(owned.filter((other) => other.id !== candidate.id))) ??
        cards.find(isJoker) ?? cards[0];
      const claim = random() < (owned.some((candidate) => candidate.rank === state.requestedRank) ? 0.2 : 0.4);
      const substituteRank = claim && state.offers.length + 1 < state.maxOffers && card.rank !== state.requestedRank ? card.rank : undefined;
      return { event: C2S.OFFER_CARD, payload: { cardId: card.id, substituteRank } };
    }
    case PHASES.DECISION: {
      const accept = state.offers.length === 2 || random() >= 0.15;
      return { event: C2S.PLAYER_DECISION, payload: { accept } };
    }
  }
}

function play(game, id, { event, payload }) {
  switch (event) {
    case C2S.REQUEST_CARD: return game.requestCard(id, payload.rank);
    case C2S.OFFER_CARD: return game.offerCard(id, payload.cardId, payload);
    case C2S.USE_LIE_DEYE: return game.useLieDeye(id);
    case C2S.PLAYER_DECISION: return game.decide(id, payload.accept, payload.offerIndex);
  }
}

function simulate(seats, human, seed) {
  const setup = randomFrom(seed * 179);
  const personalities = shuffle(Object.keys(PERSONALITIES), setup);
  const fast = TURN_SPEEDS.fast;
  let now = 0;
  const game = new JokerBluffGame(seats, {
    rng: randomFrom(seed * 197),
    now: () => now,
    timers: { REQUEST: fast, OFFER: fast, DECISION: fast, LIE_DEYE: fast },
  });
  const bots = new Map();
  for (let offset = 1; offset < seats.length; offset++) {
    const id = seats[(seats.indexOf(human) + offset) % seats.length];
    bots.set(id, new BotPlayer(personalities[offset - 1], randomFrom(seed * 131 + offset * 29)));
  }
  const humanRandom = randomFrom(seed * 73);
  const paceRandom = randomFrom(seed * 803);
  const history = [];
  game.start();
  const jokerId = [...game.hands.values()].flat().find(isJoker).id;
  let lastJokerExit = null;
  let humanJokerPasses = 0;
  let quickReturns = 0;
  let slowBotMoves = 0;
  let botMoves = 0;
  while (!game.isFinished && game.turn <= 500) {
    const { actorId: id, turn } = game;
    const state = game.getStateFor(id);
    const bot = bots.get(id);
    if (bot) {
      const delay = bot.thinkDelay(state, game.deadline - now - 650, paceRandom);
      now += delay;
      assert.ok(now < game.deadline, `bot ran out of time at ${state.phase}`);
      botMoves++;
      if (delay >= 10000) slowBotMoves++;
    }
    const action = bot ? bot.choose(state, history) : scriptedPlayer(state, humanRandom);
    const events = play(game, id, action);
    for (const event of events) {
      if (event.type === 'card_offered' || event.type === 'card_requested') {
        history.push({ type: event.type, playerId: event.playerId, rank: event.rank, declaration: event.declaration, turn });
      }
      if (event.type === 'card_transferred' && game.lastTransfer.cardId === jokerId) {
        if (event.fromId === human) {
          lastJokerExit = turn;
          humanJokerPasses++;
        }
        if (event.toId === human && lastJokerExit !== null && turn - lastJokerExit < seats.length) quickReturns++;
      }
    }
    if (history.length > 192) history.splice(0, history.length - 192);
  }
  return { winnerId: game.result?.winnerId, humanJokerPasses, quickReturns, turns: game.turn - 1, botMoves, slowBotMoves };
}

test('rotating seat identities leaves bot wins and Joker movement identical for the same deals', () => {
  const seats = ['guest', 'north', 'east', 'west'];
  const rotatedIds = ['east', 'west', 'guest', 'north'];
  for (let seed = 1; seed <= 40; seed++) {
    const result = simulate(seats, seats[0], seed);
    const rotated = simulate(rotatedIds, rotatedIds[0], seed);
    assert.ok(result.winnerId);
    assert.deepEqual(rotated, { ...result, winnerId: rotatedIds[seats.indexOf(result.winnerId)] });
  }
});

test('bots compete across all physical seats without routinely circling the Joker straight back', (t) => {
  const seats = ['zero', 'one', 'two', 'three'];
  const seeds = [1, 2001].flatMap((start) => Array.from({ length: 160 }, (_, i) => start + i));
  let botWins = 0;
  let humanJokerPasses = 0;
  let quickReturns = 0;
  let botMoves = 0;
  let slowBotMoves = 0;
  const winsByPosition = seats.map(() => 0);
  const turns = [];
  for (const human of seats) {
    for (const seed of seeds) {
      const result = simulate(seats, human, seed);
      assert.ok(result.winnerId, `the match stalled for ${human}, seed ${seed}`);
      if (result.winnerId !== human) botWins++;
      winsByPosition[seats.indexOf(result.winnerId)]++;
      humanJokerPasses += result.humanJokerPasses;
      quickReturns += result.quickReturns;
      botMoves += result.botMoves;
      slowBotMoves += result.slowBotMoves;
      turns.push(result.turns);
    }
  }
  const totalRounds = seeds.length * seats.length;
  turns.sort((a, b) => a - b);
  const medianTurns = turns[totalRounds / 2];
  t.diagnostic(`Bot wins ${botWins}/${totalRounds}. Wins by seat ${winsByPosition.join('/')}. One-lap Joker returns ${quickReturns}/${humanJokerPasses}. Median ${medianTurns} turns.`);
  t.diagnostic(`Fast mode: ${slowBotMoves}/${botMoves} bot moves took at least 10 seconds, with zero missed deadlines.`);
  assert.ok(slowBotMoves / botMoves > 0.015 && slowBotMoves / botMoves < 0.12);
  assert.ok(botWins / totalRounds >= 0.62);
  assert.ok(winsByPosition.every((wins) => wins / totalRounds >= 0.19 && wins / totalRounds <= 0.31));
  assert.ok(humanJokerPasses >= 100 && quickReturns / humanJokerPasses <= 0.10);
  assert.ok(medianTurns <= 65);
});
