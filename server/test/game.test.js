'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDeck, findWinningRank } = require('../src/game/deck');
const { JokerBluffGame, GameError } = require('../src/game/JokerBluffGame');

/** Deterministic RNG so tests are reproducible. */
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ids = (n) => Array.from({ length: n }, (_, i) => `p${i}`);
const newGame = (n, seed = 1, extra = {}) => {
  let clock = 1_000_000;
  const g = new JokerBluffGame(ids(n), { rng: seeded(seed), now: () => clock, ...extra });
  g.advance = (ms) => (clock += ms);
  g.start();
  return g;
};

test('deck: (N * 4) + 1 cards, N ranks, exactly one Joker', () => {
  for (let n = 2; n <= 8; n++) {
    const { ranks, cards } = buildDeck(n);
    assert.equal(ranks.length, n);
    assert.equal(cards.length, n * 4 + 1);
    assert.equal(cards.filter((c) => c.rank === 'JOKER').length, 1);
    for (const r of ranks) assert.equal(cards.filter((c) => c.rank === r).length, 4);
    assert.equal(new Set(cards.map((c) => c.id)).size, cards.length, 'ids unique');
  }
  assert.throws(() => buildDeck(1), RangeError);
  assert.throws(() => buildDeck(9), RangeError);
});

test('deck: card ids do not leak rank/suit', () => {
  const { cards } = buildDeck(5);
  for (const c of cards) assert.match(c.id, /^c_[0-9a-f]{12}$/);
});

test('deal: one player gets 5, everyone else 4; active sits after holder', () => {
  for (let n = 2; n <= 8; n++) {
    const g = newGame(n, n * 7);
    const counts = g.seats.map((id) => g.hands.get(id).length);
    assert.equal(counts.filter((c) => c === 5).length, 1);
    assert.equal(counts.filter((c) => c === 4).length, n - 1);
    assert.equal(g.hands.get(g.holderId).length, 5);
    assert.equal(g.activeId, g.seats[(g.seats.indexOf(g.holderId) + 1) % n]);
    assert.equal(g.phase, 'REQUEST');
  }
});

test('turn flow: accept 1st offer transfers card and rotates roles', () => {
  const g = newGame(4);
  const holder = g.holderId;
  const active = g.activeId;
  g.requestCard(active, g.ranks[0]);
  assert.equal(g.phase, 'OFFER');
  const card = g.hands.get(holder)[0];
  g.offerCard(holder, card.id);
  assert.equal(g.phase, 'DECISION');
  const events = g.decide(active, true);

  assert.equal(events[0].type, 'card_transferred');
  assert.ok(g.hands.get(active).some((c) => c.id === card.id));
  assert.equal(g.hands.get(active).length, 5);
  assert.equal(g.hands.get(holder).length, 4);
  assert.equal(g.holderId, active, 'receiver becomes the new 5-card holder');
  assert.equal(g.activeId, g.seats[(g.seats.indexOf(active) + 1) % 4]);
  assert.equal(g.turn, 2);
  assert.equal(g.phase, 'REQUEST');
});

test('3-offer rule: two rejections leave 3 cards, 3rd chosen card is auto-accepted', () => {
  const g = newGame(5, 42);
  const holder = g.holderId;
  const active = g.activeId;
  const original = g.hands.get(holder).map((c) => c.id);

  g.requestCard(active, g.ranks[1]);
  g.offerCard(holder, original[0]);
  g.decide(active, false);
  assert.equal(g.phase, 'OFFER');
  assert.equal(g.hands.get(holder).length, 4);

  g.offerCard(holder, original[1]);
  const rej = g.decide(active, false);
  assert.equal(rej[0].nextIsForced, true);
  assert.equal(g.hands.get(holder).length, 3, 'holder now has exactly 3 cards to choose from');

  // Holder deliberately picks the LAST of the 3 remaining cards.
  const chosen = g.hands.get(holder)[2].id;
  const events = g.offerCard(holder, chosen);
  assert.deepEqual(events.map((e) => e.type), ['card_offered', 'card_transferred']);
  assert.equal(events[0].forced, true);
  assert.equal(events[1].forced, true);

  assert.ok(g.hands.get(active).some((c) => c.id === chosen), 'forced card went to active player');
  const holderNow = g.hands.get(holder).map((c) => c.id);
  assert.equal(holderNow.length, 4);
  assert.ok(holderNow.includes(original[0]) && holderNow.includes(original[1]), 'rejected cards returned');
  assert.equal(g.phase, 'REQUEST');
  assert.equal(g.holderId, active);
});

