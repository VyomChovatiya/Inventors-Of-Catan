import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import {
  GameAction,
  PlayerColor,
  RedactedGameState,
  ResourceCount,
  ResourceType,
} from '@catan/shared';

export interface RoomPlayer {
  id: string;
  name: string;
  color: PlayerColor;
  sessionToken: string;
  isReady: boolean;
  connected: boolean;
}

export interface Room {
  code: string;
  createdAt: number;
  hostPlayerId: string;
  is5to6Player: boolean;
  players: Record<string, RoomPlayer>;
  gameState: any;
}

interface GameStoreState {
  socket: Socket | null;
  sessionToken: string;
  myPlayerId: string | null;
  room: Room | null;
  gameState: RedactedGameState | null;
  activeBuildMode: 'none' | 'road' | 'settlement' | 'city';
  errorMessage: string | null;
  
  // Connection methods
  initSocket: () => void;
  createRoom: (hostName: string, hostColor: PlayerColor, is5to6Player: boolean) => Promise<string>;
  joinRoom: (code: string, name: string, color: PlayerColor) => Promise<boolean>;
  reconnect: (code: string) => Promise<boolean>;
  startGame: () => void;
  
  // Game Actions
  sendAction: (action: GameAction) => void;
  setBuildMode: (mode: 'none' | 'road' | 'settlement' | 'city') => void;
  clearError: () => void;
}

function getStoredToken(): string {
  let token = localStorage.getItem('catan_session_token');
  if (!token) {
    token = 'tok_' + Math.random().toString(36).substring(2, 12) + Date.now().toString(36);
    localStorage.setItem('catan_session_token', token);
  }
  return token;
}

export const useGameStore = create<GameStoreState>((set, get) => ({
  socket: null,
  sessionToken: getStoredToken(),
  myPlayerId: localStorage.getItem('catan_player_id'),
  room: null,
  gameState: null,
  activeBuildMode: 'none',
  errorMessage: null,

  initSocket: () => {
    if (get().socket) return;
    const socket = io('/', {
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });

    socket.on('connect', () => {
      console.log('Connected to server socket:', socket.id);
      // Auto-reconnect if URL has room code or localStorage has it
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('room') || localStorage.getItem('catan_last_room');
      if (urlCode) {
        get().reconnect(urlCode);
      }
    });

    socket.on('room:updated', (room: Room) => {
      set({ room });
    });

    socket.on('game:state', (gameState: RedactedGameState) => {
      set({ gameState, errorMessage: null });
      // Reset build mode if turn ended
      if (
        gameState.currentTurnPlayerId !== get().myPlayerId &&
        gameState.pairedPlayerId !== get().myPlayerId &&
        gameState.phase !== 'SETUP_ROUND_1' &&
        gameState.phase !== 'SETUP_ROUND_2'
      ) {
        set({ activeBuildMode: 'none' });
      }
    });

    set({ socket });
  },

  createRoom: async (hostName, hostColor, is5to6Player) => {
    const { socket, sessionToken } = get();
    if (!socket) throw new Error('Socket not initialized');

    return new Promise((resolve, reject) => {
      socket.emit(
        'room:create',
        { hostName, hostColor, sessionToken, is5to6Player },
        (res: any) => {
          if (res.success) {
            localStorage.setItem('catan_last_room', res.roomCode);
            localStorage.setItem('catan_player_id', res.player.id);
            set({ room: res.room, myPlayerId: res.player.id });
            const url = new URL(window.location.href);
            url.searchParams.set('room', res.roomCode);
            window.history.pushState({}, '', url.toString());
            resolve(res.roomCode);
          } else {
            set({ errorMessage: res.error });
            reject(new Error(res.error));
          }
        },
      );
    });
  },

  joinRoom: async (code, name, color) => {
    const { socket, sessionToken } = get();
    if (!socket) return false;

    return new Promise((resolve) => {
      socket.emit('room:join', { code, name, color, sessionToken }, (res: any) => {
        if (res.success) {
          localStorage.setItem('catan_last_room', code);
          localStorage.setItem('catan_player_id', res.player.id);
          set({ room: res.room, myPlayerId: res.player.id });
          const url = new URL(window.location.href);
          url.searchParams.set('room', code);
          window.history.pushState({}, '', url.toString());
          resolve(true);
        } else {
          set({ errorMessage: res.error });
          resolve(false);
        }
      });
    });
  },

  reconnect: async (code) => {
    const { socket, sessionToken } = get();
    if (!socket) return false;

    return new Promise((resolve) => {
      socket.emit('room:reconnect', { code, sessionToken }, (res: any) => {
        if (res.success) {
          localStorage.setItem('catan_last_room', code);
          localStorage.setItem('catan_player_id', res.player.id);
          set({ room: res.room, myPlayerId: res.player.id });
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  },

  startGame: () => {
    const { socket, room, myPlayerId } = get();
    if (!socket || !room || !myPlayerId) return;

    socket.emit('room:start', { code: room.code, hostPlayerId: myPlayerId }, (res: any) => {
      if (!res.success) {
        set({ errorMessage: res.error });
      }
    });
  },

  sendAction: (action) => {
    const { socket, room } = get();
    if (!socket || !room) return;

    socket.emit('game:action', { code: room.code, action }, (res: any) => {
      if (!res.success) {
        set({ errorMessage: res.error });
      } else {
        set({ errorMessage: null });
      }
    });
  },

  setBuildMode: (mode) => set({ activeBuildMode: mode }),
  clearError: () => set({ errorMessage: null }),
}));
