'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');

const { JokerBluffGame } = require('../src/game/JokerBluffGame');
const { findWinningRank } = require('../src/game/deck');
const { sanitizeTouches, sanitizePressDuration } = require('../src/game/telemetry');
const { Room } = require('../src/rooms/Room');
const { RoomManager } = require('../src/rooms/RoomManager');
const { SessionStore } = require('../src/sessions/SessionStore');
const { clientAddress } = require('../src/utils/rateLimit');

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);

function newGame(n = 3, opts = {}) {
  let clock = 1_000_000;
  const g = new JokerBluffGame(ids(n), {
    now: () => clock,
    timers: { REQUEST: 15000, OFFER: 15000, DECISION: 10000, AFK: 3000, LIE_DEYE: 60000 },
    ...opts,
  });
  g.advance = (ms) => (clock += ms);
  g.start();
  return g;
}

/** Drives the game into DECISION for offer #1 with some touch telemetry. */
function toDecision(g, touches, pressDurationMs) {
  g.requestCard(g.activeId, g.ranks[0]);
  g.advance(4200); // giver "thinks" for 4.2s
  const hand = g.hands.get(g.holderId);
  const slot = 2;
  g.offerCard(g.holderId, hand[slot].id, { touches, pressDurationMs });
  return slot;
}

function nonWinningOffer(g) {
  const hand = g.hands.get(g.holderId);
  const owned = [...hand, ...g.offers.map((offer) => offer.card)];
  return hand.find((card) => !findWinningRank(owned.filter((other) => other !== card))).id;
}

/** Plays transactions without ending the match until `pid` is the active player. */
function cycleTo(g, pid) {
  for (let guard = 0; g.activeId !== pid && guard < 20; guard++) {
    g.requestCard(g.activeId, g.ranks[0]);
    g.offerCard(g.holderId, nonWinningOffer(g));
    g.decide(g.activeId, true);
  }
  assert.equal(g.activeId, pid);
}

/** Gives the HOLDER all four cards of ranks[0] (plus one odd card). Returns the holder id. */
function rigWin(g) {
  const pid = g.holderId;
  const R = g.ranks[0];
  const mine = g.hands.get(pid);
  for (const [other, hand] of g.hands) {
    if (other === pid) continue;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i].rank !== R) continue;
      const j = mine.findIndex((c) => c.rank !== R);
      if (j === -1) return pid;
      [hand[i], mine[j]] = [mine[j], hand[i]];
    }
  }
  return pid;
}

/** Plays the automatic win through `act(playerId, event, payload)` (engine or Room). Returns the winner id. */
function playAutoWin(g, act) {
  const winner = rigWin(g);
  const odd = g.hands.get(winner).find((c) => c.rank !== g.ranks[0]);
  act(g.activeId, 'request_card', { rank: g.ranks[1] });
  act(winner, 'offer_card', { cardId: odd.id });
  act(g.activeId, 'player_decision', { accept: true });
  return winner;
}

const engineAct = (g) => (pid, event, p = {}) => {
  if (event === 'request_card') return g.requestCard(pid, p.rank);
  if (event === 'offer_card') return g.offerCard(pid, p.cardId, p);
  if (event === 'player_decision') return g.decide(pid, p.accept);
  throw new Error(event);
};

const sampleTouches = [
  { s: 0, u: 0.5, v: 0.5, x: 0.2, y: 0.8, t: 500 },
  { s: 1, u: 0.4, v: 0.6, x: 0.35, y: 0.8, t: 1500 },
  { s: 2, u: 0.5, v: 0.3, x: 0.5, y: 0.75, t: 3900 },
];

test('telemetry: sanitizer clamps, drops garbage, sorts and downsamples', () => {
  const out = sanitizeTouches(
    [
      { s: 9, u: 2, v: -1, x: 1.5, y: 0.5, t: 99999 }, // bad slot -> null, x clamped, t clamped
      { x: 'nope', y: 0.2 }, // dropped
      null, // dropped
      { s: 1, u: 0.25, v: 0.75, x: 0.1, y: 0.9, t: 10 },
    ],
    { handSize: 5, maxT: 5000 }
  );
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { s: 1, u: 0.25, v: 0.75, x: 0.1, y: 0.9, t: 10 });
  assert.deepEqual(out[1], { s: null, u: null, v: null, x: 1, y: 0.5, t: 5000 });

  const many = Array.from({ length: 550 }, (_, i) => ({ x: 0.5, y: 0.5, t: i }));
  assert.equal(sanitizeTouches(many, { handSize: 5, maxT: 1e6 }).length, 200);
  assert.deepEqual(sanitizeTouches('junk', { handSize: 5, maxT: 1 }), []);
});

test('telemetry: hold duration handles absent inputs and stays within the server offer time', () => {
  for (const input of [undefined, null, '800', NaN, Infinity]) assert.equal(sanitizePressDuration(input, 1000), null);
  assert.equal(sanitizePressDuration(-20, 1000), 0);
  assert.equal(sanitizePressDuration(612.4, 1000), 612);
  assert.equal(sanitizePressDuration(6000, 1000), 1000);
});

