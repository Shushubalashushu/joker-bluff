'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createGameServer } = require('../src/index');
const { findWinningRank } = require('../src/game/deck');
const config = require('../src/config');

const MOVE_EVENTS = new Set(['request_card', 'offer_card', 'player_decision', 'use_lie_deye']);
const HOST_EVENTS = new Set(['start_game', 'play_again', 'end_game']);

/** Small client wrapper that tracks the latest pushed state. */
function client(url, auth = {}) {
  const socket = connect(url, { transports: ['websocket'], auth, forceNew: true, reconnection: false });
  const c = { socket, session: null, room: undefined, game: undefined, events: [] };
  socket.on('session', (s) => (c.session = s));
  socket.on('room_state', (r) => (c.room = r));
  socket.on('game_state', (g) => (c.game = g));
  socket.on('game_event', (e) => c.events.push(e));
  c.emit = (event, payload = {}) => {
    let scope;
    if (MOVE_EVENTS.has(event)) scope = { matchId: c.game?.matchId, step: c.game?.step };
    else if (event === 'shuffle_hand') scope = { matchId: c.game?.matchId };
    else if (HOST_EVENTS.has(event)) scope = { lifecycleId: c.room?.lifecycleId };
    else if (event === 'leave_room') scope = { code: c.room?.code };
    return socket.timeout(2000).emitWithAck(event, { ...scope, ...payload });
  };
  c.ready = new Promise((resolve) => socket.on('session', resolve));
  return c;
}

const until = async (fn, ms = 2000) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('condition not met in time');
};