test('decision is impossible on the 3rd offer (no DECISION phase)', () => {
  const g = newGame(3, 3);
  const h = g.holderId;
  const a = g.activeId;
  g.requestCard(a, g.ranks[0]);
  g.offerCard(h, g.hands.get(h)[0].id);
  g.decide(a, false);
  g.offerCard(h, g.hands.get(h)[0].id);
  g.decide(a, false);
  g.offerCard(h, g.hands.get(h)[0].id);
  assert.throws(() => g.decide(a, false), (e) => e instanceof GameError && e.code === 'WRONG_PHASE');
});

test('guards: wrong player / wrong phase / bad input', () => {
  const g = newGame(4, 9);
  const h = g.holderId;
  const a = g.activeId;
  const other = g.seats.find((id) => id !== h && id !== a);
  assert.throws(() => g.requestCard(other, g.ranks[0]), { code: 'NOT_YOUR_TURN' });
  assert.throws(() => g.requestCard(a, 'JOKER'), { code: 'BAD_RANK' });
  assert.throws(() => g.offerCard(h, 'x'), { code: 'WRONG_PHASE' });
  g.requestCard(a, g.ranks[0]);
  assert.throws(() => g.offerCard(a, g.hands.get(a)[0].id), { code: 'NOT_YOUR_TURN' });
  assert.throws(() => g.offerCard(h, g.hands.get(a)[0].id), { code: 'BAD_CARD' });
  g.offerCard(h, g.hands.get(h)[0].id);
  assert.throws(() => g.decide(a, 'yes'), { code: 'BAD_DECISION' });
});

test('redaction: players only see their own hand; table cards are face-down for non-owners', () => {
  const g = newGame(4, 5);
  const h = g.holderId;
  const a = g.activeId;
  const other = g.seats.find((id) => id !== h && id !== a);
  g.requestCard(a, g.ranks[0]);
  g.offerCard(h, g.hands.get(h)[0].id);

  const vh = g.getStateFor(h);
  const va = g.getStateFor(a);
  const vo = g.getStateFor(other);
  assert.ok(vh.offers[0].card, 'holder sees own offered card');
  assert.equal(va.offers[0].card, null, 'receiver sees it face-down');
  assert.equal(vo.offers[0].card, null);
  assert.equal(va.hand.length, 4);
  assert.equal(vo.isolated, true, 'bystanders are isolated');
  assert.equal(va.isolated, false);
  assert.equal(vh.isolated, false);
  const json = JSON.stringify(vo);
  for (const id of [h, a]) for (const c of g.hands.get(id)) assert.ok(!json.includes(c.id), 'no foreign card ids leaked');
});

/** Gives the HOLDER all four cards of ranks[0] (plus one other card). */
function rigHolderQuads(g) {
  const pid = g.holderId;
  const R = g.ranks[0];
  const mine = g.hands.get(pid);
  for (const [other, hand] of g.hands) {
    if (other === pid) continue;
    for (let i = 0; i < hand.length; i++) {
      if (hand[i].rank !== R) continue;
      const j = mine.findIndex((c) => c.rank !== R);
      [hand[i], mine[j]] = [mine[j], hand[i]];
    }
  }
  return { pid, R };
}

