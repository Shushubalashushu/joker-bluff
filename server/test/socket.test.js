'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createGameServer } = require('../src/index');
const { findWinningRank } = require('../src/game/deck');
const config = require('../src/config');

const MOVE_EVENTS = new Set(['request_card', 'offer_card', 'player_decision', 'use_lie_deye']);
const HOST_EVENTS = new Set(['start_game', 'play_again', 'end_game', 'kick_player', 'add_bot', 'remove_bot', 'set_turn_speed']);

/** Small client wrapper that tracks the latest pushed state. */
function client(url, auth = {}) {
  const socket = connect(url, { transports: ['websocket'], auth, forceNew: true, reconnection: false });
  const c = { socket, session: null, room: undefined, game: undefined, events: [], kicks: 0 };
  socket.on('session', (s) => (c.session = s));
  socket.on('room_state', (r) => (c.room = r));
  socket.on('game_state', (g) => (c.game = g));
  socket.on('game_event', (e) => c.events.push(e));
  socket.on('room_kicked', () => c.kicks++);
  c.emit = (event, payload = {}) => {
    let scope;
    if (MOVE_EVENTS.has(event)) scope = { matchId: c.game?.matchId, step: c.game?.step };
    else if (event === 'shuffle_hand') scope = { matchId: c.game?.matchId };
    else if (HOST_EVENTS.has(event)) scope = { lifecycleId: c.room?.lifecycleId };
    else if (event === 'leave_room') scope = { code: c.room?.code };
    return socket.timeout(2000).emitWithAck(event, { ...scope, ...payload });
  };
  c.ready = new Promise((resolve, reject) => {
    socket.once('connect_error', reject);
    socket.once('session', (session) => {
      socket.off('connect_error', reject);
      resolve(session);
    });
  });
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

async function withSocketServer(run) {
  const server = createGameServer();
  const clients = [];
  try {
    await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.httpServer.address().port}`;
    const connectGuest = async (auth) => {
      const guest = client(url, auth);
      clients.push(guest);
      await guest.ready;
      return guest;
    };
    await run({ server, connectGuest });
  } finally {
    clients.forEach(({ socket }) => socket.close());
    await server.close();
  }
}

function withWaitingLobby(names, run) {
  return withSocketServer(async ({ server, connectGuest }) => {
    const seated = await Promise.all(names.map((nickname) => connectGuest({ nickname })));
    const [host, ...guests] = seated;
    const created = await host.emit('create_room');
    assert.equal(created.ok, true);
    for (const guest of guests) assert.equal((await guest.emit('join_room', { code: created.code })).ok, true);
    await until(() => seated.every((guest) => guest.room?.players.length === names.length));
    await run({ server, seated, code: created.code, connectGuest });
  });
}

test('turn speed is broadcast, validated and scoped to the host of a waiting lobby', () =>
  withWaitingLobby(['Host', 'Guest', 'Mika', 'Roni'], async ({ seated }) => {
    const [host, guest] = seated;
    const waitingId = host.room.lifecycleId;
    assert.ok(seated.every((player) => player.room.turnSpeed === 'standard'));
    assert.equal((await guest.emit('set_turn_speed', { speed: 'fast' })).code, 'NOT_HOST');
    for (const speed of [undefined, 15000, { value: 'fast' }, 'unsupported']) {
      assert.equal((await host.emit('set_turn_speed', { speed })).code, 'BAD_TURN_SPEED');
    }
    assert.equal((await host.emit('set_turn_speed', { speed: 'fast', lifecycleId: null })).code, 'STALE_ACTION');
    assert.equal((await host.emit('set_turn_speed', { speed: 'fast' })).ok, true);
    await until(() => seated.every((player) => player.room.turnSpeed === 'fast'));
    assert.equal((await host.emit('start_game')).ok, true);
    await until(() => seated.every((player) => player.game?.phaseDuration === 15000));
    assert.equal((await host.emit('set_turn_speed', { speed: 'standard', lifecycleId: waitingId })).code, 'STALE_ACTION');
    assert.equal((await host.emit('set_turn_speed', { speed: 'standard' })).code, 'IN_PROGRESS');
    assert.ok(seated.every((player) => player.room.turnSpeed === 'fast'));
  }));

test('the lobby host can manage bot seats and start solo play over Socket.IO', { timeout: 8000 }, () =>
  withWaitingLobby(['Host', 'Guest'], async ({ server, seated: [host, guest], code }) => {
    server.rooms.get(code).botDelay = () => 10;
    assert.equal((await guest.emit('add_bot')).code, 'NOT_HOST');
    assert.equal((await host.emit('start_game')).code, 'NOT_ENOUGH_PLAYERS');
    const added = await host.emit('add_bot');
    assert.equal(added.ok, true);
    await until(() => guest.room.players.some((player) => player.id === added.botId));
    const publicBot = guest.room.players.find((player) => player.id === added.botId);
    assert.equal(publicBot.isBot, true);
    assert.equal(publicBot.nickname, publicBot.botName.en);
    assert.match(publicBot.botName.he, /[\u0590-\u05ff]/);
    assert.equal(Object.hasOwn(publicBot, 'botPersonality'), false);
    assert.equal((await guest.emit('remove_bot', { botId: added.botId })).code, 'NOT_HOST');
    assert.equal((await host.emit('remove_bot', { botId: added.botId })).ok, true);
    await until(() => guest.room.players.length === 2);
    assert.equal((await guest.emit('leave_room')).ok, true);
    await until(() => host.room.players.length === 1);

    for (let i = 0; i < 3; i++) assert.equal((await host.emit('add_bot')).ok, true);
    await until(() => host.room.players.length === 4);
    const bots = host.room.players.filter((player) => player.isBot);
    assert.equal(bots.length, 3);
    assert.equal(new Set(bots.map((player) => player.nickname)).size, 3);
    assert.ok(bots.every((player) => player.connected && player.tokens === 4 && !player.isHost));
    assert.equal(server.sessions.size, 2);
    const waitingId = host.room.lifecycleId;
    assert.equal((await host.emit('start_game')).ok, true);
    await until(() => host.game?.matchId && host.room.status === 'playing');
    assert.equal((await host.emit('add_bot', { lifecycleId: waitingId })).code, 'STALE_ACTION');
    assert.equal((await host.emit('remove_bot', { botId: bots[0].id })).code, 'IN_PROGRESS');
    const botIds = new Set(bots.map((bot) => bot.id));
    if (host.game.actorId === host.session.playerId && host.game.phase === 'REQUEST') {
      assert.equal((await host.emit('request_card', { rank: host.game.ranks[0] })).ok, true);
    }
    await until(() => host.events.some((event) => botIds.has(event.playerId) &&
      (event.type === 'card_requested' || event.type === 'card_offered')), 3500);
    assert.equal(host.events.some((event) => event.type === 'timeout'), false);
    assert.equal((await host.emit('end_game')).ok, true);
    await until(() => host.game === null);
    assert.equal(server.rooms.get(code).botJob, null);
    assert.equal((await host.emit('leave_room')).ok, true);
    assert.equal(server.rooms.get(code), null);
  }));

test('40 students on one IP can reconnect, retry room codes and play across five lobbies', { timeout: 15000 }, () =>
  withSocketServer(async ({ server, connectGuest }) => {
    const tableSize = 8;
    const tableCount = 5;
    let students = await Promise.all(Array.from({ length: tableCount * tableSize }, (_, i) =>
      connectGuest({ nickname: `Student ${i + 1}` })));

    // A Wi-Fi interruption can make an entire classroom reconnect together repeatedly.
    // The initial connections plus three waves exceed the old 120-per-address budget.
    for (let wave = 0; wave < 3; wave++) {
      students.forEach(({ socket }) => socket.close());
      students = await Promise.all(students.map(({ session }) => connectGuest({ token: session.token })));
    }
    const addresses = new Set([...server.io.sockets.sockets.values()].map((socket) => socket.handshake.address));
    assert.equal(addresses.size, 1);
    assert.equal(server.sessions.size, 40);

    const guests = students.filter((_, i) => i % tableSize !== 0);
    await Promise.all(guests.map(async (guest) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        assert.equal((await guest.emit('join_room', { code: 'invalid' })).code, 'BAD_CODE');
      }
    }));

    const tables = Array.from({ length: tableCount }, (_, i) => students.slice(i * tableSize, (i + 1) * tableSize));
    await Promise.all(tables.map(async ([host, ...tableGuests]) => {
      const created = await host.emit('create_room');
      assert.equal(created.ok, true);
      const joins = await Promise.all(tableGuests.map((guest) => guest.emit('join_room', { code: created.code })));
      assert.ok(joins.every((join) => join.ok));
      assert.equal((await host.emit('start_game')).ok, true);
    }));
    await until(() => students.every((student) => student.game?.hand));

    const events = students.flatMap((student) => [
      student.emit('shuffle_hand'),
      ...Array.from({ length: 5 }, () => student.emit('time_sync')),
    ]);
    assert.ok((await Promise.all(events)).every((event) => event.ok));
  }));

test('host kick is scoped to the waiting room and clears only the removed guest', { timeout: 10000 }, () =>
  withWaitingLobby(['Host', 'Bob', 'Cat', 'Dan', 'Eli'], async ({ server, seated, code, connectGuest }) => {
    const [host, bob, cat] = seated;
    const target = { playerId: bob.session.playerId };
    assert.equal((await cat.emit('kick_player', target)).code, 'NOT_HOST');
    assert.equal((await host.emit('kick_player', { playerId: host.session.playerId })).code, 'CANNOT_KICK_SELF');
    assert.equal((await host.emit('kick_player', { playerId: null })).code, 'BAD_PAYLOAD');
    assert.equal((await host.emit('kick_player', { ...target, lifecycleId: 'old-lobby' })).code, 'STALE_ACTION');
    assert.equal(host.room.players.length, 5);

    assert.equal((await host.emit('kick_player', target)).ok, true);
    await until(() => bob.kicks === 1 && bob.room === null && bob.game === null &&
      seated.filter((guest) => guest !== bob).every((guest) => guest.room?.players.length === 4));
    assert.equal(cat.kicks, 0);
    assert.equal(bob.socket.connected, true);
    assert.equal(server.sessions.getByPlayerId(target.playerId).roomCode, null);
    assert.equal(server.io.sockets.adapter.rooms.get(`room:${code}`).has(bob.socket.id), false);
    assert.equal((await host.emit('kick_player', target)).code, 'PLAYER_NOT_FOUND');

    bob.socket.close();
    const back = await connectGuest({ token: bob.session.token });
    await until(() => back.room === null && back.game === null);
    assert.equal(back.session.playerId, target.playerId);

    assert.equal((await host.emit('start_game')).ok, true);
    await until(() => host.room.status === 'playing' && host.game);
    assert.equal((await host.emit('kick_player', { playerId: cat.session.playerId })).code, 'IN_PROGRESS');
    assert.equal(host.room.players.length, 4);
  }));

test('a live nickname edit updates every waiting client and survives a stale reconnect profile', { timeout: 10000 }, () =>
  withWaitingLobby(['Host', 'Bob', 'Cat', 'Dan'], async ({ seated, code, connectGuest }) => {
    const [host, bob, cat, dan] = seated;
    const id = bob.session.playerId;
    const nickname = 'שחקנית 🃏';
    const lifecycleId = bob.room.lifecycleId;
    assert.deepEqual(await bob.emit('update_profile', { nickname: `  ${nickname}  `, lifecycleId }), {
      ok: true, nickname, avatarId: bob.session.avatarId,
    });
    await until(() => seated.every((guest) => guest.room?.players.find((player) => player.id === id)?.nickname === nickname));
    assert.equal((await bob.emit('update_profile', { nickname: ' ', lifecycleId })).code, 'NICKNAME_REQUIRED');
    assert.equal((await bob.emit('update_profile', { nickname: 'New', lifecycleId: 'stale' })).code, 'STALE_ACTION');

    bob.socket.close();
    await until(() => host.room.players.find((player) => player.id === id)?.connected === false);
    const back = await connectGuest({ token: bob.session.token, nickname: 'Bob' });
    assert.equal(back.session.nickname, nickname);
    await until(() => [host, cat, dan, back].every((guest) =>
      guest.room?.players.some((player) => player.id === id && player.nickname === nickname && player.connected)));

    assert.equal((await host.emit('start_game')).ok, true);
    await until(() => back.room.status === 'playing');
    assert.equal((await back.emit('update_profile', { nickname: 'New', lifecycleId: back.room.lifecycleId })).code, 'IN_PROGRESS');
    assert.equal((await back.emit('update_profile', { nickname: 'New' })).code, 'IN_PROGRESS');
    assert.equal((await back.emit('join_room', { code, nickname: 'New' })).code, 'IN_PROGRESS');
    assert.equal(host.room.players.find((player) => player.id === id).nickname, nickname);
    assert.equal((await host.emit('end_game')).ok, true);
    await until(() => back.room.status === 'waiting');
    assert.equal((await back.emit('update_profile', { nickname: 'New', lifecycleId })).code, 'STALE_ACTION');
    assert.equal((await back.emit('update_profile', { nickname: 'New', lifecycleId: back.room.lifecycleId })).ok, true);
    await until(() => host.room.players.find((player) => player.id === id)?.nickname === 'New');
  }));

test('nickname moderation covers authentication, create, join and profile updates', { timeout: 10000 }, () =>
  withWaitingLobby(['Host'], async ({ server, seated, code, connectGuest }) => {
    const [host] = seated;
    const guest = await connectGuest({ nickname: 'Ass!' });
    assert.match(guest.session.nickname, /^Guest-\d{4}$/);
    assert.equal((await guest.emit('join_room', { code, nickname: 'ש ר מ ו ט ה' })).code, 'NICKNAME_PROFANITY');
    assert.equal((await host.emit('create_room', { nickname: 'f.u.u.u.c.k' })).code, 'NICKNAME_PROFANITY');
    assert.equal(server.sessions.getByPlayerId(host.session.playerId).roomCode, code);
    assert.equal((await guest.emit('join_room', { code, nickname: 'סקסופון' })).ok, true);
    await until(() => guest.room?.lifecycleId && host.room?.players.length === 2);

    const { lifecycleId } = guest.room;
    const publicName = () => host.room.players.find((player) => player.id === guest.session.playerId)?.nickname;
    assert.equal((await guest.emit('update_profile', { lifecycleId, nickname: 'ABCDEFGHIJKL Assorted' })).code, 'NICKNAME_PROFANITY');
    assert.equal((await guest.emit('update_profile', { lifecycleId, nickname: 'Ass!' })).code, 'NICKNAME_PROFANITY');
    assert.equal(publicName(), 'סקסופון');
    for (const nickname of ['התחתנתי', 'grape', 'as', 'this hits', 'שמן', 'כוס', 'zain', 'לסבית']) {
      assert.equal((await guest.emit('update_profile', { lifecycleId, nickname })).ok, true, nickname);
      await until(() => publicName() === nickname);
    }
  }));

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
  assert.equal(active.game.phaseDuration, config.TURN_SPEEDS[host.room.turnSpeed]);
  assert.equal(active.game.lieDeye.touches.length, 2);
  assert.equal(active.game.lieDeye.pressDurationMs, Math.min(350, active.game.lieDeye.decisionMs));
  assert.equal(active.game.lieDeye.offeredSlot, 0);
  assert.equal(active.game.lieDeye.lieCount, 0, 'the current false claim is excluded over the wire');
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
  assert.equal((await active.emit('use_lie_deye')).ok, true);
  await until(() => active.game.lieDeye?.offerNumber === 2);
  assert.equal(active.game.lieDeye.lieCount, 1, 'the rejected false claim now appears in the history');
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
