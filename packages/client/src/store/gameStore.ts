import { create } from 'zustand';
import { io, Socket } from 'socket.io-client';
import {
  AuthenticatedUser,
  BoardState,
  ChatMessage,
  GameAction,
  HouseRules,
  PlayerColor,
  RedactedGameState,
  TimerSettings,
} from '@catan/shared';

export interface RoomPlayer {
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
  startedAt?: number | null;
  hostPlayerId: string;
  is5to6Player: boolean;
  victoryPointsToWin: number;
  timerSettings?: TimerSettings;
  houseRules?: HouseRules;
  previewBoard?: BoardState | null;
  players: Record<string, RoomPlayer>;
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
  houseRules?: HouseRules;
  status: 'waiting' | 'in_progress' | 'finished';
  createdAt: number;
  startedAt: number | null;
}

interface GameStoreState {
  socket: Socket | null;
  authLoading: boolean;
  authenticated: boolean;
  authUser: AuthenticatedUser | null;
  oauthConfigured: boolean;
  oauthCallbackUrl: string;
  myPlayerId: string | null;
  room: Room | null;
  publicRooms: RoomSummary[];
  gameState: RedactedGameState | null;
  activeBuildMode: 'none' | 'road' | 'settlement' | 'city';
  errorMessage: string | null;

  // Auth & Connection methods
  checkAuth: () => Promise<void>;
  logout: () => Promise<void>;
  initSocket: () => void;
  refreshRooms: () => void;
  createRoom: (
    hostName: string,
    hostColor: PlayerColor,
    is5to6Player: boolean,
    victoryPointsToWin: number,
    timerSettings: TimerSettings,
    houseRules: HouseRules,
    previewBoard?: BoardState | null,
  ) => Promise<string>;
  joinRoom: (code: string, name: string, color: PlayerColor) => Promise<boolean>;
  kickPlayer: (targetPlayerId: string) => Promise<boolean>;
  deleteRoom: (targetCode?: string) => Promise<boolean>;
  leaveRoom: () => Promise<boolean>;
  changeColor: (color: PlayerColor) => Promise<boolean>;
  changePlayerName: (name: string) => Promise<boolean>;
  randomizeLobbyBoard: () => Promise<boolean>;
  reconnect: (code: string) => Promise<boolean>;
  startGame: () => void;
  sendChatMessage: (text: string) => Promise<boolean>;

  // Game Actions
  sendAction: (action: GameAction) => void;
  setBuildMode: (mode: 'none' | 'road' | 'settlement' | 'city') => void;
  clearError: () => void;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured:
    'Google OAuth credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) are not configured on the server yet.',
  invalid_oauth_state: 'OAuth state verification failed. Please try signing in again.',
  token_exchange_failed: 'Failed to exchange authorization code with Google. Check callback URL and secret.',
  missing_access_token: 'Google did not return an access token.',
  userinfo_failed: 'Failed to retrieve Google account profile.',
  invalid_google_profile: 'Google account profile is missing required identity fields.',
  oauth_callback_exception: 'An unexpected error occurred during Google sign-in.',
};

