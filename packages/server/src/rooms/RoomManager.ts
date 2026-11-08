import fs from 'fs';
import path from 'path';
import {
  AuthenticatedUser,
  BoardState,
  ChatMessage,
  DEFAULT_HOUSE_RULES,
  DEFAULT_TIMER_SETTINGS,
  GameAction,
  GameState,
  HouseRules,
  PlayerColor,
  RedactedGameState,
  TimerSettings,
  applyAction,
  generateBoard,
  handleTurnTimeout,
  hasAdjacentRedNumbers,
  initializeGame,
  redactStateForPlayer,
} from '@catan/shared';

export interface RoomPlayer {
  id: string; // Bound to AuthenticatedUser.id
  name: string;
  color: PlayerColor;
  picture?: string;
  socketId: string | null;
  isReady: boolean;
  connected: boolean;
}

export interface ClientRoomPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  picture?: string;
  isReady: boolean;
  connected: boolean;
}

export interface Room {
  code: string;
  createdAt: number;
  startedAt: number | null;
  hostPlayerId: string;
  is5to6Player: boolean;
  victoryPointsToWin: number;
  timerSettings: TimerSettings;
  houseRules: HouseRules;
  previewBoard: BoardState;
  players: Record<string, RoomPlayer>;
  chatMessages: ChatMessage[];
  gameState: GameState | null;
}

export interface ClientRoomView {
  code: string;
  createdAt: number;
  startedAt: number | null;
  hostPlayerId: string;
  is5to6Player: boolean;
  victoryPointsToWin: number;
  timerSettings: TimerSettings;
  houseRules: HouseRules;
  previewBoard: BoardState | null;
  players: Record<string, ClientRoomPlayer>;
  chatMessages: ChatMessage[];
  hasStarted: boolean;
}

export interface RoomSummary {
  code: string;
  hostPlayerId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  is5to6Player: boolean;
  victoryPointsToWin: number;
  houseRules: HouseRules;
  status: 'waiting' | 'in_progress' | 'finished';
  createdAt: number;
  startedAt: number | null;
}

const ALL_COLORS: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'green', 'purple'];

const DATA_DIR = path.resolve(process.cwd(), 'data/rooms');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const MAX_CHAT_LENGTH = 300;
const CHAT_RATE_WINDOW_MS = 5_000;
const CHAT_MAX_PER_WINDOW = 5;
const CHAT_MIN_INTERVAL_MS = 250;

