'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');
const { BotPlayer, botThinkDelay } = require('../src/game/BotPlayer');
const { JokerBluffGame } = require('../src/game/JokerBluffGame');
const { buildDeck, findWinningRank, isJoker } = require('../src/game/deck');
const { Room } = require('../src/rooms/Room');
const { SessionStore } = require('../src/sessions/SessionStore');
const { C2S, S2C, PHASES } = require('../src/shared/events');
const config = require('../src/config');

function randomFrom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function setupRoom(humanCount, botCount, options) {
  const sessions = new SessionStore();
  const publicEvents = [];
  const recipients = new Set();
  const transport = {
    toRoom: (code, event, data) => {
      if (event === S2C.GAME_EVENT) publicEvents.push(data);
    },
    toPlayer: (id) => recipients.add(id),
  };
  const room = new Room({ code: 'TESTS', sessions, transport, botDelay: () => 0, setupRandom: randomFrom(537), ...options });
  const humans = Array.from({ length: humanCount }, (_, i) => {
    const session = sessions.create();
    session.socketId = `socket${i}`;
    session.nickname = `Human ${i + 1}`;
    room.addPlayer(session);
    return session;
  });
  const botIds = Array.from({ length: botCount }, () => room.addBot(room.hostId));
  return { room, humans, botIds, publicEvents, recipients };
}

test('Strategist feeds a plausible request and recognizes holdings that make it unlikely', () => {
  const bot = new BotPlayer('strategist', () => 0.55);
  const { cards } = buildDeck(4);
  const aces = cards.filter((card) => card.rank === 'A');
  const kings = cards.filter((card) => card.rank === 'K');
  const queen = cards.find((card) => card.rank === 'Q');
  const base = { phase: PHASES.OFFER, requestedRank: 'A', activeId: 'requester', turn: 2, offers: [] };
  const plausible = { ...base, hand: [kings[0], kings[1], kings[2], aces[0], queen] };
  assert.equal(bot.choose(plausible, []).payload.cardId, aces[0].id);
  const unlikely = { ...base, hand: [kings[0], queen, ...aces.slice(0, 3)] };
  assert.equal(bot.choose(unlikely, []).payload.cardId, queen.id);
  const winning = { ...base, hand: [...aces, kings[0]] };
  assert.equal(bot.choose(winning, []).payload.cardId, kings[0].id);
});

test('Detective waits for a reason to spend, remembers only a paid reading and can still accept a suspicious second offer', () => {
  const bot = new BotPlayer('detective', () => 0.5);
  const { cards } = buildDeck(4);
  const holderId = 'giver';
  const hand = cards.filter((card) => card.rank === 'A').slice(0, 3);
  hand.push(cards.find((card) => card.rank === 'Q'));
  const pending = { number: 1, claimedNoCard: true, card: null };
  const decision = { phase: PHASES.DECISION, holderId, requestedRank: 'A', hand, turn: 1,
    canUseLieDeye: true, lieDeye: null, offers: [pending] };
  assert.deepEqual(bot.choose(decision, []), { event: C2S.PLAYER_DECISION, payload: { accept: true } });
  assert.equal(bot.knownLieCounts.size, 0);
  const later = { ...decision, turn: 6 };
  assert.equal(bot.choose(later, []).event, C2S.PLAYER_DECISION);
  const history = [{ type: 'card_offered', playerId: holderId, turn: 3, claimedNoCard: false }];
  assert.equal(bot.choose(later, history).event, C2S.USE_LIE_DEYE);
  assert.equal(bot.knownLieCounts.size, 0);
  const reading = { ...later, canUseLieDeye: false, offers: [{ ...pending, lieDeyeUsed: true }],
    lieDeye: { giverId: holderId, lieCount: 2 } };
  assert.equal(bot.choose(reading, []).event, C2S.PLAYER_DECISION);
  assert.equal(bot.knownLieCounts.get(holderId), 2);
  const secondOffer = { ...later, offers: [...reading.offers, { number: 2, claimedNoCard: false, card: null }] };
  assert.deepEqual(bot.choose(secondOffer, []), { event: C2S.PLAYER_DECISION, payload: { accept: true, offerIndex: 1 } });
});