test('socket flow: lobby -> game -> 3-offer rule -> redaction -> reconnect', { timeout: 15000 }, async () => {
  const server = createGameServer();
  await new Promise((r) => server.httpServer.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const clients = [];
  try {
    const invalid = connect(url, {
      transports: ['websocket'],
      auth: { avatarId: '3' },
      forceNew: true,
      autoConnect: false,
      reconnection: false,
    });
    try {
      const rejected = new Promise((resolve) => invalid.once('connect_error', resolve));
      invalid.connect();
      assert.equal((await rejected).data?.code, 'BAD_PAYLOAD');
      assert.equal(server.sessions.size, 0);
    } finally {
      invalid.close();
    }
    await scenario(url, clients);
  } finally {
    clients.forEach((c) => c.socket.close());
    await server.close();
  }
});

async function scenario(url, clients) {

  const host = client(url, { nickname: 'Host', avatarId: 3 });
  const bob = client(url, { nickname: 'Bob' });
  const cat = client(url, { nickname: 'Cat' });
  const dan = client(url, { nickname: 'Dan' });
  clients.push(host, bob, cat, dan);
  await Promise.all(clients.map((c) => c.ready));

  // --- lobby
  const created = await host.emit('create_room', { nickname: 'Host 🃏', avatarId: 3 });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z2-9]{5}$/);

  const bad = await bob.emit('join_room', { code: created.code === 'ZZZZZ' ? 'YYYYY' : 'ZZZZZ' });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, 'ROOM_NOT_FOUND');

  assert.equal((await bob.emit('join_room', { code: created.code.toLowerCase() })).ok, true);
  assert.equal((await cat.emit('join_room', { code: created.code })).ok, true);
  await until(() => host.room?.players.length === 3);
  assert.equal(host.room.hostId, host.session.playerId);
  assert.equal(host.room.minPlayers, 4);
  assert.ok(host.room.players.every((p) => p.tokens === 4), 'first game: 4 Lie Deye tokens each');
  assert.equal((await host.emit('play_again')).code, 'NOT_FINISHED');
  assert.equal((await bob.emit('update_profile', { avatarId: '3' })).code, 'BAD_PAYLOAD');

  // 3 players is not enough
  assert.equal((await host.emit('start_game')).code, 'NOT_ENOUGH_PLAYERS');
  assert.equal((await dan.emit('join_room', { code: created.code })).ok, true);
  await until(() => clients.every((c) => c.room?.players.length === 4));

  const notHost = await bob.emit('start_game');
  assert.equal(notHost.code, 'NOT_HOST');
  assert.equal((await host.emit('start_game')).ok, true);
  await until(() => clients.every((c) => c.game?.phase === 'REQUEST'));

  // --- dealing: 4 players -> 17 cards; one player has 5
  const byId = Object.fromEntries(clients.map((c) => [c.session.playerId, c]));
  assert.equal(host.game.deckSize, 17);
  const counts = clients.map((c) => c.game.hand.length).sort();
  assert.deepEqual(counts, [4, 4, 4, 5]);

  const holder = byId[host.game.holderId];
  const active = byId[host.game.activeId];
  const bystander = clients.find((c) => c !== holder && c !== active);
  assert.equal(bystander.game.isolated, true);
  assert.equal(active.game.isolated, false);

  // --- request -> offer -> reject -> offer -> reject -> forced 3rd
  const heldRank = holder.game.hand.find((card) => card.rank !== 'JOKER').rank;
  assert.equal((await active.emit('request_card', { rank: heldRank })).ok, true);
  await until(() => holder.game.phase === 'OFFER');

  const owned = holder.game.hand;
  const original = owned.map((c) => c.id);
  assert.equal((await holder.emit('offer_card', { cardId: original[0], claimedNoCard: 'true' })).code, 'BAD_PAYLOAD');
  const touches = [
    { s: 0, u: 0.5, v: 0.5, x: 0.2, y: 0.85, t: 300 },
    { s: 3, u: 0.6, v: 0.4, x: 0.6, y: 0.84, t: 900 },
  ];
  assert.equal((await holder.emit('offer_card', { cardId: original[0], touches, claimedNoCard: true, pressDurationMs: 350 })).ok, true);
  await until(() => active.game.phase === 'DECISION');
  const firstDecision = active.game.step;
  assert.equal(active.game.offers[0].claimedNoCard, true, 'a giver who holds the rank may attach the claim');
  assert.ok(active.events.some((e) => e.type === 'card_offered' && e.claimedNoCard));
  assert.equal(active.game.offers[0].card, null, 'offered card is face-down for the receiver');
  assert.ok(holder.game.offers[0].card, 'holder sees their own offer');

  // --- Lie Deye over the wire
  assert.equal(active.game.lieDeye, null);
  assert.equal(active.game.canUseLieDeye, true);
  const ld = await active.emit('use_lie_deye');
  assert.equal(ld.ok, true);
  await until(() => active.game.lieDeye);
  assert.equal(active.game.timeFrozen, true);
  assert.equal(active.game.phaseDuration, config.TIMERS.LIE_DEYE);
  assert.equal(active.game.lieDeye.touches.length, 2);
  assert.equal(active.game.lieDeye.pressDurationMs, Math.min(350, active.game.lieDeye.decisionMs));
  assert.equal(active.game.lieDeye.offeredSlot, 0);
  assert.equal(active.game.lieDeyeWallet.balance, 3);
  assert.equal(bystander.game.lieDeye, null, 'bystander never sees telemetry');
  assert.equal(holder.game.lieDeye, null, 'giver never sees telemetry');
  await until(() => bystander.events.some((e) => e.type === 'lie_deye_used'));
  assert.equal((await active.emit('use_lie_deye')).code, 'ALREADY_READ');
  await until(() => host.room.players.find((p) => p.id === active.session.playerId).tokens === 3);

  // --- Shuffle Hand: private, any time (here: during someone else's decision)
  const bysBefore = bystander.game.hand.map((c) => c.id);
  assert.equal((await bystander.emit('shuffle_hand')).ok, true);
  await until(() => bystander.game.hand.map((c) => c.id).join() !== bysBefore.join());
  assert.deepEqual(bystander.game.hand.map((c) => c.id).sort(), [...bysBefore].sort());

  // Optimistic shuffle: the client proposes the order it already shows; the server stores exactly that.
  const proposed = [...bystander.game.hand.map((c) => c.id)].reverse();
  const sh = await bystander.emit('shuffle_hand', { order: proposed });
  assert.deepEqual(sh.order, proposed);
  await until(() => bystander.game.hand.map((c) => c.id).join() === proposed.join());

  await active.emit('player_decision', { accept: false });
  await until(() => holder.game.phase === 'OFFER');
  await holder.emit('offer_card', { cardId: original[1] });
  await until(() => active.game.phase === 'DECISION');
  assert.equal((await active.emit('player_decision', { step: firstDecision, accept: true })).code, 'STALE_ACTION');
  assert.equal(active.game.offers.length, 2);
  await active.emit('player_decision', { accept: false });
  await until(() => holder.game.phase === 'OFFER' && holder.game.hand.length === 3);

  const forcedCard = holder.game.hand.find((card) => !findWinningRank(owned.filter((other) => other.id !== card.id))).id;
  assert.equal((await holder.emit('offer_card', { cardId: forcedCard, claimedNoCard: true })).ok, true);
  await until(() => active.game.hand.length === 5);
  assert.ok(active.game.hand.some((c) => c.id === forcedCard), '3rd card auto-accepted');
  assert.equal(holder.game.hand.length, 4);
  assert.equal(active.game.holderId, active.session.playerId, 'receiver is the new holder');
  assert.ok(bystander.events.some((e) => e.type === 'card_transferred' && e.forced === true));

  // Bystander must never have seen any of the transferred card ids.
  assert.equal(bystander.game.lastTransfer.cardId, null);
  assert.equal(active.game.lastTransfer.claimedNoCard, true);
  assert.equal(active.game.lastTransfer.claimedRank, heldRank);

  // Both face-down slots are valid during the second decision.
  for (const offerIndex of [0, 1]) {
    const turn = active.game.turn;
    await until(() => clients.every((c) => c.game?.turn === turn));
    const giver = byId[active.game.holderId];
    const asker = byId[active.game.activeId];
    const observer = clients.find((c) => c !== giver && c !== asker);
    const hand = giver.game.hand;
    const offers = hand.filter((card) => !findWinningRank(hand.filter((other) => other.id !== card.id))).slice(0, 2);
    assert.equal((await asker.emit('request_card', { rank: asker.game.ranks[0] })).ok, true);
    await until(() => giver.game.phase === 'OFFER');
    assert.equal((await giver.emit('offer_card', { cardId: offers[0].id })).ok, true);
    await until(() => asker.game.phase === 'DECISION');
    assert.equal((await asker.emit('player_decision', { accept: false })).ok, true);
    await until(() => giver.game.phase === 'OFFER');
    assert.equal((await giver.emit('offer_card', { cardId: offers[1].id })).ok, true);
    await until(() => asker.game.phase === 'DECISION');
    assert.deepEqual(asker.game.offers.map(({ card }) => card), [null, null]);
    assert.equal((await asker.emit('player_decision', { accept: true, offerIndex })).ok, true);
    await until(() => clients.every((c) => c.game?.turn === turn + 1));
    assert.equal(asker.game.lastTransfer.offerNumber, offerIndex + 1);
    assert.equal(asker.game.lastTransfer.cardId, offers[offerIndex].id);
    assert.ok(giver.game.hand.some((card) => card.id === offers[1 - offerIndex].id));
    assert.equal(observer.game.lastTransfer.cardId, null);
  }

  // --- reconnect with the secret token keeps the seat and the hand
  const handBefore = bystander.game.hand.map((c) => c.id).sort();
  const token = bystander.session.token;
  const observer = holder; // roles are random - the bystander may be the host, so watch from someone who stays online
  bystander.socket.close();
  await until(() => observer.room.players.some((p) => !p.connected));
  const back = client(url, { token });
  clients.push(back);
  await back.ready;
  await until(() => back.game?.hand);
  assert.equal(back.session.playerId, bystander.session.playerId);
  assert.deepEqual(back.game.hand.map((c) => c.id).sort(), handBefore);
  await until(() => observer.room.players.every((p) => p.connected));

  // --- leaving mid-match terminates it for everyone and returns them to the lobby
  const leaver = active;
  const stayer = holder;
  assert.equal((await leaver.emit('leave_room')).ok, true);
  await until(() => stayer.room?.status === 'waiting' && stayer.game === null);
  assert.equal(stayer.room.players.length, 3);
  const abort = stayer.events.find((e) => e.type === 'game_aborted');
  assert.equal(abort.reason, 'player_left');
  assert.equal(abort.playerId, leaver.session.playerId);
  await until(() => leaver.room === null);
}
