import React, { useState } from 'react';
import { PlayerColor } from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';
import { Users, Copy, Check, Play, Globe, Shield, Sparkles } from 'lucide-react';

const COLORS: Array<{ id: PlayerColor; name: string; bg: string }> = [
  { id: 'red', name: 'Red', bg: 'bg-red-500' },
  { id: 'blue', name: 'Blue', bg: 'bg-blue-500' },
  { id: 'orange', name: 'Orange', bg: 'bg-orange-500' },
  { id: 'white', name: 'White', bg: 'bg-slate-200 text-slate-900' },
  { id: 'green', name: 'Green', bg: 'bg-emerald-500' },
  { id: 'purple', name: 'Purple', bg: 'bg-purple-500' },
];

export const Lobby: React.FC = () => {
  const { createRoom, joinRoom, startGame, room, myPlayerId, errorMessage } = useGameStore();

  const [name, setName] = useState(localStorage.getItem('catan_player_name') || 'Settler');
  const [selectedColor, setSelectedColor] = useState<PlayerColor>('red');
  const [is5to6, setIs5to6] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    localStorage.setItem('catan_player_name', name);
    await createRoom(name, selectedColor, is5to6);
  };

  const handleJoin = async () => {
    if (!joinCode) return;
    localStorage.setItem('catan_player_name', name);
    await joinRoom(joinCode, name, selectedColor);
  };

  const copyRoomLink = () => {
    if (!room) return;
    const url = `${window.location.origin}/?room=${room.code}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // If in a room lobby waiting for start
  if (room && !room.gameState) {
    const isHost = room.hostPlayerId === myPlayerId;
    const playerCount = Object.keys(room.players).length;
    const maxPlayers = room.is5to6Player ? 6 : 4;
    const canStart = isHost && playerCount >= 3;

    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-radial from-slate-900 to-slate-950">
        <div className="bg-slate-900/90 border border-slate-700/80 rounded-3xl p-8 max-w-lg w-full shadow-2xl backdrop-blur-2xl flex flex-col gap-6">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">Game Lobby</span>
              <h2 className="text-2xl font-black text-white">Room {room.code}</h2>
            </div>
            <button
              onClick={copyRoomLink}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs font-bold text-slate-300 transition"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              {copied ? 'Link Copied!' : 'Copy Invite Link'}
            </button>
          </div>

          {/* Mode Badge */}
          <div className="flex items-center gap-2 bg-slate-950 p-3 rounded-2xl border border-slate-800 text-xs">
            <span className="font-bold text-slate-300">Format:</span>
            <span className="text-amber-400 font-semibold">
              {room.is5to6Player ? '5-6 Players (2025 Paired Players Turn)' : '3-4 Players (Standard Base Game)'}
            </span>
          </div>

          {/* Players List */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-semibold px-1">
              <span>Joined Settlers ({playerCount}/{maxPlayers})</span>
              <span>Need $\ge 3$ to start</span>
            </div>
            <div className="grid grid-cols-1 gap-2">
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
                      <span className={`w-4 h-4 rounded-full ${col?.bg}`} />
                      <span className="text-sm font-bold text-white">{p.name} {isMe && '(You)'}</span>
                    </div>
                    {isHostPlayer && (
                      <span className="text-[10px] font-bold text-amber-400 bg-amber-950/80 border border-amber-800 px-2 py-0.5 rounded-full">
                        Host
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Start Button */}
          {isHost ? (
            <button
              onClick={startGame}
              disabled={!canStart}
              className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-40 font-black text-sm text-slate-950 rounded-2xl shadow-xl transition flex items-center justify-center gap-2 active:scale-95"
            >
              <Play className="w-5 h-5 fill-slate-950" /> Start Game ({playerCount}/{maxPlayers})
            </button>
          ) : (
            <div className="text-center text-xs font-semibold text-slate-400 animate-pulse">
              Waiting for Host to start the game...
            </div>
          )}
        </div>
      </div>
    );
  }

  // Main Home Lobby
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-radial from-slate-900 to-slate-950">
      <div className="bg-slate-900/90 border border-slate-700/80 rounded-3xl p-8 max-w-md w-full shadow-2xl backdrop-blur-2xl flex flex-col gap-6">
        {/* Title */}
        <div className="text-center flex flex-col items-center">
          <span className="text-xs font-bold text-amber-400 tracking-widest uppercase mb-1 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Official 6th Edition Rules
          </span>
          <h1 className="text-3xl font-black text-white tracking-tight">CATAN ONLINE</h1>
          <p className="text-xs text-slate-400 mt-1">Multiplayer • Counter-Trade Engine • Instant Reconnection</p>
        </div>

        {errorMessage && (
          <div className="bg-rose-950/80 border border-rose-700 text-rose-200 p-2.5 rounded-xl text-xs text-center font-semibold">
            {errorMessage}
          </div>
        )}

        {/* Player Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300">Your Nickname</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm font-semibold text-white focus:outline-none focus:border-amber-500"
            placeholder="Enter nickname..."
            maxLength={16}
          />
        </div>

        {/* Color Choice */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold text-slate-300">Player Color</label>
          <div className="grid grid-cols-6 gap-2">
            {COLORS.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedColor(c.id)}
                className={`h-9 rounded-xl flex items-center justify-center transition border-2 ${
                  selectedColor === c.id ? 'border-amber-400 scale-105 shadow' : 'border-transparent opacity-70 hover:opacity-100'
                } ${c.bg}`}
              >
                {selectedColor === c.id && <Check className="w-4 h-4 text-white drop-shadow" />}
              </button>
            ))}
          </div>
        </div>

        {/* 5-6 Player Expansion Toggle */}
        <div className="flex items-center justify-between bg-slate-950 p-3 rounded-2xl border border-slate-800">
          <div>
            <span className="text-xs font-bold text-white block">5–6 Player Expansion</span>
            <span className="text-[10px] text-slate-400">30 Hexes • 2025 Paired Players Turn</span>
          </div>
          <input
            type="checkbox"
            checked={is5to6}
            onChange={(e) => setIs5to6(e.target.checked)}
            className="w-4 h-4 accent-amber-500 cursor-pointer"
          />
        </div>

        {/* Create Room Button */}
        <button
          onClick={handleCreate}
          className="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 font-black text-sm text-slate-950 rounded-2xl shadow-xl transition active:scale-95"
        >
          Create New Game
        </button>

        {/* Or Join Room */}
        <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ROOM CODE"
            maxLength={6}
            className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono font-bold text-white text-center tracking-widest focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleJoin}
            disabled={!joinCode}
            className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 font-bold text-xs rounded-xl border border-slate-700 transition"
          >
            Join
          </button>
        </div>
      </div>
    </div>
  );
};