test('bots force a third offer only occasionally and only with corroborating evidence', () => {
  const { cards } = buildDeck(4);
  const hand = [...cards.filter((card) => card.rank === 'A').slice(0, 3), cards.find((card) => card.rank === 'K')];
  const state = {
    phase: PHASES.DECISION, holderId: 'giver', turn: 7, requestedRank: 'A', hand,
    offers: [{ number: 1, claimedNoCard: true }, { number: 2, claimedNoCard: false }],
  };
  const history = [2, 4].map((turn) => ({ type: 'card_offered', playerId: 'giver', turn, claimedNoCard: true }));
  for (const personality of ['strategist', 'detective', 'bluffer']) {
    const eager = new BotPlayer(personality, () => 0);
    assert.deepEqual(eager.choose(state, []), { event: C2S.PLAYER_DECISION, payload: { accept: true, offerIndex: 0 } });
    assert.deepEqual(eager.choose(state, history), { event: C2S.PLAYER_DECISION, payload: { accept: false } });
    const holdingJoker = { ...state, hand: [...state.hand.slice(0, 3), cards.find(isJoker)] };
    assert.equal(eager.choose(holdingJoker, history).payload.accept, true);
    const cautious = new BotPlayer(personality, () => 0.19);
    assert.equal(cautious.choose(state, history).payload.accept, true);
  }
  const takesSecond = new BotPlayer('detective', () => 0.99);
  assert.deepEqual(takesSecond.choose(state, history), { event: C2S.PLAYER_DECISION, payload: { accept: true, offerIndex: 1 } });
});

test('Bluffer can make an unexpected request but pursues a nearly complete set', () => {
  const { ranks, cards } = buildDeck(4);
  const hand = cards.filter((card) => card.rank === 'A').slice(0, 3);
  hand.push(cards.find((card) => card.rank === 'K'));
  const request = { phase: PHASES.REQUEST, holderId: 'giver', ranks, hand };
  const strategist = new BotPlayer('strategist', () => 0.10);
  assert.equal(strategist.choose(request, []).payload.rank, 'A');
  const bluffer = new BotPlayer('bluffer', () => 0.10);
  assert.equal(bluffer.choose(request, []).payload.rank, 'A');
  const rolls = [0.10, 0.35];
  const feinting = new BotPlayer('bluffer', () => rolls.shift());
  const splitHand = [...hand.slice(0, 2), hand[3], cards.find((card) => card.rank === 'Q')];
  assert.equal(feinting.choose({ ...request, hand: splitHand }, []).payload.rank, 'K');
  const decision = { phase: PHASES.DECISION, holderId: 'giver', turn: 2, requestedRank: 'A', hand,
    offers: [{ number: 1, claimedNoCard: true, card: null }] };
  assert.equal(strategist.choose(decision, []).payload.accept, true);
});

test('Bluffer claim rates follow the cards and stay the same across early and late turns', () => {
  const { cards } = buildDeck(4);
  const hand = [...cards.filter((card) => card.rank === 'K'), cards.find((card) => card.rank === 'Q')];
  const offer = { phase: PHASES.OFFER, requestedRank: 'K', activeId: 'requester', hand, offers: [] };
  const countClaims = (state) => {
    const bot = new BotPlayer('bluffer', randomFrom(719));
    return Array.from({ length: 2000 }, () => bot.choose(state, []).payload.claimedNoCard).filter(Boolean).length;
  };
  const early = countClaims({ ...offer, turn: 1 });
  assert.equal(early, countClaims({ ...offer, turn: 20 }));
  assert.ok(early > 350 && early < 550, `false claims: ${early}/2000`);
  const honest = countClaims({ ...offer, turn: 1, requestedRank: 'A' });
  assert.ok(honest > 650 && honest < 880, `honest claims: ${honest}/2000`);
});

