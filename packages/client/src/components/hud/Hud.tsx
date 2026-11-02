import React, { useState } from 'react';
import {
  RedactedGameState,
  ResourceType,
  BUILDING_COSTS,
  canAfford,
  PlayerColor,
} from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';
import {
  Dices,
  ShieldAlert,
  Trophy,
  Hammer,
  Sparkles,
  ChevronRight,
  LogOut,
  AlertCircle,
} from 'lucide-react';
import confetti from 'canvas-confetti';

interface HudProps {
  state: RedactedGameState;
  myPlayerId: string | null;
}

const RESOURCES: ResourceType[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'];

const RESOURCE_ICONS: Record<ResourceType, string> = {
  wood: '/assets/cards/wood.png',
  brick: '/assets/cards/brick.png',
  wheat: '/assets/cards/wheat.png',
  sheep: '/assets/cards/wool.png',
  ore: '/assets/cards/ore.png',
};

const DEV_CARD_ICONS: Record<string, string> = {
  knight: '/assets/cards/knight.png',
  road_building: '/assets/cards/road_building.png',
  year_of_plenty: '/assets/cards/invention.png',
  monopoly: '/assets/cards/monopoly.png',
  victory_point: '/assets/cards/victory_point.png',
};

const PLAYER_BADGES: Record<PlayerColor, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  orange: 'bg-orange-500',
  white: 'bg-slate-200 text-slate-900',
  green: 'bg-emerald-500',
  purple: 'bg-purple-500',
};

