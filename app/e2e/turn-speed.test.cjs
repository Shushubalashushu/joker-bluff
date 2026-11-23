'use strict';

const { execFile } = require('node:child_process');
const { once } = require('node:events');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { dirname, join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: wait } = require('node:timers/promises');
const { promisify } = require('node:util');
const { chromium } = require('playwright');
const express = require('../../server/node_modules/express');
const { createGameServer } = require('../../server/src/index');
const { BotPlayer } = require('../../server/src/game/BotPlayer');
const { findWinningRank } = require('../../server/src/game/deck');
const { headers: [{ source: securityHeaderSource, headers: securityHeaders }] } = require('../vercel.json');
const securityHeaderPath = new RegExp(`^${securityHeaderSource}$`);

async function until(read, timeout = 6000) {
  const deadline = Date.now() + timeout;
  do {
    const value = read();
    if (value) return value;
    await wait(20);
  } while (Date.now() < deadline);
  assert.fail('expected game state did not arrive');
}

function button(page, name) {
  return page.getByRole('button', { name, exact: true });
}

const RULES_HEADINGS = {
  en: ['How to Play', 'The Goal', 'Set Up', 'Turn Flow', 'Lie Deye', 'What It Takes to Own the Table'],
  he: ['איך משחקים?', 'המטרה:', 'איך מתחילים?', 'מהלך התור:', 'Lie Deye:', 'מה צריך כדי לשלוט בשולחן?'],
};

async function checkRules(page, lang, { escape = false, live = false, whileOpen } = {}) {
  const [title, ...sections] = RULES_HEADINGS[lang];
  const trigger = button(page, title);
  if (escape) {
    await trigger.focus();
    await page.keyboard.press('Enter');
  } else await trigger.click();
  const dialog = page.getByRole('dialog', { name: title });
  await dialog.waitFor();
  assert.deepEqual(await dialog.getByRole('heading').allTextContents(), [title, ...sections]);
  const heading = dialog.getByRole('heading', { name: sections[0], exact: true });
  assert.equal(await heading.evaluate((element) => getComputedStyle(element).textAlign), lang === 'he' ? 'right' : 'left');
  const ranks = dialog.locator('.notranslate[translate="no"]').filter({ hasText: /^J, Q, K, A$/ });
  assert.equal(await ranks.count(), 1);
  await dialog.getByText(lang === 'he' ? /אפשר אפילו להגיד ״קחו את הג׳וקר״/ : /You can even say “take the Joker\.”/).waitFor();
  if (live) await dialog.getByText(lang === 'he' ? 'שעון המשחק ממשיך לרוץ.' : 'The match clock keeps running.').waitFor();
  const finalHeading = dialog.getByRole('heading', { name: sections.at(-1), exact: true });
  await finalHeading.scrollIntoViewIfNeeded();
  const close = dialog.getByRole('button', { name: lang === 'he' ? 'סגירה' : 'Close', exact: true });
  const box = await close.boundingBox();
  assert.ok(box && box.y >= 0 && box.y + box.height <= page.viewportSize().height);
  const lastBox = await finalHeading.boundingBox();
  assert.ok(lastBox && lastBox.y >= 0 && lastBox.y + lastBox.height <= page.viewportSize().height);
  await whileOpen?.();
  if (escape) await page.keyboard.press('Escape');
  else await close.click();
  await dialog.waitFor({ state: 'detached' });
  if (escape) await trigger.and(page.locator(':focus')).waitFor();
}

async function checkHomeRules(page, url, nickname) {
  const response = await page.goto(url);
  assert.match(response.headers()['content-security-policy'], /frame-ancestors 'none'/);
  await checkRules(page, 'en', { escape: page.viewportSize().width > 600 });
  await button(page, 'Switch language (English / Hebrew)').click();
  await checkRules(page, 'he');
  await button(page, 'החלפת שפה (אנגלית / עברית)').click();
  await page.getByRole('textbox', { name: 'Nickname' }).fill(nickname);
  await button(page, 'Private Game').click();
}

function countdown(page) {
  return page.getByRole('progressbar', { name: /seconds left|נותרו/ });
}

async function tryRejoiningInHebrew(page, code) {
  await button(page, 'משחק פרטי').click();
  await page.getByRole('textbox', { name: 'הזנת קוד חדר' }).fill(code);
  await button(page, 'הצטרפות').click();
}

