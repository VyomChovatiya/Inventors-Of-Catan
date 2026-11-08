import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { RoomManager } from './rooms/RoomManager.js';
import {
  SessionManager,
  OAUTH_STATE_COOKIE_NAME,
  OAUTH_RETURN_COOKIE_NAME,
} from './auth/SessionManager.js';
import { AuthenticatedUser, GameAction } from '@catan/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  }),
);
app.use(express.json());

// Serve client dist in production mode
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const sessionManager = new SessionManager();
const roomManager = new RoomManager();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() });
});

// Current authenticated user session inspection
app.get('/api/auth/me', (req, res) => {
  const session = sessionManager.getSessionFromRequest(req);
  res.json({
    authenticated: Boolean(session),
    user: session ? session.user : null,
    oauthConfigured: sessionManager.isOAuthConfigured(),
    callbackUrl: sessionManager.getCallbackUrl(req),
  });
});

// Start Google OAuth 2.0 Authorization Code flow
app.get('/api/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    res.redirect('/?auth_error=oauth_not_configured');
    return;
  }

  const state = crypto.randomBytes(24).toString('hex');
  const returnRoom = typeof req.query.room === 'string' ? req.query.room.trim().toUpperCase() : '';
  const isSecure =
    req.secure ||
    (req.headers['x-forwarded-proto'] as string)?.includes('https') ||
    (req.headers.host || '').includes('ngrok');

  const cookiesToSet: string[] = [
    `${OAUTH_STATE_COOKIE_NAME}=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isSecure ? '; Secure' : ''}`,
  ];
  if (returnRoom) {
    cookiesToSet.push(
      `${OAUTH_RETURN_COOKIE_NAME}=${encodeURIComponent(returnRoom)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600${isSecure ? '; Secure' : ''}`,
    );
  }
  res.setHeader('Set-Cookie', cookiesToSet);

  const callbackUrl = sessionManager.getCallbackUrl(req);
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'openid email profile');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('access_type', 'online');
  authUrl.searchParams.set('prompt', 'select_account');

  res.redirect(authUrl.toString());
});

// Google OAuth 2.0 Callback
app.get('/api/auth/google/callback', async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const cookies = sessionManager.parseCookies(req.headers.cookie);
    const expectedState = cookies[OAUTH_STATE_COOKIE_NAME];
    const returnRoom = cookies[OAUTH_RETURN_COOKIE_NAME];

    if (!code || !state || !expectedState || state !== expectedState) {
      res.redirect('/?auth_error=invalid_oauth_state');
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      res.redirect('/?auth_error=oauth_not_configured');
      return;
    }

    const callbackUrl = sessionManager.getCallbackUrl(req);
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }).toString(),
    });

    if (!tokenRes.ok) {
      console.error('Google token exchange failed:', await tokenRes.text());
      res.redirect('/?auth_error=token_exchange_failed');
      return;
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      res.redirect('/?auth_error=missing_access_token');
      return;
    }

    const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      res.redirect('/?auth_error=userinfo_failed');
      return;
    }

    const profile = (await profileRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
      picture?: string;
    };

    if (!profile.sub || !profile.email) {
      res.redirect('/?auth_error=invalid_google_profile');
      return;
    }

    const deterministicId = `usr_${crypto
      .createHash('sha256')
      .update(`google:${profile.sub}`)
      .digest('hex')
      .slice(0, 12)}`;

    const user: AuthenticatedUser = {
      id: deterministicId,
      email: profile.email,
      name: (profile.name || profile.given_name || profile.email.split('@')[0] || 'Settler').slice(0, 20),
      picture: profile.picture,
    };

    const { signedToken } = sessionManager.createSession(user);
    const isSecure =
      req.secure ||
      (req.headers['x-forwarded-proto'] as string)?.includes('https') ||
      (req.headers.host || '').includes('ngrok');

    const maxAgeSec = 14 * 24 * 60 * 60;
    res.setHeader('Set-Cookie', [
      `catan_sid=${encodeURIComponent(signedToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${isSecure ? '; Secure' : ''}`,
      `${OAUTH_STATE_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
      `${OAUTH_RETURN_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    ]);

    if (returnRoom) {
      res.redirect(`/?room=${encodeURIComponent(returnRoom)}`);
    } else {
      res.redirect('/');
    }
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.redirect('/?auth_error=oauth_callback_exception');
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const session = sessionManager.getSessionFromRequest(req);
  if (session) {
    sessionManager.destroySession(session.sessionId);
    // Disconnect any sockets bound to this session
    for (const s of io.sockets.sockets.values()) {
      if (s.data.sessionId === session.sessionId) {
        s.disconnect(true);
      }
    }
  }
  sessionManager.clearSessionCookie(res);
  res.json({ success: true });
});

app.get('/api/rooms', (_req, res) => {
  res.json({ rooms: roomManager.listPublicRooms() });
});

