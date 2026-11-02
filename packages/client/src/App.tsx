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

      {/* 3. Expanded Trading Dock at Bottom Left */}
      <div className="absolute left-4 bottom-4 z-30 pointer-events-auto">
        <TradeDock state={gameState} myPlayerId={myPlayerId} />
      </div>

      {/* 4. Room Info Pill at Top Right */}
      <div className="absolute top-4 right-4 z-30 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md px-3.5 py-2 rounded-2xl border border-slate-700/80 text-xs text-slate-300 shadow-xl">
        <span>
          Seat: <strong className="text-amber-400">{gameState.players[myPlayerId || '']?.name || 'Spectator'}</strong>
        </span>
        <span className="text-slate-600">•</span>
        <span>
          Room: <strong className="text-white font-mono">{room.code}</strong>
        </span>
      </div>
    </div>
  );
}

export default App;