export const useGameStore = create<GameStoreState>((set, get) => ({
  socket: null,
  authLoading: true,
  authenticated: false,
  authUser: null,
  oauthConfigured: false,
  oauthCallbackUrl: 'https://flakily-vaseline-catchy.ngrok-free.dev/api/auth/google/callback',
  myPlayerId: null,
  room: null,
  publicRooms: [],
  gameState: null,
  activeBuildMode: 'none',
  errorMessage: null,

  checkAuth: async () => {
    set({ authLoading: true });
    try {
      const params = new URLSearchParams(window.location.search);
      const authErrCode = params.get('auth_error');
      if (authErrCode) {
        const msg = AUTH_ERROR_MESSAGES[authErrCode] || `Authentication error: ${authErrCode}`;
        set({ errorMessage: msg });
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('auth_error');
        window.history.replaceState({}, '', cleanUrl.toString());
      }

      const res = await fetch('/api/auth/me', {
        credentials: 'include',
      });
      if (!res.ok) {
        set({ authLoading: false, authenticated: false, authUser: null, myPlayerId: null });
        return;
      }
      const data = await res.json();
      set({
        authLoading: false,
        authenticated: Boolean(data.authenticated && data.user),
        authUser: data.user || null,
        myPlayerId: data.user?.id || null,
        oauthConfigured: Boolean(data.oauthConfigured),
        oauthCallbackUrl:
          data.callbackUrl || 'https://flakily-vaseline-catchy.ngrok-free.dev/api/auth/google/callback',
      });

      if (data.authenticated && data.user) {
        get().initSocket();
      }
    } catch (e) {
      console.error('Error checking auth status:', e);
      set({ authLoading: false, authenticated: false, authUser: null, myPlayerId: null });
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (e) {
      console.error('Error logging out:', e);
    }
    const existingSocket = get().socket;
    if (existingSocket) {
      existingSocket.disconnect();
    }
    sessionStorage.removeItem('catan_last_room');
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.history.replaceState({}, '', url.toString());
    set({
      socket: null,
      authenticated: false,
      authUser: null,
      myPlayerId: null,
      room: null,
      gameState: null,
      errorMessage: null,
    });
  },

  initSocket: () => {
    if (get().socket) return;
    const socket = io('/', {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      withCredentials: true,
    });

    socket.on('connect', () => {
      console.log('Connected to server socket:', socket.id);
      const params = new URLSearchParams(window.location.search);
      const urlCode = params.get('room') || sessionStorage.getItem('catan_last_room');
      if (urlCode && get().authenticated) {
        get().reconnect(urlCode);
      }
      socket.emit('rooms:list', (res: any) => {
        if (res && Array.isArray(res.rooms)) {
          set({ publicRooms: res.rooms });
        }
      });
    });

    socket.on('rooms:list', (rooms: RoomSummary[]) => {
      set({ publicRooms: rooms });
    });

    socket.on('room:updated', (room: Room) => {
      set({ room });
    });

    socket.on('room:chatMessage', (msg: ChatMessage) => {
      set((state) => {
        if (!state.room || state.room.code !== msg.roomCode) return state;
        const existing = state.room.chatMessages || [];
        if (existing.some((m) => m.id === msg.id)) return state;
        return {
          room: {
            ...state.room,
            chatMessages: [...existing, msg].slice(-100),
          },
        };
      });
    });

    socket.on('room:kicked', ({ reason }: { code: string; reason: string }) => {
      sessionStorage.removeItem('catan_last_room');
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.pushState({}, '', url.toString());
      set({
        room: null,
        gameState: null,
        errorMessage: reason || 'You were removed from the lobby by the host.',
      });
    });

    socket.on('game:state', (gameState: RedactedGameState) => {
      set({ gameState });
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

  refreshRooms: () => {
    const { socket } = get();
    if (!socket) return;
    socket.emit('rooms:list', (res: any) => {
      if (res && Array.isArray(res.rooms)) {
        set({ publicRooms: res.rooms });
      }
    });
  },

  createRoom: async (
    hostName,
    hostColor,
    is5to6Player,
    victoryPointsToWin,
    timerSettings,
    houseRules,
    previewBoard,
  ) => {
    const { socket } = get();
    if (!socket) throw new Error('Socket not initialized');

    return new Promise((resolve, reject) => {
      socket.emit(
        'room:create',
        {
          hostName,
          hostColor,
          is5to6Player,
          victoryPointsToWin,
          timerSettings,
          houseRules,
          previewBoard,
        },
        (res: any) => {
          if (res.success) {
            sessionStorage.setItem('catan_last_room', res.roomCode);
            set({ room: res.room, myPlayerId: res.player.id, errorMessage: null });
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
    const { socket } = get();
    if (!socket) return false;

    return new Promise((resolve) => {
      socket.emit('room:join', { code, name, color }, (res: any) => {
        if (res.success) {
          sessionStorage.setItem('catan_last_room', code);
          set({ room: res.room, myPlayerId: res.player.id, errorMessage: null });
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

  kickPlayer: async (targetPlayerId) => {
    const { socket, room, myPlayerId } = get();
    if (!socket || !room || !myPlayerId) return false;

    return new Promise((resolve) => {
      socket.emit(
        'room:kick',
        { code: room.code, hostPlayerId: myPlayerId, targetPlayerId },
        (res: any) => {
          if (res.success) {
            set({ room: res.room, errorMessage: null });
            resolve(true);
          } else {
            set({ errorMessage: res.error });
            resolve(false);
          }
        },
      );
    });
  },

  deleteRoom: async (targetCode) => {
    const { socket, room } = get();
    const codeToDelete = (targetCode || room?.code || '').trim().toUpperCase();
    if (!socket || !codeToDelete) return false;

    return new Promise((resolve) => {
      socket.emit('room:delete', { code: codeToDelete }, (res: any) => {
        if (res && res.success) {
          const currentRoomCode = get().room?.code;
          if (!targetCode || currentRoomCode === codeToDelete) {
            sessionStorage.removeItem('catan_last_room');
            const url = new URL(window.location.href);
            url.searchParams.delete('room');
            window.history.pushState({}, '', url.toString());
            set({ room: null, gameState: null, errorMessage: null });
          } else {
            set({ errorMessage: null });
          }
          get().refreshRooms();
          resolve(true);
        } else {
          set({ errorMessage: res?.error || 'Could not delete lobby.' });
          resolve(false);
        }
      });
    });
  },

  leaveRoom: async () => {
    const { socket, room } = get();
    if (!socket || !room) return false;

    return new Promise((resolve) => {
      socket.emit('room:leave', { code: room.code }, (res: any) => {
        if (res && res.success) {
          sessionStorage.removeItem('catan_last_room');
          const url = new URL(window.location.href);
          url.searchParams.delete('room');
          window.history.pushState({}, '', url.toString());
          set({ room: null, gameState: null, errorMessage: null });
          get().refreshRooms();
          resolve(true);
        } else {
          set({ errorMessage: res?.error || 'Could not leave lobby.' });
          resolve(false);
        }
      });
    });
  },

  changeColor: async (color) => {
    const { socket, room, myPlayerId } = get();
    if (!socket || !room || !myPlayerId) return false;

    return new Promise((resolve) => {
      socket.emit(
        'room:changeColor',
        { code: room.code, playerId: myPlayerId, color },
        (res: any) => {
          if (res.success) {
            set({ room: res.room, errorMessage: null });
            resolve(true);
          } else {
            set({ errorMessage: res.error });
            resolve(false);
          }
        },
      );
    });
  },

  changePlayerName: async (name) => {
    const { socket, room } = get();
    if (!socket || !room) return false;

    return new Promise((resolve) => {
      socket.emit(
        'room:changeName',
        { code: room.code, name },
        (res: any) => {
          if (res.success) {
            set({ room: res.room, errorMessage: null });
            resolve(true);
          } else {
            set({ errorMessage: res.error });
            resolve(false);
          }
        },
      );
    });
  },

  randomizeLobbyBoard: async () => {
    const { socket, room } = get();
    if (!socket || !room) return false;

    return new Promise((resolve) => {
      socket.emit('room:randomizeBoard', { code: room.code }, (res: any) => {
        if (res.success) {
          set({ room: res.room, errorMessage: null });
          resolve(true);
        } else {
          set({ errorMessage: res.error });
          resolve(false);
        }
      });
    });
  },

  reconnect: async (code) => {
    const { socket } = get();
    if (!socket) return false;

    return new Promise((resolve) => {
      socket.emit('room:reconnect', { code }, (res: any) => {
        if (res.success) {
          sessionStorage.setItem('catan_last_room', code);
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

  sendChatMessage: async (text: string) => {
    const { socket, room } = get();
    if (!socket || !room) return false;

    return new Promise((resolve) => {
      socket.emit('room:chat', { code: room.code, text }, (res: any) => {
        if (res && res.success) {
          resolve(true);
        } else {
          if (res?.error) set({ errorMessage: res.error });
          resolve(false);
        }
      });
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