function isValidCustomBoard(board: unknown, is5to6Player: boolean): board is BoardState {
  if (!board || typeof board !== 'object') return false;
  const b = board as BoardState;
  if (!b.hexes || !b.vertices || !b.edges || !b.harbors || typeof b.robberHexId !== 'string') {
    return false;
  }
  const expectedHexCount = is5to6Player ? 30 : 19;
  if (Object.keys(b.hexes).length !== expectedHexCount) {
    return false;
  }
  if (!b.hexes[b.robberHexId]) {
    return false;
  }
  if (hasAdjacentRedNumbers(b.hexes)) {
    return false;
  }
  return true;
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private chatTimestamps = new Map<string, number[]>();

  constructor() {
    this.loadPersistedRooms();
  }

  private writeQueues = new Map<string, Promise<void>>();

  private loadPersistedRooms() {
    try {
      const files = fs.readdirSync(DATA_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const fullPath = path.join(DATA_DIR, file);
          let room: Room;
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            room = JSON.parse(content);
          } catch {
            try {
              fs.unlinkSync(fullPath);
            } catch {
              // ignore
            }
            continue;
          }
          if (!room.victoryPointsToWin) room.victoryPointsToWin = 10;
          if (!room.timerSettings) {
            room.timerSettings = { ...DEFAULT_TIMER_SETTINGS };
          } else if (!room.timerSettings.turnTimeoutSeconds) {
            room.timerSettings.turnTimeoutSeconds = DEFAULT_TIMER_SETTINGS.turnTimeoutSeconds;
          }
          if (!room.houseRules) {
            room.houseRules = { ...DEFAULT_HOUSE_RULES };
          }
          if (!Array.isArray(room.chatMessages)) {
            room.chatMessages = [];
          }
          if (!room.previewBoard || !isValidCustomBoard(room.previewBoard, Boolean(room.is5to6Player))) {
            room.previewBoard = room.gameState
              ? room.gameState.board
              : generateBoard(Boolean(room.is5to6Player));
          }
          if (room.gameState) {
            if (!room.gameState.settings.houseRules) {
              room.gameState.settings.houseRules = { ...room.houseRules };
            }
            if (!Array.isArray(room.gameState.playerOrder) || room.gameState.playerOrder.length === 0) {
              room.gameState.playerOrder = Object.keys(room.gameState.players);
            }
            if (!Array.isArray(room.gameState.balancedDiceDeck)) {
              room.gameState.balancedDiceDeck = [];
            }
          }
          if (room.startedAt === undefined) {
            room.startedAt = room.gameState ? room.gameState.startedAt || room.createdAt : null;
          }
          for (const p of Object.values(room.players)) {
            p.connected = false;
            p.socketId = null;
            // Remove any legacy sessionToken property on persisted room players
            delete (p as any).sessionToken;
          }
          this.rooms.set(room.code, room);
        }
      }
      console.log(`Loaded ${this.rooms.size} persisted rooms from disk.`);
    } catch (e) {
      console.error('Error loading persisted rooms:', e);
    }
  }

  // Asynchronous non-blocking disk persistence (serialized per room + atomic temp-file rename)
  private persistRoom(room: Room) {
    try {
      if (room.gameState && room.gameState.actionLog.length > 100) {
        room.gameState.actionLog = room.gameState.actionLog.slice(-100);
      }
      if (room.chatMessages && room.chatMessages.length > 100) {
        room.chatMessages = room.chatMessages.slice(-100);
      }
      const filePath = path.join(DATA_DIR, `${room.code}.json`);
      const tmpPath = `${filePath}.tmp`;
      const payload = JSON.stringify(room);
      const prev = this.writeQueues.get(room.code) || Promise.resolve();
      const next = prev
        .then(async () => {
          await fs.promises.writeFile(tmpPath, payload, 'utf-8');
          await fs.promises.rename(tmpPath, filePath);
        })
        .catch((err) => {
          console.error('Async error saving room:', err);
        });
      this.writeQueues.set(room.code, next);
    } catch (e) {
      console.error('Error serializing room:', e);
    }
  }

  public sanitizePlayerForClient(player: RoomPlayer): ClientRoomPlayer {
    return {
      id: player.id,
      name: player.name,
      color: player.color,
      picture: player.picture,
      isReady: player.isReady,
      connected: player.connected,
    };
  }

  public sanitizeRoomForClient(room: Room): ClientRoomView {
    const sanitizedPlayers: Record<string, ClientRoomPlayer> = {};
    for (const [pid, p] of Object.entries(room.players)) {
      sanitizedPlayers[pid] = this.sanitizePlayerForClient(p);
    }

    return {
      code: room.code,
      createdAt: room.createdAt,
      startedAt: room.startedAt,
      hostPlayerId: room.hostPlayerId,
      is5to6Player: room.is5to6Player,
      victoryPointsToWin: room.victoryPointsToWin,
      timerSettings: { ...room.timerSettings },
      houseRules: { ...room.houseRules },
      // Only include previewBoard while in lobby; active game boards are delivered via redacted game:state
      previewBoard: room.gameState ? null : room.previewBoard,
      players: sanitizedPlayers,
      chatMessages: room.chatMessages || [],
      hasStarted: Boolean(room.gameState),
    };
  }

  listPublicRooms(): RoomSummary[] {
    const summaries: RoomSummary[] = [];
    for (const room of this.rooms.values()) {
      const players = Object.values(room.players);
      const anyConnected = players.some((p) => p.connected);
      const isRecent = Date.now() - room.createdAt < 45 * 60 * 1000;
      if (!anyConnected && !isRecent) continue;

      const host = room.players[room.hostPlayerId] || players[0];
      const status: 'waiting' | 'in_progress' | 'finished' = !room.gameState
        ? 'waiting'
        : room.gameState.phase === 'GAME_OVER'
          ? 'finished'
          : 'in_progress';

      if (status === 'finished') continue;

      summaries.push({
        code: room.code,
        hostPlayerId: room.hostPlayerId,
        hostName: host ? host.name : 'Settler',
        playerCount: players.length,
        maxPlayers: room.is5to6Player ? 6 : 4,
        is5to6Player: room.is5to6Player,
        victoryPointsToWin: room.victoryPointsToWin || 10,
        houseRules: room.houseRules || { ...DEFAULT_HOUSE_RULES },
        status,
        createdAt: room.createdAt,
        startedAt: room.startedAt || (room.gameState ? room.gameState.startedAt : null),
      });
    }
    return summaries.sort((a, b) => b.createdAt - a.createdAt);
  }

  createRoom(
    user: AuthenticatedUser,
    hostName: string | undefined,
    hostColor: PlayerColor,
    is5to6Player = false,
    victoryPointsToWin = 10,
    timerSettings?: Partial<TimerSettings>,
    houseRules?: Partial<HouseRules>,
    customPreviewBoard?: BoardState | null,
  ): { room: Room; player: RoomPlayer } {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const playerId = user.id;
    const cleanName = (hostName || user.name || 'Settler').trim().slice(0, 20) || 'Settler';
    const validColor: PlayerColor = ALL_COLORS.includes(hostColor) ? hostColor : 'red';

    const player: RoomPlayer = {
      id: playerId,
      name: cleanName,
      color: validColor,
      picture: user.picture,
      socketId: null,
      isReady: true,
      connected: true,
    };

    const clampedVPs = Math.max(5, Math.min(18, Number(victoryPointsToWin) || 10));
    const mergedTimers: TimerSettings = {
      setupTimeoutSeconds: Math.max(
        15,
        Math.min(180, Number(timerSettings?.setupTimeoutSeconds) || DEFAULT_TIMER_SETTINGS.setupTimeoutSeconds),
      ),
      rollTimeoutSeconds: Math.max(
        5,
        Math.min(90, Number(timerSettings?.rollTimeoutSeconds) || DEFAULT_TIMER_SETTINGS.rollTimeoutSeconds),
      ),
      turnTimeoutSeconds: Math.max(
        15,
        Math.min(300, Number(timerSettings?.turnTimeoutSeconds) || DEFAULT_TIMER_SETTINGS.turnTimeoutSeconds),
      ),
      robberTimeoutSeconds: Math.max(
        10,
        Math.min(120, Number(timerSettings?.robberTimeoutSeconds) || DEFAULT_TIMER_SETTINGS.robberTimeoutSeconds),
      ),
    };

    const mergedHouseRules: HouseRules = {
      balancedDice: Boolean(houseRules?.balancedDice),
      hiddenBank: Boolean(houseRules?.hiddenBank),
      freeTrades: Boolean(houseRules?.freeTrades),
    };

    const previewBoard = isValidCustomBoard(customPreviewBoard, Boolean(is5to6Player))
      ? customPreviewBoard
      : generateBoard(Boolean(is5to6Player));

    const room: Room = {
      code,
      createdAt: Date.now(),
      startedAt: null,
      hostPlayerId: playerId,
      is5to6Player: Boolean(is5to6Player),
      victoryPointsToWin: clampedVPs,
      timerSettings: mergedTimers,
      houseRules: mergedHouseRules,
      previewBoard,
      players: { [playerId]: player },
      chatMessages: [],
      gameState: null,
    };

    this.rooms.set(code, room);
    this.persistRoom(room);
    return { room, player };
  }

  getRoom(code: string): Room | undefined {
    if (!code || typeof code !== 'string') return undefined;
    return this.rooms.get(code.trim().toUpperCase());
  }

  joinRoom(
    code: string,
    user: AuthenticatedUser,
    preferredName: string | undefined,
    color: PlayerColor,
  ): { room: Room; player: RoomPlayer } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };

    // Check if this authenticated account is already seated in the room (rejoining)
    const existingPlayer = room.players[user.id];
    if (existingPlayer) {
      existingPlayer.connected = true;
      if (!room.gameState && preferredName && preferredName.trim()) {
        existingPlayer.name = preferredName.trim().slice(0, 20);
      }
      if (room.gameState && room.gameState.players[existingPlayer.id]) {
        room.gameState.players[existingPlayer.id].isConnected = true;
        room.gameState.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: existingPlayer.id,
          message: `${existingPlayer.name} reconnected to the game.`,
          category: 'system',
        });
      }
      this.persistRoom(room);
      return { room, player: existingPlayer };
    }

    if (room.gameState) {
      return { error: 'Game has already started in this room.' };
    }

    const maxPlayers = room.is5to6Player ? 6 : 4;
    if (Object.keys(room.players).length >= maxPlayers) {
      return { error: `Room is full (max ${maxPlayers} players).` };
    }

    const takenColors = new Set(Object.values(room.players).map((p) => p.color));
    const availableColors = ALL_COLORS.filter((c) => !takenColors.has(c));
    if (availableColors.length === 0) {
      return { error: 'No available player colors left in this room.' };
    }

    const finalColor = availableColors.includes(color) ? color : availableColors[0];
    const cleanName =
      (preferredName || user.name || `Settler ${Object.keys(room.players).length + 1}`)
        .trim()
        .slice(0, 20) || `Settler ${Object.keys(room.players).length + 1}`;

    const player: RoomPlayer = {
      id: user.id,
      name: cleanName,
      color: finalColor,
      picture: user.picture,
      socketId: null,
      isReady: false,
      connected: true,
    };

    room.players[user.id] = player;
    this.persistRoom(room);
    return { room, player };
  }

  kickPlayer(
    code: string,
    authenticatedPlayerId: string,
    targetPlayerId: string,
    claimedHostPlayerId?: string,
  ): { success: boolean; error?: string; room?: Room; kickedSocketId?: string | null } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (claimedHostPlayerId && claimedHostPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Unauthorized: host identity mismatch.' };
    }
    if (!room.players[authenticatedPlayerId] || room.hostPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Only the room host can kick players.' };
    }
    if (authenticatedPlayerId === targetPlayerId) {
      return { success: false, error: 'Host cannot kick themselves.' };
    }
    if (room.gameState) {
      return { success: false, error: 'Cannot kick players after the match has started.' };
    }

    const target = room.players[targetPlayerId];
    if (!target) {
      return { success: false, error: 'Player not found in lobby.' };
    }

    const kickedSocketId = target.socketId;
    delete room.players[targetPlayerId];
    this.persistRoom(room);
    return { success: true, room, kickedSocketId };
  }

  deleteRoom(
    code: string,
    authenticatedPlayerId: string,
  ): { success: boolean; error?: string; code?: string; socketIds?: string[] } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (room.hostPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Only the room host can delete this lobby.' };
    }

    const socketIds = Object.values(room.players)
      .map((p) => p.socketId)
      .filter((sid): sid is string => Boolean(sid));

    this.rooms.delete(room.code);
    this.writeQueues.delete(room.code);

    const filePath = path.join(DATA_DIR, `${room.code}.json`);
    const tmpPath = `${filePath}.tmp`;
    fs.promises.unlink(filePath).catch(() => {});
    fs.promises.unlink(tmpPath).catch(() => {});

    return { success: true, code: room.code, socketIds };
  }

  leaveRoom(
    code: string,
    authenticatedPlayerId: string,
  ): { success: boolean; error?: string; room?: Room; deleted?: boolean } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (room.gameState) {
      return { success: false, error: 'Cannot leave a room after the match has started.' };
    }
    if (!room.players[authenticatedPlayerId]) {
      return { success: false, error: 'Player not in lobby.' };
    }
    if (room.hostPlayerId === authenticatedPlayerId) {
      const del = this.deleteRoom(code, authenticatedPlayerId);
      return { success: del.success, error: del.error, deleted: true };
    }

    delete room.players[authenticatedPlayerId];
    this.persistRoom(room);
    return { success: true, room, deleted: false };
  }

  changePlayerColor(
    code: string,
    authenticatedPlayerId: string,
    newColor: PlayerColor,
    claimedPlayerId?: string,
  ): { success: boolean; error?: string; room?: Room } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (claimedPlayerId && claimedPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Unauthorized: cannot change another player’s color.' };
    }
    if (room.gameState) return { success: false, error: 'Cannot change color after game starts.' };
    if (!ALL_COLORS.includes(newColor)) {
      return { success: false, error: 'Invalid player color.' };
    }

    const player = room.players[authenticatedPlayerId];
    if (!player) return { success: false, error: 'Player not in room.' };

    const isTakenByOther = Object.values(room.players).some(
      (p) => p.id !== authenticatedPlayerId && p.color === newColor,
    );
    if (isTakenByOther) {
      return { success: false, error: `Color ${newColor} is already taken by another player!` };
    }

    player.color = newColor;
    this.persistRoom(room);
    return { success: true, room };
  }

  changePlayerName(
    code: string,
    authenticatedPlayerId: string,
    newName: string,
  ): { success: boolean; error?: string; room?: Room } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (room.gameState) return { success: false, error: 'Cannot change name after game starts.' };

    const player = room.players[authenticatedPlayerId];
    if (!player) return { success: false, error: 'Player not in room.' };

    const cleanName = (typeof newName === 'string' ? newName : '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, 20);
    if (!cleanName) {
      return { success: false, error: 'Player name cannot be empty.' };
    }

    player.name = cleanName;
    this.persistRoom(room);
    return { success: true, room };
  }

  randomizePreviewBoard(
    code: string,
    authenticatedPlayerId: string,
  ): { success: boolean; error?: string; room?: Room } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (room.gameState) return { success: false, error: 'Cannot randomize board after game starts.' };
    if (!room.players[authenticatedPlayerId] || room.hostPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Only the host can randomize the match board.' };
    }

    room.previewBoard = generateBoard(room.is5to6Player);
    this.persistRoom(room);
    return { success: true, room };
  }

  reconnectSocket(
    code: string,
    authenticatedPlayerId: string,
    socketId: string,
  ): { room: Room; player: RoomPlayer } | null {
    const room = this.getRoom(code);
    if (!room) return null;

    const p = room.players[authenticatedPlayerId];
    if (!p) return null;

    const wasDisconnected = !p.connected;
    p.socketId = socketId;
    p.connected = true;
    if (room.gameState && room.gameState.players[p.id]) {
      room.gameState.players[p.id].isConnected = true;
      if (wasDisconnected) {
        room.gameState.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: p.id,
          message: `${p.name} reconnected.`,
          category: 'system',
        });
      }
    }
    this.persistRoom(room);
    return { room, player: p };
  }

  handleDisconnect(socketId: string): { room: Room; player: RoomPlayer } | null {
    for (const room of this.rooms.values()) {
      for (const p of Object.values(room.players)) {
        if (p.socketId === socketId) {
          p.socketId = null;
          p.connected = false;
          if (room.gameState && room.gameState.players[p.id]) {
            room.gameState.players[p.id].isConnected = false;
            room.gameState.actionLog.push({
              id: `log_${Date.now()}_${Math.random()}`,
              timestamp: Date.now(),
              playerId: p.id,
              message: `${p.name} disconnected.`,
              category: 'system',
            });
          }
          this.persistRoom(room);
          return { room, player: p };
        }
      }
    }
    return null;
  }

  startGame(
    code: string,
    authenticatedPlayerId: string,
    claimedHostPlayerId?: string,
  ): { success: boolean; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (claimedHostPlayerId && claimedHostPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Unauthorized: host identity mismatch.' };
    }
    if (!room.players[authenticatedPlayerId] || room.hostPlayerId !== authenticatedPlayerId) {
      return { success: false, error: 'Only the joined room host can start the game.' };
    }
    if (room.gameState) return { success: false, error: 'Game already started.' };

    // Final duplicate color safety sanitization before game start
    const usedColors = new Set<PlayerColor>();
    for (const p of Object.values(room.players)) {
      if (usedColors.has(p.color)) {
        const fallback = ALL_COLORS.find((c) => !usedColors.has(c));
        if (fallback) p.color = fallback;
      }
      usedColors.add(p.color);
    }

    const playersList = Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
    }));

    if (playersList.length < 2) {
      return { success: false, error: 'Need at least 2 players to start CATAN.' };
    }

    room.startedAt = Date.now();
    room.gameState = initializeGame(
      `gm_${room.code}`,
      playersList,
      room.is5to6Player,
      room.victoryPointsToWin || 10,
      room.timerSettings,
      {
        houseRules: room.houseRules,
        customBoard: room.previewBoard,
        randomizeTurnOrder: true,
      },
    );
    this.persistRoom(room);
    return { success: true };
  }

  dispatchAction(
    code: string,
    authenticatedPlayerId: string,
    action: GameAction,
  ): { success: boolean; error?: string; stateChanged?: boolean } {
    const room = this.getRoom(code);
    if (!room || !room.gameState) {
      return { success: false, error: 'Active game not found.' };
    }

    if (!room.players[authenticatedPlayerId] || !room.gameState.players[authenticatedPlayerId]) {
      return { success: false, error: 'Unauthorized: you are not a player in this match.' };
    }

    if (!action || typeof action !== 'object') {
      return { success: false, error: 'Invalid action payload.' };
    }

    if (action.playerId && action.playerId !== authenticatedPlayerId) {
      return {
        success: false,
        error: 'Unauthorized: cannot perform an action on behalf of another player.',
      };
    }

    const authorizedAction: GameAction = {
      ...action,
      playerId: authenticatedPlayerId,
    };

    const result = applyAction(room.gameState, authorizedAction);
    if (result.success || result.stateChanged) {
      this.persistRoom(room);
    }
    return result;
  }

  sendChatMessage(
    code: string,
    authenticatedPlayerId: string,
    rawText: unknown,
  ): { success: boolean; error?: string; message?: ChatMessage } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };

    const player = room.players[authenticatedPlayerId];
    if (!player) {
      return { success: false, error: 'Unauthorized: you must be in the room to send chat messages.' };
    }

    if (typeof rawText !== 'string') {
      return { success: false, error: 'Invalid message format.' };
    }

    // Strip control characters and trim whitespace
    const cleanText = rawText.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    if (!cleanText) {
      return { success: false, error: 'Message cannot be empty.' };
    }
    if (cleanText.length > MAX_CHAT_LENGTH) {
      return {
        success: false,
        error: `Message is too long (max ${MAX_CHAT_LENGTH} characters).`,
      };
    }

    // Enforce per-player rate limits
    const now = Date.now();
    const rateKey = `${room.code}:${authenticatedPlayerId}`;
    const recent = (this.chatTimestamps.get(rateKey) || []).filter(
      (t) => now - t < CHAT_RATE_WINDOW_MS,
    );
    if (recent.length > 0 && now - recent[recent.length - 1] < CHAT_MIN_INTERVAL_MS) {
      return { success: false, error: 'Sending messages too fast. Please wait a moment.' };
    }
    if (recent.length >= CHAT_MAX_PER_WINDOW) {
      return { success: false, error: 'Chat rate limit reached. Please wait a few seconds.' };
    }
    recent.push(now);
    this.chatTimestamps.set(rateKey, recent);

    const chatMsg: ChatMessage = {
      id: `chat_${now}_${Math.random().toString(36).slice(2, 7)}`,
      roomCode: room.code,
      playerId: player.id,
      playerName: player.name,
      playerColor: player.color,
      text: cleanText,
      timestamp: now,
    };

    if (!Array.isArray(room.chatMessages)) {
      room.chatMessages = [];
    }
    room.chatMessages.push(chatMsg);
    if (room.chatMessages.length > 100) {
      room.chatMessages = room.chatMessages.slice(-100);
    }

    this.persistRoom(room);
    return { success: true, message: chatMsg };
  }

  checkTurnTimeouts(): string[] {
    const updatedRoomCodes: string[] = [];
    for (const room of this.rooms.values()) {
      if (!room.gameState) continue;
      // Only run auto-timers if at least 1 player is connected to the room
      const anyConnected = Object.values(room.players).some((p) => p.connected);
      if (!anyConnected) continue;

      if (handleTurnTimeout(room.gameState)) {
        this.persistRoom(room);
        updatedRoomCodes.push(room.code);
      }
    }
    return updatedRoomCodes;
  }

  getRedactedState(code: string, playerId: string): RedactedGameState | null {
    const room = this.getRoom(code);
    if (!room || !room.gameState) return null;
    return redactStateForPlayer(room.gameState, playerId);
  }
}