test('a freshly received Joker is offered less often even though a winning pass takes priority', () => {
  const { cards } = buildDeck(4);
  const joker = cards.find(isJoker);
  const hand = ['A', 'K', 'Q', 'J'].map((rank) => cards.find((card) => card.rank === rank));
  const state = { phase: PHASES.OFFER, turn: 4, requestedRank: 'A', hand: [...hand, joker], offers: [] };
  const countJokers = (offer) => {
    const bot = new BotPlayer('strategist', randomFrom(921));
    return Array.from({ length: 2000 }, () => bot.choose(offer, []).payload.cardId).filter((id) => id === joker.id).length;
  };
  const fresh = { ...state, lastTransfer: { cardId: joker.id } };
  const freshCount = countJokers(fresh);
  assert.ok(freshCount > 150 && freshCount < 450, `fresh: ${freshCount}/2000`);
  assert.ok(countJokers(state) > freshCount * 1.5);
  const winning = { ...fresh, hand: [...cards.filter((card) => card.rank === 'A'), joker] };
  assert.equal(new BotPlayer('bluffer', () => 0).choose(winning, []).payload.cardId, joker.id);
});

test('bot pacing samples a broad 2–15s range and adapts to shorter decision clocks', () => {
  const random = randomFrom(731);
  const delays = Array.from({ length: 10000 }, () => botThinkDelay(600000, random));
  const mean = delays.reduce((total, delay) => total + delay, 0) / delays.length;
  assert.ok(mean > 9800 && mean < 10200, `mean delay: ${mean}ms`);
  assert.ok(Math.min(...delays) < 2500 && Math.max(...delays) > 14500);
  assert.ok(delays.some((delay) => delay >= 6800 && delay <= 7200));
  assert.ok(delays.every((delay) => delay >= 2000 && delay <= 15000));
  const short = Array.from({ length: 100 }, () => botThinkDelay(9980, random));
  assert.ok(short.every((delay) => delay > 2000 && delay <= 9980));
  assert.ok(new Set(short).size > 90);
  assert.equal(botThinkDelay(180, random), 180);
  assert.equal(botThinkDelay(0, random), 0);
});

test('a bot can force a third card after a private paid Lie Deye reading', () => {
  const bot = new BotPlayer('detective', () => 0.1);
  const game = new JokerBluffGame(['one', 'two', 'three', 'four'], { rng: randomFrom(73) });
  game.start();
  const { holderId, activeId } = game;
  const rank = game.getStateFor(holderId).hand.find((card) => !isJoker(card)).rank;
  game.requestCard(activeId, rank);
  const [first, second, third] = game.getStateFor(holderId).hand;
  game.offerCard(holderId, first.id, { claimedNoCard: true });
  game.decide(activeId, false);
  game.offerCard(holderId, second.id);
  const before = game.getStateFor(activeId);
  assert.equal(before.lieDeye, null);
  assert.equal(bot.choose(before, []).event, C2S.USE_LIE_DEYE);
  game.useLieDeye(activeId);
  const after = game.getStateFor(activeId);
  assert.equal(after.lieDeyeWallet.balance, config.LIE_DEYE.STARTING_TOKENS - 1);
  assert.equal(after.lieDeye.lieCount, 1);
  assert.ok(after.offers.every((offer) => offer.card === null));
  for (const otherId of game.seats.filter((id) => id !== activeId)) {
    assert.equal(game.getStateFor(otherId).lieDeye, null);
  }
  const { event, payload } = bot.choose(after, []);
  assert.equal(event, C2S.PLAYER_DECISION);
  assert.deepEqual(payload, { accept: false });
  game.decide(activeId, payload.accept, payload.offerIndex);
  assert.equal(game.phase, PHASES.OFFER);
  assert.deepEqual(game.offers.map((offer) => offer.status), ['rejected', 'rejected']);
  const transfer = game.offerCard(holderId, third.id).find((event) => event.type === 'card_transferred');
  assert.equal(transfer.forced, true);
  assert.equal(transfer.offerNumber, 3);
  assert.equal(game.getStateFor(activeId).hand.some((card) => card.id === third.id), true);
  assert.ok([first, second].every((offer) => game.getStateFor(holderId).hand.some((card) => card.id === offer.id)));
});

