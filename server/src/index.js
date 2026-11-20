'use strict';

const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const config = require('./config');
const { SessionStore } = require('./sessions/SessionStore');
const { RoomManager } = require('./rooms/RoomManager');
const { registerSocketHandlers } = require('./socket/registerSocketHandlers');
const { createRateLimiter } = require('./utils/rateLimit');

const channel = (code) => `room:${code}`;

/** Builds (but does not start) the HTTP + Socket.IO server. Exported for integration tests. */
function createGameServer() {
  const app = express();
  app.disable('x-powered-by');

  const httpServer = http.createServer(app);
  const allowConnection = createRateLimiter({ windowMs: 10000, maxAttempts: 120 });
  const io = new Server(httpServer, {
    cors: { origin: config.CORS_ORIGIN },
    allowRequest: (req, reply) => reply(null, allowConnection(req.socket.remoteAddress)),
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

  registerSocketHandlers(io, { sessions, rooms });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime(), sessions: sessions.size, ...rooms.stats() });
  });

  const cleanupTimer = setInterval(() => {
    sessions.cleanup(config.SESSION_TTL_MS);
    rooms.cleanup();
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
  server.httpServer.listen(config.PORT, () => {
    console.log(`🃏 Joker Bluff server listening on :${config.PORT}`);
    console.log(`   min players: ${config.MIN_PLAYERS} · Lie Deye start: ${config.LIE_DEYE.STARTING_TOKENS} (max ${config.LIE_DEYE.MAX_USES_PER_GAME}/game)`);
    if (config.DEV_TESTING_MODE) {
      console.log(`   🧪 DEV_TESTING_MODE: every turn timer = ${config.TIMERS.REQUEST / 1000}s (set DEV_TESTING_MODE=0 for real timers)`);
    }
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