test('auto-win: passing the 5th card away with 4-of-a-kind left wins instantly; Joker owner loses', () => {
  const g = newGame(4, 11);
  const { pid: h, R } = rigHolderQuads(g);
  const a = g.activeId;
  const extra = g.hands.get(h).find((c) => c.rank !== R);
  const jokerOwnerBefore = g.seats.find((id) => g.hands.get(id).some((c) => c.rank === 'JOKER'));

  g.requestCard(a, g.ranks[1]);
  assert.equal(g.isFinished, false, 'holding 4-of-a-kind with 5 cards is NOT a win');
  g.offerCard(h, extra.id);
  assert.equal(g.isFinished, false, 'not until the card is actually passed');
  const events = g.decide(a, true);

  assert.deepEqual(events.map((e) => e.type), ['card_transferred', 'game_over']);
  assert.equal(g.phase, 'FINISHED');
  assert.equal(g.deadline, null);
  assert.equal(g.result.winnerId, h);
  assert.equal(g.result.winningRank, R);
  assert.equal(g.result.auto, true);
  const jokerOwnerNow = extra.rank === 'JOKER' ? a : jokerOwnerBefore;
  assert.equal(g.result.loserId, jokerOwnerNow);
  assert.equal(g.getStateFor(a).result.hands[h].length, 4, 'hands revealed at the end');
  assert.ok(!('canDeclare' in g.getStateFor(h)), 'manual declare is gone');
  assert.equal(typeof g.declareWin, 'undefined');
});

test('auto-win: rejected cards come back first - a returned quad card still completes the win', () => {
  const g = newGame(4, 12);
  const { pid: h, R } = rigHolderQuads(g);
  const a = g.activeId;
  const quadCard = g.hands.get(h).find((c) => c.rank === R);
  const extra = g.hands.get(h).find((c) => c.rank !== R);
  g.requestCard(a, R);
  g.offerCard(h, quadCard.id);
  g.decide(a, false); // quad card rejected -> stays the holder's
  g.offerCard(h, extra.id);
  g.decide(a, true);
  assert.equal(g.isFinished, true);
  assert.equal(g.result.winnerId, h);
});

test('second decision: taking the first card returns the pending second card before checking for a win', () => {
  const g = newGame(4, 33);
  const { pid: holder, R: rank } = rigHolderQuads(g);
  const asker = g.activeId;
  const hand = g.hands.get(holder);
  const first = hand.find((c) => c.rank !== rank);
  const second = hand.find((c) => c.rank === rank);
  g.requestCard(asker, rank);
  g.offerCard(holder, first.id);
  assert.throws(() => g.decide(asker, true, 1), { code: 'BAD_DECISION' });
  g.decide(asker, false);
  g.offerCard(holder, second.id);

  for (const index of [-1, 2, 0.5, '0', null]) {
    assert.throws(() => g.decide(asker, true, index), { code: 'BAD_DECISION' });
  }
  assert.throws(() => g.decide(asker, false, 0), { code: 'BAD_DECISION' });
  assert.equal(g.phase, 'DECISION');
  assert.deepEqual(g.getStateFor(asker).offers.map(({ card }) => card), [null, null]);

  const [transfer, win] = g.decide(asker, true, 0);
  assert.equal(transfer.offerNumber, 1);
  assert.equal(g.lastTransfer.cardId, first.id);
  assert.ok(g.hands.get(asker).includes(first));
  assert.ok(hand.includes(second));
  assert.equal(win.winnerId, holder);
  assert.deepEqual(hand.map((card) => card.rank), [rank, rank, rank, rank]);
});

test('second decision: taking the second card returns the first without awarding a four-card win', () => {
  const g = newGame(4, 34);
  const { pid: holder, R: rank } = rigHolderQuads(g);
  const asker = g.activeId;
  const hand = g.hands.get(holder);
  const first = hand.find((c) => c.rank !== rank);
  const second = hand.find((c) => c.rank === rank);
  g.requestCard(asker, rank);
  g.offerCard(holder, first.id);
  g.decide(asker, false);
  g.offerCard(holder, second.id);

  const [transfer] = g.decide(asker, true, 1);
  assert.equal(transfer.offerNumber, 2);
  assert.ok(g.hands.get(asker).includes(second));
  assert.ok(hand.includes(first));
  assert.equal(hand.length, 4);
  assert.equal(g.result, null);
});

