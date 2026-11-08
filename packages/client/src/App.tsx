import React, { useEffect } from 'react';
import { useGameStore } from './store/gameStore.js';
import { Lobby } from './components/lobby/Lobby.js';
import { Board } from './components/board/Board.js';
import { Hud } from './components/hud/Hud.js';
import { TradeDock } from './components/trade/TradeDock.js';

export function App() {
  const { checkAuth, gameState, myPlayerId, room } = useGameStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (!gameState || !room) {
    return <Lobby />;
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-slate-950 font-sans select-none">
      {/* 1. Main Interactive Board */}
      <Board state={gameState} myPlayerId={myPlayerId} />

      {/* 2. Tactical Heads-Up Display (HUD) */}
      <Hud state={gameState} myPlayerId={myPlayerId} />

      {/* 3. Expanded Trading Dock at Bottom Left of Board Area (avoids overlapping Left Sidebar & Bottom-Right Hand) */}
      <div className="absolute left-3 lg:left-[322px] bottom-3 z-30 pointer-events-auto">
        <TradeDock state={gameState} myPlayerId={myPlayerId} />
      </div>
    </div>
  );
}

export default App;
