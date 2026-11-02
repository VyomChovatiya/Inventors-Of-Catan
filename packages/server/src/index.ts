import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { RoomManager } from './rooms/RoomManager.js';
import { GameAction } from '@catan/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Serve client dist in production mode
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const roomManager = new RoomManager();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);

  // Create room
  socket.on('room:create', ({ hostName, hostColor, sessionToken, is5to6Player }, callback) => {
    try {
      const { room, player } = roomManager.createRoom(hostName, hostColor, sessionToken, is5to6Player);
      player.socketId = socket.id;
      socket.join(room.code);
      callback({ success: true, roomCode: room.code, player, room });
      io.to(room.code).emit('room:updated', room);
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  // Join room
  socket.on('room:join', ({ code, name, color, sessionToken }, callback) => {
    try {
      const res = roomManager.joinRoom(code, name, color, sessionToken);
      if ('error' in res) {
        callback({ success: false, error: res.error });
        return;
      }
      res.player.socketId = socket.id;
      socket.join(res.room.code);
      callback({ success: true, room: res.room, player: res.player });
      io.to(res.room.code).emit('room:updated', res.room);

      // If game is active, send state
      if (res.room.gameState) {
        broadcastGameState(res.room.code);
      }
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  // Reconnect
  socket.on('room:reconnect', ({ code, sessionToken }, callback) => {
    try {
      const res = roomManager.reconnectSocket(code, sessionToken, socket.id);
      if (!res) {
        callback({ success: false, error: 'Could not restore session.' });
        return;
      }
      socket.join(res.room.code);
      callback({ success: true, room: res.room, player: res.player });
      io.to(res.room.code).emit('room:updated', res.room);

      if (res.room.gameState) {
        broadcastGameState(res.room.code);
      }
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  // Start game
  socket.on('room:start', ({ code, hostPlayerId }, callback) => {
    try {
      const res = roomManager.startGame(code, hostPlayerId);
      if (!res.success) {
        callback({ success: false, error: res.error });
        return;
      }
      const room = roomManager.getRoom(code);
      callback({ success: true });
      if (room) {
        io.to(code).emit('room:updated', room);
        broadcastGameState(code);
      }
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  // Game Action
  socket.on('game:action', ({ code, action }: { code: string; action: GameAction }, callback) => {
    try {
      const res = roomManager.dispatchAction(code, action);
      if (!res.success) {
        callback({ success: false, error: res.error });
        return;
      }
      callback({ success: true });
      broadcastGameState(code);
    } catch (e: any) {
      callback({ success: false, error: e.message });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const res = roomManager.handleDisconnect(socket.id);
    if (res) {
      console.log(`Player ${res.player.name} disconnected from room ${res.room.code}`);
      io.to(res.room.code).emit('room:updated', res.room);
      if (res.room.gameState) {
        broadcastGameState(res.room.code);
      }
    }
  });
});

function broadcastGameState(roomCode: string) {
  const room = roomManager.getRoom(roomCode);
  if (!room || !room.gameState) return;

  for (const player of Object.values(room.players)) {
    if (player.socketId) {
      const redacted = roomManager.getRedactedState(roomCode, player.id);
      if (redacted) {
        io.to(player.socketId).emit('game:state', redacted);
      }
    }
  }
}

const PORT = process.env.PORT || 3001;

// Check turn timeouts every 500ms (PlaySettlr auto-roller / auto-pass)
setInterval(() => {
  const timedOutRooms = roomManager.checkTurnTimeouts();
  for (const code of timedOutRooms) {
    broadcastGameState(code);
  }
}, 500);

// SPA fallback
if (fs.existsSync(clientDist)) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

httpServer.listen(PORT, () => {
  console.log(`CATAN Game Server listening on http://localhost:${PORT}`);
});
