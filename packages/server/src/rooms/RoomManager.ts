import fs from 'fs';
import path from 'path';
import {
  GameState,
  PlayerColor,
  RedactedGameState,
  initializeGame,
  applyAction,
  redactStateForPlayer,
  handleTurnTimeout,
  GameAction,
} from '@catan/shared';

export interface RoomPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  sessionToken: string;
  socketId: string | null;
  isReady: boolean;
  connected: boolean;
}

export interface Room {
  code: string;
  createdAt: number;
  hostPlayerId: string;
  is5to6Player: boolean;
  players: Record<string, RoomPlayer>;
  gameState: GameState | null;
}

const DATA_DIR = path.resolve(process.cwd(), 'data/rooms');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor() {
    this.loadPersistedRooms();
  }

  private loadPersistedRooms() {
    try {
      const files = fs.readdirSync(DATA_DIR);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
          const room: Room = JSON.parse(content);
          for (const p of Object.values(room.players)) {
            p.connected = false;
            p.socketId = null;
          }
          this.rooms.set(room.code, room);
        }
      }
      console.log(`Loaded ${this.rooms.size} persisted rooms from disk.`);
    } catch (e) {
      console.error('Error loading persisted rooms:', e);
    }
  }

  private persistRoom(room: Room) {
    try {
      const filePath = path.join(DATA_DIR, `${room.code}.json`);
      fs.writeFileSync(filePath, JSON.stringify(room, null, 2), 'utf-8');
    } catch (e) {
      console.error('Error saving room:', e);
    }
  }

  createRoom(
    hostName: string,
    hostColor: PlayerColor,
    sessionToken: string,
    is5to6Player = false,
  ): { room: Room; player: RoomPlayer } {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const playerId = `usr_${Math.random().toString(36).substring(2, 9)}`;

    const player: RoomPlayer = {
      id: playerId,
      name: hostName,
      color: hostColor,
      sessionToken,
      socketId: null,
      isReady: true,
      connected: true,
    };

    const room: Room = {
      code,
      createdAt: Date.now(),
      hostPlayerId: playerId,
      is5to6Player,
      players: { [playerId]: player },
      gameState: null,
    };

    this.rooms.set(code, room);
    this.persistRoom(room);
    return { room, player };
  }

  getRoom(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  joinRoom(
    code: string,
    name: string,
    color: PlayerColor,
    sessionToken: string,
  ): { room: Room; player: RoomPlayer } | { error: string } {
    const room = this.getRoom(code);
    if (!room) return { error: 'Room not found.' };

    // Check if player is rejoining with existing sessionToken
    for (const p of Object.values(room.players)) {
      if (p.sessionToken === sessionToken) {
        p.connected = true;
        if (room.gameState && room.gameState.players[p.id]) {
          room.gameState.players[p.id].isConnected = true;
        }
        this.persistRoom(room);
        return { room, player: p };
      }
    }

    if (room.gameState) {
      return { error: 'Game has already started in this room.' };
    }

    const maxPlayers = room.is5to6Player ? 6 : 4;
    if (Object.keys(room.players).length >= maxPlayers) {
      return { error: `Room is full (max ${maxPlayers} players).` };
    }

    const takenColors = Object.values(room.players).map((p) => p.color);
    const availableColors: PlayerColor[] = ['red', 'blue', 'orange', 'white', 'green', 'purple'].filter(
      (c) => !takenColors.includes(c as PlayerColor),
    ) as PlayerColor[];

    const finalColor = availableColors.includes(color) ? color : availableColors[0];
    const playerId = `usr_${Math.random().toString(36).substring(2, 9)}`;

    const player: RoomPlayer = {
      id: playerId,
      name,
      color: finalColor,
      sessionToken,
      socketId: null,
      isReady: false,
      connected: true,
    };

    room.players[playerId] = player;
    this.persistRoom(room);
    return { room, player };
  }

  reconnectSocket(code: string, sessionToken: string, socketId: string): { room: Room; player: RoomPlayer } | null {
    const room = this.getRoom(code);
    if (!room) return null;

    for (const p of Object.values(room.players)) {
      if (p.sessionToken === sessionToken) {
        p.socketId = socketId;
        p.connected = true;
        if (room.gameState && room.gameState.players[p.id]) {
          room.gameState.players[p.id].isConnected = true;
        }
        this.persistRoom(room);
        return { room, player: p };
      }
    }
    return null;
  }

  handleDisconnect(socketId: string): { room: Room; player: RoomPlayer } | null {
    for (const room of this.rooms.values()) {
      for (const p of Object.values(room.players)) {
        if (p.socketId === socketId) {
          p.socketId = null;
          p.connected = false;
          if (room.gameState && room.gameState.players[p.id]) {
            room.gameState.players[p.id].isConnected = false;
          }
          this.persistRoom(room);
          return { room, player: p };
        }
      }
    }
    return null;
  }

  startGame(code: string, hostPlayerId: string): { success: boolean; error?: string } {
    const room = this.getRoom(code);
    if (!room) return { success: false, error: 'Room not found.' };
    if (room.hostPlayerId !== hostPlayerId) return { success: false, error: 'Only host can start game.' };
    if (room.gameState) return { success: false, error: 'Game already started.' };

    const playersList = Object.values(room.players).map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
    }));

    if (playersList.length < 2) {
      return { success: false, error: 'Need at least 2 players to start CATAN.' };
    }

    room.gameState = initializeGame(`gm_${room.code}`, playersList, room.is5to6Player);
    this.persistRoom(room);
    return { success: true };
  }

  dispatchAction(code: string, action: GameAction): { success: boolean; error?: string } {
    const room = this.getRoom(code);
    if (!room || !room.gameState) {
      return { success: false, error: 'Active game not found.' };
    }

    const result = applyAction(room.gameState, action);
    if (result.success) {
      this.persistRoom(room);
    }
    return result;
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