async function shownSeconds(page) {
  const timer = countdown(page);
  await timer.waitFor();
  return Number((await timer.getAttribute('aria-label')).match(/\d+/)[0]);
}

// Set up a claimed second offer for a bot without waiting on opening moves.
function prepareSecondOffer(room) {
  for (let i = 0; i < 12; i++) {
    const { actorId, activeId, phase } = room.game;
    const botAsker = room.botBrains.has(activeId);
    const { hand, ranks, offers } = room.game.getStateFor(actorId);
    if (phase === 'DECISION' && botAsker && offers.length === 2) return;
    if (phase === 'REQUEST') room.act(actorId, 'request_card', { rank: ranks[0] });
    else if (phase === 'OFFER') {
      const owned = [...hand, ...offers.map((offer) => offer.card)];
      const card = hand.find((candidate) => !findWinningRank(owned.filter((other) => other !== candidate)));
      room.act(actorId, 'offer_card', { cardId: card.id, substituteRank: offers.length === 1 ? 'JOKER' : undefined });
    } else room.act(actorId, 'player_decision', { accept: !botAsker });
  }
  assert.fail('expected a bot to face a second offer');
}

function safeOffer(game) {
  const hand = game.hands.get(game.holderId);
  const owned = [...hand, ...game.offers.map(({ card }) => card)];
  const receiverHand = game.hands.get(game.activeId);
  return hand.find((card) => !findWinningRank(owned.filter((other) => other !== card)) &&
    !findWinningRank([...receiverHand, card].filter((candidate) => candidate.rank !== 'JOKER')));
}

function advanceToHolder(room, holder) {
  for (let i = 0; i < room.players.length && room.game.holderId !== holder; i++) {
    const { activeId, holderId, ranks } = room.game;
    room.act(activeId, 'request_card', { rank: ranks[0] });
    room.act(holderId, 'offer_card', { cardId: safeOffer(room.game).id });
    room.act(activeId, 'player_decision', { accept: true });
  }
  assert.equal(room.game.holderId, holder);
}

async function selectOfferCard(page, room, lang) {
  const { holderId, hands } = room.game;
  const card = safeOffer(room.game);
  const order = hands.get(holderId).map(({ id }) => id);
  const from = order.indexOf(card.id);
  const center = Math.floor((order.length - 1) / 2);
  [order[from], order[center]] = [order[center], order[from]];
  room.shuffleHand(holderId, order);

  const heSuits = { hearts: 'לב', diamonds: 'יהלום', clubs: 'תלתן', spades: 'עלה' };
  const name = card.rank === 'JOKER' ? (lang === 'he' ? "ג'וקר" : 'Joker')
    : lang === 'he' ? `\u2068${card.rank}\u2069 \u2068${heSuits[card.suit]}\u2069` : `${card.rank} of ${card.suit}`;
  const target = button(page, name);
  if (lang === 'he') await target.tap();
  else await target.click();
  await target.and(page.locator('[aria-pressed="true"]')).waitFor();
  return card;
}

