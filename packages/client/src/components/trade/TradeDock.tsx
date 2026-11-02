import React, { useState } from 'react';
import {
  RedactedGameState,
  ResourceCount,
  ResourceType,
  canAfford,
  BUILDING_COSTS,
} from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';
import { ArrowLeftRight, Landmark, Check, X, SlidersHorizontal, Ban } from 'lucide-react';

interface TradeDockProps {
  state: RedactedGameState;
  myPlayerId: string | null;
}

const RESOURCES: ResourceType[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'];

const RESOURCE_LABELS: Record<ResourceType, string> = {
  wood: 'Lumber',
  brick: 'Brick',
  wheat: 'Grain',
  sheep: 'Wool',
  ore: 'Ore',
};

const RESOURCE_ICONS: Record<ResourceType, string> = {
  wood: '/assets/cards/wood.png',
  brick: '/assets/cards/brick.png',
  wheat: '/assets/cards/wheat.png',
  sheep: '/assets/cards/wool.png',
  ore: '/assets/cards/ore.png',
};

export const TradeDock: React.FC<TradeDockProps> = ({ state, myPlayerId }) => {
  const { sendAction } = useGameStore();

  const [giving, setGiving] = useState<ResourceCount>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
  const [asking, setAsking] = useState<ResourceCount>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });

  // Counter offer state
  const [isCountering, setIsCountering] = useState(false);
  const [counterGiving, setCounterGiving] = useState<ResourceCount>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });
  const [counterAsking, setCounterAsking] = useState<ResourceCount>({ wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 });

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
        (state.board.buildings[harbor.vertexIds[0]] && state.board.buildings[harbor.vertexIds[0]].playerId === myPlayerId) ||
        (state.board.buildings[harbor.vertexIds[1]] && state.board.buildings[harbor.vertexIds[1]].playerId === myPlayerId);
      if (touchesMe) {
        if (harbor.type === 'generic_3_1' && best > 3) best = 3;
        if (harbor.resource === res && harbor.ratio === 2) best = 2;
      }
    }
    return best;
  };

  const handleAdjust = (tray: 'giving' | 'asking', res: ResourceType, delta: number) => {
    if (tray === 'giving') {
      const current = giving[res];
      const maxAvailable = self.resources[res] || 0;
      const next = Math.max(0, Math.min(maxAvailable, current + delta));
      setGiving({ ...giving, [res]: next });
    } else {
      const current = asking[res];
      const next = Math.max(0, current + delta);
      setAsking({ ...asking, [res]: next });
    }
  };

  const totalGiving = Object.values(giving).reduce((s, n) => s + n, 0);
  const totalAsking = Object.values(asking).reduce((s, n) => s + n, 0);

  // Quick Maritime Trade Execution
  const handleBankTrade = (givingRes: ResourceType, askingRes: ResourceType) => {
    const ratio = getMaritimeRatio(givingRes);
    sendAction({
      type: 'MARITIME_TRADE',
      playerId: myPlayerId,
      giving: givingRes,
      asking: askingRes,
      ratio,
    });
  };

  // Propose Domestic Trade
  const handleProposeTrade = () => {
    if (totalGiving === 0 || totalAsking === 0) return;
    sendAction({
      type: 'PROPOSE_TRADE',
      playerId: myPlayerId,
      giving,
      asking,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      {/* 1. Incoming Trade Offer Banner (for non-proposers) */}
      {activeTrade && activeTrade.fromPlayerId !== myPlayerId && (
        <div className="bg-gradient-to-r from-amber-950/90 via-slate-900/90 to-amber-950/90 border-2 border-amber-500/80 rounded-2xl p-4 shadow-2xl backdrop-blur-xl animate-bounce-short">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
              <ArrowLeftRight className="w-4 h-4" /> Trade Offer from {state.players[activeTrade.fromPlayerId]?.name}
            </span>
            <span className="text-xs text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-full">Domestic Trade</span>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
            <div>
              <span className="text-xs text-emerald-400 font-semibold block mb-1">They Give:</span>
              <div className="flex flex-wrap gap-1.5">
                {RESOURCES.map((res) => {
                  const count = activeTrade.giving[res] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={res} className="flex items-center gap-1 bg-emerald-950/60 border border-emerald-700/60 px-2 py-1 rounded-lg">
                      <img src={RESOURCE_ICONS[res]} className="w-4 h-5 object-cover rounded" />
                      <span className="text-xs font-bold text-emerald-200">×{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="text-xs text-amber-400 font-semibold block mb-1">They Want:</span>
              <div className="flex flex-wrap gap-1.5">
                {RESOURCES.map((res) => {
                  const count = activeTrade.asking[res] || 0;
                  if (count === 0) return null;
                  return (
                    <div key={res} className="flex items-center gap-1 bg-amber-950/60 border border-amber-700/60 px-2 py-1 rounded-lg">
                      <img src={RESOURCE_ICONS[res]} className="w-4 h-5 object-cover rounded" />
                      <span className="text-xs font-bold text-amber-200">×{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendAction({ type: 'RESPOND_TRADE', playerId: myPlayerId, tradeId: activeTrade.id, accept: true })}
              disabled={!canAfford(self.resources, activeTrade.asking)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-white font-bold text-xs rounded-xl transition shadow-lg"
            >
              <Check className="w-4 h-4" /> Accept
            </button>

            <button
              onClick={() => {
                setCounterGiving(activeTrade.asking as ResourceCount);
                setCounterAsking(activeTrade.giving as ResourceCount);
                setIsCountering(true);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition shadow-lg"
            >
              <SlidersHorizontal className="w-4 h-4" /> Counter-Offer
            </button>

            <button
              onClick={() => sendAction({ type: 'RESPOND_TRADE', playerId: myPlayerId, tradeId: activeTrade.id, accept: false })}
              className="py-2 px-3 bg-slate-800 hover:bg-rose-900/60 text-slate-300 hover:text-rose-200 font-bold text-xs rounded-xl transition border border-slate-700"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Counter-Offer Mini Drawer */}
          {isCountering && (
            <div className="mt-4 pt-3 border-t border-slate-800 flex flex-col gap-2">
              <span className="text-xs font-bold text-indigo-300">Customize Counter-Offer:</span>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-emerald-400 font-semibold block mb-1">I will give:</span>
                  <div className="grid grid-cols-5 gap-1">
                    {RESOURCES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setCounterGiving({ ...counterGiving, [r]: (counterGiving[r] || 0) + 1 })}
                        className="p-1 bg-slate-800 hover:bg-slate-700 rounded text-center"
                      >
                        <img src={RESOURCE_ICONS[r]} className="w-4 h-5 mx-auto" />
                        <span>{counterGiving[r] || 0}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <span className="text-amber-400 font-semibold block mb-1">I want instead:</span>
                  <div className="grid grid-cols-5 gap-1">
                    {RESOURCES.map((r) => (
                      <button
                        key={r}
                        onClick={() => setCounterAsking({ ...counterAsking, [r]: (counterAsking[r] || 0) + 1 })}
                        className="p-1 bg-slate-800 hover:bg-slate-700 rounded text-center"
                      >
                        <img src={RESOURCE_ICONS[r]} className="w-4 h-5 mx-auto" />
                        <span>{counterAsking[r] || 0}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 mt-2">
                <button
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
                  className="flex-1 py-1.5 bg-indigo-600 hover:bg-indigo-500 font-bold text-xs rounded-lg text-white"
                >
                  Send Counter
                </button>
                <button
                  onClick={() => setIsCountering(false)}
                  className="px-3 py-1.5 bg-slate-800 font-semibold text-xs rounded-lg text-slate-300"
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
        <div className="bg-slate-900/90 border border-amber-500/50 rounded-2xl p-4 shadow-xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-amber-300 uppercase tracking-wider">Your Active Trade Offer</span>
            <button
              onClick={() => sendAction({ type: 'CANCEL_TRADE', playerId: myPlayerId, tradeId: activeTrade.id })}
              className="text-xs text-rose-400 hover:text-rose-300 font-semibold flex items-center gap-1"
            >
              <X className="w-3.5 h-3.5" /> Cancel Offer
            </button>
          </div>

          {/* Status Matrix */}
          <div className="flex flex-wrap gap-2 mb-3">
            {Object.entries(activeTrade.status).map(([pid, status]) => (
              <div key={pid} className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800 text-xs">
                <span className="font-semibold text-slate-300">{state.players[pid]?.name}:</span>
                {status === 'pending' && <span className="text-amber-400">Thinking...</span>}
                {status === 'declined' && <span className="text-rose-400">Declined</span>}
                {status === 'accepted' && <span className="text-emerald-400 font-bold">Accepted ✓</span>}
              </div>
            ))}
          </div>

          {/* Counter-offers received */}
          {activeTrade.counterOffers.length > 0 && (
            <div className="flex flex-col gap-2 mt-2 pt-2 border-t border-slate-800">
              <span className="text-xs font-bold text-indigo-300">Counter-Offers Received:</span>
              {activeTrade.counterOffers.map((counter) => (
                <div key={counter.id} className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-indigo-900/60">
                  <div className="text-xs">
                    <span className="font-bold text-indigo-200">{state.players[counter.fromPlayerId]?.name} offers:</span>
                    <span className="text-slate-400 ml-1">
                      {Object.entries(counter.giving)
                        .filter(([_, n]) => (n || 0) > 0)
                        .map(([r, n]) => `${n} ${r}`)
                        .join(', ')}{' '}
                      for{' '}
                      {Object.entries(counter.asking)
                        .filter(([_, n]) => (n || 0) > 0)
                        .map(([r, n]) => `${n} ${r}`)
                        .join(', ')}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      sendAction({
                        type: 'ACCEPT_COUNTER_TRADE',
                        playerId: myPlayerId,
                        tradeId: activeTrade.id,
                        counterId: counter.id,
                      })
                    }
                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 font-bold text-xs text-white rounded-lg transition"
                  >
                    Accept Counter
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 3. Trade Creator Dock (When it is your turn to trade) */}
      {(isPlayer1Action || isPlayer2Action) && !activeTrade && (
        <div className="bg-slate-900/95 border border-slate-700/80 rounded-2xl p-4 shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <ArrowLeftRight className="w-4 h-4 text-amber-400" /> Trading Dock
            </span>
            {isPlayer2Action && (
              <span className="text-xs text-amber-400 bg-amber-950/60 border border-amber-800/80 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Ban className="w-3 h-3" /> Paired Turn: Bank Trades Only
              </span>
            )}
          </div>

          {/* Offer & Request Trays */}
          <div className="grid grid-cols-2 gap-3 mb-3">
            {/* I Give Tray */}
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-emerald-400 block mb-2">I Give ({totalGiving})</span>
              <div className="grid grid-cols-5 gap-1.5">
                {RESOURCES.map((r) => {
                  const held = self.resources[r] || 0;
                  const count = giving[r];
                  return (
                    <div key={r} className="flex flex-col items-center">
                      <div className="relative group">
                        <img src={RESOURCE_ICONS[r]} className="w-8 h-11 object-cover rounded shadow border border-slate-700" />
                        <span className="absolute -bottom-1 -right-1 bg-slate-900 text-[10px] font-bold px-1 rounded border border-slate-700">
                          {held}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 mt-1.5">
                        <button
                          onClick={() => handleAdjust('giving', r, -1)}
                          disabled={count === 0}
                          className="w-4 h-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-xs flex items-center justify-center font-bold"
                        >
                          −
                        </button>
                        <span className="text-xs font-bold w-3 text-center">{count}</span>
                        <button
                          onClick={() => handleAdjust('giving', r, 1)}
                          disabled={count >= held}
                          className="w-4 h-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-xs flex items-center justify-center font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* I Want Tray */}
            <div className="bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
              <span className="text-xs font-semibold text-amber-400 block mb-2">I Want ({totalAsking})</span>
              <div className="grid grid-cols-5 gap-1.5">
                {RESOURCES.map((r) => {
                  const count = asking[r];
                  return (
                    <div key={r} className="flex flex-col items-center">
                      <img src={RESOURCE_ICONS[r]} className="w-8 h-11 object-cover rounded shadow border border-slate-700" />
                      <div className="flex items-center gap-1 mt-1.5">
                        <button
                          onClick={() => handleAdjust('asking', r, -1)}
                          disabled={count === 0}
                          className="w-4 h-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-xs flex items-center justify-center font-bold"
                        >
                          −
                        </button>
                        <span className="text-xs font-bold w-3 text-center">{count}</span>
                        <button
                          onClick={() => handleAdjust('asking', r, 1)}
                          className="w-4 h-4 bg-slate-800 hover:bg-slate-700 rounded text-xs flex items-center justify-center font-bold"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center gap-2">
            {!isPlayer2Action && (
              <button
                onClick={handleProposeTrade}
                disabled={totalGiving === 0 || totalAsking === 0}
                className="flex-1 py-2 px-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 disabled:hover:bg-amber-600 text-white font-bold text-xs rounded-xl transition shadow flex items-center justify-center gap-1.5"
              >
                <ArrowLeftRight className="w-4 h-4" /> Propose to Players
              </button>
            )}

            {/* Quick Maritime Bank Rate */}
            <div className="flex items-center gap-1">
              {RESOURCES.map((r) => {
                const ratio = getMaritimeRatio(r);
                const hasCards = (self.resources[r] || 0) >= ratio;
                return (
                  <button
                    key={r}
                    onClick={() => {
                      // Find first requested resource or default to wheat
                      const firstAsked = RESOURCES.find((req) => asking[req] > 0) || 'wheat';
                      handleBankTrade(r, firstAsked);
                    }}
                    disabled={!hasCards}
                    title={`Trade ${ratio} ${r} for 1 of chosen resource`}
                    className="flex flex-col items-center p-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded-lg border border-slate-700 text-[10px] font-bold"
                  >
                    <img src={RESOURCE_ICONS[r]} className="w-4 h-5 object-cover rounded" />
                    <span className="text-amber-300">{ratio}:1</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