export const Hud: React.FC<HudProps> = ({ state, myPlayerId }) => {
  const { sendAction, activeBuildMode, setBuildMode, errorMessage, clearError } = useGameStore();

  const [discardSelection, setDiscardSelection] = useState<Record<ResourceType, number>>({
    wood: 0,
    brick: 0,
    wheat: 0,
    sheep: 0,
    ore: 0,
  });

  const self = state.self;
  const isMyTurn =
    (state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId) ||
    (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId);

  const isRollPhase = state.phase === 'TURN_START' && state.currentTurnPlayerId === myPlayerId;
  const needsDiscard = state.phase === 'DISCARD_PHASE' && myPlayerId && state.pendingDiscards[myPlayerId];

  // Trigger confetti if game won
  React.useEffect(() => {
    if (state.winnerId) {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    }
  }, [state.winnerId]);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 z-10 overflow-hidden">
      {/* 1. Top Header Bar */}
      <div className="pointer-events-auto flex items-center justify-between gap-4 bg-slate-900/80 backdrop-blur-xl border border-slate-700/80 px-4 py-2.5 rounded-2xl shadow-2xl">
        {/* Phase & Turn info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Turn {state.turnNumber}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
            <div className="flex items-center gap-1.5">
              <span
                className={`w-3 h-3 rounded-full ${
                  state.players[state.currentTurnPlayerId]
                    ? PLAYER_BADGES[state.players[state.currentTurnPlayerId].color]
                    : 'bg-slate-500'
                }`}
              />
              <span className="text-sm font-black text-white">
                {state.players[state.currentTurnPlayerId]?.name || 'Player'}
              </span>
            </div>
          </div>

          {/* Phase Badge */}
          <span className="bg-slate-800 text-amber-300 text-xs font-bold px-2.5 py-1 rounded-xl border border-slate-700">
            {state.phase === 'SETUP_ROUND_1' && 'Setup: Round 1 (Forward)'}
            {state.phase === 'SETUP_ROUND_2' && 'Setup: Round 2 (Starting Resources)'}
            {state.phase === 'TURN_START' && 'Roll Dice'}
            {state.phase === 'DISCARD_PHASE' && 'Discarding on 7'}
            {state.phase === 'ROBBER_PLACEMENT' && 'Move Robber'}
            {state.phase === 'ROBBER_STEAL' && 'Select Player to Steal From'}
            {state.phase === 'ACTION_PHASE' && 'Action Phase'}
            {state.phase === 'PAIRED_ACTION_PHASE' && `Paired Turn: ${state.players[state.pairedPlayerId || '']?.name}`}
            {state.phase === 'GAME_OVER' && 'Match Complete!'}
          </span>
        </div>

        {/* Dice & Turn Control */}
        <div className="flex items-center gap-3">
          {/* Dice Result Display */}
          {state.diceRoll && (
            <div className="flex items-center gap-1.5 bg-slate-950 px-3 py-1 rounded-xl border border-slate-800">
              <Dices className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black text-white">
                {state.diceRoll[0]} + {state.diceRoll[1]} = {state.diceRoll[0] + state.diceRoll[1]}
              </span>
            </div>
          )}

          {/* Roll Dice Button */}
          {isRollPhase && (
            <button
              onClick={() => myPlayerId && sendAction({ type: 'ROLL_DICE', playerId: myPlayerId })}
              className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs px-4 py-2 rounded-xl shadow-lg transition active:scale-95 animate-pulse"
            >
              <Dices className="w-4 h-4" /> Roll Dice
            </button>
          )}

          {/* End Turn Button */}
          {isMyTurn && (
            <button
              onClick={() => myPlayerId && sendAction({ type: 'END_TURN', playerId: myPlayerId })}
              className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-4 py-2 rounded-xl shadow-lg transition active:scale-95"
            >
              End Turn <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Middle Floating Error Banner */}
      {errorMessage && (
        <div className="pointer-events-auto self-center bg-rose-950/90 border border-rose-600/80 text-rose-200 px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold backdrop-blur-md">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
          <button onClick={clearError} className="ml-2 hover:text-white font-bold">✕</button>
        </div>
      )}

      {/* 3. Discard Dialog Modal */}
      {needsDiscard && self && (
        <div className="pointer-events-auto self-center bg-slate-900/95 border-2 border-rose-500 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-md w-full">
          <span className="text-sm font-black text-rose-400 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" /> Rolled a 7! Discard {needsDiscard} Cards:
          </span>
          <div className="grid grid-cols-5 gap-2">
            {RESOURCES.map((r) => {
              const held = self.resources[r] || 0;
              const selected = discardSelection[r] || 0;
              return (
                <div key={r} className="flex flex-col items-center bg-slate-950 p-2 rounded-xl border border-slate-800">
                  <img src={RESOURCE_ICONS[r]} className="w-8 h-11 object-cover rounded shadow mb-1" />
                  <span className="text-[10px] text-slate-400">Held: {held}</span>
                  <div className="flex items-center gap-1 mt-1">
                    <button
                      onClick={() => setDiscardSelection({ ...discardSelection, [r]: Math.max(0, selected - 1) })}
                      className="w-4 h-4 bg-slate-800 rounded text-xs font-bold"
                    >
                      −
                    </button>
                    <span className="text-xs font-bold">{selected}</span>
                    <button
                      onClick={() => setDiscardSelection({ ...discardSelection, [r]: Math.min(held, selected + 1) })}
                      className="w-4 h-4 bg-slate-800 rounded text-xs font-bold"
                    >
                      +
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            onClick={() =>
              myPlayerId &&
              sendAction({ type: 'DISCARD_CARDS', playerId: myPlayerId, resources: discardSelection })
            }
            className="w-full py-2 bg-rose-600 hover:bg-rose-500 font-bold text-xs text-white rounded-xl shadow mt-2"
          >
            Submit Discard ({Object.values(discardSelection).reduce((s, n) => s + n, 0)}/{needsDiscard})
          </button>
        </div>
      )}

      {/* 4. Steal Target Modal */}
      {state.phase === 'ROBBER_STEAL' && state.currentTurnPlayerId === myPlayerId && (
        <div className="pointer-events-auto self-center bg-slate-900/95 border-2 border-amber-500 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3">
          <span className="text-sm font-black text-amber-300">Select Player to Steal From:</span>
          <div className="flex gap-2">
            {state.pendingStealTargets.map((pid) => (
              <button
                key={pid}
                onClick={() => myPlayerId && sendAction({ type: 'STEAL_FROM_PLAYER', playerId: myPlayerId, targetPlayerId: pid })}
                className="px-4 py-2 bg-slate-800 hover:bg-amber-600 font-bold text-xs text-white rounded-xl border border-slate-700 transition"
              >
                {state.players[pid]?.name} ({state.players[pid]?.cardCount} cards)
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 5. Bottom Navigation & Hand Dock */}
      <div className="flex items-end justify-between gap-4">
        {/* Left: Players Leaderboard */}
        <div className="pointer-events-auto bg-slate-900/85 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 min-w-[220px]">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Players</span>
          {Object.values(state.players).map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between p-1.5 rounded-xl border ${
                p.id === myPlayerId ? 'bg-slate-800/80 border-amber-500/50' : 'bg-slate-950/50 border-slate-800'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${PLAYER_BADGES[p.color]}`} />
                <span className="text-xs font-bold text-white truncate max-w-[90px]">{p.name}</span>
                {!p.isConnected && (
                  <span className="text-[9px] bg-rose-950 text-rose-300 px-1 rounded">DC</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                {p.hasLongestRoute && <span title="Longest Route (2 VPs)" className="text-amber-400 font-black">🛣️</span>}
                {p.hasLargestArmy && <span title="Largest Army (2 VPs)" className="text-red-400 font-black">⚔️</span>}
                <span className="font-semibold text-slate-400">{p.cardCount}🎴</span>
                <span className="font-black text-amber-300 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-800/80">
                  {p.victoryPoints} VP
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Center: Hand Resource Cards */}
        {self && (
          <div className="pointer-events-auto flex flex-col items-center gap-2">
            {/* Build Action Buttons */}
            {isMyTurn && (
              <div className="flex items-center gap-1.5 bg-slate-900/90 backdrop-blur-xl p-1.5 rounded-2xl border border-slate-700/80 shadow-2xl">
                <button
                  onClick={() => setBuildMode(activeBuildMode === 'road' ? 'none' : 'road')}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.road) || self.roadsLeft <= 0}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    activeBuildMode === 'road'
                      ? 'bg-amber-500 text-slate-950 shadow-lg'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" /> Road (1🪵 1🧱) [{self.roadsLeft}]
                </button>

                <button
                  onClick={() => setBuildMode(activeBuildMode === 'settlement' ? 'none' : 'settlement')}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.settlement) || self.settlementsLeft <= 0}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    activeBuildMode === 'settlement'
                      ? 'bg-amber-500 text-slate-950 shadow-lg'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" /> Settlement [{self.settlementsLeft}]
                </button>

                <button
                  onClick={() => setBuildMode(activeBuildMode === 'city' ? 'none' : 'city')}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.city) || self.citiesLeft <= 0}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 ${
                    activeBuildMode === 'city'
                      ? 'bg-amber-500 text-slate-950 shadow-lg'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-40'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" /> City (2🌾 3🪨) [{self.citiesLeft}]
                </button>

                <button
                  onClick={() => myPlayerId && sendAction({ type: 'BUY_DEV_CARD', playerId: myPlayerId })}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.devCard) || state.devCardDeckCount <= 0}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Dev Card (1🌾 1🐑 1🪨) [{state.devCardDeckCount}]
                </button>
              </div>
            )}

            {/* Hand Cards Bar */}
            <div className="flex items-center gap-2 bg-slate-900/90 backdrop-blur-xl p-2 rounded-2xl border border-slate-700/80 shadow-2xl">
              {RESOURCES.map((r) => {
                const count = self.resources[r] || 0;
                return (
                  <div key={r} className="relative group transition-transform hover:-translate-y-2">
                    <img
                      src={RESOURCE_ICONS[r]}
                      className="w-14 h-20 object-cover rounded-xl shadow-lg border border-slate-700/80"
                    />
                    <span className="absolute -top-2 -right-2 bg-amber-500 text-slate-950 font-black text-xs px-2 py-0.5 rounded-full shadow border-2 border-slate-900">
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Right: Unplayed Dev Cards */}
        {self && self.devCards.length > 0 && (
          <div className="pointer-events-auto bg-slate-900/85 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 max-w-[240px]">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Your Dev Cards ({self.devCards.length})
            </span>
            <div className="flex flex-wrap gap-2">
              {self.devCards.map((c) => {
                const isPlayable = isMyTurn && c.boughtTurn !== state.turnNumber && c.type !== 'victory_point';
                return (
                  <div key={c.id} className="relative group">
                    <img src={DEV_CARD_ICONS[c.type]} className="w-12 h-16 object-cover rounded-lg border border-slate-700 shadow" />
                    {isPlayable && (
                      <button
                        onClick={() =>
                          myPlayerId &&
                          sendAction({
                            type: 'PLAY_DEV_CARD',
                            playerId: myPlayerId,
                            cardId: c.id,
                          })
                        }
                        className="absolute inset-0 bg-slate-950/80 hover:bg-indigo-600/90 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-black text-white rounded-lg transition"
                      >
                        Play
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