test('lie deye: every player starts their first game with 4 tokens (use cap stays 3)', () => {
  const g = newGame(4);
  for (const id of g.seats) {
    const w = g.getStateFor(id).lieDeyeWallet;
    assert.deepEqual(w, { balance: 4, usedThisGame: 0, maxPerGame: 3, usesLeft: 3 }, 'start with 4, but max 3 uses');
  }
  assert.ok(g.getStateFor('p0').seats.every((s) => s.tokens === 4 && s.lieDeyeUsesLeft === 3));
});

test('lie deye: freezes the clock at 60s and reveals telemetry ONLY to the active player', () => {
  const g = newGame(3);
  const holder = g.holderId;
  const active = g.activeId;
  const bystander = g.seats.find((id) => id !== holder && id !== active);
  const slot = toDecision(g, sampleTouches, 815);

  assert.equal(g.getStateFor(active).lieDeye, null, 'nothing visible before spending a token');
  assert.equal(g.getStateFor(active).canUseLieDeye, true);
  assert.equal(g.getStateFor(bystander).canUseLieDeye, false);
  g.advance(7000); // 3s left on the 10s decision clock

  const events = g.useLieDeye(active);
  assert.equal(events[0].type, 'lie_deye_used');
  assert.equal(events[0].tokensLeft, 3);
  assert.equal(events[0].usesLeft, 2);
  assert.equal(g.deadline - g.now(), 60000, 'full 60s from the moment of activation');
  assert.equal(g.phaseDuration, 60000);

  const va = g.getStateFor(active);
  assert.equal(va.timeFrozen, true);
  assert.equal(va.canUseLieDeye, false, 'once per offer');
  assert.equal(va.lieDeyeWallet.balance, 3);
  assert.equal(va.lieDeye.decisionMs, 4200, 'server-measured decision time');
  assert.equal(va.lieDeye.handSize, 5);
  assert.equal(va.lieDeye.offeredSlot, slot);
  assert.equal(va.lieDeye.touches.length, 3);
  assert.equal(va.lieDeye.pressDurationMs, 815);
  assert.equal(va.lieDeye.giverId, holder);
  assert.equal(va.lieDeye.lieCount, 0);

  assert.equal(g.getStateFor(holder).lieDeye, null);
  assert.equal(g.getStateFor(bystander).lieDeye, null);
  assert.ok(!JSON.stringify(g.getStateFor(bystander)).includes('"touches"'), 'no telemetry leak');
  assert.ok(!JSON.stringify(g.getStateFor(bystander)).includes('"pressDurationMs"'), 'no hold duration leak');
  assert.equal(g.getStateFor(bystander).offers[0].lieDeyeUsed, true, 'everyone sees a token was used');
});

test('lie deye: both reviews use the same historical count until the exchange completes', () => {
  const g = newGame(4, { maxLieDeyeUses: 4 });
  const holder = rigWin(g);
  const asker = g.activeId;
  const hand = g.hands.get(holder);
  const oddIndex = hand.findIndex((card) => card.rank !== g.ranks[0]);
  if (hand[oddIndex].rank === 'JOKER') {
    const other = g.hands.get(asker);
    [hand[oddIndex], other[0]] = [other[0], hand[oddIndex]];
  }
  const onlyMatchingCard = hand[oddIndex];

  g.requestCard(asker, onlyMatchingCard.rank);
  g.offerCard(holder, onlyMatchingCard.id, { substituteRank: 'JOKER' });
  g.useLieDeye(asker);
  assert.equal(g.getStateFor(asker).lieDeye.lieCount, 0, 'the first false claim is still under review');
  g.decide(asker, false);

  assert.ok(hand.every((card) => card.rank !== onlyMatchingCard.rank));
  g.offerCard(holder, hand[0].id, { substituteRank: hand[0].rank });
  g.useLieDeye(asker);
  assert.equal(g.getStateFor(asker).lieDeye.lieCount, 0, 'both offers share the same historical count');
  assert.equal(g.liesByPlayer.get(holder), 0, 'no new claims are published before transfer');
  assert.equal(g.getStateFor(holder).lieDeye, null);
  g.decide(asker, true);

  cycleTo(g, asker);
  assert.equal(g.holderId, holder);
  const missingRank = g.ranks.find((rank) => !g.hands.get(holder).some((card) => card.rank === rank));
  g.requestCard(asker, missingRank);
  const safeId = nonWinningOffer(g);
  const honest = hand.find((card) => card.id === safeId);
  g.offerCard(holder, honest.id, { substituteRank: honest.rank });
  g.useLieDeye(asker);
  assert.equal(g.getStateFor(asker).lieDeye.lieCount, 2, 'the second claim was also false because the giver still owned the rejected card');
  g.decide(asker, false);
  g.offerCard(holder, nonWinningOffer(g));
  g.useLieDeye(asker);
  assert.equal(g.getStateFor(asker).lieDeye.lieCount, 2, 'the prior honest claim did not increase the history');
  g.decide(asker, true);

  const otherGiverHistory = g.liesByPlayer.get(g.holderId);
  toDecision(g, []);
  g.useLieDeye(g.activeId);
  assert.equal(g.getStateFor(g.activeId).lieDeye.lieCount, otherGiverHistory, 'another giver has a separate count');
});