function broadcastPublicRooms() {
  io.emit('rooms:list', roomManager.listPublicRooms());
}

function broadcastRoomUpdated(roomCode: string) {
  const room = roomManager.getRoom(roomCode);
  if (!room) return;
  io.to(room.code).emit('room:updated', roomManager.sanitizeRoomForClient(room));
}

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

// Bind every socket connection to its server-verified session identity
io.use((socket, next) => {
  const cookieHeader = socket.handshake.headers.cookie;
  const authToken =
    typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
  const session = sessionManager.getSessionFromCookieHeader(cookieHeader, authToken);
  if (session) {
    socket.data.user = session.user as AuthenticatedUser;
    socket.data.sessionId = session.sessionId;
  } else {
    socket.data.user = null;
    socket.data.sessionId = null;
  }
  next();
});

function getAuthenticatedSocketUser(socket: Socket): AuthenticatedUser | null {
  const sessionId = socket.data.sessionId;
  if (!sessionId) return null;
  // Re-verify session is still valid on each privileged operation
  const cookieHeader = socket.handshake.headers.cookie;
  const authToken =
    typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
  const session = sessionManager.getSessionFromCookieHeader(cookieHeader, authToken);
  if (!session) {
    socket.data.user = null;
    return null;
  }
  socket.data.user = session.user;
  return session.user;
}

