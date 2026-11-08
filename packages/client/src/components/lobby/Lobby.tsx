import React, { useState, useEffect } from 'react';
import { PlayerColor, HouseRules, BoardState, generateBoard } from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';
import { BoardPreview } from '../board/BoardPreview.js';
import {
  Copy,
  Check,
  Play,
  Sparkles,
  Trophy,
  Lock,
  Clock,
  Users,
  RefreshCw,
  LogIn,
  LogOut,
  UserMinus,
  Shuffle,
  Sliders,
  ShieldCheck,
  User,
  Trash2,
} from 'lucide-react';

const COLORS: Array<{ id: PlayerColor; name: string; hex: string }> = [
  { id: 'red', name: 'Red', hex: '#ff1a1a' },
  { id: 'blue', name: 'Blue', hex: '#0055ff' },
  { id: 'orange', name: 'Orange', hex: '#ff6a00' },
  { id: 'white', name: 'White', hex: '#ffffff' },
  { id: 'green', name: 'Green', hex: '#00cc44' },
  { id: 'purple', name: 'Purple', hex: '#aa00ff' },
];

function formatElapsed(timestamp: number | null | undefined, now: number): string {
  if (!timestamp) return 'Just now';
  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins < 60) return `${mins}m ${secs}s ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function formatClockTime(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTurnDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return secs === 0 ? `${mins}m (${seconds}s)` : `${mins}m ${secs}s (${seconds}s)`;
}

export const Lobby: React.FC = () => {
  const {
    authLoading,
    authenticated,
    oauthConfigured,
    authUser,
    logout,
    createRoom,
    joinRoom,
    kickPlayer,
    deleteRoom,
    leaveRoom,
    changeColor,
    changePlayerName,
    randomizeLobbyBoard,
    startGame,
    refreshRooms,
    room,
    publicRooms,
    myPlayerId,
    errorMessage,
  } = useGameStore();

  // Custom in-game player display name (independent of Google account name)
  const [playerName, setPlayerName] = useState<string>(
    () => localStorage.getItem('catan_player_name') || '',
  );
  const [lobbyNameSaved, setLobbyNameSaved] = useState(false);

  const [selectedColor, setSelectedColor] = useState<PlayerColor>('red');
  const [is5to6, setIs5to6] = useState(false);
  const [victoryPointsToWin, setVictoryPointsToWin] = useState<number>(10);

  // Variable timer sliders for the lobby maker (Default normal turn duration: 3 minutes = 180s, max 5 minutes = 300s)
  const [setupTimeoutSeconds, setSetupTimeoutSeconds] = useState<number>(45);
  const [rollTimeoutSeconds, setRollTimeoutSeconds] = useState<number>(15);
  const [turnTimeoutSeconds, setTurnTimeoutSeconds] = useState<number>(180);
  const [robberTimeoutSeconds, setRobberTimeoutSeconds] = useState<number>(25);

  // Configurable House Rules (Standard rules false by default)
  const [houseRules, setHouseRules] = useState<HouseRules>({
    balancedDice: false,
    hiddenBank: false,
    freeTrades: false,
  });

  // Home-screen Board Preview (This exact board is used when creating the room)
  const [previewBoard, setPreviewBoard] = useState<BoardState>(() => generateBoard(false));

  const [joinCode, setJoinCode] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get('room') || '').toUpperCase();
  });
  const [copied, setCopied] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  // Initialize playerName from authUser.name if the user hasn't saved a custom nickname yet
  useEffect(() => {
    if (!playerName && authUser?.name) {
      setPlayerName(authUser.name.slice(0, 20));
    }
  }, [authUser?.name, playerName]);

  // Sync playerName when entering a room lobby
  useEffect(() => {
    if (room && myPlayerId && room.players[myPlayerId]?.name) {
      setPlayerName(room.players[myPlayerId].name);
    }
  }, [room?.code, myPlayerId]);

  // Regenerate preview board whenever 5-6 player mode toggles
  useEffect(() => {
    setPreviewBoard(generateBoard(is5to6));
  }, [is5to6]);

  // 1-second ticker so "Started on / Elapsed" timers on the home screen update live
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const handleRandomizePreview = () => {
    setPreviewBoard(generateBoard(is5to6));
  };

  const getEffectivePlayerName = () => {
    const trimmed = playerName.trim().slice(0, 20);
    const finalName = trimmed || authUser?.name || 'Settler';
    localStorage.setItem('catan_player_name', finalName);
    return finalName;
  };

  const handleCreate = async () => {
    const chosenName = getEffectivePlayerName();
    await createRoom(
      chosenName,
      selectedColor,
      is5to6,
      victoryPointsToWin,
      {
        setupTimeoutSeconds,
        rollTimeoutSeconds,
        turnTimeoutSeconds,
        robberTimeoutSeconds,
      },
      houseRules,
      previewBoard,
    );
  };

  const handleJoin = async (targetCode?: string) => {
    const codeToJoin = (targetCode || joinCode).trim().toUpperCase();
    if (!codeToJoin) return;
    const chosenName = getEffectivePlayerName();
    await joinRoom(codeToJoin, chosenName, selectedColor);
  };

  const handleSaveLobbyName = async (e: React.FormEvent) => {
    e.preventDefault();
    const chosenName = getEffectivePlayerName();
    const ok = await changePlayerName(chosenName);
    if (ok) {
      setLobbyNameSaved(true);
      setTimeout(() => setLobbyNameSaved(false), 1800);
    }
  };

  const copyRoomLink = () => {
    if (!room) return;
    const url = `${window.location.origin}/?room=${room.code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleGoogleLogin = () => {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.href = `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
  };

  // Loading authentication state
  if (authLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center bg-no-repeat relative"
        style={{ backgroundImage: "url('/assets/backgrounds/bg.jpg')" }}
      >
        <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm" />
        <div className="relative z-10 bg-slate-900/95 border border-slate-700 rounded-3xl p-8 max-w-md w-full text-center shadow-2xl">
          <span className="text-base font-black text-amber-400 animate-pulse">Verifying Google Session...</span>
        </div>
      </div>
    );
  }

  // Unauthenticated view: Require Google OAuth2 Sign-In
  if (!authenticated || !authUser) {
    const authErrorParam = new URLSearchParams(window.location.search).get('auth_error');

    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 bg-cover bg-center bg-no-repeat relative"
        style={{ backgroundImage: "url('/assets/backgrounds/bg.jpg')" }}
      >
        <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-[3px]" />

        <div className="relative z-10 bg-slate-900/95 border border-slate-700/80 rounded-3xl p-9 max-w-lg w-full shadow-2xl backdrop-blur-2xl flex flex-col items-center gap-6 text-center">
          <div className="flex flex-col items-center">
            <span className="text-xs font-bold text-amber-400 tracking-widest uppercase mb-1 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" /> Official 6th Edition Rules
            </span>
            <h1 className="text-4xl font-black text-white tracking-tight">CATAN ONLINE</h1>
            <p className="text-sm text-slate-300 mt-1.5">
              Sign in with Google to play, customize your in-game nickname, and automatically reconnect to your seat.
            </p>
          </div>

          {(errorMessage || authErrorParam) && (
            <div className="w-full bg-rose-950/85 border border-rose-700 text-rose-200 p-3.5 rounded-xl text-xs font-semibold">
              {errorMessage || `Authentication error: ${authErrorParam}`}
            </div>
          )}

          {!oauthConfigured && (
            <div className="w-full bg-amber-950/80 border border-amber-700/80 text-amber-200 p-3.5 rounded-xl text-xs text-left leading-relaxed">
              <strong className="block text-amber-300 mb-1">Google OAuth2 Not Configured on Server:</strong>
              Set <code className="text-white">GOOGLE_CLIENT_ID</code>,{' '}
              <code className="text-white">GOOGLE_CLIENT_SECRET</code>, and{' '}
              <code className="text-white">GOOGLE_CALLBACK_URL</code> in your server environment or{' '}
              <code className="text-white">.env</code> file.
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full py-4 px-6 bg-white hover:bg-slate-100 text-slate-900 font-black text-base rounded-2xl shadow-xl transition flex items-center justify-center gap-3 active:scale-95 cursor-pointer"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.3 0 6.08-1.09 8.11-2.96l-3.88-3.05c-1.08.72-2.45 1.16-4.23 1.16-3.26 0-6.02-2.2-7-5.16H1.01v3.14C3.03 21.2 7.22 24 12 24z"
              />
              <path
                fill="#FBBC05"
                d="M5 13.99c-.25-.72-.4-1.49-.4-2.29s.15-1.57.4-2.29V6.27H1.01C.37 7.55 0 9.01 0 11.7s.37 4.15 1.01 5.43L5 13.99z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.8 0 3.41.62 4.68 1.84l3.5-3.5C18.07 1.19 15.3 0 12 0 7.22 0 3.03 2.8 1.01 6.87L5 10.01c.98-2.96 3.74-5.26 7-5.26z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Authenticated sessions protect your seat, cards, and turns.</span>
          </div>
        </div>
      </div>
    );
  }

  // If in a room waiting lobby before match start
  if (room && !room.hasStarted) {
    const isHost = room.hostPlayerId === myPlayerId;
    const playerCount = Object.keys(room.players).length;
    const maxPlayers = room.is5to6Player ? 6 : 4;
    const canStart = isHost && playerCount >= 2;
    const myPlayer = myPlayerId ? room.players[myPlayerId] : null;
    const takenColorsByOthers = new Set(
      Object.values(room.players)
        .filter((p) => p.id !== myPlayerId)
        .map((p) => p.color),
    );
    const ts = room.timerSettings || {
      setupTimeoutSeconds: 45,
      rollTimeoutSeconds: 15,
      turnTimeoutSeconds: 180,
      robberTimeoutSeconds: 25,
    };
    const hr = room.houseRules || {
      balancedDice: false,
      hiddenBank: false,
      freeTrades: false,
    };

    return (
      <div
        className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-cover bg-center bg-no-repeat relative overflow-y-auto"
        style={{ backgroundImage: "url('/assets/backgrounds/bg.jpg')" }}
      >
        <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-[3px]" />

        <div className="relative z-10 bg-slate-900/92 border border-slate-700/80 rounded-3xl p-6 sm:p-8 max-w-[1320px] w-full shadow-2xl backdrop-blur-2xl grid grid-cols-1 lg:grid-cols-12 gap-6 my-auto">
          {/* Left Column (6 cols): Room Details, Custom Name, Rules, Players & Start */}
          <div className="lg:col-span-6 flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
                  Game Lobby • Opened {formatClockTime(room.createdAt)} ({formatElapsed(room.createdAt, nowMs)})
                </span>
                <h2 className="text-3xl font-black text-white">Room {room.code}</h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={copyRoomLink}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm font-bold text-slate-200 transition cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Link Copied!' : 'Copy Invite Link'}
                </button>
                {isHost ? (
                  <button
                    type="button"
                    onClick={() => deleteRoom(room.code)}
                    title="Delete this lobby and return to Home Screen to create a new one"
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-rose-950/90 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-700/80 rounded-xl text-sm font-bold transition cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" /> Delete Lobby
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => leaveRoom()}
                    title="Leave this lobby and return to Home Screen"
                    className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-rose-900/70 text-slate-300 hover:text-rose-200 border border-slate-700 rounded-xl text-sm font-bold transition cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" /> Leave Lobby
                  </button>
                )}
              </div>
            </div>

            {errorMessage && (
              <div className="bg-rose-950/80 border border-rose-700 text-rose-200 p-3 rounded-xl text-sm text-center font-semibold">
                {errorMessage}
              </div>
            )}

            {/* Mode, VP, Timers & House Rules Badges */}
            <div className="flex flex-col gap-2.5 bg-slate-950 p-4 rounded-2xl border border-slate-800 text-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-400">Format:</span>
                  <span className="text-amber-400 font-bold">
                    {room.is5to6Player ? '5–6 Players (Paired Turn)' : '2–4 Players (Standard)'}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 bg-amber-950/80 border border-amber-700/70 px-3 py-1 rounded-xl text-amber-300 font-black">
                  <Trophy className="w-4 h-4" /> {room.victoryPointsToWin || 10} VP to Win
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-slate-400 border-t border-slate-800/80 pt-2.5">
                <span className="flex items-center gap-1 font-semibold text-slate-300">
                  <Clock className="w-4 h-4 text-sky-400" /> Timers:
                </span>
                <span>Setup: <strong className="text-slate-200">{ts.setupTimeoutSeconds}s</strong></span>
                <span>Roll: <strong className="text-slate-200">{ts.rollTimeoutSeconds}s</strong></span>
                <span>Turn: <strong className="text-slate-200">{formatTurnDuration(ts.turnTimeoutSeconds)}</strong></span>
                <span>Robber/Dev: <strong className="text-slate-200">{ts.robberTimeoutSeconds}s</strong></span>
              </div>

              <div className="flex items-center flex-wrap gap-2 border-t border-slate-800/80 pt-2.5">
                <span className="text-xs font-semibold text-slate-300 mr-1">Rules:</span>
                {!hr.balancedDice && !hr.hiddenBank && !hr.freeTrades ? (
                  <span className="text-xs font-bold bg-slate-800 text-slate-300 px-2.5 py-0.5 rounded-full">
                    Standard Official Rules
                  </span>
                ) : (
                  <>
                    {hr.balancedDice && (
                      <span className="text-xs font-bold bg-indigo-950 text-indigo-300 border border-indigo-700 px-2.5 py-0.5 rounded-full">
                        🎲 Balanced Dice (36-Deck)
                      </span>
                    )}
                    {hr.hiddenBank && (
                      <span className="text-xs font-bold bg-amber-950 text-amber-300 border border-amber-700 px-2.5 py-0.5 rounded-full">
                        🔒 Hidden Bank
                      </span>
                    )}
                    {hr.freeTrades && (
                      <span className="text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 px-2.5 py-0.5 rounded-full">
                        🎁 Free Trades Allowed
                      </span>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Custom Player Name & Color Picker */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-950/75 p-4 rounded-2xl border border-slate-800">
              <form onSubmit={handleSaveLobbyName} className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <User className="w-3.5 h-3.5 text-amber-400" /> Your In-Game Name
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={playerName}
                    onChange={(e) => setPlayerName(e.target.value)}
                    maxLength={20}
                    placeholder="Custom player name..."
                    className="flex-1 min-w-0 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="submit"
                    className="px-3 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer shrink-0"
                  >
                    {lobbyNameSaved ? 'Saved ✓' : 'Update'}
                  </button>
                </div>
              </form>

              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-bold text-slate-300">
                  Your Color <span className="text-slate-500 font-normal">(Unique)</span>
                </span>
                <div className="grid grid-cols-6 gap-1.5">
                  {COLORS.map((c) => {
                    const isMine = myPlayer?.color === c.id;
                    const isTaken = takenColorsByOthers.has(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={isTaken}
                        onClick={() => !isTaken && changeColor(c.id)}
                        style={{ backgroundColor: c.hex }}
                        title={isTaken ? `${c.name} is already taken` : `Select ${c.name}`}
                        className={`h-9 rounded-xl flex items-center justify-center transition border-2 ${
                          isMine
                            ? 'border-amber-400 scale-105 shadow-lg'
                            : isTaken
                              ? 'border-slate-800 opacity-25 cursor-not-allowed'
                              : 'border-transparent opacity-80 hover:opacity-100 cursor-pointer'
                        }`}
                      >
                        {isMine && (
                          <Check
                            className={`w-4 h-4 drop-shadow ${
                              c.id === 'white' ? 'text-slate-950' : 'text-white'
                            }`}
                          />
                        )}
                        {isTaken && (
                          <Lock
                            className={`w-3.5 h-3.5 ${
                              c.id === 'white' ? 'text-slate-900' : 'text-white'
                            }`}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Players List with Host Kick Controls */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
                <span>Joined Settlers ({playerCount}/{maxPlayers}) • Turn Order Randomized on Start</span>
                <span>{isHost ? 'Host can kick stale players' : 'Need ≥ 2 to start'}</span>
              </div>
              <div className="grid grid-cols-1 gap-2 max-h-[210px] overflow-y-auto pr-1">
                {Object.values(room.players).map((p) => {
                  const isMe = p.id === myPlayerId;
                  const isHostPlayer = p.id === room.hostPlayerId;
                  const col = COLORS.find((c) => c.id === p.color);
                  return (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between p-3 rounded-2xl border ${
                        isMe ? 'bg-slate-800/80 border-amber-500/60' : 'bg-slate-950/80 border-slate-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className="w-4 h-4 rounded-full border border-white/40 shadow"
                          style={{ backgroundColor: col?.hex || '#ff1a1a' }}
                        />
                        <span className="text-base font-bold text-white">
                          {p.name} {isMe && '(You)'}
                        </span>
                        {!p.connected && (
                          <span className="text-xs font-bold bg-rose-950 text-rose-300 border border-rose-700 px-2 py-0.5 rounded-full">
                            Offline
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-400 capitalize">{p.color}</span>
                        {isHostPlayer && (
                          <span className="text-xs font-bold text-amber-400 bg-amber-950/80 border border-amber-800 px-2.5 py-0.5 rounded-full">
                            Host
                          </span>
                        )}
                        {isHost && !isMe && (
                          <button
                            type="button"
                            onClick={() => kickPlayer(p.id)}
                            title={`Kick ${p.name} from lobby`}
                            className="flex items-center gap-1 px-3 py-1 bg-rose-950/90 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-700/80 rounded-xl text-xs font-bold transition cursor-pointer"
                          >
                            <UserMinus className="w-3.5 h-3.5" /> Kick
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Start Button */}
            {isHost ? (
              <button
                type="button"
                onClick={startGame}
                disabled={!canStart}
                className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 font-black text-base text-slate-950 rounded-2xl shadow-xl transition flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-slate-950" /> Start Game ({playerCount}/{maxPlayers})
              </button>
            ) : (
              <div className="text-center text-sm font-semibold text-slate-400 animate-pulse py-2">
                Waiting for Host to start the game...
              </div>
            )}
          </div>

          {/* Right Column (6 cols): Large Selected Match Board Preview & Randomize */}
          <div className="lg:col-span-6 flex flex-col justify-between bg-slate-950/85 border border-slate-800 rounded-2xl p-5 gap-3">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-sm font-black text-amber-400 uppercase tracking-wider block">
                  Selected Match Board
                </span>
                <span className="text-xs text-slate-400">
                  This exact board layout will be used when the match starts.
                </span>
              </div>
              {isHost && (
                <button
                  type="button"
                  onClick={randomizeLobbyBoard}
                  className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm rounded-xl shadow transition cursor-pointer shrink-0"
                >
                  <Shuffle className="w-4 h-4" /> Randomize Board
                </button>
              )}
            </div>

            <div className="flex-1 min-h-[380px] lg:min-h-[470px]">
              {room.previewBoard && <BoardPreview board={room.previewBoard} />}
            </div>

            <div className="text-xs text-slate-400 text-center font-medium">
              No adjacent red 6/8 tokens • Verified balanced harbor placement
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Main Home Lobby (Wide 12-column layout: Left 7 cols Settings & Ongoing Lobbies + Right 5 cols Large Board Preview)
  return (
    <div
      className="min-h-screen flex items-center justify-center p-3 sm:p-6 bg-cover bg-center bg-no-repeat relative overflow-y-auto"
      style={{ backgroundImage: "url('/assets/backgrounds/bg.jpg')" }}
    >
      <div className="absolute inset-0 bg-slate-950/65 backdrop-blur-[3px]" />

      <div className="relative z-10 max-w-[1460px] w-full grid grid-cols-1 lg:grid-cols-12 gap-5 my-auto">
        {/* Left Column (7 cols): Game Setup Settings + Ongoing Lobbies */}
        <div className="lg:col-span-7 bg-slate-900/92 border border-slate-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-2xl flex flex-col justify-between gap-5">
          {/* Top Bar: Title + Authenticated Google User Profile */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
            <div>
              <span className="text-xs font-bold text-amber-400 tracking-widest uppercase flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" /> Official 6th Edition Rules
              </span>
              <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">CATAN ONLINE</h1>
            </div>

            {/* Signed-in Google Account Badge */}
            <div className="flex items-center gap-3 bg-slate-950/90 border border-slate-800 px-3.5 py-2 rounded-2xl">
              {authUser.picture ? (
                <img
                  src={authUser.picture}
                  alt={authUser.name}
                  className="w-8 h-8 rounded-full border border-amber-400/70"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-amber-500 text-slate-950 font-black text-sm flex items-center justify-center">
                  {authUser.name.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col text-left">
                <span className="text-xs font-bold text-slate-300 leading-tight">
                  Google: <strong className="text-white">{authUser.name}</strong>
                </span>
                <span className="text-[11px] text-slate-400 leading-tight">{authUser.email}</span>
              </div>
              <button
                type="button"
                onClick={logout}
                title="Sign Out"
                className="ml-1 p-2 text-slate-400 hover:text-rose-300 hover:bg-slate-800 rounded-xl transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="bg-rose-950/80 border border-rose-700 text-rose-200 p-3 rounded-xl text-sm text-center font-semibold">
              {errorMessage}
            </div>
          )}

          {/* Side-by-Side Inner Grid: Left Settings/Sliders (7 cols) + Right Ongoing Lobbies (5 cols) */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
            {/* Settings & Sliders Column (7 of 12) */}
            <div className="md:col-span-7 flex flex-col gap-3.5">
              {/* Custom In-Game Player Display Name Input */}
              <div className="flex flex-col gap-1.5 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-bold text-white flex items-center gap-1.5">
                    <User className="w-4 h-4 text-amber-400" /> Player Display Name
                  </label>
                  <span className="text-[11px] text-slate-400">Can differ from Google name</span>
                </div>
                <input
                  type="text"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  maxLength={20}
                  placeholder="Enter your in-game nickname..."
                  className="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm font-bold text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              {/* Preferred Color & 5-6P Expansion */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5 bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                  <label className="text-xs font-bold text-slate-300">Preferred Color</label>
                  <div className="grid grid-cols-6 gap-1.5">
                    {COLORS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedColor(c.id)}
                        style={{ backgroundColor: c.hex }}
                        className={`h-9 rounded-xl flex items-center justify-center transition border-2 cursor-pointer ${
                          selectedColor === c.id
                            ? 'border-amber-400 scale-105 shadow-lg'
                            : 'border-transparent opacity-75 hover:opacity-100'
                        }`}
                      >
                        {selectedColor === c.id && (
                          <Check
                            className={`w-4 h-4 drop-shadow ${
                              c.id === 'white' ? 'text-slate-950' : 'text-white'
                            }`}
                          />
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                  <div>
                    <span className="text-sm font-bold text-white block">5–6 Player Board</span>
                    <span className="text-xs text-slate-400">30 Hexes • Paired Turns</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={is5to6}
                    onChange={(e) => setIs5to6(e.target.checked)}
                    className="w-5 h-5 accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Victory Points Slider */}
              <div className="flex flex-col justify-between bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-amber-400" /> Victory Points to Win
                  </span>
                  <span className="text-sm font-black text-amber-400 bg-amber-950/90 border border-amber-700 px-2.5 py-0.5 rounded-lg">
                    {victoryPointsToWin} VP
                  </span>
                </div>
                <input
                  type="range"
                  min={5}
                  max={18}
                  value={victoryPointsToWin}
                  onChange={(e) => setVictoryPointsToWin(Number(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer my-1.5"
                />
                <div className="flex justify-between text-[11px] text-slate-400 font-semibold">
                  <span>5 (Fast)</span>
                  <span>10 (Standard)</span>
                  <span>18 (Epic)</span>
                </div>
              </div>

              {/* Variable Turn Timer Sliders (Default 180s = 3m, Max 300s = 5m) */}
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-sky-400" /> Turn Timers
                  </span>
                  <span className="text-xs text-slate-400">Default 3m • Up to 5m</span>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                  <div className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-semibold">Main Turn:</span>
                      <span className="text-amber-400 font-black">{formatTurnDuration(turnTimeoutSeconds)}</span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={300}
                      step={15}
                      value={turnTimeoutSeconds}
                      onChange={(e) => setTurnTimeoutSeconds(Number(e.target.value))}
                      className="w-full accent-sky-400 cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-semibold">Robber & Dev:</span>
                      <span className="text-rose-400 font-black">{robberTimeoutSeconds}s</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      step={5}
                      value={robberTimeoutSeconds}
                      onChange={(e) => setRobberTimeoutSeconds(Number(e.target.value))}
                      className="w-full accent-rose-400 cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-semibold">Dice Roll:</span>
                      <span className="text-emerald-400 font-black">{rollTimeoutSeconds}s</span>
                    </div>
                    <input
                      type="range"
                      min={5}
                      max={60}
                      step={5}
                      value={rollTimeoutSeconds}
                      onChange={(e) => setRollTimeoutSeconds(Number(e.target.value))}
                      className="w-full accent-emerald-400 cursor-pointer"
                    />
                  </div>

                  <div className="flex flex-col gap-0.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-300 font-semibold">Setup Turn:</span>
                      <span className="text-indigo-400 font-black">{setupTimeoutSeconds}s</span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={120}
                      step={5}
                      value={setupTimeoutSeconds}
                      onChange={(e) => setSetupTimeoutSeconds(Number(e.target.value))}
                      className="w-full accent-indigo-400 cursor-pointer"
                    />
                  </div>
                </div>
              </div>

              {/* Configurable House Rules */}
              <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Sliders className="w-4 h-4 text-amber-400" /> Optional House Rules
                  </span>
                  <span className="text-xs text-slate-400">Standard rules off by default</span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <label className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 cursor-pointer hover:border-slate-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-indigo-300">Balanced Dice</span>
                      <input
                        type="checkbox"
                        checked={houseRules.balancedDice}
                        onChange={(e) =>
                          setHouseRules((prev) => ({ ...prev, balancedDice: e.target.checked }))
                        }
                        className="w-4 h-4 accent-indigo-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] text-slate-400 leading-tight">
                      36-pair deck without replacement
                    </span>
                  </label>

                  <label className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 cursor-pointer hover:border-slate-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-amber-300">Hidden Bank</span>
                      <input
                        type="checkbox"
                        checked={houseRules.hiddenBank}
                        onChange={(e) =>
                          setHouseRules((prev) => ({ ...prev, hiddenBank: e.target.checked }))
                        }
                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] text-slate-400 leading-tight">
                      Hide bank resource card counts
                    </span>
                  </label>

                  <label className="flex flex-col justify-between p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 cursor-pointer hover:border-slate-700">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-bold text-emerald-300">Free Trades</span>
                      <input
                        type="checkbox"
                        checked={houseRules.freeTrades}
                        onChange={(e) =>
                          setHouseRules((prev) => ({ ...prev, freeTrades: e.target.checked }))
                        }
                        className="w-4 h-4 accent-emerald-500 cursor-pointer"
                      />
                    </div>
                    <span className="text-[11px] text-slate-400 leading-tight">
                      Allow one-sided gift trades
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Ongoing Lobbies Column (Switched into the 5-col slot where small board preview used to be!) */}
            <div className="md:col-span-5 bg-slate-950 p-4 rounded-2xl border border-slate-800 flex flex-col justify-between gap-3">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" />
                    <h2 className="text-sm font-black text-white uppercase tracking-wider">
                      Ongoing Lobbies ({publicRooms.length})
                    </h2>
                  </div>
                  <button
                    type="button"
                    onClick={refreshRooms}
                    title="Refresh Lobbies"
                    className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {publicRooms.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-4 bg-slate-900/70 rounded-2xl border border-slate-800/80">
                    <Users className="w-9 h-9 text-slate-600 mb-2" />
                    <span className="text-sm font-bold text-slate-300">No Active Lobbies Right Now</span>
                    <span className="text-xs text-slate-500 mt-1">
                      Create a new game and it will appear here immediately for others to join!
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {publicRooms.map((r) => {
                      const isWaiting = r.status === 'waiting' && r.playerCount < r.maxPlayers;
                      const timeRef = r.status === 'in_progress' ? r.startedAt || r.createdAt : r.createdAt;
                      const hr = r.houseRules;
                      return (
                        <div
                          key={r.code}
                          className="flex items-center justify-between p-3 bg-slate-900/90 hover:bg-slate-900 rounded-2xl border border-slate-800 transition"
                        >
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-black text-sm text-amber-400">{r.code}</span>
                              <span
                                className={`text-[10px] font-bold px-2 py-0.2 rounded-full border ${
                                  r.status === 'waiting'
                                    ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                                    : 'bg-sky-950/80 border-sky-700 text-sky-300'
                                }`}
                              >
                                {r.status === 'waiting' ? 'Open Lobby' : 'In Progress'}
                              </span>
                            </div>
                            <span className="text-xs font-bold text-slate-200 truncate">
                              Host: {r.hostName}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {r.playerCount}/{r.maxPlayers} Players • {r.victoryPointsToWin} VP •{' '}
                              {r.is5to6Player ? '5–6P' : '2–4P'}
                            </span>
                            {hr && (hr.balancedDice || hr.hiddenBank || hr.freeTrades) && (
                              <div className="flex flex-wrap gap-1 mt-0.5">
                                {hr.balancedDice && (
                                  <span className="text-[9px] font-bold bg-indigo-950 text-indigo-300 px-1.5 rounded">
                                    Balanced Dice
                                  </span>
                                )}
                                {hr.hiddenBank && (
                                  <span className="text-[9px] font-bold bg-amber-950 text-amber-300 px-1.5 rounded">
                                    Hidden Bank
                                  </span>
                                )}
                                {hr.freeTrades && (
                                  <span className="text-[9px] font-bold bg-emerald-950 text-emerald-300 px-1.5 rounded">
                                    Free Trades
                                  </span>
                                )}
                              </div>
                            )}
                            <span className="text-[11px] text-sky-400 font-semibold flex items-center gap-1 mt-0.5">
                              <Clock className="w-3 h-3" />
                              {r.status === 'in_progress' ? 'Started' : 'Created'} {formatClockTime(timeRef)} (
                              {formatElapsed(timeRef, nowMs)})
                            </span>
                          </div>

                           <div className="flex items-center gap-1.5 shrink-0">
                            {r.hostPlayerId === myPlayerId && (
                              <button
                                type="button"
                                onClick={() => deleteRoom(r.code)}
                                title={`Delete your lobby (${r.code})`}
                                className="px-2.5 py-2 bg-rose-950/90 hover:bg-rose-600 text-rose-200 hover:text-white border border-rose-700/80 rounded-xl text-xs font-bold flex items-center gap-1 transition cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" /> Delete
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleJoin(r.code)}
                              className={`px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 transition shrink-0 cursor-pointer ${
                                isWaiting
                                  ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow'
                                  : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                              }`}
                            >
                              <LogIn className="w-3.5 h-3.5" /> {isWaiting ? 'Join' : 'Reconnect'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs text-slate-400 leading-relaxed">
                <strong className="text-slate-200">Tip:</strong> Disconnected from a match? Click{' '}
                <strong className="text-slate-200">Reconnect</strong> or enter your room code below.
              </div>
            </div>
          </div>

          {/* Create Room & Join by Code Row */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={handleCreate}
              className="flex-1 py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 font-black text-base text-slate-950 rounded-2xl shadow-xl transition active:scale-95 cursor-pointer"
            >
              Create Match with Selected Board ({victoryPointsToWin} VP)
            </button>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="ROOM CODE"
                maxLength={6}
                className="w-36 px-3.5 py-4 bg-slate-950 border border-slate-800 rounded-2xl text-sm font-mono font-bold text-white text-center tracking-widest focus:outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={() => handleJoin()}
                disabled={!joinCode}
                className="px-5 py-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold text-sm rounded-2xl border border-slate-700 transition cursor-pointer"
              >
                Join Code
              </button>
            </div>
          </div>
        </div>

        {/* Right Column (5 cols): Large Dedicated Match Board Preview Panel */}
        <div className="lg:col-span-5 bg-slate-900/92 border border-slate-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl backdrop-blur-2xl flex flex-col justify-between gap-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="text-sm sm:text-base font-black text-amber-400 uppercase tracking-wider block">
                Match Board Preview
              </span>
              <span className="text-xs text-slate-300 block mt-0.5">
                This exact board layout is used when you create the match
              </span>
            </div>
            <button
              type="button"
              onClick={handleRandomizePreview}
              title="Generate a new valid random board layout"
              className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-sm rounded-xl shadow-lg transition active:scale-95 cursor-pointer shrink-0"
            >
              <Shuffle className="w-4 h-4" /> Randomize Board
            </button>
          </div>

          <div className="flex-1 min-h-[440px] lg:min-h-[540px] flex items-center justify-center">
            <BoardPreview board={previewBoard} />
          </div>

          <div className="flex items-center justify-between bg-slate-950/85 px-4 py-3 rounded-2xl border border-slate-800 text-xs text-slate-300 font-semibold">
            <span>{is5to6 ? 'Expanded 30-Hex Island' : 'Standard 19-Hex Island'}</span>
            <span className="text-amber-400">✓ Zero Adjacent 6/8 Red Tokens</span>
          </div>
        </div>
      </div>
    </div>
  );
};