test('lie deye: keeps the picked slot and touches distinct and hides faces even with a Joker in play', () => {
  const g = newGame(4);
  const holder = g.holderId;
  const asker = g.activeId;
  const hand = g.hands.get(holder);
  const jokerOwner = [...g.hands.values()].find((cards) => cards.some((card) => card.rank === 'JOKER'));
  if (jokerOwner !== hand) {
    const jokerIndex = jokerOwner.findIndex((card) => card.rank === 'JOKER');
    [hand[0], jokerOwner[jokerIndex]] = [jokerOwner[jokerIndex], hand[0]];
  }
  g.requestCard(asker, g.ranks[0]);
  g.shuffleHand(holder, hand.map((card) => card.id).reverse());
  const jokerSlot = hand.findIndex((card) => card.rank === 'JOKER');
  const pickedSlot = hand.findIndex((card) => card.rank !== 'JOKER');
  const joker = hand[jokerSlot];
  const picked = hand[pickedSlot];
  g.offerCard(holder, picked.id, { touches: [{ c: joker.id, x: 0.5, y: 0.5, t: 0 }] });
  g.shuffleHand(holder, hand.map((card) => card.id).reverse());
  g.useLieDeye(asker);

  let view = g.getStateFor(asker);
  assert.equal(view.offers[0].card, null);
  assert.equal(view.lieDeye.offeredSlot, pickedSlot);
  assert.equal(view.lieDeye.touches[0].s, jokerSlot);
  assert.ok(!('card' in view.lieDeye));
  assert.ok(!('c' in view.lieDeye.touches[0]));

  g.decide(asker, false);
  g.offerCard(holder, joker.id);
  g.useLieDeye(asker);
  view = g.getStateFor(asker);
  assert.ok(view.offers.every(({ card }) => card === null));
  assert.ok(!('card' in view.lieDeye));
  g.decide(asker, true, 0);
  assert.equal(g.getStateFor(asker).lastTransfer.cardId, picked.id);
  assert.ok(g.getStateFor(holder).hand.some((card) => card.id === joker.id));
});

test('lie deye: guards (phase, actor, once per offer)', () => {
  const g = newGame(3);
  const active = g.activeId;
  assert.throws(() => g.useLieDeye(active), { code: 'WRONG_PHASE' });
  toDecision(g, []);
  assert.throws(() => g.useLieDeye(g.holderId), { code: 'NOT_YOUR_TURN' });
  g.useLieDeye(active);
  assert.throws(() => g.useLieDeye(active), { code: 'ALREADY_READ' });

  // Reject -> offer #2 -> can read again
  g.decide(active, false);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  g.useLieDeye(active);
  assert.equal(g.tokens.get(active), 2);
});

test('lie deye: an empty wallet is refused (NO_TOKENS) and the clock is untouched', () => {
  const g = newGame(3, { tokenBalances: new Map([['p0', 0], ['p1', 0], ['p2', 0]]) });
  const active = g.activeId;
  toDecision(g, []);
  assert.equal(g.getStateFor(active).canUseLieDeye, false);
  assert.throws(() => g.useLieDeye(active), { code: 'NO_TOKENS' });
  assert.equal(g.deadline - g.now(), 10000, 'clock untouched');
});

test('lie deye: max 3 uses per match even with a bigger balance (LIE_DEYE_LIMIT)', () => {
  const g = newGame(3, { tokenBalances: { p0: 5, p1: 5, p2: 5 } });
  const me = g.activeId;

  // Transaction 1: read offer #1 and #2, the 3rd is forced.
  g.requestCard(me, g.ranks[0]);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  g.useLieDeye(me);
  g.decide(me, false);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  g.useLieDeye(me);
  g.decide(me, false);
  g.offerCard(g.holderId, nonWinningOffer(g)); // forced -> transfer

  // Round the table until I'm asking again.
  cycleTo(g, me);
  g.requestCard(me, g.ranks[0]);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  g.useLieDeye(me); // 3rd use
  assert.deepEqual(g.getStateFor(me).lieDeyeWallet, { balance: 2, usedThisGame: 3, maxPerGame: 3, usesLeft: 0 });

  g.decide(me, false);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  assert.equal(g.getStateFor(me).canUseLieDeye, false);
  assert.throws(() => g.useLieDeye(me), { code: 'LIE_DEYE_LIMIT' });
  assert.equal(g.tokens.get(me), 2, 'the remaining balance is kept for the next game');
});

test('lie deye: telemetry disappears once the decision is made', () => {
  const g = newGame(3);
  const active = g.activeId;
  toDecision(g, sampleTouches);
  g.useLieDeye(active);
  g.decide(active, false);
  assert.equal(g.getStateFor(active).lieDeye, null);
  assert.equal(g.getStateFor(active).timeFrozen, false);
});