function humanMove(room, id) {
  const game = room.game.getStateFor(id);
  if (game.phase === PHASES.REQUEST) {
    const count = (rank) => game.hand.filter((card) => card.rank === rank).length;
    const rank = game.ranks.reduce((best, next) => count(next) > count(best) ? next : best);
    room.act(id, C2S.REQUEST_CARD, { rank });
  } else if (game.phase === PHASES.OFFER) {
    const card = game.hand.find((card) => findWinningRank(game.hand.filter((other) => other !== card))) ??
      game.hand.find(isJoker) ?? game.hand.find((card) => card.rank === game.requestedRank) ?? game.hand[0];
    room.act(id, C2S.OFFER_CARD, { cardId: card.id });
  } else {
    room.act(id, C2S.PLAYER_DECISION, { accept: true });
  }
}

for (const humanCount of [1, 2, 3]) {
  const botCount = 4 - humanCount;
  test(`plays a full game with ${humanCount} human seat(s) and ${botCount} bot seat(s) using seat-redacted inputs`, async (t) => {
    const originalStart = JokerBluffGame.prototype.start;
    t.mock.method(JokerBluffGame.prototype, 'start', function () {
      this.rng = randomFrom(41 + humanCount);
      return originalStart.call(this);
    });
    const { room, humans, botIds, publicEvents, recipients } = setupRoom(humanCount, botCount,
      { botRandom: randomFrom(113) });
    try {
      room.startGame(room.hostId);
      const humanIds = new Set(humans.map((session) => session.playerId));
      const botMoves = [];
      const observations = [];
      for (const [id, brain] of room.botBrains) {
        const choose = brain.choose.bind(brain);
        brain.choose = (state, history) => {
          const publishedHistory = publicEvents.filter((event) => event.type === 'card_requested' || event.type === 'card_offered');
          observations.push({
            playerId: id,
            actorId: state.actorId,
            hand: state.hand.map((card) => card.id),
            ownedHand: room.game.hands.get(id).map((card) => card.id),
            otherCardsHidden: state.seats.every((seat) => !Object.hasOwn(seat, 'hand')) &&
              (state.holderId === id || state.offers.every((offer) => offer.card === null)) &&
              (!state.lastTransfer?.cardId || state.lastTransfer.toId === id),
            privateReadingValid: state.lieDeye === null || (state.activeId === id && state.lieDeyeWallet.usedThisGame > 0 &&
              state.offers.at(-1).lieDeyeUsed),
            historyMatches: history.every((item, index) => {
              const published = publishedHistory.at(index - history.length);
              return published?.type === item.type && published.playerId === item.playerId &&
                published.rank === item.rank && published.claimedNoCard === item.claimedNoCard &&
                Object.keys(item).every((key) => ['type', 'playerId', 'rank', 'claimedNoCard', 'turn'].includes(key));
            }),
          });
          const action = choose(state, history);
          botMoves.push({ id, action: action.event });
          return action;
        };
      }

      for (let tick = 0; !room.game.isFinished && tick < 1000; tick++) {
        if (humanIds.has(room.game.actorId)) humanMove(room, room.game.actorId);
        else await wait(1);
      }
      assert.equal(room.status, 'finished');
      const { winnerId, loserId, winningRank } = room.game.result;
      assert.equal(findWinningRank(room.game.hands.get(winnerId)), winningRank);
      assert.equal(room.game.hands.get(loserId).some(isJoker), true);
      const finalCards = [...room.game.hands.values()].flat();
      assert.equal(new Set(finalCards.map((card) => card.id)).size, 17);
      assert.equal(finalCards.length, 17);
      assert.equal(room.botJob, null);
      assert.deepEqual(recipients, humanIds);
      assert.deepEqual(new Set(botMoves.map((move) => move.id)), new Set(botIds));
      assert.ok(botMoves.some((move) => move.action === C2S.OFFER_CARD));
      assert.ok(publicEvents.some((event) => event.type === 'card_offered' && humanIds.has(event.playerId)));
      assert.equal(publicEvents.some((event) => event.type === 'timeout'), false);
      for (const observed of observations) {
        assert.equal(observed.playerId, observed.actorId);
        assert.deepEqual(observed.hand, observed.ownedHand);
        assert.equal(observed.otherCardsHidden, true);
        assert.equal(observed.privateReadingValid, true);
        assert.equal(observed.historyMatches, true);
      }
      for (const id of botIds) {
        assert.ok(room.game.lieDeyeUses.get(id) <= config.LIE_DEYE.MAX_USES_PER_GAME);
        assert.equal(room.sessions.getByPlayerId(id), null);
      }

      const balances = new Map(room.tokenBank);
      room.pruneTokenBank();
      room.startGame(room.hostId, { rematch: true });
      assert.equal(room.game.turn, 1);
      assert.deepEqual(room.game.tokens, balances);
      assert.equal(room.botHistory.length, 0);
      assert.ok([...room.botBrains.values()].every((brain) => brain.knownLieCounts.size === 0));
    } finally {
      room.destroy();
    }
  });
}

