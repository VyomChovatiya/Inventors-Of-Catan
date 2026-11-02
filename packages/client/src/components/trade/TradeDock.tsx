import React, { useState } from 'react';
import {
  RedactedGameState,
  ResourceCount,
  ResourceType,
  canAfford,
} from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';
import {
  ArrowLeftRight,
  Check,
  X,
  SlidersHorizontal,
  Ban,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from 'lucide-react';

interface TradeDockProps {
  state: RedactedGameState;
  myPlayerId: string | null;
}

const RESOURCES: ResourceType[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'];

const RESOURCE_LABELS: Record<ResourceType, string> = {
  wood: 'Wood',
  brick: 'Brick',
  wheat: 'Wheat',
  sheep: 'Sheep',
  ore: 'Ore',
};

const RESOURCE_ICONS: Record<ResourceType, string> = {
  wood: '/assets/cards/wood.png',
  brick: '/assets/cards/brick.png',
  wheat: '/assets/cards/wheat.png',
  sheep: '/assets/cards/wool.png',
  ore: '/assets/cards/ore.png',
};

const EMPTY_COUNT: ResourceCount = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };

export const TradeDock: React.FC<TradeDockProps> = ({ state, myPlayerId }) => {
  const { sendAction } = useGameStore();

  const [isMinimized, setIsMinimized] = useState(false);
  const [giving, setGiving] = useState<ResourceCount>({ ...EMPTY_COUNT });
  const [asking, setAsking] = useState<ResourceCount>({ ...EMPTY_COUNT });

  // Counter offer state
  const [isCountering, setIsCountering] = useState(false);
  const [counterGiving, setCounterGiving] = useState<ResourceCount>({ ...EMPTY_COUNT });
  const [counterAsking, setCounterAsking] = useState<ResourceCount>({ ...EMPTY_COUNT });

  if (!myPlayerId) return null;
  const self = state.self;
  if (!self) return null;

  const isPlayer1Action = state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId;
  const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId;
  const activeTrade = state.activeTradeOffer;

  // Compute best Maritime bank ratio for each resource
  const getMaritimeRatio = (res: ResourceType) => {
    let best = 4;
    for (const harbor of Object.values(state.board.harbors)) {
      const touchesMe =
        (state.board.buildings[harbor.vertexIds[0]] &&
          state.board.buildings[harbor.vertexIds[0]].playerId === myPlayerId) ||
        (state.board.buildings[harbor.vertexIds[1]] &&
          state.board.buildings[harbor.vertexIds[1]].playerId === myPlayerId);
      if (touchesMe) {
        if (harbor.type === 'generic_3_1' && best > 3) best = 3;
        if (harbor.resource === res && harbor.ratio === 2) best = 2;
      }
    }
    return best;
  };

  const handleAdjust = (tray: 'giving' | 'asking', res: ResourceType, delta: number) => {
    if (tray === 'giving') {
      const current = giving[res] || 0;
      const maxAvailable = self.resources[res] || 0;
      const next = Math.max(0, Math.min(maxAvailable, current + delta));
      setGiving((prev) => ({ ...prev, [res]: next }));
    } else {
      const current = asking[res] || 0;
      const next = Math.max(0, current + delta);
      setAsking((prev) => ({ ...prev, [res]: next }));
    }
  };

  const handleCounterAdjust = (tray: 'giving' | 'asking', res: ResourceType, delta: number) => {
    if (tray === 'giving') {
      const current = counterGiving[res] || 0;
      const maxAvailable = self.resources[res] || 0;
      const next = Math.max(0, Math.min(maxAvailable, current + delta));
      setCounterGiving((prev) => ({ ...prev, [res]: next }));
    } else {
      const current = counterAsking[res] || 0;
      const next = Math.max(0, current + delta);
      setCounterAsking((prev) => ({ ...prev, [res]: next }));
    }
  };

  const resetSelection = () => {
    setGiving({ ...EMPTY_COUNT });
    setAsking({ ...EMPTY_COUNT });
  };

  const totalGiving = Object.values(giving).reduce((s, n) => s + n, 0);
  const totalAsking = Object.values(asking).reduce((s, n) => s + n, 0);

  // Check if current selection qualifies as a valid single Maritime Bank Trade
  const givingEntries = RESOURCES.filter((r) => giving[r] > 0);
  const askingEntries = RESOURCES.filter((r) => asking[r] > 0);
  const canMaritimeTradeSelected =
    givingEntries.length === 1 &&
    askingEntries.length === 1 &&
    givingEntries[0] !== askingEntries[0] &&
    giving[givingEntries[0]] === getMaritimeRatio(givingEntries[0]) &&
    asking[askingEntries[0]] === 1;

  const handleBankTrade = (givingRes: ResourceType, askingRes: ResourceType) => {
    const ratio = getMaritimeRatio(givingRes);
    sendAction({
      type: 'MARITIME_TRADE',
      playerId: myPlayerId,
      giving: givingRes,
      asking: askingRes,
      ratio,
    });
    resetSelection();
  };

  const handleProposeTrade = () => {
    if (totalGiving === 0 || totalAsking === 0) return;
    sendAction({
      type: 'PROPOSE_TRADE',
      playerId: myPlayerId,
      giving,
      asking,
    });
    resetSelection();
  };

  return (
    <div className="pointer-events-auto flex flex-col gap-3 w-[440px] max-w-[92vw]">
      {/* 1. Incoming Trade Offer Banner (for non-proposers) */}
      {activeTrade && activeTrade.fromPlayerId !== myPlayerId && (
        <div className="bg-slate-900/95 border-2 border-amber-500 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-black text-amber-300 flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4" />
              {state.players[activeTrade.fromPlayerId]?.name} Wants to Trade
            </span>
            <span className="text-[11px] font-semibold text-slate-300 bg-slate-800 px-2.5 py-0.5 rounded-full">
              Player Offer
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 bg-slate-950/80 p-3 rounded-xl border border-slate-800">
            <div>
              <span className="text-xs text-emerald-400 font-bold block mb-1.5">You Receive:</span>
              <div className="flex flex-wrap gap-1.5">
                {RESOURCES.map((res) => {
                  const count = activeTrade.giving[res] || 0;
                  if (count === 0) return null;
                  return (
                    <div
                      key={res}
                      className="flex items-center gap-1.5 bg-emerald-950/70 border border-emerald-600/60 px-2.5 py-1 rounded-lg"
                    >
                      <img src={RESOURCE_ICONS[res]} className="w-5 h-7 object-cover rounded" />
                      <span className="text-xs font-black text-emerald-200">×{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="text-xs text-amber-400 font-bold block mb-1.5">They Ask For:</span>
              <div className="flex flex-wrap gap-1.5">
                {RESOURCES.map((res) => {
                  const count = activeTrade.asking[res] || 0;
                  if (count === 0) return null;
                  return (
                    <div
                      key={res}
                      className="flex items-center gap-1.5 bg-amber-950/70 border border-amber-600/60 px-2.5 py-1 rounded-lg"
                    >
                      <img src={RESOURCE_ICONS[res]} className="w-5 h-7 object-cover rounded" />
                      <span className="text-xs font-black text-amber-200">×{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                sendAction({ type: 'RESPOND_TRADE', playerId: myPlayerId, tradeId: activeTrade.id, accept: true })
              }
              disabled={!canAfford(self.resources, activeTrade.asking)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition shadow-lg cursor-pointer"
            >
              <Check className="w-4 h-4" /> Accept Deal
            </button>

            <button
              type="button"
              onClick={() => {
                setCounterGiving({
                  wood: activeTrade.asking.wood || 0,
                  brick: activeTrade.asking.brick || 0,
                  wheat: activeTrade.asking.wheat || 0,
                  sheep: activeTrade.asking.sheep || 0,
                  ore: activeTrade.asking.ore || 0,
                });
                setCounterAsking({
                  wood: activeTrade.giving.wood || 0,
                  brick: activeTrade.giving.brick || 0,
                  wheat: activeTrade.giving.wheat || 0,
                  sheep: activeTrade.giving.sheep || 0,
                  ore: activeTrade.giving.ore || 0,
                });
                setIsCountering((prev) => !prev);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition shadow-lg cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" /> Counter-Offer
            </button>

            <button
              type="button"
              onClick={() =>
                sendAction({ type: 'RESPOND_TRADE', playerId: myPlayerId, tradeId: activeTrade.id, accept: false })
              }
              className="py-2.5 px-3 bg-slate-800 hover:bg-rose-900/70 text-slate-300 hover:text-rose-200 font-bold text-xs rounded-xl transition border border-slate-700 cursor-pointer"
            >
              <X className="w-4 h-4" /> Decline
            </button>
          </div>

          {/* Spacious Counter-Offer Drawer */}
          {isCountering && (
            <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-3">
              <span className="text-xs font-bold text-indigo-300">Customize Your Counter-Offer:</span>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-emerald-400 block mb-2">I Will Give:</span>
                <div className="grid grid-cols-5 gap-2">
                  {RESOURCES.map((r) => {
                    const held = self.resources[r] || 0;
                    const val = counterGiving[r] || 0;
                    return (
                      <div key={r} className="flex flex-col items-center bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                        <img src={RESOURCE_ICONS[r]} className="w-7 h-9 object-cover rounded mb-1" />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('giving', r, -1)}
                            disabled={val === 0}
                            className="w-5 h-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-xs font-bold flex items-center justify-center cursor-pointer"
                          >
                            −
                          </button>
                          <span className="text-xs font-black w-4 text-center">{val}</span>
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('giving', r, 1)}
                            disabled={val >= held}
                            className="w-5 h-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-xs font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-amber-400 block mb-2">I Want Instead:</span>
                <div className="grid grid-cols-5 gap-2">
                  {RESOURCES.map((r) => {
                    const val = counterAsking[r] || 0;
                    return (
                      <div key={r} className="flex flex-col items-center bg-slate-900 p-1.5 rounded-lg border border-slate-800">
                        <img src={RESOURCE_ICONS[r]} className="w-7 h-9 object-cover rounded mb-1" />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('asking', r, -1)}
                            disabled={val === 0}
                            className="w-5 h-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-xs font-bold flex items-center justify-center cursor-pointer"
                          >
                            −
                          </button>
                          <span className="text-xs font-black w-4 text-center">{val}</span>
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('asking', r, 1)}
                            className="w-5 h-5 bg-slate-800 hover:bg-slate-700 rounded text-xs font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    sendAction({
                      type: 'COUNTER_TRADE',
                      playerId: myPlayerId,
                      tradeId: activeTrade.id,
                      giving: counterGiving,
                      asking: counterAsking,
                    });
                    setIsCountering(false);
                  }}
                  className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 font-bold text-xs rounded-xl text-white cursor-pointer"
                >
                  Send Counter-Offer
                </button>
                <button
                  type="button"
                  onClick={() => setIsCountering(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 font-semibold text-xs rounded-xl text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. Active Trade Offer Monitoring (for the proposer) */}
      {activeTrade && activeTrade.fromPlayerId === myPlayerId && (
        <div className="bg-slate-900/95 border-2 border-amber-500/70 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-black text-amber-300 uppercase tracking-wider">Your Active Trade Offer</span>
            <button
              type="button"
              onClick={() => sendAction({ type: 'CANCEL_TRADE', playerId: myPlayerId, tradeId: activeTrade.id })}
              className="text-xs bg-rose-950/80 hover:bg-rose-900 border border-rose-700 text-rose-200 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Cancel Offer
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(activeTrade.status).map(([pid, status]) => (
              <div
                key={pid}
                className="flex items-center gap-1.5 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800 text-xs"
              >
                <span className="font-bold text-slate-200">{state.players[pid]?.name}:</span>
                {status === 'pending' && <span className="text-amber-400 animate-pulse">Thinking...</span>}
                {status === 'declined' && <span className="text-rose-400 font-semibold">Declined ✕</span>}
                {status === 'accepted' && <span className="text-emerald-400 font-bold">Accepted ✓</span>}
              </div>
            ))}
          </div>

          {activeTrade.counterOffers.length > 0 && (
            <div className="flex flex-col gap-2 mt-2 pt-3 border-t border-slate-800">
              <span className="text-xs font-bold text-indigo-300">Counter-Offers Received:</span>
              {activeTrade.counterOffers.map((counter) => (
                <div
                  key={counter.id}
                  className="flex items-center justify-between bg-slate-950 p-3 rounded-xl border border-indigo-700/60"
                >
                  <div className="text-xs">
                    <span className="font-bold text-indigo-200 block">
                      {state.players[counter.fromPlayerId]?.name} proposes:
                    </span>
                    <span className="text-slate-300">
                      Gives{' '}
                      <strong className="text-emerald-300">
                        {Object.entries(counter.giving)
                          .filter(([_, n]) => (n || 0) > 0)
                          .map(([r, n]) => `${n} ${RESOURCE_LABELS[r as ResourceType]}`)
                          .join(', ')}
                      </strong>{' '}
                      for your{' '}
                      <strong className="text-amber-300">
                        {Object.entries(counter.asking)
                          .filter(([_, n]) => (n || 0) > 0)
                          .map(([r, n]) => `${n} ${RESOURCE_LABELS[r as ResourceType]}`)
                          .join(', ')}
                      </strong>
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      sendAction({
                        type: 'ACCEPT_COUNTER_TRADE',
                        playerId: myPlayerId,
                        tradeId: activeTrade.id,
                        counterId: counter.id,
                      })
                    }
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white rounded-xl transition cursor-pointer shrink-0 ml-2"
                  >
                    Accept Counter
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Main Expanded Trading Dock (Bottom Left) */}
      {(isPlayer1Action || isPlayer2Action) && !activeTrade && (
        <div className="bg-slate-900/95 border border-slate-700/90 rounded-2xl shadow-2xl backdrop-blur-xl overflow-hidden">
          {/* Header with Collapse Toggle & Reset */}
          <div className="flex items-center justify-between px-4 py-3 bg-slate-950/60 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black text-white uppercase tracking-wider">Trading Dock</span>
              {isPlayer2Action && (
                <span className="text-[10px] text-amber-300 bg-amber-950/80 border border-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Ban className="w-3 h-3" /> Bank Only
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {(totalGiving > 0 || totalAsking > 0) && (
                <button
                  type="button"
                  onClick={resetSelection}
                  title="Reset selection"
                  className="text-xs text-slate-400 hover:text-white flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Reset
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsMinimized((m) => !m)}
                className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {!isMinimized && (
            <div className="p-4 flex flex-col gap-3">
              {/* Row 1: I GIVE */}
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-emerald-400">
                    I Give ({totalGiving}) <span className="text-slate-500 font-normal">— click card or + / −</span>
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {RESOURCES.map((r) => {
                    const held = self.resources[r] || 0;
                    const count = giving[r] || 0;
                    const ratio = getMaritimeRatio(r);
                    return (
                      <div
                        key={r}
                        className={`flex flex-col items-center p-1.5 rounded-xl border transition ${
                          count > 0
                            ? 'bg-emerald-950/40 border-emerald-500/70'
                            : 'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleAdjust('giving', r, 1)}
                          disabled={count >= held}
                          className="relative group cursor-pointer disabled:opacity-40"
                          title={`Click to add ${RESOURCE_LABELS[r]} (Port rate: ${ratio}:1)`}
                        >
                          <img
                            src={RESOURCE_ICONS[r]}
                            className="w-10 h-13 object-cover rounded-lg shadow border border-slate-700"
                          />
                          <span className="absolute -top-1.5 -right-1.5 bg-slate-900 text-[10px] font-black text-slate-200 px-1.5 py-0.2 rounded-full border border-slate-600">
                            {held}
                          </span>
                          <span className="absolute bottom-0.5 left-0.5 bg-slate-950/85 text-[9px] font-bold text-amber-300 px-1 rounded">
                            {ratio}:1
                          </span>
                        </button>

                        {/* Large, non-overlapping - / count / + controls */}
                        <div className="flex items-center justify-between w-full mt-2 px-0.5">
                          <button
                            type="button"
                            onClick={() => handleAdjust('giving', r, -1)}
                            disabled={count === 0}
                            className="w-6 h-6 bg-slate-800 hover:bg-rose-600 disabled:opacity-25 text-white rounded-lg text-sm font-black flex items-center justify-center transition cursor-pointer shadow"
                          >
                            −
                          </button>
                          <span className="text-xs font-black text-white">{count}</span>
                          <button
                            type="button"
                            onClick={() => handleAdjust('giving', r, 1)}
                            disabled={count >= held}
                            className="w-6 h-6 bg-slate-800 hover:bg-emerald-600 disabled:opacity-25 text-white rounded-lg text-sm font-black flex items-center justify-center transition cursor-pointer shadow"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Row 2: I WANT */}
              <div className="bg-slate-950/80 p-3 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-amber-400">
                    I Want ({totalAsking}) <span className="text-slate-500 font-normal">— click card or + / −</span>
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2">
                  {RESOURCES.map((r) => {
                    const count = asking[r] || 0;
                    return (
                      <div
                        key={r}
                        className={`flex flex-col items-center p-1.5 rounded-xl border transition ${
                          count > 0
                            ? 'bg-amber-950/40 border-amber-500/70'
                            : 'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleAdjust('asking', r, 1)}
                          className="relative group cursor-pointer"
                          title={`Click to request ${RESOURCE_LABELS[r]}`}
                        >
                          <img
                            src={RESOURCE_ICONS[r]}
                            className="w-10 h-13 object-cover rounded-lg shadow border border-slate-700"
                          />
                        </button>

                        <div className="flex items-center justify-between w-full mt-2 px-0.5">
                          <button
                            type="button"
                            onClick={() => handleAdjust('asking', r, -1)}
                            disabled={count === 0}
                            className="w-6 h-6 bg-slate-800 hover:bg-rose-600 disabled:opacity-25 text-white rounded-lg text-sm font-black flex items-center justify-center transition cursor-pointer shadow"
                          >
                            −
                          </button>
                          <span className="text-xs font-black text-white">{count}</span>
                          <button
                            type="button"
                            onClick={() => handleAdjust('asking', r, 1)}
                            className="w-6 h-6 bg-slate-800 hover:bg-amber-500 text-white rounded-lg text-sm font-black flex items-center justify-center transition cursor-pointer shadow"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Action Buttons Row */}
              <div className="flex items-center gap-2">
                {!isPlayer2Action && (
                  <button
                    type="button"
                    onClick={handleProposeTrade}
                    disabled={totalGiving === 0 || totalAsking === 0}
                    className="flex-1 py-2.5 px-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-35 text-slate-950 font-black text-xs rounded-xl transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ArrowLeftRight className="w-4 h-4" /> Propose to Players
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (canMaritimeTradeSelected) {
                      handleBankTrade(givingEntries[0], askingEntries[0]);
                    }
                  }}
                  disabled={!canMaritimeTradeSelected}
                  title="Select exact harbor ratio in 'I Give' (e.g. 4, 3, or 2 of one resource) and 1 resource in 'I Want'"
                  className="flex-1 py-2.5 px-4 bg-sky-600 hover:bg-sky-500 disabled:opacity-35 text-white font-black text-xs rounded-xl transition shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  ⚓ Trade with Bank
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