test('auto-win: a forced third transfer of the Joker wins only after both rejected cards return', () => {
  const g = newGame(4, 31);
  const { pid: holder, R: rank } = rigHolderQuads(g);
  const asker = g.activeId;
  const hand = g.hands.get(holder);
  const jokerHand = [...g.hands.values()].find((cards) => cards.some((c) => c.rank === 'JOKER'));
  if (jokerHand !== hand) {
    const jokerIndex = jokerHand.findIndex((c) => c.rank === 'JOKER');
    const extraIndex = hand.findIndex((c) => c.rank !== rank);
    [hand[extraIndex], jokerHand[jokerIndex]] = [jokerHand[jokerIndex], hand[extraIndex]];
  }

  g.requestCard(asker, rank);
  for (let i = 0; i < 2; i++) {
    g.offerCard(holder, hand.find((card) => card.rank === rank).id);
    g.decide(asker, false);
    assert.equal(g.result, null);
  }
  const events = g.offerCard(holder, hand.find((card) => card.rank === 'JOKER').id);
  assert.deepEqual(events.map((event) => event.type), ['card_offered', 'card_transferred', 'game_over']);
  assert.deepEqual(g.result, { winnerId: holder, loserId: asker, winningRank: rank, auto: true });
  assert.deepEqual(hand.map((card) => card.rank), [rank, rank, rank, rank]);
});

test('auto-win: passing a quad card (keeping the odd card) is not a win; the receiver never wins', () => {
  const g = newGame(4, 13);
  const { pid: h, R } = rigHolderQuads(g);
  const a = g.activeId;
  const quadCard = g.hands.get(h).find((c) => c.rank === R);
  g.requestCard(a, R);
  g.offerCard(h, quadCard.id);
  g.decide(a, true);
  assert.equal(g.isFinished, false);
  assert.equal(g.phase, 'REQUEST');
  assert.equal(g.holderId, a, 'receiver (5 cards) is just the new holder');
});

test('four of a kind + Joker is never a winning hand', () => {
  const four = [1, 2, 3, 4].map((i) => ({ id: `k${i}`, rank: 'K', suit: 's' }));
  assert.equal(findWinningRank([...four, { id: 'j', rank: 'JOKER' }]), null);
  assert.equal(findWinningRank(four), 'K');
});

test('verified forced bluff: allowed only when the holder truly owns no card of the requested rank', () => {
  const g = newGame(4, 14);
  const { pid: h, R } = rigHolderQuads(g);
  const a = g.activeId;
  const other = g.seats.find((id) => id !== h && id !== a);

  // Holder owns every R -> claim refused.
  g.requestCard(a, R);
  assert.equal(g.getStateFor(h).canClaimNoCard, false);
  assert.throws(() => g.offerCard(h, g.hands.get(h)[0].id, { noCard: true }), { code: 'HAS_RANK' });
  assert.equal(g.offers.length, 0, 'refused claim does not place a card');
  assert.equal(g.hands.get(h).length, 5);

  // Force a new transaction where the holder lacks the requested rank.
  const g2 = newGame(4, 15);
  const r2 = rigHolderQuads(g2);
  const h2 = g2.holderId;
  const a2 = g2.activeId;
  const missing = g2.ranks.find((rk) => !g2.hands.get(h2).some((c) => c.rank === rk));
  g2.requestCard(a2, missing);
  assert.equal(g2.getStateFor(h2).canClaimNoCard, true, 'server confirms the holder lacks it');
  assert.equal(g2.getStateFor(a2).canClaimNoCard, false, 'only the holder gets the button');
  const card = g2.hands.get(h2).find((c) => c.rank === r2.R);
  const ev = g2.offerCard(h2, card.id, { noCard: true });
  assert.equal(ev[0].verifiedNoCard, true);
  assert.equal(ev[0].rank, missing);
  const seen = g2.getStateFor(a2).offers[0];
  assert.equal(seen.verifiedNoCard, true, 'receiver sees the verified stamp');
  assert.equal(seen.card, null, 'the card itself stays face-down');
  assert.equal(g2.getStateFor(g2.seats.find((id) => id !== h2 && id !== a2)).offers[0].verifiedNoCard, true);
  // The flag is never inferred: a normal offer is unstamped.
  g2.decide(a2, false);
  g2.offerCard(h2, g2.hands.get(h2)[0].id);
  assert.equal(g2.getStateFor(a2).offers[1].verifiedNoCard, false);
  void other;
});