test('bot jobs pause when all humans disconnect, resume on reconnect and cancel safely on abort', async () => {
  const { room, humans } = setupRoom(1, 3, { botDelay: () => 15 });
  const [host] = humans;
  try {
    room.startGame(host.playerId);
    if (room.game.actorId === host.playerId) humanMove(room, host.playerId);
    assert.ok(room.botJob);
    host.socketId = null;
    room.onPlayerDisconnected(host.playerId);
    assert.equal(room.botJob, null);
    const step = room.game.step;
    await wait(25);
    assert.equal(room.game.step, step);

    host.socketId = 'newSocket';
    room.addPlayer(host);
    assert.ok(room.botJob);
    room.endGame(host.playerId);
    await wait(25);
    assert.equal(room.botJob, null);
    assert.equal(room.game, null);
    assert.equal(room.players.length, 4);
    room.removePlayer(host.playerId);
    assert.equal(room.hostId, null);
    assert.equal(room.isEmpty, true);
    assert.equal(room.tokenBank.size, 1);
  } finally {
    room.destroy();
  }
});

test('bot seats share the room cap and are skipped when the host leaves', () => {
  const { room, humans, botIds } = setupRoom(2, config.MAX_PLAYERS - 2);
  const [host, guest] = humans;
  try {
    assert.throws(() => room.addBot(host.playerId), { code: 'ROOM_FULL' });
    const bots = room.publicState().players.filter((player) => player.isBot);
    assert.equal(bots.length, botIds.length);
    assert.equal(new Set(bots.map((bot) => bot.botName.en)).size, botIds.length);
    assert.equal(new Set(bots.map((bot) => bot.botName.he)).size, botIds.length);
    room.removeBot(host.playerId, botIds[0]);
    assert.equal(room.tokenBank.has(botIds[0]), false);
    room.removePlayer(host.playerId);
    assert.equal(room.hostId, guest.playerId);
    assert.equal(room.connectedCount, 1);
  } finally {
    room.destroy();
  }
});

test('fresh games and rematches shuffle the same lobby roster and draw hidden personalities', () => {
  const { room, botIds } = setupRoom(1, 3, { botDelay: () => 60000 });
  try {
    const { players } = room.publicState();
    const lobbyOrder = players.map((player) => player.id);
    const positions = lobbyOrder.map(() => new Set());
    const personalitiesById = new Map(botIds.map((id) => [id, new Set()]));
    for (let i = 0; i < 100; i++) {
      room.startGame(room.hostId, { rematch: i > 0 });
      assert.deepEqual(room.publicState().players, players);
      assert.deepEqual(new Set(room.game.seats), new Set(lobbyOrder));
      assert.equal(room.game.activeId, room.game.seats[(room.game.seats.indexOf(room.game.holderId) + 1) % lobbyOrder.length]);
      room.game.seats.forEach((id, position) => positions[position].add(id));
      for (const [id, brain] of room.botBrains) personalitiesById.get(id).add(brain.personality);
      assert.equal(new Set([...room.botBrains.values()].map((brain) => brain.personality)).size, 3);
      const publicBots = room.publicState().players.filter((player) => player.isBot);
      assert.ok(publicBots.every((bot) => Object.keys(bot).length === 8 && !Object.hasOwn(bot, 'botPersonality')));
      // Reset only the lifecycle gate to exercise setup repeatedly without playing 100 full games.
      room.status = 'finished';
    }
    assert.ok(positions.every((seat) => seat.size === lobbyOrder.length));
    assert.ok([...personalitiesById.values()].every((choices) => choices.size === 3));
  } finally {
    room.destroy();
  }
});