test('timeout auto-offers are flagged and carry no touches', () => {
  const g = newGame(3);
  g.handleTimeout(); // REQUEST
  g.handleTimeout(); // OFFER (auto)
  g.useLieDeye(g.activeId);
  const ld = g.getStateFor(g.activeId).lieDeye;
  assert.equal(ld.auto, true);
  assert.deepEqual(ld.touches, []);
});

// ------------------------------------------------------------------ Shuffle Hand

test('shuffle: reorders my hand only, keeps the same cards, works in any phase', () => {
  const g = newGame(4);
  const bystander = g.seats.find((id) => id !== g.holderId && id !== g.activeId);
  const before = g.hands.get(bystander).map((c) => c.id);
  const otherBefore = g.hands.get(g.holderId).map((c) => c.id).join();

  assert.deepEqual(g.shuffleHand(bystander), [], 'private: no public events');
  const after = g.hands.get(bystander).map((c) => c.id);
  assert.notDeepEqual(after, before, 'order changed');
  assert.deepEqual([...after].sort(), [...before].sort(), 'same cards');
  assert.equal(g.hands.get(g.holderId).map((c) => c.id).join(), otherBefore, 'nobody else affected');

  toDecision(g, []); // another player's DECISION phase - still allowed
  g.shuffleHand(bystander);
  g.shuffleHand(g.activeId);
  assert.equal(g.getStateFor(bystander).hand.length, 4);
});

test('shuffle: the giver shuffling while choosing is counted in the Lie Deye report', () => {
  const g = newGame(3);
  g.requestCard(g.activeId, g.ranks[0]);
  g.shuffleHand(g.holderId);
  g.shuffleHand(g.holderId);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  g.useLieDeye(g.activeId);
  assert.equal(g.getStateFor(g.activeId).lieDeye.shuffles, 2);

  // The counter resets for the next offer.
  g.decide(g.activeId, false);
  g.offerCard(g.holderId, g.hands.get(g.holderId)[0].id, {});
  g.useLieDeye(g.activeId);
  assert.equal(g.getStateFor(g.activeId).lieDeye.shuffles, 0);
});

test('shuffle: touches keyed by card id land on the card\'s FINAL slot after a mid-decision shuffle', () => {
  const g = newGame(3);
  g.requestCard(g.activeId, g.ranks[0]);
  const holder = g.holderId;
  const touched = g.hands.get(holder)[0].id;
  const touches = [{ c: touched, u: 0.5, v: 0.5, x: 0.3, y: 0.8, t: 100 }];
  g.shuffleHand(holder);
  const finalSlot = g.hands.get(holder).findIndex((c) => c.id === touched);
  const offered = g.hands.get(holder).find((c) => c.id !== touched);
  g.advance(1000);
  g.offerCard(holder, offered.id, { touches });
  g.useLieDeye(g.activeId);
  const ld = g.getStateFor(g.activeId).lieDeye;
  assert.equal(ld.touches[0].s, finalSlot);
  assert.ok(!('c' in ld.touches[0]), 'card ids are never sent back (would leak identity)');
});

test('shuffle: refused once the game is over', () => {
  const g = newGame(4);
  const winner = playAutoWin(g, engineAct(g));
  assert.equal(g.isFinished, true);
  assert.throws(() => g.shuffleHand(winner), { code: 'GAME_OVER' });
});

// ------------------------------------------------------------------ Room: leave / end game

function makeRoom(n = 4, options = {}) {
  const sessions = new SessionStore();
  const sent = [];
  const transport = {
    toRoom: (code, event, payload) => sent.push({ to: 'room', event, payload }),
    toPlayer: (pid, event, payload) => sent.push({ to: pid, event, payload }),
  };
  const room = new Room({ code: 'ABCDE', sessions, transport, ...options });
  const players = Array.from({ length: n }, (_, i) => {
    const s = sessions.create();
    s.nickname = `P${i}`;
    s.socketId = `sock${i}`;
    s.roomCode = 'ABCDE';
    room.addPlayer(s);
    return s;
  });
  return { room, sessions, players, sent };
}

test('guest storage reclaims expired unseated sessions before denying new guests', () => {
  let now = 0;
  const sessions = new SessionStore({ maxSessions: 3, ttlMs: 50, now: () => now });
  const unseated = sessions.create();
  const seated = Object.assign(sessions.create(), { roomCode: 'ABCDE' });
  const connected = Object.assign(sessions.create(), { socketId: 'connected-guest' });
  now = 49;
  assert.equal(sessions.create(), null);
  now = 50;
  assert.ok(sessions.create());
  assert.equal(sessions.getByToken(unseated.token), null);
  assert.equal(sessions.getByPlayerId(unseated.playerId), null);
  assert.equal(sessions.getByToken(seated.token), seated);
  assert.equal(sessions.getByToken(connected.token), connected);
});

