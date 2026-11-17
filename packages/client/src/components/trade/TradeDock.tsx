import React, { useState, useEffect } from 'react';
import {
  RedactedGameState,
  ResourceType,
  CommodityType,
  TradeableCardType,
  TradePayload,
  canAffordTradePayload,
  isValidResourceType,
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
const COMMODITIES: CommodityType[] = ['cloth', 'coin', 'paper'];
const ALL_TRADEABLES: TradeableCardType[] = [...RESOURCES, ...COMMODITIES];

const TRADEABLE_LABELS: Record<TradeableCardType, string> = {
  wood: 'Wood',
  brick: 'Brick',
  wheat: 'Wheat',
  sheep: 'Sheep',
  ore: 'Ore',
  cloth: 'Cloth',
  coin: 'Coin',
  paper: 'Paper',
};

const RESOURCE_ICONS: Record<ResourceType, string> = {
  wood: '/assets/cards/wood.png',
  brick: '/assets/cards/brick.png',
  wheat: '/assets/cards/wheat.png',
  sheep: '/assets/cards/wool.png',
  ore: '/assets/cards/ore.png',
};

const COMMODITY_ICONS: Record<CommodityType, string> = {
  cloth: '/assets/cards/cloth.png',
  coin: '/assets/cards/coin.png',
  paper: '/assets/cards/paper.png',
};

const COMMODITY_META: Record<
  CommodityType,
  { emoji: string; bg: string; border: string; text: string }
> = {
  cloth: {
    emoji: '🧵',
    bg: 'bg-amber-950/90',
    border: 'border-amber-500/80',
    text: 'text-amber-300',
  },
  coin: {
    emoji: '🪙',
    bg: 'bg-sky-950/90',
    border: 'border-sky-500/80',
    text: 'text-sky-300',
  },
  paper: {
    emoji: '📜',
    bg: 'bg-emerald-950/90',
    border: 'border-emerald-500/80',
    text: 'text-emerald-300',
  },
};

const EMPTY_PAYLOAD: TradePayload = {
  wood: 0,
  brick: 0,
  wheat: 0,
  sheep: 0,
  ore: 0,
  cloth: 0,
  coin: 0,
  paper: 0,
};

const TradeCardVisual: React.FC<{
  cardType: TradeableCardType;
  size?: 'xs' | 'sm' | 'md';
}> = ({ cardType, size = 'md' }) => {
  const dims =
    size === 'xs'
      ? 'w-4 h-5 text-[11px]'
      : size === 'sm'
        ? 'w-7 h-9 text-sm'
        : 'w-8 h-11 text-base';

  if (isValidResourceType(cardType)) {
    return (
      <img
        src={RESOURCE_ICONS[cardType]}
        alt={TRADEABLE_LABELS[cardType]}
        className={`${dims} object-cover rounded shadow border border-slate-700 shrink-0`}
      />
    );
  }

  const meta = COMMODITY_META[cardType];
  return (
    <img
      src={COMMODITY_ICONS[cardType]}
      alt={TRADEABLE_LABELS[cardType]}
      className={`${dims} object-cover rounded shadow border ${meta.border} shrink-0`}
    />
  );
};

export const TradeDock: React.FC<TradeDockProps> = ({ state, myPlayerId }) => {
  const { sendAction } = useGameStore();

  const isCK = state.settings.expansion === 'cities_and_knights';
  const visibleCards: TradeableCardType[] = isCK ? ALL_TRADEABLES : RESOURCES;

  const [isMinimized, setIsMinimized] = useState(false);
  const [giving, setGiving] = useState<TradePayload>({ ...EMPTY_PAYLOAD });
  const [asking, setAsking] = useState<TradePayload>({ ...EMPTY_PAYLOAD });

  // Counter offer state
  const [isCountering, setIsCountering] = useState(false);
  const [counterGiving, setCounterGiving] = useState<TradePayload>({ ...EMPTY_PAYLOAD });
  const [counterAsking, setCounterAsking] = useState<TradePayload>({ ...EMPTY_PAYLOAD });

  const activeTrade = state.activeTradeOffer;

  // Reset stale counter-offer UI whenever the active trade offer ID changes or closes
  useEffect(() => {
    setIsCountering(false);
    setCounterGiving({ ...EMPTY_PAYLOAD });
    setCounterAsking({ ...EMPTY_PAYLOAD });
  }, [activeTrade?.id]);

  if (!myPlayerId) return null;
  const self = state.self;
  if (!self) return null;

  const isPlayer1Action = state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId;
  const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId;
  const allowFreeTrades = Boolean(state.settings?.houseRules?.freeTrades);

  const getHeldCount = (card: TradeableCardType): number => {
    if (isValidResourceType(card)) {
      return self.resources[card] || 0;
    }
    return self.commodities?.[card] || 0;
  };

  // Compute best Maritime bank ratio for each resource or commodity
  const getMaritimeRatio = (card: TradeableCardType) => {
    let best = 4;
    for (const harbor of Object.values(state.board.harbors)) {
      const touchesMe =
        (state.board.buildings[harbor.vertexIds[0]] &&
          state.board.buildings[harbor.vertexIds[0]].playerId === myPlayerId) ||
        (state.board.buildings[harbor.vertexIds[1]] &&
          state.board.buildings[harbor.vertexIds[1]].playerId === myPlayerId);
      if (touchesMe) {
        if (harbor.type === 'generic_3_1' && best > 3) best = 3;
        if (harbor.resource === card && harbor.ratio === 2) best = 2;
      }
    }

    if (isCK) {
      // Trading House (Trade Level 3): 2:1 for any commodity
      if (!isValidResourceType(card) && (self.cityImprovements?.trade || 0) >= 3) {
        best = Math.min(best, 2);
      }
      // Merchant: 2:1 for the resource produced by the Merchant's hex
      if (state.merchant?.ownerId === myPlayerId && state.merchant.resource === card) {
        best = Math.min(best, 2);
      }
      // Merchant Fleet Progress Card: 2:1 for chosen resource/commodity this turn
      if (state.merchantFleetTypes?.includes(card)) {
        best = Math.min(best, 2);
      }
    }

    return best;
  };

  const handleAdjust = (tray: 'giving' | 'asking', card: TradeableCardType, delta: number) => {
    if (tray === 'giving') {
      const current = giving[card] || 0;
      const maxAvailable = getHeldCount(card);
      const next = Math.max(0, Math.min(maxAvailable, current + delta));
      setGiving((prev) => ({ ...prev, [card]: next }));
    } else {
      const current = asking[card] || 0;
      const next = Math.max(0, current + delta);
      setAsking((prev) => ({ ...prev, [card]: next }));
    }
  };

  // Add one full harbor bundle of a card to "I Give" (e.g. +2 if 2:1, +3 if 3:1, +4 if 4:1)
  const handleAddHarborBundle = (card: TradeableCardType) => {
    const ratio = getMaritimeRatio(card);
    const current = giving[card] || 0;
    const held = getHeldCount(card);
    if (current + ratio <= held) {
      setGiving((prev) => ({ ...prev, [card]: current + ratio }));
    } else if (current < held) {
      setGiving((prev) => ({ ...prev, [card]: current + 1 }));
    }
  };

  const handleCounterAdjust = (tray: 'giving' | 'asking', card: TradeableCardType, delta: number) => {
    if (tray === 'giving') {
      const current = counterGiving[card] || 0;
      const maxAvailable = getHeldCount(card);
      const next = Math.max(0, Math.min(maxAvailable, current + delta));
      setCounterGiving((prev) => ({ ...prev, [card]: next }));
    } else {
      const current = counterAsking[card] || 0;
      const next = Math.max(0, current + delta);
      setCounterAsking((prev) => ({ ...prev, [card]: next }));
    }
  };

  const resetSelection = () => {
    setGiving({ ...EMPTY_PAYLOAD });
    setAsking({ ...EMPTY_PAYLOAD });
  };

  const totalGiving = visibleCards.reduce((s, k) => s + (giving[k] || 0), 0);
  const totalAsking = visibleCards.reduce((s, k) => s + (asking[k] || 0), 0);

  const totalCounterGiving = visibleCards.reduce((s, k) => s + (counterGiving[k] || 0), 0);
  const totalCounterAsking = visibleCards.reduce((s, k) => s + (counterAsking[k] || 0), 0);
  const hasSameResourceInCounter = visibleCards.some(
    (r) => (counterGiving[r] || 0) > 0 && (counterAsking[r] || 0) > 0,
  );
  const isCounterSameAsOriginal = Boolean(
    activeTrade &&
      (visibleCards.every(
        (r) =>
          (counterGiving[r] || 0) === (activeTrade.asking[r] || 0) &&
          (counterAsking[r] || 0) === (activeTrade.giving[r] || 0),
      ) ||
        visibleCards.every(
          (r) =>
            (counterGiving[r] || 0) === (activeTrade.giving[r] || 0) &&
            (counterAsking[r] || 0) === (activeTrade.asking[r] || 0),
        )),
  );
  const isDuplicateCounterOffer = Boolean(
    activeTrade &&
      activeTrade.counterOffers.some((c) =>
        visibleCards.every(
          (r) =>
            (c.giving[r] || 0) === (counterGiving[r] || 0) &&
            (c.asking[r] || 0) === (counterAsking[r] || 0),
        ),
      ),
  );
  const hasBasicCounterValidity = allowFreeTrades
    ? (totalCounterGiving > 0 || totalCounterAsking > 0) && !hasSameResourceInCounter
    : totalCounterGiving > 0 && totalCounterAsking > 0 && !hasSameResourceInCounter;

  const hasSameResourceInOffer = visibleCards.some((r) => (giving[r] || 0) > 0 && (asking[r] || 0) > 0);
  const canProposeDomestic = allowFreeTrades
    ? (totalGiving > 0 || totalAsking > 0) && !hasSameResourceInOffer
    : totalGiving > 0 && totalAsking > 0 && !hasSameResourceInOffer;

  // Evaluate Multi-Port Batch Maritime Trade (supports combining multiple 4:1, 3:1, and 2:1 trades at once!)
  const maritimeEval = (() => {
    let creditsEarned = 0;
    let allDivisible = true;

    for (const r of visibleCards) {
      const amt = giving[r] || 0;
      if (amt <= 0) continue;
      const bestRatio = getMaritimeRatio(r);
      if (amt % bestRatio !== 0) {
        allDivisible = false;
      } else {
        creditsEarned += amt / bestRatio;
      }
    }

    const bankHasSupply = visibleCards.every((r) => {
      const askAmt = asking[r] || 0;
      if (askAmt <= 0) return true;
      if (isValidResourceType(r)) {
        return state.resourceBank === null ? true : askAmt <= (state.resourceBank?.[r] || 0);
      }
      return state.commodityBank === null ? true : askAmt <= (state.commodityBank?.[r] || 0);
    });

    const valid =
      allDivisible &&
      creditsEarned > 0 &&
      totalAsking > 0 &&
      creditsEarned === totalAsking &&
      bankHasSupply &&
      !hasSameResourceInOffer;

    return { valid, creditsEarned, allDivisible };
  })();

  const handleBatchBankTrade = () => {
    if (!maritimeEval.valid) return;
    sendAction({
      type: 'MARITIME_BATCH_TRADE',
      playerId: myPlayerId,
      giving,
      asking,
    });
    resetSelection();
  };

  const handleProposeTrade = () => {
    if (!canProposeDomestic) return;
    sendAction({
      type: 'PROPOSE_TRADE',
      playerId: myPlayerId,
      giving,
      asking,
    });
    resetSelection();
  };

  const allRecipientsDeclined = Boolean(
    activeTrade &&
      Object.values(activeTrade.status).length > 0 &&
      Object.values(activeTrade.status).every((s) => s === 'declined') &&
      activeTrade.counterOffers.length === 0,
  );
  const myTradeResponseStatus = activeTrade?.status?.[myPlayerId];
  const showIncomingTradeBanner =
    Boolean(activeTrade) &&
    !allRecipientsDeclined &&
    activeTrade!.fromPlayerId !== myPlayerId &&
    myTradeResponseStatus !== 'declined';

  const gridColsClass = isCK ? 'grid-cols-4 sm:grid-cols-8' : 'grid-cols-5';

  return (
    <div
      className={`pointer-events-auto flex flex-col gap-2.5 ${
        isCK ? 'w-[520px]' : 'w-[420px]'
      } max-w-[92vw]`}
    >
      {/* 1. Incoming Trade Offer Banner */}
      {showIncomingTradeBanner && activeTrade && (
        <div className="bg-slate-900/95 border-2 border-amber-500 rounded-2xl p-3.5 shadow-2xl backdrop-blur-xl max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-sm font-black text-amber-300 flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4" />
              {state.players[activeTrade.fromPlayerId]?.name} Wants to Trade
            </span>
            <span className="text-[10px] font-semibold text-slate-300 bg-slate-800 px-2.5 py-0.5 rounded-full">
              {allowFreeTrades ? 'Player Offer (Free Trades On)' : 'Player Offer'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2.5 mb-3 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span className="text-xs text-emerald-400 font-bold block mb-1.5">You Receive:</span>
              <div className="flex flex-wrap gap-1.5">
                {visibleCards.filter((res) => (activeTrade.giving[res] || 0) > 0).length === 0 ? (
                  <span className="text-[11px] font-bold text-slate-400 italic">Nothing (Gift)</span>
                ) : (
                  visibleCards.map((res) => {
                    const count = activeTrade.giving[res] || 0;
                    if (count === 0) return null;
                    return (
                      <div
                        key={res}
                        className="flex flex-col items-center bg-emerald-950/70 border border-emerald-600/60 px-2 py-1 rounded-lg"
                      >
                        <div className="flex items-center gap-1">
                          <TradeCardVisual cardType={res} size="xs" />
                          <span className="text-xs font-black text-emerald-200">×{count}</span>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-300 mt-0.5">
                          {TRADEABLE_LABELS[res]}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <span className="text-xs text-amber-400 font-bold block mb-1.5">They Ask For:</span>
              <div className="flex flex-wrap gap-1.5">
                {visibleCards.filter((res) => (activeTrade.asking[res] || 0) > 0).length === 0 ? (
                  <span className="text-[11px] font-bold text-emerald-300 italic">Nothing (Free Gift!)</span>
                ) : (
                  visibleCards.map((res) => {
                    const count = activeTrade.asking[res] || 0;
                    if (count === 0) return null;
                    return (
                      <div
                        key={res}
                        className="flex flex-col items-center bg-amber-950/70 border border-amber-600/60 px-2 py-1 rounded-lg"
                      >
                        <div className="flex items-center gap-1">
                          <TradeCardVisual cardType={res} size="xs" />
                          <span className="text-xs font-black text-amber-200">×{count}</span>
                        </div>
                        <span className="text-[10px] font-bold text-amber-300 mt-0.5">
                          {TRADEABLE_LABELS[res]}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                sendAction({ type: 'RESPOND_TRADE', playerId: myPlayerId, tradeId: activeTrade.id, accept: true })
              }
              disabled={!canAffordTradePayload(self.resources, self.commodities, activeTrade.asking, isCK)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl transition shadow-lg cursor-pointer"
            >
              <Check className="w-4 h-4" /> Accept Deal
            </button>

            <button
              type="button"
              onClick={() => {
                const nextGiving: TradePayload = { ...EMPTY_PAYLOAD };
                const nextAsking: TradePayload = { ...EMPTY_PAYLOAD };
                for (const k of visibleCards) {
                  nextGiving[k] = Math.min(getHeldCount(k), activeTrade.asking[k] || 0);
                  nextAsking[k] = activeTrade.giving[k] || 0;
                }
                setCounterGiving(nextGiving);
                setCounterAsking(nextAsking);
                setIsCountering((prev) => !prev);
              }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl transition shadow-lg cursor-pointer"
            >
              <SlidersHorizontal className="w-4 h-4" /> Counter-Offer
            </button>

            <button
              type="button"
              onClick={() => {
                setIsCountering(false);
                sendAction({ type: 'RESPOND_TRADE', playerId: myPlayerId, tradeId: activeTrade.id, accept: false });
              }}
              className="py-2 px-3 bg-slate-800 hover:bg-rose-900/70 text-slate-300 hover:text-rose-200 font-bold text-xs rounded-xl transition border border-slate-700 cursor-pointer flex items-center gap-1"
            >
              <X className="w-4 h-4" /> Decline
            </button>
          </div>

          {/* Spacious Counter-Offer Drawer */}
          {isCountering && (
            <div className="mt-3 pt-3 border-t border-slate-800 flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-indigo-300">Customize Your Counter-Offer:</span>
                {!hasBasicCounterValidity && (
                  <span className="text-[10px] font-bold text-rose-400">
                    {hasSameResourceInCounter
                      ? 'Cannot swap identical cards'
                      : allowFreeTrades
                        ? 'Include ≥1 card to trade'
                        : 'Must give ≥1 & ask ≥1 card'}
                  </span>
                )}
              </div>

              {(isCounterSameAsOriginal || isDuplicateCounterOffer) && (
                <div className="bg-rose-950/90 border border-rose-500/80 text-rose-200 px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>
                    {isCounterSameAsOriginal
                      ? 'Counter-offer cannot be identical to the original trade offer! Adjust quantities or click Accept Deal.'
                      : 'This exact counter-offer has already been offered!'}
                  </span>
                </div>
              )}

              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-emerald-400 block mb-1.5">
                  I Will Give ({totalCounterGiving}):
                </span>
                <div className={`grid ${gridColsClass} gap-1.5`}>
                  {visibleCards.map((r) => {
                    const held = getHeldCount(r);
                    const val = counterGiving[r] || 0;
                    return (
                      <div
                        key={r}
                        className="flex flex-col items-center bg-slate-900 p-1 rounded-lg border border-slate-800"
                      >
                        <TradeCardVisual cardType={r} size="sm" />
                        <span className="text-[9px] font-bold text-slate-300 mt-0.5 mb-0.5">
                          {TRADEABLE_LABELS[r]}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('giving', r, -1)}
                            disabled={val === 0}
                            className="w-4 h-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-[10px] font-bold flex items-center justify-center cursor-pointer"
                          >
                            −
                          </button>
                          <span className="text-[11px] font-black w-3.5 text-center">{val}</span>
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('giving', r, 1)}
                            disabled={val >= held}
                            className="w-4 h-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-[10px] font-bold flex items-center justify-center cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-slate-950 p-2 rounded-xl border border-slate-800">
                <span className="text-xs font-bold text-amber-400 block mb-1.5">
                  I Want Instead ({totalCounterAsking}):
                </span>
                <div className={`grid ${gridColsClass} gap-1.5`}>
                  {visibleCards.map((r) => {
                    const val = counterAsking[r] || 0;
                    return (
                      <div
                        key={r}
                        className="flex flex-col items-center bg-slate-900 p-1 rounded-lg border border-slate-800"
                      >
                        <TradeCardVisual cardType={r} size="sm" />
                        <span className="text-[9px] font-bold text-slate-300 mt-0.5 mb-0.5">
                          {TRADEABLE_LABELS[r]}
                        </span>
                        <div className="flex items-center gap-0.5">
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('asking', r, -1)}
                            disabled={val === 0}
                            className="w-4 h-4 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 rounded text-[10px] font-bold flex items-center justify-center cursor-pointer"
                          >
                            −
                          </button>
                          <span className="text-[11px] font-black w-3.5 text-center">{val}</span>
                          <button
                            type="button"
                            onClick={() => handleCounterAdjust('asking', r, 1)}
                            className="w-4 h-4 bg-slate-800 hover:bg-slate-700 rounded text-[10px] font-bold flex items-center justify-center cursor-pointer"
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
                  disabled={!hasBasicCounterValidity}
                  onClick={() => {
                    if (!hasBasicCounterValidity) return;
                    sendAction({
                      type: 'COUNTER_TRADE',
                      playerId: myPlayerId,
                      tradeId: activeTrade.id,
                      giving: counterGiving,
                      asking: counterAsking,
                    });
                    if (!isCounterSameAsOriginal && !isDuplicateCounterOffer) {
                      setIsCountering(false);
                    }
                  }}
                  className={`flex-1 py-2 font-bold text-xs rounded-xl text-white cursor-pointer transition ${
                    isCounterSameAsOriginal || isDuplicateCounterOffer
                      ? 'bg-rose-700/80 hover:bg-rose-600 border border-rose-400'
                      : 'bg-indigo-600 hover:bg-indigo-500 disabled:opacity-35'
                  }`}
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
      {activeTrade && !allRecipientsDeclined && activeTrade.fromPlayerId === myPlayerId && (
        <div className="bg-slate-900/95 border-2 border-amber-500/70 rounded-2xl p-3.5 shadow-2xl backdrop-blur-xl max-h-[80vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-xs font-black text-amber-300 uppercase tracking-wider">Your Active Trade Offer</span>
            <button
              type="button"
              onClick={() => sendAction({ type: 'CANCEL_TRADE', playerId: myPlayerId, tradeId: activeTrade.id })}
              className="text-xs bg-rose-950/80 hover:bg-rose-900 border border-rose-700 text-rose-200 px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" /> Cancel Offer
            </button>
          </div>

          {/* Summary of Proposer's Offer */}
          <div className="grid grid-cols-2 gap-2 mb-2.5 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
            <div>
              <span className="text-[11px] font-bold text-emerald-400 block mb-1">Offering:</span>
              <div className="flex flex-wrap gap-1.5">
                {visibleCards.filter((r) => (activeTrade.giving[r] || 0) > 0).length === 0 ? (
                  <span className="text-[10px] text-slate-400 italic">Nothing</span>
                ) : (
                  visibleCards.map((r) => {
                    const n = activeTrade.giving[r] || 0;
                    if (n === 0) return null;
                    return (
                      <div
                        key={r}
                        className="flex flex-col items-center bg-slate-900 px-2 py-1 rounded-lg border border-slate-700"
                      >
                        <div className="flex items-center gap-1">
                          <TradeCardVisual cardType={r} size="xs" />
                          <span className="text-[11px] font-black text-emerald-300">×{n}</span>
                        </div>
                        <span className="text-[9px] font-bold text-slate-300">{TRADEABLE_LABELS[r]}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <span className="text-[11px] font-bold text-amber-400 block mb-1">Requesting:</span>
              <div className="flex flex-wrap gap-1.5">
                {visibleCards.filter((r) => (activeTrade.asking[r] || 0) > 0).length === 0 ? (
                  <span className="text-[10px] text-slate-400 italic">Nothing (Gift)</span>
                ) : (
                  visibleCards.map((r) => {
                    const n = activeTrade.asking[r] || 0;
                    if (n === 0) return null;
                    return (
                      <div
                        key={r}
                        className="flex flex-col items-center bg-slate-900 px-2 py-1 rounded-lg border border-slate-700"
                      >
                        <div className="flex items-center gap-1">
                          <TradeCardVisual cardType={r} size="xs" />
                          <span className="text-[11px] font-black text-amber-300">×{n}</span>
                        </div>
                        <span className="text-[9px] font-bold text-slate-300">{TRADEABLE_LABELS[r]}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 mb-2">
            {Object.entries(activeTrade.status).map(([pid, status]) => (
              <div
                key={pid}
                className="flex items-center gap-1.5 bg-slate-950 px-2.5 py-1 rounded-xl border border-slate-800 text-xs"
              >
                <span className="font-bold text-slate-200">{state.players[pid]?.name}:</span>
                {status === 'pending' && <span className="text-amber-400 animate-pulse">Thinking...</span>}
                {status === 'declined' && <span className="text-rose-400 font-semibold">Declined ✕</span>}
                {status === 'accepted' && <span className="text-emerald-400 font-bold">Accepted ✓</span>}
              </div>
            ))}
          </div>

          {activeTrade.counterOffers.length > 0 && (
            <div className="flex flex-col gap-2 mt-2 pt-2.5 border-t border-slate-800">
              <span className="text-xs font-bold text-indigo-300">Counter-Offers Received:</span>
              {activeTrade.counterOffers.map((counter) => (
                <div
                  key={counter.id}
                  className="flex flex-col gap-2 bg-slate-950 p-2.5 rounded-xl border border-indigo-700/60"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-indigo-200">
                      {state.players[counter.fromPlayerId]?.name} counter-proposes:
                    </span>
                    <button
                      type="button"
                      disabled={!canAffordTradePayload(self.resources, self.commodities, counter.asking, isCK)}
                      onClick={() =>
                        sendAction({
                          type: 'ACCEPT_COUNTER_TRADE',
                          playerId: myPlayerId,
                          tradeId: activeTrade.id,
                          counterId: counter.id,
                        })
                      }
                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 font-bold text-xs text-white rounded-xl transition cursor-pointer shrink-0"
                    >
                      Accept Counter
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] font-bold text-emerald-400 block mb-1">They Give You:</span>
                      <div className="flex flex-wrap gap-1">
                        {visibleCards.filter((r) => (counter.giving[r] || 0) > 0).length === 0 ? (
                          <span className="text-[10px] text-slate-400 italic">Nothing</span>
                        ) : (
                          visibleCards.map((r) => {
                            const n = counter.giving[r] || 0;
                            if (n === 0) return null;
                            return (
                              <div
                                key={r}
                                className="flex flex-col items-center bg-emerald-950/60 border border-emerald-700/60 px-1.5 py-0.5 rounded"
                              >
                                <div className="flex items-center gap-1">
                                  <TradeCardVisual cardType={r} size="xs" />
                                  <span className="text-[10px] font-black text-emerald-200">×{n}</span>
                                </div>
                                <span className="text-[9px] font-bold text-emerald-300">
                                  {TRADEABLE_LABELS[r]}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-amber-400 block mb-1">For Your:</span>
                      <div className="flex flex-wrap gap-1">
                        {visibleCards.filter((r) => (counter.asking[r] || 0) > 0).length === 0 ? (
                          <span className="text-[10px] text-slate-400 italic">Nothing</span>
                        ) : (
                          visibleCards.map((r) => {
                            const n = counter.asking[r] || 0;
                            if (n === 0) return null;
                            return (
                              <div
                                key={r}
                                className="flex flex-col items-center bg-amber-950/60 border border-amber-700/60 px-1.5 py-0.5 rounded"
                              >
                                <div className="flex items-center gap-1">
                                  <TradeCardVisual cardType={r} size="xs" />
                                  <span className="text-[10px] font-black text-amber-200">×{n}</span>
                                </div>
                                <span className="text-[9px] font-bold text-amber-300">
                                  {TRADEABLE_LABELS[r]}
                                </span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
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
          <div className="flex items-center justify-between px-3.5 py-2 bg-slate-950/60 border-b border-slate-800">
            <div className="flex items-center gap-2">
              <ArrowLeftRight className="w-4 h-4 text-amber-400" />
              <span className="text-xs font-black text-white uppercase tracking-wider">
                {isCK ? 'Trading Dock (Resources & Commodities)' : 'Trading Dock'}
              </span>
              {isPlayer2Action && (
                <span className="text-[10px] text-amber-300 bg-amber-950/80 border border-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Ban className="w-3 h-3" /> Bank Only
                </span>
              )}
              {allowFreeTrades && !isPlayer2Action && (
                <span className="text-[10px] text-emerald-300 bg-emerald-950/80 border border-emerald-700 px-2 py-0.5 rounded-full">
                  🎁 Free Trades On
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
            <div className="p-2.5 flex flex-col gap-2">
              {/* Row 1: I GIVE */}
              <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-emerald-400">
                    I Give ({totalGiving}){' '}
                    <span className="text-slate-400 font-normal text-[10px]">
                      — click card to add port bundle
                    </span>
                  </span>
                  {maritimeEval.creditsEarned > 0 && maritimeEval.allDivisible && (
                    <span className="text-[10px] font-black bg-sky-950/90 border border-sky-500 text-sky-300 px-2 py-0.5 rounded-full">
                      ⚓ {maritimeEval.creditsEarned} Bank Credit{maritimeEval.creditsEarned > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
                <div className={`grid ${gridColsClass} gap-1`}>
                  {visibleCards.map((r) => {
                    const held = getHeldCount(r);
                    const count = giving[r] || 0;
                    const ratio = getMaritimeRatio(r);
                    return (
                      <div
                        key={r}
                        className={`flex flex-col items-center p-1 rounded-xl border transition ${
                          count > 0
                            ? 'bg-emerald-950/40 border-emerald-500/70'
                            : 'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleAddHarborBundle(r)}
                          disabled={count >= held}
                          className="relative group cursor-pointer disabled:opacity-40"
                          title={`Click to add ${ratio} ${TRADEABLE_LABELS[r]} (Best bank rate: ${ratio}:1)`}
                        >
                          <TradeCardVisual cardType={r} size="md" />
                          <span className="absolute -top-1.5 -right-1.5 bg-slate-900 text-[9px] font-black text-slate-200 px-1 rounded-full border border-slate-600">
                            {held}
                          </span>
                          <span
                            className={`absolute bottom-0.5 left-0.5 text-[8px] font-black px-1 rounded border ${
                              ratio === 2
                                ? 'bg-emerald-950/95 border-emerald-500 text-emerald-300'
                                : ratio === 3
                                  ? 'bg-amber-950/95 border-amber-500 text-amber-300'
                                  : 'bg-slate-950/90 border-slate-700 text-slate-300'
                            }`}
                          >
                            {ratio}:1
                          </span>
                        </button>

                        <span className="text-[9px] font-bold text-slate-300 mt-0.5">
                          {TRADEABLE_LABELS[r]}
                        </span>

                        <div className="flex items-center justify-between w-full mt-0.5 px-0.5">
                          <button
                            type="button"
                            onClick={() => handleAdjust('giving', r, -1)}
                            disabled={count === 0}
                            className="w-4 h-4 bg-slate-800 hover:bg-rose-600 disabled:opacity-25 text-white rounded text-[10px] font-black flex items-center justify-center transition cursor-pointer shadow"
                          >
                            −
                          </button>
                          <span className="text-[11px] font-black text-white">{count}</span>
                          <button
                            type="button"
                            onClick={() => handleAdjust('giving', r, 1)}
                            disabled={count >= held}
                            className="w-4 h-4 bg-slate-800 hover:bg-emerald-600 disabled:opacity-25 text-white rounded text-[10px] font-black flex items-center justify-center transition cursor-pointer shadow"
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
              <div className="bg-slate-950/80 p-2 rounded-xl border border-slate-800">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-amber-400">
                    I Want ({totalAsking}){' '}
                    <span className="text-slate-400 font-normal text-[10px]">
                      {maritimeEval.creditsEarned > 0 && maritimeEval.allDivisible
                        ? `— select ${maritimeEval.creditsEarned} card(s) for bank trade`
                        : '— click card or + / −'}
                    </span>
                  </span>
                </div>
                <div className={`grid ${gridColsClass} gap-1`}>
                  {visibleCards.map((r) => {
                    const count = asking[r] || 0;
                    return (
                      <div
                        key={r}
                        className={`flex flex-col items-center p-1 rounded-xl border transition ${
                          count > 0
                            ? 'bg-amber-950/40 border-amber-500/70'
                            : 'bg-slate-900/80 border-slate-800'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => handleAdjust('asking', r, 1)}
                          className="relative group cursor-pointer"
                          title={`Click to request ${TRADEABLE_LABELS[r]}`}
                        >
                          <TradeCardVisual cardType={r} size="md" />
                        </button>

                        <span className="text-[9px] font-bold text-slate-300 mt-0.5">
                          {TRADEABLE_LABELS[r]}
                        </span>

                        <div className="flex items-center justify-between w-full mt-0.5 px-0.5">
                          <button
                            type="button"
                            onClick={() => handleAdjust('asking', r, -1)}
                            disabled={count === 0}
                            className="w-4 h-4 bg-slate-800 hover:bg-rose-600 disabled:opacity-25 text-white rounded text-[10px] font-black flex items-center justify-center transition cursor-pointer shadow"
                          >
                            −
                          </button>
                          <span className="text-[11px] font-black text-white">{count}</span>
                          <button
                            type="button"
                            onClick={() => handleAdjust('asking', r, 1)}
                            className="w-4 h-4 bg-slate-800 hover:bg-amber-500 text-white rounded text-[10px] font-black flex items-center justify-center transition cursor-pointer shadow"
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
                    disabled={!canProposeDomestic}
                    className="flex-1 py-2 px-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-35 text-slate-950 font-black text-xs rounded-xl transition shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <ArrowLeftRight className="w-4 h-4" /> Propose to Players
                  </button>
                )}

                <button
                  type="button"
                  onClick={handleBatchBankTrade}
                  disabled={!maritimeEval.valid}
                  title="Combine any number of 2:1, 3:1, or 4:1 bank trades in one transaction!"
                  className="flex-1 py-2 px-3 bg-sky-600 hover:bg-sky-500 disabled:opacity-35 text-white font-black text-xs rounded-xl transition shadow-lg flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  ⚓ Trade with Bank
                  {maritimeEval.creditsEarned > 0 && maritimeEval.allDivisible
                    ? ` (${totalAsking}/${maritimeEval.creditsEarned})`
                    : ''}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