io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id} (user: ${socket.data.user?.id || 'unauthenticated'})`);

  // Send active rooms list immediately upon connecting
  socket.emit('rooms:list', roomManager.listPublicRooms());

  socket.on('rooms:list', (callback) => {
    if (typeof callback === 'function') {
      callback({ rooms: roomManager.listPublicRooms() });
    } else {
      socket.emit('rooms:list', roomManager.listPublicRooms());
    }
  });

  // Create room (bound to authenticated user)
  socket.on(
    'room:create',
    (
      {
        hostName,
        hostColor,
        is5to6Player,
        victoryPointsToWin,
        timerSettings,
        houseRules,
        previewBoard,
      } = {},
      callback,
    ) => {
      try {
        const user = getAuthenticatedSocketUser(socket);
        if (!user) {
          callback?.({
            success: false,
            error: 'Authentication required. Please sign in with Google.',
          });
          return;
        }

        const { room, player } = roomManager.createRoom(
          user,
          hostName,
          hostColor,
          is5to6Player,
          victoryPointsToWin,
          timerSettings,
          houseRules,
          previewBoard,
        );
        player.socketId = socket.id;
        socket.join(room.code);
        const sanitizedRoom = roomManager.sanitizeRoomForClient(room);
        const sanitizedPlayer = roomManager.sanitizePlayerForClient(player);
        callback?.({
          success: true,
          roomCode: room.code,
          player: sanitizedPlayer,
          room: sanitizedRoom,
        });
        broadcastRoomUpdated(room.code);
        broadcastPublicRooms();
      } catch (e: any) {
        callback?.({ success: false, error: e.message });
      }
    },
  );

  // Join room (bound to authenticated user)
  socket.on('room:join', ({ code, name, color } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.joinRoom(code, user, name, color);
      if ('error' in res) {
        callback?.({ success: false, error: res.error });
        return;
      }
      res.player.socketId = socket.id;
      socket.join(res.room.code);
      const sanitizedRoom = roomManager.sanitizeRoomForClient(res.room);
      const sanitizedPlayer = roomManager.sanitizePlayerForClient(res.player);
      callback?.({ success: true, room: sanitizedRoom, player: sanitizedPlayer });
      broadcastRoomUpdated(res.room.code);
      broadcastPublicRooms();

      // If game is active, send redacted state to each player
      if (res.room.gameState) {
        broadcastGameState(res.room.code);
      }
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Host kicks player from room lobby
  socket.on('room:kick', ({ code, hostPlayerId, targetPlayerId } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.kickPlayer(code, user.id, targetPlayerId, hostPlayerId);
      if (!res.success || !res.room) {
        callback?.({ success: false, error: res.error });
        return;
      }
      if (res.kickedSocketId) {
        io.to(res.kickedSocketId).emit('room:kicked', {
          code: res.room.code,
          reason: 'You were removed from the lobby by the host.',
        });
        const targetSocket = io.sockets.sockets.get(res.kickedSocketId);
        if (targetSocket) {
          targetSocket.leave(res.room.code);
        }
      }
      const sanitizedRoom = roomManager.sanitizeRoomForClient(res.room);
      callback?.({ success: true, room: sanitizedRoom });
      broadcastRoomUpdated(res.room.code);
      broadcastPublicRooms();
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Host deletes room lobby (so host can create a fresh lobby with the same account)
  socket.on('room:delete', ({ code } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.deleteRoom(code, user.id);
      if (!res.success || !res.code) {
        callback?.({ success: false, error: res.error });
        return;
      }

      if (res.socketIds) {
        for (const sid of res.socketIds) {
          if (sid !== socket.id) {
            io.to(sid).emit('room:kicked', {
              code: res.code,
              reason: 'The host deleted the lobby.',
            });
          }
          const targetSocket = io.sockets.sockets.get(sid);
          if (targetSocket) {
            targetSocket.leave(res.code);
          }
        }
      }

      socket.leave(res.code);
      callback?.({ success: true, code: res.code });
      broadcastPublicRooms();
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Non-host player leaves waiting lobby
  socket.on('room:leave', ({ code } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.leaveRoom(code, user.id);
      if (!res.success) {
        callback?.({ success: false, error: res.error });
        return;
      }

      socket.leave((code || '').trim().toUpperCase());
      callback?.({ success: true });
      if (res.room && !res.deleted) {
        broadcastRoomUpdated(res.room.code);
      }
      broadcastPublicRooms();
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Change player color in lobby
  socket.on('room:changeColor', ({ code, playerId, color } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.changePlayerColor(code, user.id, color, playerId);
      if (!res.success || !res.room) {
        callback?.({ success: false, error: res.error });
        return;
      }
      const sanitizedRoom = roomManager.sanitizeRoomForClient(res.room);
      callback?.({ success: true, room: sanitizedRoom });
      broadcastRoomUpdated(res.room.code);
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Change custom player display name in lobby
  socket.on('room:changeName', ({ code, name } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.changePlayerName(code, user.id, name);
      if (!res.success || !res.room) {
        callback?.({ success: false, error: res.error });
        return;
      }
      const sanitizedRoom = roomManager.sanitizeRoomForClient(res.room);
      callback?.({ success: true, room: sanitizedRoom });
      broadcastRoomUpdated(res.room.code);
      broadcastPublicRooms();
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Host randomizes match board preview in lobby
  socket.on('room:randomizeBoard', ({ code } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.randomizePreviewBoard(code, user.id);
      if (!res.success || !res.room) {
        callback?.({ success: false, error: res.error });
        return;
      }
      const sanitizedRoom = roomManager.sanitizeRoomForClient(res.room);
      callback?.({ success: true, room: sanitizedRoom });
      broadcastRoomUpdated(res.room.code);
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Reconnect (bound to authenticated user)
  socket.on('room:reconnect', ({ code } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.reconnectSocket(code, user.id, socket.id);
      if (!res) {
        callback?.({ success: false, error: 'Could not restore session in this room.' });
        return;
      }
      socket.join(res.room.code);
      const sanitizedRoom = roomManager.sanitizeRoomForClient(res.room);
      const sanitizedPlayer = roomManager.sanitizePlayerForClient(res.player);
      callback?.({ success: true, room: sanitizedRoom, player: sanitizedPlayer });
      broadcastRoomUpdated(res.room.code);
      broadcastPublicRooms();

      if (res.room.gameState) {
        broadcastGameState(res.room.code);
      }
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Start game (strictly verified against authenticated host)
  socket.on('room:start', ({ code, hostPlayerId } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.startGame(code, user.id, hostPlayerId);
      if (!res.success) {
        callback?.({ success: false, error: res.error });
        return;
      }
      const room = roomManager.getRoom(code);
      callback?.({ success: true });
      if (room) {
        broadcastRoomUpdated(room.code);
        broadcastGameState(room.code);
      }
      broadcastPublicRooms();
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Game Action (strictly verified against authenticated player ownership)
  socket.on('game:action', ({ code, action }: { code: string; action: GameAction }, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.dispatchAction(code, user.id, action);
      // Even if the action was rejected due to a deadline timeout, broadcast the timeout state transition!
      if (res.stateChanged) {
        broadcastGameState(code);
      }
      if (!res.success) {
        callback?.({ success: false, error: res.error });
        return;
      }
      callback?.({ success: true });
      broadcastGameState(code);
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Room-scoped Player Chat (server-authoritative sender identity & rate-limited)
  socket.on('room:chat', ({ code, text } = {}, callback) => {
    try {
      const user = getAuthenticatedSocketUser(socket);
      if (!user) {
        callback?.({
          success: false,
          error: 'Authentication required. Please sign in with Google.',
        });
        return;
      }

      const res = roomManager.sendChatMessage(code, user.id, text);
      if (!res.success || !res.message) {
        callback?.({ success: false, error: res.error });
        return;
      }
      callback?.({ success: true, message: res.message });
      io.to(res.message.roomCode).emit('room:chatMessage', res.message);
    } catch (e: any) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Disconnect
  socket.on('disconnect', () => {
    const res = roomManager.handleDisconnect(socket.id);
    if (res) {
      console.log(`Player ${res.player.name} disconnected from room ${res.room.code}`);
      broadcastRoomUpdated(res.room.code);
      broadcastPublicRooms();
      if (res.room.gameState) {
        broadcastGameState(res.room.code);
      }
    }
  });
});

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
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

httpServer.listen(PORT, () => {
  console.log(`CATAN Game Server listening on http://localhost:${PORT}`);
});