test('the room cap rejects new rooms independently of session and seat capacity', () => {
  const sessions = new SessionStore();
  const transport = { toRoom() {}, toPlayer() {}, joinChannel() {}, leaveChannel() {} };
  const rooms = new RoomManager({ sessions, transport, maxRooms: 1 });
  const host = Object.assign(sessions.create(), { socketId: 'host' });
  const guest = Object.assign(sessions.create(), { socketId: 'guest' });
  const room = rooms.createRoom(host);
  try {
    assert.throws(() => rooms.createRoom(guest), { code: 'SERVER_BUSY' });
    assert.throws(() => rooms.createRoom(host), { code: 'SERVER_BUSY' });
    assert.equal(host.roomCode, room.code);
    assert.equal(rooms.joinRoom(guest, room.code), room);
    assert.equal(rooms.stats().rooms, 1);
  } finally {
    room.destroy();
  }
});

test('address resolution trusts the managed Render header only on Render', () => {
  const req = { socket: { remoteAddress: '10.0.0.8' }, headers: {
    'cf-connecting-ip': '2001:0DB8::001', 'x-forwarded-for': '192.0.2.5',
  } };
  assert.equal(clientAddress(req, false), '10.0.0.8');
  assert.equal(clientAddress(req, true), '2001:db8::1');
  delete req.headers['cf-connecting-ip'];
  assert.equal(clientAddress(req, true), '10.0.0.8');
  req.headers['cf-connecting-ip'] = '192.0.2.5, 192.0.2.6';
  assert.equal(clientAddress(req, true), '10.0.0.8');
});

test('request timeout rank stays independent of the actor hand', () => {
  const g = newGame(4);
  const [first, second] = g.ranks;
  const asker = g.activeId;
  const hand = g.hands.get(asker);
  for (const card of hand) card.rank = first;
  g.rng = () => 0.35;
  const events = g.handleTimeout();
  assert.equal(events.find((event) => event.type === 'card_requested').rank, second);
});

test('unchanged profile updates do not publish snapshots', () => {
  const { room, players, sent } = makeRoom();
  try {
    sent.length = 0;
    const [player] = players;
    room.updateProfile(player, { nickname: player.nickname, avatarId: player.avatarId });
    room.updateProfile(player, {});
    assert.deepEqual(sent, []);
    room.updateProfile(player, { avatarId: 3 });
    assert.equal(sent.filter(({ event }) => event === 'room_state').length, players.length);
  } finally {
    room.destroy();
  }
});

for (const [speed, duration] of [['fast', 15000], ['standard', 120000]]) {
  test(`${speed} room clocks cover every move, Lie Deye, timeouts and rematches`, async () => {
    const { room, players, sent } = makeRoom();
    const hostId = players[0].playerId;
    try {
      room.setTurnSpeed(hostId, speed);
      room.startGame(hostId);
      const game = room.game;
      const clock = () => {
        assert.equal(game.phaseDuration, duration);
        assert.ok(game.deadline - Date.now() <= duration);
        assert.ok(game.deadline - Date.now() > duration - 1000);
      };
      const expire = async (phase) => {
        assert.equal(game.phase, phase);
        clock();
        game.deadline = Date.now() - 500;
        room._schedule();
        for (let i = 0; game.phase === phase && i < 50; i++) await wait(5);
        assert.notEqual(game.phase, phase);
      };
      await expire('REQUEST');
      await expire('OFFER');
      clock();
      assert.equal(game.offers[0].auto, true);
      room.act(game.activeId, 'use_lie_deye');
      assert.equal(sent.find(({ payload }) => payload?.type === 'lie_deye_used').payload.durationMs, duration);
      await expire('DECISION');
      assert.deepEqual(sent.filter(({ payload }) => payload?.type === 'timeout').map(({ payload }) => payload.phase),
        ['REQUEST', 'OFFER', 'DECISION']);

      if (!game.isFinished) playAutoWin(game, (pid, event, payload) => room.act(pid, event, payload));
      assert.throws(() => room.setTurnSpeed(hostId, 'fast'), { code: 'IN_PROGRESS' });
      room.startGame(hostId, { rematch: true });
      assert.equal(room.publicState().turnSpeed, speed);
      assert.equal(room.game.phaseDuration, duration);

      room.endGame(hostId);
      const alternateMode = speed === 'fast' ? 'standard' : 'fast';
      room.setTurnSpeed(hostId, alternateMode);
      room.startGame(hostId);
      assert.equal(room.game.phaseDuration, alternateMode === 'fast' ? 15000 : 120000);
    } finally {
      room.destroy();
    }
  });
}

test('room: nickname edits update the seat and session only while waiting', () => {
  const { room, players, sent } = makeRoom();
  const [host, guest] = players;
  room.updateProfile(guest, { nickname: 'מיקה' });
  assert.equal(guest.nickname, 'מיקה');
  assert.equal(room.nicknameOf(guest.playerId), 'מיקה');
  assert.ok(sent.some(({ event, payload }) => event === 'room_state' &&
    payload.players.some((player) => player.id === guest.playerId && player.nickname === 'מיקה')));

  room.startGame(host.playerId);
  assert.throws(() => room.updateProfile(guest, { nickname: 'Mika', avatarId: 2 }), { code: 'IN_PROGRESS' });
  assert.equal(guest.nickname, 'מיקה');
  assert.equal(guest.avatarId, 0);
  assert.equal(room.nicknameOf(guest.playerId), 'מיקה');
  room.updateProfile(guest, { avatarId: 2 });
  assert.equal(room.publicState().players.find((player) => player.id === guest.playerId).avatarId, 2);
  room.destroy();
});

