import React, { useEffect } from 'react';
import { useGameStore } from './store/gameStore.js';
import { Lobby } from './components/lobby/Lobby.js';
import { Board } from './components/board/Board.js';
import { Hud } from './components/hud/Hud.js';
import { TradeDock } from './components/trade/TradeDock.js';

export function App() {
  const { initSocket, gameState, myPlayerId, room } = useGameStore();

  useEffect(() => {
    initSocket();
  }, [initSocket]);

  if (!gameState || !room) {
    return <Lobby />;
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none">
      {/* 1. Main Interactive Board */}
      <Board state={gameState} myPlayerId={myPlayerId} />

      {/* 2. Tactical Heads-Up Display (HUD) */}
      <Hud state={gameState} myPlayerId={myPlayerId} />

      {/* 3. Floating Trade Dock (Bottom-Right / Side) */}
      <div className="absolute right-4 bottom-24 z-20 max-w-sm w-full pointer-events-auto">
        <TradeDock state={gameState} myPlayerId={myPlayerId} />
      </div>

      {/* 4. Dev Multi-Seat Testing Bar */}
      <div className="absolute bottom-2 left-4 z-30 flex items-center gap-2 bg-slate-900/70 backdrop-blur-md px-3 py-1 rounded-xl border border-slate-800 text-[11px] text-slate-400">
        <span>Active Seat: <strong className="text-amber-400">{gameState.players[myPlayerId || '']?.name || 'Spectator'}</strong></span>
        <span>•</span>
        <span>Room: <strong className="text-white font-mono">{room.code}</strong></span>
      </div>
    </div>
  );
}

export default App;
