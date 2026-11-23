'use strict';

const http = require('http');
const cors = require('cors');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const { SessionStore } = require('./sessions/SessionStore');
const { RoomManager } = require('./rooms/RoomManager');
const { registerSocketHandlers } = require('./socket/registerSocketHandlers');
const { createRateLimiter, clientAddress, ADDRESS_CONNECTION_LIMIT } = require('./utils/rateLimit');

const channel = (code) => `room:${code}`;
const LOOPBACK_ORIGIN = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/;

/** Builds (but does not start) the HTTP + Socket.IO server. Exported for integration tests. */
function createGameServer({ maxOpenConnections = config.MAX_OPEN_CONNECTIONS } = {}) {
  const browserOrigins = config.CORS_ORIGINS.length ? config.CORS_ORIGINS : [LOOPBACK_ORIGIN];
  const allowAnyOrigin = browserOrigins.includes('*');
  const corsOptions = { origin: allowAnyOrigin ? '*' : browserOrigins };
  const app = express();
  app.disable('x-powered-by');
  app.use(cors(corsOptions));

  const httpServer = http.createServer(app);
  const allowConnection = createRateLimiter(ADDRESS_CONNECTION_LIMIT);
  const reconnectReserve = Math.floor(maxOpenConnections / 4);
  // Keep unclassified Engine.IO handshakes below the reconnect reserve.
  const maxPending = Math.max(1, Math.floor(maxOpenConnections * 3 / 16));
  const addressOf = (req) => clientAddress(req, config.TRUST_RENDER_INGRESS);
  const io = new Server(httpServer, {
    cors: corsOptions,
    allowRequest: (req, reply) => {
      // WebSocket handshakes need an explicit origin check. Native clients can
      // omit Origin or send the server's own origin.
      const { origin, host } = req.headers;
      const sameHost = origin === `http://${host}` || origin === `https://${host}`;
      const allowed = !origin || sameHost || allowAnyOrigin || browserOrigins.some((entry) =>
        typeof entry === 'string' ? entry === origin : entry.test(origin));
      const open = io.engine.clientsCount;
      const pending = open - io.of('/').sockets.size;
      reply(null, allowed && open < maxOpenConnections && pending < maxPending && allowConnection(addressOf(req)));
    },
    maxHttpBufferSize: 128 * 1024,
    pingInterval: 10000,
    pingTimeout: 8000,
  });

  const sessions = new SessionStore();
  const transport = {
    toRoom: (code, event, payload) => io.to(channel(code)).emit(event, payload),
    toPlayer: (playerId, event, payload) => {
      const socketId = sessions.socketIdOf(playerId);
      if (socketId) io.to(socketId).emit(event, payload);
    },
    joinChannel: (socketId, code) => io.sockets.sockets.get(socketId)?.join(channel(code)),
    leaveChannel: (socketId, code) => io.sockets.sockets.get(socketId)?.leave(channel(code)),
  };
  const rooms = new RoomManager({ sessions, transport });

  registerSocketHandlers(io, { sessions, rooms, addressOf, maxOpenForNewGuests: maxOpenConnections - reconnectReserve });

  app.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ ok: true });
  });

  const cleanupTimer = setInterval(() => {
    rooms.cleanup();
    sessions.cleanup();
  }, config.CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();

  const close = () =>
    new Promise((resolve) => {
      clearInterval(cleanupTimer);
      io.close(() => {
        for (const room of rooms.rooms.values()) room.destroy();
        rooms.rooms.clear();
        resolve();
      });
    });

  return { app, httpServer, io, sessions, rooms, close };
}

if (require.main === module) {
  const server = createGameServer();
  server.httpServer.listen(config.PORT, '0.0.0.0', () => {
    const { address, port } = server.httpServer.address();
    console.log(`🃏 Joker Bluff server listening on ${address}:${port}`);
    console.log(`   min players: ${config.MIN_PLAYERS} · Lie Deye start: ${config.LIE_DEYE.STARTING_TOKENS} (max ${config.LIE_DEYE.MAX_USES_PER_GAME}/game)`);
    console.log(`   turn speeds: Fast ${config.TURN_SPEEDS.fast / 1000}s · Standard ${config.TURN_SPEEDS.standard / 1000}s`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down…`);
    server.close().then(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = { createGameServer };
