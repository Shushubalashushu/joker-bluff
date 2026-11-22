'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createInterface } = require('node:readline');
const { io: connect } = require('socket.io-client');

async function withServer(env, run) {
  const child = spawn(process.execPath, [require.resolve('../src/index')], {
    env: { ...process.env, PORT: '0', CORS_ORIGIN: '', CORS_ORIGINS: '', ...env },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const closed = once(child, 'close');
  const output = createInterface({ input: child.stdout });
  const startupTimeout = setTimeout(() => child.kill(), 5000);
  try {
    for await (const line of output) {
      const binding = /listening on ([^:]+):(\d+)$/.exec(line);
      if (!binding) continue;
      clearTimeout(startupTimeout);
      const [, address, port] = binding;
      assert.equal(address, '0.0.0.0');
      assert.ok(Number(port) > 0 && Number(port) !== 3001, 'PORT=0 requests an ephemeral port');
      await run(`http://127.0.0.1:${port}`);
      return;
    }
    assert.fail('The server did not report a listening address');
  } finally {
    clearTimeout(startupTimeout);
    output.close();
    child.kill();
    await closed;
  }
}

function request(url, origin, method = 'GET') {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (method === 'OPTIONS') headers['Access-Control-Request-Method'] = 'GET';
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.once('error', reject);
    req.end();
  });
}

async function canConnectWebSocket(url, origin) {
  const socket = connect(url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
    extraHeaders: origin ? { Origin: origin } : {},
    timeout: 2000,
  });
  try {
    const connected = new Promise((resolve) => {
      socket.once('connect', () => resolve(true));
      socket.once('connect_error', () => resolve(false));
    });
    socket.connect();
    return await connected;
  } finally {
    socket.close();
  }
}

test('health returns only readiness and uses the loopback CORS fallback', { timeout: 10000 }, () =>
  withServer({}, async (url) => {
    const local = 'http://localhost:8081';
    const health = await request(`${url}/health`, local);
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true });
    assert.equal(health.headers['cache-control'], 'no-store');
    assert.equal(health.headers['access-control-allow-origin'], local);

    const outside = await request(`${url}/health`, 'https://outside.example');
    assert.equal(outside.status, 200);
    assert.equal(outside.headers['access-control-allow-origin'], undefined);
  }));

test('HTTP and Socket.IO honor the configured browser origins', { timeout: 10000 }, () => {
  const web = 'https://joker.vercel.app';
  const preview = 'https://preview-joker.vercel.app';
  const outside = 'https://joker.vercel.app.example';
  return withServer({ CORS_ORIGINS: ` ${web}/ , ${preview} `, CORS_ORIGIN: outside }, async (url) => {
    const preflight = await request(`${url}/health`, preview, 'OPTIONS');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], preview);

    const polling = `${url}/socket.io/?EIO=4&transport=polling`;
    const accepted = await request(polling, web);
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers['access-control-allow-origin'], web);

    const denied = await request(polling, outside);
    assert.equal(denied.status, 403);
    assert.equal(denied.headers['access-control-allow-origin'], undefined);

    assert.equal(await canConnectWebSocket(url, preview), true);
    assert.equal(await canConnectWebSocket(url, outside), false);
    assert.equal(await canConnectWebSocket(url, url), true);
    assert.equal(await canConnectWebSocket(url), true);
  });
});