test('room manager: kicking an offline guest clears their seat and disconnect timer', () => {
  const sessions = new SessionStore();
  const transport = { toRoom() {}, toPlayer() {}, joinChannel() {}, leaveChannel() {} };
  const rooms = new RoomManager({ sessions, transport });
  const host = Object.assign(sessions.create(), { socketId: 'host' });
  const guest = Object.assign(sessions.create(), { socketId: 'guest' });
  const room = rooms.createRoom(host);
  rooms.joinRoom(guest, room.code);
  guest.socketId = null;
  room.onPlayerDisconnected(guest.playerId);
  assert.ok(room.graceTimers.has(guest.playerId));

  rooms.removeGuest(room, host.playerId, guest.playerId);
  assert.equal(guest.roomCode, null);
  assert.equal(room.hasPlayer(guest.playerId), false);
  assert.equal(room.graceTimers.has(guest.playerId), false);
  assert.equal(rooms.restore(guest), null);
  assert.equal(room.hostId, host.playerId);
  room.destroy();
});

test('room: leaving in the middle of an exchange keeps the cards, phase and remaining deadline', () => {
  const { room, players, sent } = makeRoom(5);
  const hostId = players[0].playerId;
  try {
    room.startGame(hostId);
    const game = room.game;
    const { holderId, activeId } = game;
    room.act(activeId, 'request_card', { rank: game.ranks[0] });
    room.act(holderId, 'offer_card', { cardId: nonWinningOffer(game) });
    const { step, deadline } = game;
    const cards = game.getStateFor(holderId).hand;
    const offer = game.offers[0];
    sent.length = 0;
    room.removePlayer(holderId);
    assert.equal(room.status, 'playing');
    assert.equal(room.game, game);
    assert.equal(game.step, step);
    assert.equal(game.deadline, deadline);
    assert.equal(game.getStateFor(activeId).deckSize, 21);
    assert.deepEqual(game.getStateFor(holderId).hand, cards);
    assert.equal(game.offers[0], offer);
    assert.ok(room.players.find((player) => player.id === holderId).temporary);
    assert.ok(room.botBrains.has(holderId));
    assert.ok(sent.some(({ payload }) => payload?.type === 'seat_taken_over' && payload.playerId === holderId));
    assert.ok(!sent.some(({ event, to }) => event === 'game_state' && to === holderId));
    assert.throws(() => room.shuffleHand(holderId), { code: 'NOT_PLAYING' });
    room.act(activeId, 'player_decision', { accept: true });
    playAutoWin(game, (pid, event, payload) => room.act(pid, event, payload));
    room.startGame(room.hostId, { rematch: true });
    assert.equal(room.players.length, 5);
    assert.equal(room.hasPlayer(holderId), false);
    assert.equal(room.players.filter((p) => p.isBot).length, 1);
  } finally {
    room.destroy();
  }
});

test('room: host leaving mid-match hands host to someone else', () => {
  const { room, players } = makeRoom(4);
  room.startGame(players[0].playerId);
  room.removePlayer(players[0].playerId);
  assert.equal(room.hostId, players[1].playerId);
  assert.equal(room.status, 'playing');
  assert.throws(() => room.endGame(players[0].playerId), { code: 'NOT_HOST' });
  room.endGame(players[1].playerId);
  assert.equal(room.status, 'waiting');
  assert.equal(room.players.length, 3, 'returning to the lobby removes the match-only bot');
  room.destroy();
});

test('room: after the grace period a bot acts, and the last human leaving ends the match', async () => {
  const { room, players } = makeRoom(4, { disconnectGraceMs: 10, botDelay: () => 0 });
  try {
    room.startGame(players[0].playerId);
    const game = room.game;
    const actor = players.find((p) => p.playerId === game.actorId);
    const initialStep = game.step;
    actor.socketId = null;
    room.onPlayerDisconnected(actor.playerId);
    assert.equal(room.hasHumanSeat(actor.playerId), true);
    for (let i = 0; game.step === initialStep && i < 50; i++) await wait(5);
    assert.ok(game.step > initialStep);
    assert.equal(room.hasHumanSeat(actor.playerId), false);
    assert.equal(actor.roomCode, null);
    for (const p of players.filter((p) => p !== actor)) room.removePlayer(p.playerId);
    assert.equal(room.game, null);
    assert.equal(room.isEmpty, true);
    assert.equal(room.timer, null);
    assert.equal(room.botJob, null);
    assert.equal(room.hostId, null);
  } finally {
    room.destroy();
  }
});