test('desktop and mobile players can moderate lobbies, declare substitutes, and keep playing in both languages', { timeout: 120000 }, async (t) => {
  const output = await mkdtemp(join(tmpdir(), 'jokerbluff-turn-speed-'));
  const server = createGameServer();
  let browser;
  t.after(async () => {
    try {
      await browser?.close();
      await server.close();
    } finally {
      await rm(output, { recursive: true, force: true });
    }
  });

  server.app.use(express.static(output, {
    setHeaders(response) {
      if (!securityHeaderPath.test(response.req.path)) return;
      for (const { key, value } of securityHeaders) response.setHeader(key, value);
    },
  }));
  server.httpServer.listen(0, '127.0.0.1');
  await once(server.httpServer, 'listening');
  const url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const expo = join(dirname(require.resolve('expo/package.json')), 'bin', 'cli');
  await promisify(execFile)(process.execPath, [expo, 'export', '--clear', '--platform', 'web', '--max-workers', '4', '--output-dir', output], {
    cwd: dirname(__dirname),
    env: { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_SERVER_URL: url },
    timeout: 65000,
  });

  browser = await chromium.launch();
  const host = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const guest = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  for (const page of [host, guest]) {
    page.setDefaultTimeout(6000);
    page.on('pageerror', (error) => errors.push(error.message));
  }

  await checkHomeRules(host, url, 'Host Tester');
  await button(host, 'Create Private Lobby').click();
  const desktopFast = host.getByRole('radio', { name: 'Fast · 15 seconds' });
  const desktopStandard = host.getByRole('radio', { name: 'Standard · 2 minutes' });
  await desktopStandard.waitFor();
  assert.equal(await desktopStandard.getAttribute('aria-checked'), 'true');
  await button(host, 'Private Game').waitFor({ state: 'detached' });
  await checkRules(host, 'en');
  const room = [...server.rooms.rooms.values()][0];

  await checkHomeRules(guest, url, 'Guest Tester');
  await guest.getByRole('textbox', { name: 'Enter room code' }).fill(room.code);
  await button(guest, 'Join').click();
  await guest.getByText('Standard · 2 minutes', { exact: true }).waitFor();
  await button(guest, 'Private Game').waitFor({ state: 'detached' });
  await button(guest, 'Switch language (English / Hebrew)').click();
  await guest.getByText(/רגיל.*2 דקות/).waitFor();
  assert.equal(await guest.getByRole('radio').count(), 0);
  await checkRules(guest, 'he');

  for (let strike = 1; strike <= 2; strike++) {
    await button(host, 'Manage Guest Tester').click();
    await host.getByRole('heading', { name: 'Manage Guest Tester' }).waitFor();
    await button(host, 'Kick').click();
    await tryRejoiningInHebrew(guest, room.code);
    if (strike === 1) {
      await guest.getByText(/רגיל.*2 דקות/).waitFor();
      assert.equal(await host.getByRole('heading', { name: 'Banned players' }).count(), 0);
    }
  }
  const joinDenied = guest.getByText(/לא ניתן להצטרף ללובי הזה/);
  await joinDenied.waitFor();
  await host.getByRole('heading', { name: 'Banned players' }).waitFor();
  await button(host, 'Unban Guest Tester').click();
  await host.getByRole('heading', { name: 'Banned players' }).waitFor({ state: 'detached' });
  await button(guest, 'הצטרפות').click();
  await guest.getByText(/רגיל.*2 דקות/).waitFor();

  await desktopFast.click();
  await guest.getByText(/מהיר.*15 שניות/).waitFor();
  await desktopFast.and(host.locator('[aria-checked="true"]')).waitFor();
  await button(host, 'Switch language (English / Hebrew)').click();
  await host.setViewportSize({ width: 375, height: 667 });
  const mobileFast = host.getByRole('radio', { name: /מהיר.*15 שניות/ });
  const mobileStandard = host.getByRole('radio', { name: /רגיל.*2 דקות/ });
  await mobileFast.and(host.locator('[aria-checked="true"]')).waitFor();
  const box = await mobileStandard.boundingBox();
  assert.ok(box && box.x >= 0 && box.x + box.width <= 375);
  await mobileStandard.click();
  await guest.getByText(/רגיל.*2 דקות/).waitFor();

  await button(host, 'ניהול השחקן \u2068Guest Tester\u2069').click();
  const hebrewBan = button(host, 'חסימה');
  await hebrewBan.waitFor();
  const banBox = await hebrewBan.boundingBox();
  assert.ok(banBox && banBox.x >= 0 && banBox.x + banBox.width <= 375);
  await hebrewBan.click();
  await tryRejoiningInHebrew(guest, room.code);
  await joinDenied.waitFor();
  await host.getByRole('heading', { name: 'שחקנים חסומים' }).waitFor();
  await button(host, 'החלפת שפה (אנגלית / עברית)').click();
  await host.getByRole('heading', { name: 'Banned players' }).waitFor();
  await host.setViewportSize({ width: 1280, height: 800 });
  await button(host, 'Switch language (English / Hebrew)').click();
  await host.getByRole('heading', { name: 'שחקנים חסומים' }).waitFor();
  await host.setViewportSize({ width: 375, height: 667 });
  await button(host, 'ביטול חסימה של \u2068Guest Tester\u2069').click();
  await host.getByRole('heading', { name: 'שחקנים חסומים' }).waitFor({ state: 'detached' });
  await button(guest, 'הצטרפות').click();
  await guest.getByText(/רגיל.*2 דקות/).waitFor();

  for (let i = 0; i < 2; i++) {
    await button(host, 'הוספת בוט').click();
    await until(() => room.players.length === 3 + i);
  }
  room.botDelay = () => 20000;
  await button(host, 'התחלת משחק!').click();
  for (const page of [host, guest]) {
    const seconds = await shownSeconds(page);
    assert.ok(seconds >= 115 && seconds <= 120, `standard countdown: ${seconds}s`);
    await countdown(page).getByText(/^(2:00|1:5[5-9])$/).waitFor();
  }
  assert.equal(room.game.phaseDuration, 120000);
  const standardGame = room.game;
  const matchId = room.lifecycleId;
  const sockets = room.players.filter(({ isBot }) => !isBot).map(({ id }) => server.sessions.socketIdOf(id));
  await host.setViewportSize({ width: 1280, height: 800 });
  await button(host, 'התחלת משחק!').waitFor({ state: 'detached' });
  await button(host, 'החלפת שפה (אנגלית / עברית)').click();
  const secondsBeforeHelp = await shownSeconds(host);
  await checkRules(host, 'en', { escape: true, live: true, whileOpen: () => wait(1200) });
  assert.ok(await shownSeconds(host) < secondsBeforeHelp);
  await checkRules(guest, 'he', { live: true });
  assert.equal(room.game, standardGame);
  assert.equal(room.lifecycleId, matchId);
  assert.deepEqual(room.players.filter(({ isBot }) => !isBot).map(({ id }) => server.sessions.socketIdOf(id)), sockets);
  const handOrder = () => standardGame.getStateFor(room.hostId).hand.map(({ id }) => id).join(',');
  const beforeShuffle = handOrder();
  await button(host, 'Shuffle my hand').click();
  await until(() => handOrder() !== beforeShuffle);
  await button(host, 'Switch language (English / Hebrew)').click();

  host.once('dialog', (dialog) => dialog.accept());
  await button(host, 'סיום המשחק לכולם').click();
  delete room.botDelay;
  for (const page of [host, guest]) await countdown(page).waitFor({ state: 'detached' });
  await mobileFast.click();
  await guest.getByText(/מהיר.*15 שניות/).waitFor();
  const events = [];
  const publish = room.transport.toRoom;
  t.mock.method(room.transport, 'toRoom', (code, event, payload) => {
    if (event === 'game_event') events.push(payload);
    publish(code, event, payload);
  });
  const thinkDelay = BotPlayer.prototype.thinkDelay;
  t.mock.method(BotPlayer.prototype, 'thinkDelay', function (state, budget) {
    // Sample a reproducible tail from the actual Fast-mode distribution.
    const rolls = state.phase === 'DECISION' && state.offers.length === 2 ? [0.01, 0.93] : [0.99, 0.50];
    return thinkDelay.call(this, state, budget, () => rolls.shift());
  });
  // Keep a human-to-human exchange adjacent, with bots available for the following turns.
  room.setupRandom = () => 0.999999;
  room.botDelay = () => 14000;
  await button(host, 'התחלת משחק!').click();
  for (const page of [host, guest]) {
    const seconds = await shownSeconds(page);
    assert.ok(seconds >= 10 && seconds <= 15, `fast countdown: ${seconds}s`);
  }
  assert.equal(room.game.phaseDuration, 15000);

  await button(host, 'התחלת משחק!').waitFor({ state: 'detached' });
  await host.setViewportSize({ width: 1280, height: 800 });
  await button(host, 'החלפת שפה (אנגלית / עברית)').click();
  advanceToHolder(room, room.hostId);
  const { activeId: guestId, ranks: [requested, alternative] } = room.game;
  await button(guest, `לבקש \u2068${requested}\u2069`).tap();
  const englishToggle = host.getByRole('switch', { name: "I don't have it" });
  await englishToggle.click();
  assert.equal(await button(host, `Declare ${requested} instead`).count(), 0);
  const firstCard = await selectOfferCard(host, room, 'en');
  assert.equal(await button(host, 'Offer face-down').isEnabled(), false);
  await button(host, 'Declare Joker instead').click();
  await button(host, 'Offer face-down').click();
  await until(() => room.game.offers[0]?.card.id === firstCard.id);
  await guest.getByText(/הצעה.*אין לי.*קחו.*ג'וקר\u2069 במקום/).waitFor();
  const englishDeclaration = host.getByText(/Offer 1 · I don’t have .* Take Joker instead/);
  await englishDeclaration.waitFor();
  assert.equal(await englishDeclaration.locator('[translate="no"]').textContent(), requested);
  await button(guest, 'דוחה').tap();
  await englishToggle.and(host.locator('[aria-checked="false"]')).waitFor();
  await selectOfferCard(host, room, 'en');
  await button(host, 'Offer face-down').click();
  await guest.getByText(/הצעה.*הנה/).waitFor();
  assert.deepEqual(room.game.offers.map(({ declaration }) => declaration.substituteRank), ['JOKER', null]);
  await button(guest, 'לדחות שני').tap();
  await button(host, 'Select a card').waitFor();
  assert.equal(await englishToggle.count(), 0);
  await selectOfferCard(host, room, 'en');
  await button(host, 'Force this card!').click();
  await until(() => room.game.holderId === guestId);
  assert.equal(room.game.lastTransfer.declaration, null);

  room.act(room.game.activeId, 'request_card', { rank: requested });
  await guest.getByRole('switch', { name: 'אין לי את הקלף' }).tap();
  const mobileRank = button(guest, `להכריז על \u2068${alternative}\u2069 במקום`);
  await mobileRank.waitFor();
  const rankBox = await mobileRank.boundingBox();
  assert.ok(rankBox && rankBox.x >= 0 && rankBox.x + rankBox.width <= 390);
  assert.equal(await mobileRank.locator('[translate="no"]').textContent(), alternative);
  await mobileRank.tap();
  await selectOfferCard(guest, room, 'he');
  await button(guest, 'הצע הפוך').tap();
  await host.getByText(new RegExp(`Offer 1 · I don’t have ${requested}\\. Take ${alternative} instead`)).waitFor();
  room.act(room.game.activeId, 'player_decision', { accept: true });

  const botGiver = room.game.seats.at(-1);
  advanceToHolder(room, botGiver);
  room.botBrains.set(botGiver, new BotPlayer('bluffer', () => 0));
  room.botDelay = () => 50;
  await button(host, `Ask for ${requested}`).click();
  await host.getByText(/Offer 1 · I don’t have .* Take Joker instead/).waitFor();
  assert.ok(events.some((event) => event.playerId === botGiver && event.declaration?.substituteRank === 'JOKER'));
  await button(host, 'Take it').click();
  await until(() => room.game.phase === 'REQUEST');
  delete room.botDelay;

  prepareSecondOffer(room);
  const { actorId, phaseStartedAt, deadline } = room.game;
  const offerEvents = events.length;
  await countdown(guest).getByText(/^[345]$/).waitFor({ timeout: 12500 });
  const botMove = await until(() => events.slice(offerEvents).find(({ type, playerId, toId }) =>
    (type === 'card_transferred' && toId === actorId) ||
    (playerId === actorId && (type === 'lie_deye_used' || type === 'offer_rejected'))));
  assert.ok(botMove.at - phaseStartedAt >= 10000, 'tense reply went past the old fast-mode cap');
  assert.ok(botMove.at < deadline - 1000, 'bot replied with time left on the Fast clock');
  assert.ok(events.every(({ type }) => type !== 'timeout'));

  const gameBeforeLeave = room.game;
  const previousHost = room.hostId;
  await button(host, 'Switch language (English / Hebrew)').click();
  host.once('dialog', (dialog) => dialog.accept());
  await button(host, 'יציאה מהמשחק').click();
  await button(host, 'משחק פרטי').waitFor();
  await button(guest, 'סיום המשחק לכולם').waitFor();
  const replacement = await until(() => room.players.find((player) => player.id === previousHost && player.isBot));
  await guest.getByText(replacement.botName.he, { exact: true }).first().waitFor();
  assert.equal(room.game, gameBeforeLeave);
  assert.equal(room.players.length, 4);

  await tryRejoiningInHebrew(host, room.code);
  await host.getByText(/לא ניתן להצטרף ללובי הזה/).waitFor();

  room.disconnectGraceMs = 30;
  await guest.close();
  await until(() => room.game === null && room.isEmpty);
  assert.deepEqual(errors, []);
});
