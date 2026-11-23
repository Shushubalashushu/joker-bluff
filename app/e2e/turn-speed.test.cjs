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
const { headers: [{ headers: securityHeaders }] } = require('../vercel.json');

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
      room.act(actorId, 'offer_card', { cardId: card.id, claimedNoCard: offers.length > 0 });
    } else room.act(actorId, 'player_decision', { accept: !botAsker });
  }
  assert.fail('expected a bot to face a second offer');
}

test('desktop and mobile players can read bilingual rules, use both clocks and keep playing', { timeout: 90000 }, async (t) => {
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
  await button(host, 'התחלת משחק!').click();
  for (const page of [host, guest]) {
    const seconds = await shownSeconds(page);
    assert.ok(seconds >= 10 && seconds <= 15, `fast countdown: ${seconds}s`);
  }
  assert.equal(room.game.phaseDuration, 15000);

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
  host.once('dialog', (dialog) => dialog.accept());
  await button(host, 'יציאה מהמשחק').click();
  await button(host, 'משחק פרטי').waitFor();
  await button(guest, 'סיום המשחק לכולם').waitFor();
  const replacement = await until(() => room.players.find((player) => player.id === previousHost && player.isBot));
  await guest.getByText(replacement.botName.he, { exact: true }).first().waitFor();
  assert.equal(room.game, gameBeforeLeave);
  assert.equal(room.players.length, 4);

  await button(host, 'משחק פרטי').click();
  await host.getByRole('textbox', { name: 'הזנת קוד חדר' }).fill(room.code);
  await button(host, 'הצטרפות').click();
  await host.getByText(/לא ניתן להצטרף ללובי הזה/).waitFor();

  room.disconnectGraceMs = 30;
  await guest.close();
  await until(() => room.game === null && room.isEmpty);
  assert.deepEqual(errors, []);
});