test('room: only the host can End Game; it returns everyone to the lobby', () => {
  const { room, players, sent } = makeRoom(4);
  assert.throws(() => room.endGame(players[0].playerId), { code: 'NOT_PLAYING' });
  room.startGame(players[0].playerId);
  assert.throws(() => room.endGame(players[1].playerId), { code: 'NOT_HOST' });
  room.endGame(players[0].playerId);
  assert.equal(room.status, 'waiting');
  assert.equal(room.players.length, 4, 'nobody loses their seat');
  const abort = sent.filter((m) => m.payload?.type === 'game_aborted').pop();
  assert.equal(abort.payload.reason, 'host_ended');
  room.destroy();
});

test('room: disconnect keeps the seat during the grace period, reconnect cancels it', () => {
  const { room, players, sessions } = makeRoom(4);
  room.startGame(players[0].playerId);
  players[1].socketId = null;
  room.onPlayerDisconnected(players[1].playerId);
  assert.equal(room.status, 'playing');
  assert.equal(room.graceTimers.size, 1);
  players[1].socketId = 'sock1b';
  room.addPlayer(sessions.getByPlayerId(players[1].playerId));
  assert.equal(room.graceTimers.size, 0);
  assert.equal(room.status, 'playing');
  room.destroy();
});

test('room: waiting seats stay reserved during reconnect and cannot fill the start roster offline', () => {
  const { room, players } = makeRoom(4);
  const offline = players[1];
  offline.socketId = null;
  room.onPlayerDisconnected(offline.playerId);
  assert.equal(room.graceTimers.has(offline.playerId), true);
  assert.throws(() => room.startGame(players[0].playerId), { code: 'PLAYERS_OFFLINE' });

  offline.socketId = 'sock1b';
  room.addPlayer(offline);
  room.startGame(players[0].playerId);
  assert.equal(room.graceTimers.size, 0);
  assert.equal(room.status, 'playing');
  room.destroy();
});

test('room switch: failed admission preserves the current match, seat, and profile', () => {
  const sessions = new SessionStore();
  const noop = () => {};
  const transport = { toRoom: noop, toPlayer: noop, joinChannel: noop, leaveChannel: noop };
  const rooms = new RoomManager({ sessions, transport });
  const connectGuest = (i) => Object.assign(sessions.create(), { nickname: `P${i}`, socketId: `sock${i}` });
  const host = connectGuest(0);
  const current = rooms.createRoom(host);
  for (let i = 1; i < 4; i += 1) rooms.joinRoom(connectGuest(i), current.code);
  current.startGame(host.playerId);

  const destinationHost = connectGuest(10);
  const destination = rooms.createRoom(destinationHost);
  for (let i = 11; i < 14; i += 1) rooms.joinRoom(connectGuest(i), destination.code);
  destination.startGame(destinationHost.playerId);

  assert.throws(() => rooms.joinRoom(host, destination.code, { nickname: 'New name' }), { code: 'ROOM_UNAVAILABLE' });
  assert.equal(current.status, 'playing');
  assert.equal(host.roomCode, current.code);
  assert.equal(host.nickname, 'P0');
  assert.equal(current.hasPlayer(host.playerId), true);
  current.destroy();
  destination.destroy();
});

// ------------------------------------------------------------------ Room: Lie Deye economy

test('room economy: unused tokens carry over to the next game (spent ones stay spent)', () => {
  const { room, players } = makeRoom(4);
  assert.ok(room.publicState().players.every((p) => p.tokens === 4), 'first game: 4 each');

  room.startGame(players[0].playerId);
  const g = room.game;
  const me = g.activeId;
  room.act(me, 'request_card', { rank: g.ranks[0] });
  room.act(g.holderId, 'offer_card', { cardId: g.hands.get(g.holderId)[0].id });
  room.act(me, 'use_lie_deye');
  assert.equal(room.tokenBank.get(me), 3, 'bank updated immediately');

  room.endGame(players[0].playerId); // aborted match
  assert.equal(room.publicState().players.find((p) => p.id === me).tokens, 3);

  room.startGame(players[0].playerId);
  const w = room.game.getStateFor(me).lieDeyeWallet;
  assert.equal(w.balance, 3, 'balance carried over');
  assert.equal(w.usedThisGame, 0, 'per-match counter resets');
  room.destroy();
});

test('room economy: the winner gets +1 token for the next game, paid exactly once', () => {
  const { room, players, sent } = makeRoom(4);
  room.startGame(players[0].playerId);
  const g = room.game;
  assert.throws(() => room.act(g.activeId, 'declare_win'), { code: 'UNKNOWN_ACTION' });
  const winner = playAutoWin(g, (pid, event, p) => room.act(pid, event, p));

  assert.equal(room.status, 'finished');
  assert.equal(room.tokenBank.get(winner), 5);
  const bonus = sent.filter((m) => m.payload?.type === 'lie_deye_bonus');
  assert.equal(bonus.length, 1);
  assert.deepEqual(
    { playerId: bonus[0].payload.playerId, amount: bonus[0].payload.amount, balance: bonus[0].payload.balance },
    { playerId: winner, amount: 1, balance: 5 }
  );
  assert.equal(g.getStateFor(winner).lieDeyeWallet.balance, 5, 'results screen shows the new balance');

  room.broadcast();
  room.onConnectionChanged();
  assert.equal(room.tokenBank.get(winner), 5, 'no double payout');

  assert.throws(() => room.startGame(players[0].playerId), { code: 'REMATCH_REQUIRED' });
  room.startGame(players[0].playerId, { rematch: true });
  assert.equal(room.game.getStateFor(winner).lieDeyeWallet.balance, 5);
  assert.equal(room.game.getStateFor(winner).lieDeyeWallet.usesLeft, 3, 'still capped at 3 per game');
  room.destroy();
});

