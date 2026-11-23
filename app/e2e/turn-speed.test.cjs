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

async function openPrivateGame(page, url, nickname) {
  await page.goto(url);
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

test('desktop and mobile players see both lobby speeds, countdowns and a real fast-mode bot move', { timeout: 90000 }, async (t) => {
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

  server.app.use(express.static(output));
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

  await openPrivateGame(host, url, 'Host Tester');
  await button(host, 'Create Private Lobby').click();
  const desktopFast = host.getByRole('radio', { name: 'Fast · 15 seconds' });
  const desktopStandard = host.getByRole('radio', { name: 'Standard · 2 minutes' });
  await desktopStandard.waitFor();
  assert.equal(await desktopStandard.getAttribute('aria-checked'), 'true');
  const room = [...server.rooms.rooms.values()][0];

  await openPrivateGame(guest, url, 'Guest Tester');
  await guest.getByRole('textbox', { name: 'Enter room code' }).fill(room.code);
  await button(guest, 'Join').click();
  await guest.getByText('Standard · 2 minutes', { exact: true }).waitFor();
  await button(guest, 'Private Game').waitFor({ state: 'detached' });
  await button(guest, 'Switch language (English / Hebrew)').click();
  await guest.getByText(/רגיל.*2 דקות/).waitFor();
  assert.equal(await guest.getByRole('radio').count(), 0);

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
  await button(host, 'התחלת משחק!').click();
  for (const page of [host, guest]) {
    const seconds = await shownSeconds(page);
    assert.ok(seconds >= 115 && seconds <= 120, `standard countdown: ${seconds}s`);
    await countdown(page).getByText(/^(2:00|1:5[5-9])$/).waitFor();
  }
  assert.equal(room.game.phaseDuration, 120000);

  room.endGame(room.hostId);
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
  assert.deepEqual(errors, []);
});