test('verified forced bluff: a requested-rank card the holder already put on the table still counts as owned', () => {
  const g = newGame(4, 16);
  const h = g.holderId;
  const a = g.activeId;
  const hand = g.hands.get(h);
  const R = hand.find((c) => c.rank !== 'JOKER').rank;
  const mine = hand.filter((c) => c.rank === R);
  // Leave the holder exactly ONE card of rank R by swapping extras away.
  const victim = g.seats.find((id) => id !== h);
  for (const extraR of mine.slice(1)) {
    const vh = g.hands.get(victim);
    const j = vh.findIndex((c) => c.rank !== R);
    const i = hand.indexOf(extraR);
    [hand[i], vh[j]] = [vh[j], hand[i]];
  }
  const only = hand.find((c) => c.rank === R);
  g.requestCard(a, R);
  g.offerCard(h, only.id); // honest offer of the real card
  g.decide(a, false); // rejected - but it's still the holder's
  assert.equal(g.getStateFor(h).canClaimNoCard, false);
  const priorState = g.getStateFor(h);
  assert.throws(() => g.offerCard(h, g.hands.get(h)[0].id, { noCard: true }), { code: 'HAS_RANK' });
  assert.deepEqual(g.getStateFor(h), priorState, 'a refused claim preserves the current offer step and hand');
});

test('verified forced bluff: the accepted third offer keeps its proof and only the receiver gets its identity', () => {
  const g = newGame(4, 32);
  const { pid: holder, R: quadRank } = rigHolderQuads(g);
  const asker = g.activeId;
  const observer = g.seats.find((id) => id !== holder && id !== asker);
  const hand = g.hands.get(holder);
  const missingRank = g.ranks.find((rank) => !hand.some((card) => card.rank === rank));
  g.requestCard(asker, missingRank);
  for (let i = 0; i < 2; i++) {
    g.offerCard(holder, hand.find((card) => card.rank === quadRank).id);
    g.decide(asker, false);
  }

  const card = hand.find((c) => c.rank === quadRank);
  const [, transfer] = g.offerCard(holder, card.id, { noCard: true });
  assert.equal(transfer.forced, true);
  assert.equal(transfer.verifiedNoCard, true);
  assert.equal(transfer.verifiedRank, missingRank);
  assert.equal(Object.hasOwn(transfer, 'cardId'), false);
  assert.equal(g.getStateFor(asker).lastTransfer.cardId, card.id);
  assert.equal(g.getStateFor(observer).lastTransfer.cardId, null);
  assert.equal(g.getStateFor(observer).lastTransfer.verifiedRank, missingRank);
  assert.equal(g.getStateFor(holder).canClaimNoCard, false);
  assert.equal(g.result, null);
});

test('timeouts: server auto-plays and the 3rd offer is still forced', () => {
  const g = newGame(4, 21);
  const startTurn = g.turn;
  const a = g.activeId;
  g.handleTimeout(); // REQUEST -> auto rank
  assert.equal(g.phase, 'OFFER');
  g.handleTimeout(); // OFFER -> auto card
  assert.equal(g.phase, 'DECISION');
  g.handleTimeout(); // DECISION -> auto accept
  assert.equal(g.turn, startTurn + 1);
  assert.equal(g.holderId, a);
});

test('deadline is shortened when the acting player is disconnected', () => {
  const offline = new Set();
  const g = newGame(3, 2, { isConnected: (id) => !offline.has(id), timers: { REQUEST: 15000, AFK: 3000 } });
  const before = g.deadline;
  offline.add(g.activeId);
  assert.equal(g.onConnectionChanged(), true);
  assert.ok(g.deadline < before);
  assert.equal(g.deadline - g.now(), 3000);
});

test('full random games: card conservation, and every finished game has a valid auto-win', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const n = 2 + (seed % 7);
    const g = newGame(n, seed);
    let guard = 0;
    while (!g.isFinished && guard++ < 5000) {
      g.handleTimeout();
      const total = [...g.hands.values()].reduce((s, h) => s + h.length, 0) + g.offers.length;
      assert.equal(total, n * 4 + 1, 'card conservation');
    }
    if (g.isFinished) {
      assert.ok(g.result.winnerId);
      assert.equal(g.result.auto, true);
      assert.notEqual(g.result.winnerId, g.result.loserId);
      const hand = g.hands.get(g.result.winnerId);
      assert.equal(hand.length, 4, 'winner holds exactly 4 cards');
      assert.ok(hand.every((c) => c.rank === g.result.winningRank), 'all the same rank');
    }
  }
});