test('room economy: leaving and rejoining does not reset a spent balance', () => {
  const { room, players, sessions } = makeRoom(4);
  room.tokenBank.set(players[2].playerId, 1);
  room.removePlayer(players[2].playerId);
  room.addPlayer(sessions.getByPlayerId(players[2].playerId));
  assert.equal(room.tokenBalance(players[2].playerId), 1);
  room.destroy();
});

test('room: Shuffle Hand ignores the phase deadline and only updates the shuffler', () => {
  const { room, players, sent } = makeRoom(4);
  room.startGame(players[0].playerId);
  const me = players[1].playerId;
  room.game.deadline = Date.now() - 10_000; // the turn clock already ran out
  assert.throws(() => room.act(room.game.activeId, 'request_card', { rank: room.game.ranks[0] }), { code: 'TOO_LATE' });

  sent.length = 0;
  room.shuffleHand(me);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, me);
  assert.equal(sent[0].event, 'game_state');
  room.destroy();
  assert.throws(() => room.shuffleHand(me), { code: 'NOT_PLAYING' });
});

// ------------------------------------------------------------------ device-testing fixes

test('room: a match needs at least 4 players and a waiting lobby cannot play a rematch', () => {
  const sessions = new SessionStore();
  const transport = { toRoom: () => {}, toPlayer: () => {} };
  const room = new Room({ code: 'MINPL', sessions, transport });
  const add = (i) => {
    const s = sessions.create();
    s.nickname = `P${i}`;
    s.socketId = `s${i}`;
    s.roomCode = 'MINPL';
    room.addPlayer(s);
    return s;
  };
  const host = add(0);
  add(1);
  add(2);
  assert.equal(room.publicState().minPlayers, 4);
  assert.throws(() => room.startGame(host.playerId), { code: 'NOT_ENOUGH_PLAYERS' });
  assert.throws(() => room.startGame(host.playerId, { rematch: true }), { code: 'NOT_FINISHED' });
  assert.equal(room.status, 'waiting');
  add(3);
  room.startGame(host.playerId);
  assert.equal(room.status, 'playing');
  room.destroy();
});

test('timeout: the auto-offer is a RANDOM card from the hand (not the requested rank / Joker)', () => {
  // rng sequence lets us steer which index the fallback picks.
  const picks = new Set();
  for (const r of [0, 0.21, 0.41, 0.61, 0.81, 0.99]) {
    const g = newGame(4);
    g.requestCard(g.activeId, g.ranks[0]);
    const hand = g.hands.get(g.holderId).slice();
    g.rng = () => r;
    const events = g.handleTimeout();
    const offered = g.offers[0].card;
    assert.equal(offered.id, hand[Math.floor(r * hand.length)].id, 'exactly the rng-chosen slot');
    assert.equal(events[0].type, 'timeout');
    assert.equal(g.offers[0].auto, true);
    picks.add(hand.findIndex((c) => c.id === offered.id));
  }
  assert.equal(picks.size, 5, 'every slot of a 5-card hand can be picked');
});

test('shuffle: a client-proposed order is applied verbatim when it is a valid permutation', () => {
  const g = newGame(4);
  const me = g.seats.find((id) => id !== g.holderId);
  const ids0 = g.hands.get(me).map((c) => c.id);
  const proposed = [...ids0].reverse();
  g.shuffleHand(me, proposed);
  assert.deepEqual(g.hands.get(me).map((c) => c.id), proposed);

  // Invalid proposals (foreign id / duplicates / wrong length) -> server-side random shuffle, same cards.
  for (const bad of [[...proposed.slice(1), 'c_fake'], [proposed[0], ...proposed.slice(0, -1)], proposed.slice(1), 'nope']) {
    const before = g.hands.get(me).map((c) => c.id);
    g.shuffleHand(me, bad);
    const after = g.hands.get(me).map((c) => c.id);
    assert.deepEqual([...after].sort(), [...before].sort());
  }
});

test('config: dev testing mode stretches every phase timer to 10 minutes; Lie Deye starts at 4, capped at 3', () => {
  const config = require('../src/config');
  if (config.DEV_TESTING_MODE) {
    for (const k of ['REQUEST', 'OFFER', 'DECISION', 'LIE_DEYE']) assert.equal(config.TIMERS[k], 600000, k);
  }
  assert.equal(config.LIE_DEYE.STARTING_TOKENS, 4);
  assert.equal(config.LIE_DEYE.MAX_USES_PER_GAME, 3);
  assert.ok(config.MIN_PLAYERS >= 4);
});
