import React, { useState, useEffect } from 'react';
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
  Hammer,
  Sparkles,
  ChevronRight,
  AlertCircle,
  Clock,
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
  white: 'bg-slate-100 text-slate-900',
  green: 'bg-emerald-500',
  purple: 'bg-purple-500',
};

// Traditional die pip positions in a 3x3 grid (normalized 0..100)
const DIE_PIP_COORDS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [
    [28, 28],
    [72, 72],
  ],
  3: [
    [26, 26],
    [50, 50],
    [74, 74],
  ],
  4: [
    [28, 28],
    [72, 28],
    [28, 72],
    [72, 72],
  ],
  5: [
    [26, 26],
    [74, 26],
    [50, 50],
    [26, 74],
    [74, 74],
  ],
  6: [
    [28, 24],
    [72, 24],
    [28, 50],
    [72, 50],
    [28, 76],
    [72, 76],
  ],
};

const VisualDie: React.FC<{
  value: number;
  variant: 'red' | 'yellow';
  isRolling: boolean;
}> = ({ value, variant, isRolling }) => {
  const pips = DIE_PIP_COORDS[value] || DIE_PIP_COORDS[1];
  const bg = variant === 'red' ? '#dc2626' : '#facc15';
  const border = variant === 'red' ? '#991b1b' : '#ca8a04';
  const pipFill = variant === 'red' ? '#fef08a' : '#dc2626';

  return (
    <svg
      viewBox="0 0 100 100"
      className={`w-9 h-9 drop-shadow-md transition-transform ${
        isRolling ? 'animate-spin scale-110' : 'scale-100'
      }`}
    >
      <rect
        x="6"
        y="6"
        width="88"
        height="88"
        rx="20"
        fill={bg}
        stroke={border}
        strokeWidth="6"
      />
      {pips.map(([cx, cy], idx) => (
        <circle key={idx} cx={cx} cy={cy} r="9.5" fill={pipFill} />
      ))}
    </svg>
  );
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

  // Animated Dice state
  const [isRollingAnim, setIsRollingAnim] = useState(false);
  const [animDice, setAnimDice] = useState<[number, number]>([1, 1]);

  // Turn countdown timer state
  const [remainingMs, setRemainingMs] = useState<number>(0);

  useEffect(() => {
    if (!state.lastDiceRollAt || !state.diceRoll) return;
    // Trigger 800ms dice tumble animation whenever a new roll occurs
    setIsRollingAnim(true);
    const interval = setInterval(() => {
      setAnimDice([
        Math.floor(Math.random() * 6) + 1,
        Math.floor(Math.random() * 6) + 1,
      ]);
    }, 75);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setIsRollingAnim(false);
      if (state.diceRoll) {
        setAnimDice(state.diceRoll);
      }
    }, 800);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [state.lastDiceRollAt]);

  // Real-time countdown ticker
  useEffect(() => {
    const updateTimer = () => {
      if (!state.turnDeadlineMs) {
        setRemainingMs(0);
        return;
      }
      const diff = Math.max(0, state.turnDeadlineMs - Date.now());
      setRemainingMs(diff);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 200);
    return () => clearInterval(interval);
  }, [state.turnDeadlineMs]);

  useEffect(() => {
    if (state.winnerId) {
      confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
    }
  }, [state.winnerId]);

  const self = state.self;
  const isMyTurn =
    (state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId) ||
    (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId);

  const isRollPhase = state.phase === 'TURN_START' && state.currentTurnPlayerId === myPlayerId;
  const needsDiscard = state.phase === 'DISCARD_PHASE' && myPlayerId && state.pendingDiscards[myPlayerId];

  const activeTurnPlayerId =
    state.phase === 'SETUP_ROUND_1' || state.phase === 'SETUP_ROUND_2'
      ? state.setupTurnOrder[state.setupTurnIndex]
      : state.phase === 'PAIRED_ACTION_PHASE'
        ? state.pairedPlayerId || state.currentTurnPlayerId
        : state.currentTurnPlayerId;

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const timerProgress =
    state.phaseDurationMs > 0 ? Math.min(100, Math.max(0, (remainingMs / state.phaseDurationMs) * 100)) : 0;

  const displayedDice = isRollingAnim ? animDice : state.diceRoll;
  const diceSum = displayedDice ? displayedDice[0] + displayedDice[1] : null;

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4 z-10 overflow-hidden">
      {/* TOP ROW: Top-Left Players & VPs | Top-Center Turn, Timer & Animated Dice */}
      <div className="flex items-start justify-between gap-4 w-full">
        {/* 1. TOP-LEFT: Players & Victory Points Leaderboard */}
        <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 min-w-[250px] max-w-[300px]">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-black text-amber-400 uppercase tracking-wider">
              Players & VPs (Goal: {state.settings.victoryPointsToWin})
            </span>
            <span className="text-[10px] font-bold text-slate-400">Turn {state.turnNumber}</span>
          </div>

          <div className="flex flex-col gap-1.5">
            {Object.values(state.players).map((p) => {
              const isCurrentActive = p.id === activeTurnPlayerId;
              const isPairedP2 = state.settings.pairedPlayersTurn && p.id === state.pairedPlayerId;
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-2.5 py-2 rounded-xl border transition ${
                    isCurrentActive
                      ? 'bg-amber-500/15 border-amber-400 shadow-md'
                      : p.id === myPlayerId
                        ? 'bg-slate-800/80 border-slate-600'
                        : 'bg-slate-950/60 border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`w-3.5 h-3.5 rounded-full shrink-0 border border-white/30 ${PLAYER_BADGES[p.color]}`} />
                    <span className="text-xs font-bold text-white truncate">
                      {p.name} {p.id === myPlayerId && '(You)'}
                    </span>
                    {isCurrentActive && (
                      <span className="text-[10px] bg-amber-500 text-slate-950 font-black px-1.5 py-0.2 rounded-full">
                        TURN
                      </span>
                    )}
                    {!isCurrentActive && isPairedP2 && (
                      <span className="text-[9px] bg-indigo-950 text-indigo-300 border border-indigo-700 px-1.5 rounded-full">
                        P2
                      </span>
                    )}
                    {!p.isConnected && (
                      <span className="text-[9px] bg-rose-950 text-rose-300 px-1 rounded">DC</span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 text-xs shrink-0 ml-2">
                    {p.hasLongestRoute && (
                      <span title={`Longest Route (${p.longestRouteLength}) — 2 VPs`} className="text-amber-400 font-black">
                        🛣️
                      </span>
                    )}
                    {p.hasLargestArmy && (
                      <span title={`Largest Army (${p.playedKnightsCount}) — 2 VPs`} className="text-rose-400 font-black">
                        ⚔️
                      </span>
                    )}
                    <span title="Resource Cards" className="font-semibold text-slate-300">
                      {p.cardCount}🎴
                    </span>
                    <span className="font-black text-amber-300 bg-amber-950/80 px-2 py-0.5 rounded-lg border border-amber-700/80">
                      {p.victoryPoints} VP
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 2. TOP-CENTER: Turn Status, PlaySettlr Timer, Animated Dice & Turn Controls */}
        <div className="pointer-events-auto flex flex-col items-center gap-1.5">
          <div className="flex items-center gap-4 bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 px-5 py-2.5 rounded-2xl shadow-2xl">
            {/* Active Player & Phase Instruction */}
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full ${
                    state.players[activeTurnPlayerId]
                      ? PLAYER_BADGES[state.players[activeTurnPlayerId].color]
                      : 'bg-slate-500'
                  }`}
                />
                <span className="text-sm font-black text-white">
                  {state.players[activeTurnPlayerId]?.name || 'Player'}
                </span>
                <span className="bg-slate-800 text-amber-300 text-xs font-bold px-2.5 py-0.5 rounded-lg border border-slate-700">
                  {state.phase === 'SETUP_ROUND_1' &&
                    (state.lastSetupVertexId ? 'Setup 1: Place Connected Road' : 'Setup 1: Place Settlement')}
                  {state.phase === 'SETUP_ROUND_2' &&
                    (state.lastSetupVertexId ? 'Setup 2: Place Connected Road' : 'Setup 2: Place 2nd Settlement')}
                  {state.phase === 'TURN_START' && 'Roll Dice'}
                  {state.phase === 'DISCARD_PHASE' && '7 Rolled: Discard Half'}
                  {state.phase === 'ROBBER_PLACEMENT' && 'Move the Robber'}
                  {state.phase === 'ROBBER_STEAL' && 'Steal 1 Resource'}
                  {state.phase === 'ACTION_PHASE' &&
                    (state.freeRoadsRemaining > 0
                      ? `Place ${state.freeRoadsRemaining} Free Road(s)`
                      : 'Trade & Build Phase')}
                  {state.phase === 'PAIRED_ACTION_PHASE' && 'Paired Player 2 Action Phase'}
                  {state.phase === 'GAME_OVER' && 'Match Finished!'}
                </span>
              </div>
            </div>

            {/* Countdown Timer Pill */}
            {state.turnDeadlineMs && state.phase !== 'GAME_OVER' && (
              <div
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-mono text-xs font-black transition ${
                  remainingSeconds <= 5
                    ? 'bg-rose-950/90 border-rose-500 text-rose-300 animate-pulse'
                    : remainingSeconds <= 15
                      ? 'bg-amber-950/90 border-amber-500 text-amber-300'
                      : 'bg-slate-950/90 border-slate-800 text-slate-200'
                }`}
                title="Auto-roller / auto-pass triggers when timer reaches 0s"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>
                  {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
                </span>
              </div>
            )}

            {/* Animated Visual Dice Display */}
            {displayedDice && (
              <div className="flex items-center gap-2 bg-slate-950/90 px-3 py-1.5 rounded-xl border border-slate-800">
                <VisualDie value={displayedDice[0]} variant="red" isRolling={isRollingAnim} />
                <VisualDie value={displayedDice[1]} variant="yellow" isRolling={isRollingAnim} />
                <div className="flex flex-col items-center pl-1">
                  <span className="text-[9px] font-bold text-slate-400 uppercase leading-none">Total</span>
                  <span
                    className={`text-lg font-black leading-tight ${
                      diceSum === 6 || diceSum === 8 || diceSum === 7 ? 'text-rose-400' : 'text-white'
                    }`}
                  >
                    {isRollingAnim ? '…' : diceSum}
                  </span>
                </div>
              </div>
            )}

            {/* Roll Dice Button */}
            {isRollPhase && (
              <button
                type="button"
                onClick={() => myPlayerId && sendAction({ type: 'ROLL_DICE', playerId: myPlayerId })}
                className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs px-5 py-2.5 rounded-xl shadow-lg transition active:scale-95 animate-pulse cursor-pointer"
              >
                <Dices className="w-4 h-4" /> Roll Dice
              </button>
            )}

            {/* End Turn Button */}
            {isMyTurn && (
              <button
                type="button"
                onClick={() => myPlayerId && sendAction({ type: 'END_TURN', playerId: myPlayerId })}
                className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-5 py-2.5 rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
              >
                End Turn <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Smooth Progress Bar under Top Turn Bar */}
          {state.turnDeadlineMs && state.phase !== 'GAME_OVER' && (
            <div className="w-64 h-1.5 bg-slate-900/80 rounded-full overflow-hidden border border-slate-800">
              <div
                className={`h-full transition-all duration-200 ${
                  remainingSeconds <= 5
                    ? 'bg-rose-500'
                    : remainingSeconds <= 15
                      ? 'bg-amber-400'
                      : 'bg-emerald-500'
                }`}
                style={{ width: `${timerProgress}%` }}
              />
            </div>
          )}
        </div>

        {/* Top-Right Spacer so Zoom buttons in Board.tsx never overlap */}
        <div className="w-16 shrink-0" />
      </div>

      {/* MIDDLE FLOATING ALERTS & MODALS */}
      <div className="flex flex-col items-center gap-3">
        {errorMessage && (
          <div className="pointer-events-auto bg-rose-950/95 border-2 border-rose-500 text-rose-100 px-5 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-bold backdrop-blur-md">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={clearError}
              className="ml-2 px-1.5 py-0.5 bg-rose-900 hover:bg-rose-800 rounded text-white font-black cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Discard Dialog Modal */}
        {needsDiscard && self && (
          <div className="pointer-events-auto bg-slate-900/95 border-2 border-rose-500 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-md w-full">
            <span className="text-sm font-black text-rose-400 flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4" /> Rolled a 7! Discard {needsDiscard} Cards:
            </span>
            <div className="grid grid-cols-5 gap-2">
              {RESOURCES.map((r) => {
                const held = self.resources[r] || 0;
                const selected = discardSelection[r] || 0;
                return (
                  <div key={r} className="flex flex-col items-center bg-slate-950 p-2 rounded-xl border border-slate-800">
                    <img src={RESOURCE_ICONS[r]} className="w-9 h-12 object-cover rounded shadow mb-1" />
                    <span className="text-[10px] text-slate-400">Held: {held}</span>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <button
                        type="button"
                        onClick={() => setDiscardSelection({ ...discardSelection, [r]: Math.max(0, selected - 1) })}
                        className="w-5 h-5 bg-slate-800 hover:bg-rose-600 rounded text-xs font-bold cursor-pointer"
                      >
                        −
                      </button>
                      <span className="text-xs font-black">{selected}</span>
                      <button
                        type="button"
                        onClick={() => setDiscardSelection({ ...discardSelection, [r]: Math.min(held, selected + 1) })}
                        className="w-5 h-5 bg-slate-800 hover:bg-emerald-600 rounded text-xs font-bold cursor-pointer"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() =>
                myPlayerId &&
                sendAction({ type: 'DISCARD_CARDS', playerId: myPlayerId, resources: discardSelection })
              }
              className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 font-bold text-xs text-white rounded-xl shadow mt-1 cursor-pointer"
            >
              Confirm Discard ({Object.values(discardSelection).reduce((s, n) => s + n, 0)}/{needsDiscard})
            </button>
          </div>
        )}

        {/* Steal Target Modal */}
        {state.phase === 'ROBBER_STEAL' &&
          (state.currentTurnPlayerId === myPlayerId || state.pairedPlayerId === myPlayerId) && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-500 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3">
              <span className="text-sm font-black text-amber-300">Select Player to Steal 1 Card From:</span>
              <div className="flex gap-2">
                {state.pendingStealTargets.map((pid) => (
                  <button
                    key={pid}
                    type="button"
                    onClick={() =>
                      myPlayerId && sendAction({ type: 'STEAL_FROM_PLAYER', playerId: myPlayerId, targetPlayerId: pid })
                    }
                    className="px-4 py-2 bg-slate-800 hover:bg-amber-600 font-bold text-xs text-white rounded-xl border border-slate-700 transition cursor-pointer"
                  >
                    {state.players[pid]?.name} ({state.players[pid]?.cardCount} cards)
                  </button>
                ))}
              </div>
            </div>
          )}
      </div>

      {/* BOTTOM ROW: Left Spacer (for TradeDock) | Center Build & Hand | Right Dev Cards */}
      <div className="flex items-end justify-between gap-4 w-full">
        {/* Left placeholder space reserved for Bottom-Left TradeDock */}
        <div className="w-[440px] max-w-[40vw] shrink-0 pointer-events-none" />

        {/* Center: Build Action Buttons + Hand Resource Cards */}
        {self && (
          <div className="pointer-events-auto flex flex-col items-center gap-2 mx-auto">
            {isMyTurn && (
              <div className="flex items-center gap-1.5 bg-slate-900/95 backdrop-blur-xl p-1.5 rounded-2xl border border-slate-700/80 shadow-2xl">
                <button
                  type="button"
                  onClick={() => setBuildMode(activeBuildMode === 'road' ? 'none' : 'road')}
                  disabled={
                    (!canAfford(self.resources, BUILDING_COSTS.road) && state.freeRoadsRemaining === 0) ||
                    self.roadsLeft <= 0
                  }
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    activeBuildMode === 'road' || state.freeRoadsRemaining > 0
                      ? 'bg-amber-500 text-slate-950 shadow-lg'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-35'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" /> Road (1🪵 1🧱) [{self.roadsLeft}]
                </button>

                <button
                  type="button"
                  onClick={() => setBuildMode(activeBuildMode === 'settlement' ? 'none' : 'settlement')}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.settlement) || self.settlementsLeft <= 0}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    activeBuildMode === 'settlement'
                      ? 'bg-amber-500 text-slate-950 shadow-lg'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-35'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" /> Settlement [{self.settlementsLeft}]
                </button>

                <button
                  type="button"
                  onClick={() => setBuildMode(activeBuildMode === 'city' ? 'none' : 'city')}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.city) || self.citiesLeft <= 0}
                  className={`px-3 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                    activeBuildMode === 'city'
                      ? 'bg-amber-500 text-slate-950 shadow-lg'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-200 disabled:opacity-35'
                  }`}
                >
                  <Hammer className="w-3.5 h-3.5" /> City (2🌾 3🪨) [{self.citiesLeft}]
                </button>

                <button
                  type="button"
                  onClick={() => myPlayerId && sendAction({ type: 'BUY_DEV_CARD', playerId: myPlayerId })}
                  disabled={!canAfford(self.resources, BUILDING_COSTS.devCard) || state.devCardDeckCount <= 0}
                  className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-35 text-white rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" /> Dev Card (1🌾 1🐑 1🪨) [{state.devCardDeckCount}]
                </button>
              </div>
            )}

            {/* Resource Hand Bar */}
            <div className="flex items-center gap-2.5 bg-slate-900/95 backdrop-blur-xl px-3.5 py-2.5 rounded-2xl border border-slate-700/80 shadow-2xl">
              {RESOURCES.map((r) => {
                const count = self.resources[r] || 0;
                return (
                  <div key={r} className="relative group transition-transform hover:-translate-y-1.5">
                    <img
                      src={RESOURCE_ICONS[r]}
                      className="w-13 h-18 object-cover rounded-xl shadow-lg border border-slate-700/80"
                    />
                    <span
                      className={`absolute -top-2 -right-2 font-black text-xs px-2 py-0.5 rounded-full shadow border-2 border-slate-900 ${
                        count > 0 ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Bottom-Right: Unplayed Dev Cards */}
        <div className="min-w-[200px] flex justify-end">
          {self && self.devCards.length > 0 && (
            <div className="pointer-events-auto bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-3 shadow-2xl flex flex-col gap-2 max-w-[260px]">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                Your Dev Cards ({self.devCards.length})
              </span>
              <div className="flex flex-wrap gap-2">
                {self.devCards.map((c) => {
                  const isPlayable =
                    (isMyTurn || isRollPhase) &&
                    c.boughtTurn !== state.turnNumber &&
                    c.type !== 'victory_point' &&
                    !state.devCardPlayedThisTurn;
                  return (
                    <div key={c.id} className="relative group">
                      <img
                        src={DEV_CARD_ICONS[c.type]}
                        className="w-12 h-16 object-cover rounded-lg border border-slate-700 shadow"
                      />
                      {isPlayable && (
                        <button
                          type="button"
                          onClick={() =>
                            myPlayerId &&
                            sendAction({
                              type: 'PLAY_DEV_CARD',
                              playerId: myPlayerId,
                              cardId: c.id,
                            })
                          }
                          className="absolute inset-0 bg-slate-950/85 hover:bg-indigo-600/95 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] font-black text-white rounded-lg transition cursor-pointer"
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
    </div>
  );
};
