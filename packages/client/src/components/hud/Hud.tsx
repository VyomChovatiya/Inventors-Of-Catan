import React, { useState, useEffect, useRef } from 'react';
import {
  RedactedGameState,
  ResourceType,
  CommodityType,
  TradeableCardType,
  TradePayload,
  ResourceCount,
  CommodityCount,
  BUILDING_COSTS,
  canAfford,
  PlayerColor,
  DevCardType,
  ProgressCardDiscipline,
  ProgressCardType,
  EventDieFace,
  PROGRESS_CARD_METADATA,
  CITY_IMPROVEMENT_NAMES,
  DISCIPLINE_COMMODITY,
  getBarbarianStrength,
  getTotalActiveKnightStrength,
  getPlayerActiveKnightStrength,
  getPlayerVulnerableCityVertices,
  cryptoRandomInt,
} from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';
import {
  Dices,
  ShieldAlert,
  ChevronRight,
  AlertCircle,
  Clock,
  ScrollText,
  BarChart3,
  Layers,
  Sparkles,
  Trophy,
  Swords,
  Lock,
  MessageSquare,
  Send,
  EyeOff,
  BellRing,
  Home,
  UserMinus,
  Shield,
  Crown,
  X,
} from 'lucide-react';
import confetti from 'canvas-confetti';

// Synthesized Web Audio chime for Turn Alert notifications (no external audio asset required)
function playTurnAlertChime(): void {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 -> E5 -> G5 pleasant chime
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.09);
      gain.gain.setValueAtTime(0.001, now + idx * 0.09);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.09 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.09 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.09);
      osc.stop(now + idx * 0.09 + 0.3);
    });
    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1000);
  } catch {
    // Ignore if browser autoplay policy blocks audio before interaction
  }
}

const DICE_WAYS_OUT_OF_36: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

interface HudProps {
  state: RedactedGameState;
  myPlayerId: string | null;
}

const RESOURCES: ResourceType[] = ['wood', 'brick', 'wheat', 'sheep', 'ore'];
const COMMODITIES: CommodityType[] = ['cloth', 'coin', 'paper'];
const DISCIPLINES: ProgressCardDiscipline[] = ['trade', 'politics', 'science'];

const RESOURCE_LABELS: Record<ResourceType, string> = {
  wood: 'Wood',
  brick: 'Brick',
  wheat: 'Wheat',
  sheep: 'Sheep',
  ore: 'Ore',
};

const COMMODITY_LABELS: Record<CommodityType, string> = {
  cloth: 'Cloth',
  coin: 'Coin',
  paper: 'Paper',
};

const COMMODITY_EMOJIS: Record<CommodityType, string> = {
  cloth: '🧵',
  coin: '🪙',
  paper: '📜',
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

const PROGRESS_CARD_ICONS: Record<ProgressCardType, string> = {
  // Science (10)
  alchemy: '/assets/cards/progress_alchemy.png',
  crane: '/assets/cards/progress_crane.png',
  engineering: '/assets/cards/progress_engineering.png',
  invention: '/assets/cards/progress_invention.png',
  irrigation: '/assets/cards/progress_irrigation.png',
  medicine: '/assets/cards/progress_medicine.png',
  mining: '/assets/cards/progress_mining.png',
  road_building: '/assets/cards/progress_road_building.png',
  smithing: '/assets/cards/progress_smithing.png',
  printing: '/assets/cards/progress_printing.png',
  // Trade (6)
  commercial_harbor: '/assets/cards/progress_commercial_harbor.png',
  guild_dues: '/assets/cards/progress_guild_dues.png',
  merchant: '/assets/cards/progress_merchant.png',
  merchant_fleet: '/assets/cards/progress_merchant_fleet.png',
  resource_monopoly: '/assets/cards/progress_resource_monopoly.png',
  trade_monopoly: '/assets/cards/progress_trade_monopoly.png',
  // Politics (9)
  diplomacy: '/assets/cards/progress_diplomacy.png',
  encouragement: '/assets/cards/progress_encouragement.png',
  espionage: '/assets/cards/progress_espionage.png',
  intrigue: '/assets/cards/progress_intrigue.png',
  sabotage: '/assets/cards/progress_sabotage.png',
  taxation: '/assets/cards/progress_taxation.png',
  treason: '/assets/cards/progress_treason.png',
  constitution: '/assets/cards/progress_constitution.png',
  wedding: '/assets/cards/progress_wedding.png',
};

const DEV_CARD_ICONS: Record<string, string> = {
  knight: '/assets/cards/knight.png',
  road_building: '/assets/cards/road_building.png',
  year_of_plenty: '/assets/cards/invention.png',
  monopoly: '/assets/cards/monopoly.png',
  victory_point: '/assets/cards/victory_point.png',
};

const DEV_CARD_INFO: Record<DevCardType, { title: string; desc: string }> = {
  knight: {
    title: 'Knight',
    desc: 'Move the Robber and steal 1 random resource from an adjacent player. Counts toward Largest Army.',
  },
  road_building: {
    title: 'Road Building',
    desc: 'Immediately place 2 free roads on the board.',
  },
  year_of_plenty: {
    title: 'Year of Plenty',
    desc: 'Take any 2 resource cards directly from the bank.',
  },
  monopoly: {
    title: 'Monopoly',
    desc: 'Name 1 resource type; all other players must give you all of their cards of that type.',
  },
  victory_point: {
    title: '+1 Victory Point',
    desc: 'Kept secret from opponents until your total reaches the winning VP goal on your turn!',
  },
};

const DISCIPLINE_STYLES: Record<
  ProgressCardDiscipline,
  { label: string; emoji: string; badgeBg: string; border: string; text: string }
> = {
  trade: {
    label: 'Trade',
    emoji: '🟡',
    badgeBg: 'bg-amber-950/90',
    border: 'border-amber-400',
    text: 'text-amber-300',
  },
  politics: {
    label: 'Politics',
    emoji: '🔵',
    badgeBg: 'bg-sky-950/90',
    border: 'border-sky-400',
    text: 'text-sky-300',
  },
  science: {
    label: 'Science',
    emoji: '🟢',
    badgeBg: 'bg-emerald-950/90',
    border: 'border-emerald-400',
    text: 'text-emerald-300',
  },
};

const PLAYER_BADGES: Record<PlayerColor, string> = {
  red: 'bg-[#ff1a1a]',
  blue: 'bg-[#0055ff]',
  orange: 'bg-[#ff6a00]',
  white: 'bg-white text-slate-900',
  green: 'bg-[#00cc44]',
  purple: 'bg-[#aa00ff]',
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
  variant: 'red' | 'yellow' | 'white';
  isRolling: boolean;
}> = React.memo(({ value, variant, isRolling }) => {
  const pips = DIE_PIP_COORDS[value] || DIE_PIP_COORDS[1];
  const bg = variant === 'red' ? '#dc2626' : variant === 'white' ? '#f8fafc' : '#facc15';
  const border = variant === 'red' ? '#991b1b' : variant === 'white' ? '#64748b' : '#ca8a04';
  const pipFill = variant === 'red' ? '#fef08a' : variant === 'white' ? '#0f172a' : '#dc2626';

  return (
    <svg
      viewBox="0 0 100 100"
      className={`w-8 h-8 sm:w-9 sm:h-9 drop-shadow-md transition-transform ${
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
});

const VisualEventDie: React.FC<{
  face: EventDieFace;
  isRolling: boolean;
}> = React.memo(({ face, isRolling }) => {
  const config: Record<EventDieFace, { emoji: string; label: string; border: string; bg: string }> = {
    barbarian: { emoji: '⛵', label: 'Barbarian Ship', border: '#ef4444', bg: '#1e293b' },
    trade: { emoji: '🟡', label: 'Trade Gate', border: '#facc15', bg: '#422006' },
    politics: { emoji: '🔵', label: 'Politics Gate', border: '#38bdf8', bg: '#082f49' },
    science: { emoji: '🟢', label: 'Science Gate', border: '#4ade80', bg: '#052e16' },
  };
  const info = config[face] || config.barbarian;

  return (
    <div
      title={`Event Die: ${info.label}`}
      style={{ backgroundColor: info.bg, borderColor: info.border }}
      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-lg border-2 flex items-center justify-center text-base shadow-md select-none transition-transform ${
        isRolling ? 'animate-spin scale-110' : 'scale-100'
      }`}
    >
      <span>{info.emoji}</span>
    </div>
  );
});

// Isolated Turn Timer component so 250ms ticks never re-render the rest of the HUD
const TurnTimerDisplay: React.FC<{
  turnDeadlineMs: number | null;
  phaseDurationMs: number;
  isSeparateActionTimer: boolean;
  savedActionRemainingMs: number | null;
}> = React.memo(({ turnDeadlineMs, phaseDurationMs, isSeparateActionTimer, savedActionRemainingMs }) => {
  const [remainingMs, setRemainingMs] = useState<number>(0);

  useEffect(() => {
    const updateTimer = () => {
      if (!turnDeadlineMs) {
        setRemainingMs(0);
        return;
      }
      setRemainingMs(Math.max(0, turnDeadlineMs - Date.now()));
    };
    updateTimer();
    const interval = setInterval(updateTimer, 250);
    return () => clearInterval(interval);
  }, [turnDeadlineMs]);

  if (!turnDeadlineMs) return null;

  const remainingSeconds = Math.ceil(remainingMs / 1000);
  const timerProgress =
    phaseDurationMs > 0 ? Math.min(100, Math.max(0, (remainingMs / phaseDurationMs) * 100)) : 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5">
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl border font-mono text-xs font-black transition ${
            remainingSeconds <= 5
              ? 'bg-rose-950/90 border-rose-500 text-rose-300 animate-pulse'
              : isSeparateActionTimer
                ? 'bg-indigo-950/90 border-indigo-400 text-indigo-200'
                : remainingSeconds <= 15
                  ? 'bg-amber-950/90 border-amber-500 text-amber-300'
                  : 'bg-slate-950/90 border-slate-800 text-slate-200'
          }`}
          title={
            isSeparateActionTimer
              ? 'Dedicated Robber / Card prompt timer (your main turn timer is paused!)'
              : 'Auto-roller / auto-pass triggers when timer reaches 0s'
          }
        >
          <Clock className="w-3.5 h-3.5" />
          <span>
            {Math.floor(remainingSeconds / 60)}:{String(remainingSeconds % 60).padStart(2, '0')}
          </span>
        </div>

        {savedActionRemainingMs && savedActionRemainingMs > 0 && (
          <span
            title="Your main turn timer is paused and will resume once this action completes"
            className="text-[10px] font-bold bg-slate-950/90 border border-slate-700 text-slate-400 px-2 py-1 rounded-lg"
          >
            Paused ({Math.ceil(savedActionRemainingMs / 1000)}s)
          </span>
        )}
      </div>

      <div className="w-28 sm:w-36 h-1 bg-slate-950 rounded-full overflow-hidden border border-slate-800">
        <div
          className={`h-full transition-all duration-200 ${
            remainingSeconds <= 5
              ? 'bg-rose-500'
              : isSeparateActionTimer
                ? 'bg-indigo-400'
                : remainingSeconds <= 15
                  ? 'bg-amber-400'
                  : 'bg-emerald-500'
          }`}
          style={{ width: `${timerProgress}%` }}
        />
      </div>
    </div>
  );
});

const RESOURCE_EMOJIS: Record<ResourceType, string> = {
  wood: '🪵',
  brick: '🧱',
  wheat: '🌾',
  sheep: '🐑',
  ore: '🪨',
};

const ResourceMiniPill: React.FC<{
  resource: ResourceType;
  needed: number;
  held: number;
}> = React.memo(({ resource, needed, held }) => {
  const hasEnough = held >= needed;
  const emoji = RESOURCE_EMOJIS[resource];
  const label = RESOURCE_LABELS[resource];

  return (
    <div
      title={`${label}: You have ${held}, need ${needed}`}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-lg border transition shadow-sm ${
        hasEnough
          ? 'bg-emerald-950/85 border-emerald-500/90 text-emerald-100'
          : 'bg-rose-950/75 border-rose-500/80 text-rose-200'
      }`}
    >
      <span className="text-sm leading-none select-none" aria-hidden="true">
        {emoji}
      </span>
      {needed > 1 && (
        <span className="text-[10px] font-black leading-none pr-0.5">
          ×{needed}
        </span>
      )}
    </div>
  );
});

// Resizable container that allows dragging any of the 4 corners to rescale width & height
const ResizableHudBox: React.FC<{
  storageKey: string;
  defaultWidth: number;
  defaultHeight: number;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  children: React.ReactNode;
}> = ({
  storageKey,
  defaultWidth,
  defaultHeight,
  minWidth = 230,
  maxWidth = 640,
  minHeight = 120,
  maxHeight = 520,
  className = '',
  children,
}) => {
  const [size, setSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.width === 'number' && typeof parsed.height === 'number') {
          return {
            width: Math.max(minWidth, Math.min(maxWidth, parsed.width)),
            height: Math.max(minHeight, Math.min(maxHeight, parsed.height)),
          };
        }
      }
    } catch {
      // ignore storage errors
    }
    return { width: defaultWidth, height: defaultHeight };
  });

  const startCornerResize = (
    corner: 'br' | 'tr' | 'bl' | 'tl',
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.width;
    const startH = size.height;

    const handleMove = (moveEvent: PointerEvent) => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;

      const nextW =
        corner === 'br' || corner === 'tr'
          ? Math.max(minWidth, Math.min(maxWidth, startW + dx))
          : Math.max(minWidth, Math.min(maxWidth, startW - dx));

      const nextH =
        corner === 'br' || corner === 'bl'
          ? Math.max(minHeight, Math.min(maxHeight, startH + dy))
          : Math.max(minHeight, Math.min(maxHeight, startH - dy));

      const updated = { width: Math.round(nextW), height: Math.round(nextH) };
      setSize(updated);
      try {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  };

  return (
    <div
      style={{ width: `${size.width}px`, height: `${size.height}px`, maxWidth: '65vw' }}
      className={`relative group/resize shrink-0 ${className}`}
    >
      {children}

      {/* Top-Left Corner Drag Handle */}
      <div
        onPointerDown={(e) => startCornerResize('tl', e)}
        title="Drag corner to resize"
        className="absolute -top-1 -left-1 w-3.5 h-3.5 cursor-nwse-resize z-30 opacity-0 group-hover/resize:opacity-100 transition-opacity flex items-start justify-start p-0.5"
      >
        <span className="w-2 h-2 border-t-2 border-l-2 border-amber-400/80 rounded-tl-sm" />
      </div>

      {/* Top-Right Corner Drag Handle */}
      <div
        onPointerDown={(e) => startCornerResize('tr', e)}
        title="Drag corner to resize"
        className="absolute -top-1 -right-1 w-4 h-4 cursor-nesw-resize z-30 opacity-60 hover:opacity-100 transition-opacity flex items-start justify-end p-0.5"
      >
        <span className="w-2.5 h-2.5 border-t-2 border-r-2 border-amber-400 rounded-tr-sm" />
      </div>

      {/* Bottom-Left Corner Drag Handle */}
      <div
        onPointerDown={(e) => startCornerResize('bl', e)}
        title="Drag corner to resize"
        className="absolute -bottom-1 -left-1 w-3.5 h-3.5 cursor-nesw-resize z-30 opacity-0 group-hover/resize:opacity-100 transition-opacity flex items-end justify-start p-0.5"
      >
        <span className="w-2 h-2 border-b-2 border-l-2 border-amber-400/80 rounded-bl-sm" />
      </div>

      {/* Bottom-Right Corner Drag Handle (Primary Visible Grip) */}
      <div
        onPointerDown={(e) => startCornerResize('br', e)}
        title="Drag corner to resize box"
        className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize z-30 opacity-75 hover:opacity-100 transition-opacity flex items-end justify-end p-0.5"
      >
        <svg viewBox="0 0 12 12" className="w-3 h-3 text-amber-400 drop-shadow">
          <path
            d="M10 2L2 10M10 6L6 10M10 10L10 10"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </div>
  );
};

export const Hud: React.FC<HudProps> = ({ state, myPlayerId }) => {
  const {
    sendAction,
    sendChatMessage,
    kickPlayer,
    exitToHomeScreen,
    activeBuildMode,
    setBuildMode,
    selectedKnightVertexId,
    setSelectedKnightVertexId,
    activeProgressCardId,
    setActiveProgressCardId,
    errorMessage,
    clearError,
    room,
  } = useGameStore();
  const chatMessages = room?.chatMessages || [];
  const isHost = Boolean(room && myPlayerId && room.hostPlayerId === myPlayerId);
  const isCK = state.settings.expansion === 'cities_and_knights';

  const [discardSelection, setDiscardSelection] = useState<TradePayload>({
    wood: 0,
    brick: 0,
    wheat: 0,
    sheep: 0,
    ore: 0,
    cloth: 0,
    coin: 0,
    paper: 0,
  });

  // Dev card interactive modal state (for Base Game Year of Plenty & Monopoly)
  const [pendingDevCard, setPendingDevCard] = useState<{
    cardId: string;
    type: 'year_of_plenty' | 'monopoly';
  } | null>(null);
  const [yopSelection, setYopSelection] = useState<[ResourceType, ResourceType]>(['wheat', 'ore']);
  const [monopolySelection, setMonopolySelection] = useState<ResourceType>('wheat');

  // Cities & Knights Modals & Selections
  const [showCityImprovementsModal, setShowCityImprovementsModal] = useState(false);
  const [pendingProgressModal, setPendingProgressModal] = useState<{
    cardId: string;
    type: ProgressCardType;
  } | null>(null);
  const [alchemyDice, setAlchemyDice] = useState<[number, number]>([3, 4]);
  const [selectedResourceOption, setSelectedResourceOption] = useState<ResourceType>('wheat');
  const [selectedCommodityOption, setSelectedCommodityOption] = useState<CommodityType>('cloth');
  const [selectedTradeableOption, setSelectedTradeableOption] = useState<TradeableCardType>('wheat');
  const [selectedTargetPlayerId, setSelectedTargetPlayerId] = useState<string>('');
  const [guildDuesPayload, setGuildDuesPayload] = useState<TradePayload>({
    wood: 0,
    brick: 0,
    wheat: 0,
    sheep: 0,
    ore: 0,
    cloth: 0,
    coin: 0,
    paper: 0,
  });
  const [weddingGiftPayload, setWeddingGiftPayload] = useState<TradePayload>({
    wood: 0,
    brick: 0,
    wheat: 0,
    sheep: 0,
    ore: 0,
    cloth: 0,
    coin: 0,
    paper: 0,
  });

  const [showDiceStats, setShowDiceStats] = useState(false);

  // Selected/Hovered Dev Card or Progress Card in the upper-right panel
  const [focusedDevCardId, setFocusedDevCardId] = useState<string | null>(null);
  const [focusedProgressCardId, setFocusedProgressCardId] = useState<string | null>(null);

  const [chatInput, setChatInput] = useState('');

  // Animated Dice state
  const [isRollingAnim, setIsRollingAnim] = useState(false);
  const [animDice, setAnimDice] = useState<[number, number]>([1, 1]);
  const [animEventDie, setAnimEventDie] = useState<EventDieFace>('barbarian');

  const [visibleAwardId, setVisibleAwardId] = useState<string | null>(null);
  const awardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [turnAlert, setTurnAlert] = useState<{
    id: string;
    title: string;
    subtitle: string;
  } | null>(null);
  const lastTurnAlertKeyRef = useRef<string>('');
  const turnAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Resource & Commodity Gain / Loss Animation state
  const prevResourcesRef = useRef<ResourceCount | null>(null);
  const prevCommoditiesRef = useRef<CommodityCount | null>(null);
  const deltaTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const [resourceDeltas, setResourceDeltas] = useState<
    Partial<Record<TradeableCardType, { delta: number; seq: number }>>
  >({});
  const [resourceToastItems, setResourceToastItems] = useState<
    Array<{ id: string; cardType: TradeableCardType; delta: number }>
  >([]);

  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const latestLogId = state.actionLog[state.actionLog.length - 1]?.id;
  const latestChatId = chatMessages[chatMessages.length - 1]?.id;

  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.actionLog.length, latestLogId]);

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages.length, latestChatId]);

  useEffect(() => {
    if (!state.latestAwardEvent) return;
    const awardId = state.latestAwardEvent.id;
    setVisibleAwardId(awardId);
    if (awardTimerRef.current) clearTimeout(awardTimerRef.current);
    awardTimerRef.current = setTimeout(() => {
      setVisibleAwardId((current) => (current === awardId ? null : current));
    }, 6000);
  }, [state.latestAwardEvent?.id]);

  // Auto-dismiss error messages after 4.5s
  useEffect(() => {
    if (!errorMessage) return;
    const timer = setTimeout(() => {
      clearError();
    }, 4500);
    return () => clearTimeout(timer);
  }, [errorMessage, clearError]);

  // Clear all transient notifications, banners, and lingering resource deltas when a turn ends
  useEffect(() => {
    setTurnAlert(null);
    setVisibleAwardId(null);
    setResourceDeltas({});
    setResourceToastItems([]);
    setPendingProgressModal(null);
    setPendingDevCard(null);
    clearError();
  }, [state.turnNumber, state.currentTurnPlayerId, state.pairedPlayerId, clearError]);

  // Cleanup any active timers on unmount
  useEffect(() => {
    return () => {
      if (turnAlertTimerRef.current) clearTimeout(turnAlertTimerRef.current);
      if (awardTimerRef.current) clearTimeout(awardTimerRef.current);
      for (const t of deltaTimersRef.current) clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!state.lastDiceRollAt || !state.diceRoll) return;
    setIsRollingAnim(true);
    const faces: EventDieFace[] = ['barbarian', 'barbarian', 'barbarian', 'trade', 'politics', 'science'];
    const interval = setInterval(() => {
      setAnimDice([
        cryptoRandomInt(6) + 1,
        cryptoRandomInt(6) + 1,
      ]);
      setAnimEventDie(faces[cryptoRandomInt(6)]);
    }, 75);

    const timeout = setTimeout(() => {
      clearInterval(interval);
      setIsRollingAnim(false);
      if (state.diceRoll) {
        setAnimDice(state.diceRoll);
      }
      if (state.eventDie) {
        setAnimEventDie(state.eventDie);
      }
    }, 800);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [state.lastDiceRollAt]);

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

  const isMySetupTurn =
    Boolean(myPlayerId) &&
    (state.phase === 'SETUP_ROUND_1' || state.phase === 'SETUP_ROUND_2') &&
    activeTurnPlayerId === myPlayerId;

  const isMyRobberTurn =
    Boolean(myPlayerId) &&
    (state.phase === 'ROBBER_PLACEMENT' || state.phase === 'ROBBER_STEAL') &&
    (state.robberControllerPlayerId
      ? state.robberControllerPlayerId === myPlayerId
      : state.currentTurnPlayerId === myPlayerId || state.pairedPlayerId === myPlayerId);

  // Turn Alert Notification Banner
  useEffect(() => {
    if (!myPlayerId || state.phase === 'GAME_OVER') {
      document.title = 'CATAN ONLINE';
      return;
    }

    let alertKey = '';
    let title = '';
    let subtitle = '';

    if (isRollPhase) {
      alertKey = `roll_${state.turnNumber}_${myPlayerId}`;
      title = "🎲 IT'S YOUR TURN!";
      subtitle = 'Roll the dice to start your turn';
    } else if (isMySetupTurn) {
      alertKey = `setup_${state.phase}_${state.setupTurnIndex}_${state.lastSetupVertexId || 'settlement'}`;
      title = '🏠 YOUR SETUP TURN!';
      subtitle = state.lastSetupVertexId
        ? 'Place your starting Road connected to your building'
        : state.phase === 'SETUP_ROUND_2' && isCK
          ? 'Place your starting City on the board'
          : 'Place your starting Settlement on the board';
    } else if (needsDiscard) {
      alertKey = `discard_${state.turnNumber}_${myPlayerId}`;
      title = '⚠️ 7 ROLLED — DISCARD CARDS!';
      subtitle = `Select ${needsDiscard} cards to discard`;
    } else if (isMyRobberTurn) {
      alertKey = `robber_${state.phase}_${state.turnNumber}_${myPlayerId}`;
      title = state.phase === 'ROBBER_PLACEMENT' ? '🦹 MOVE THE ROBBER!' : '🦹 STEAL A CARD!';
      subtitle =
        state.phase === 'ROBBER_PLACEMENT'
          ? 'Click any highlighted hex on the board to move the Robber'
          : 'Choose an adjacent player to steal 1 random card from';
    } else if (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId) {
      alertKey = `paired_${state.turnNumber}_${myPlayerId}`;
      title = '⚡ PAIRED PLAYER 2 TURN!';
      subtitle = 'You may build & trade with the Bank now';
    } else if (state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId) {
      alertKey = `action_${state.turnNumber}_${myPlayerId}`;
      title = '🛠️ YOUR TURN — TRADE & BUILD!';
      subtitle = isCK
        ? 'Trade, build, recruit Knights, upgrade City Improvements, or play Progress Cards'
        : 'Trade resources, build roads/settlements/cities, or play a Dev Card';
    }

    const isCurrentlyMyAction = Boolean(alertKey);
    document.title = isCurrentlyMyAction ? '🎲 YOUR TURN! — CATAN ONLINE' : 'CATAN ONLINE';

    if (alertKey && alertKey !== lastTurnAlertKeyRef.current) {
      const wasAlreadyMyRollTurn =
        lastTurnAlertKeyRef.current === `roll_${state.turnNumber}_${myPlayerId}` &&
        alertKey === `action_${state.turnNumber}_${myPlayerId}`;
      lastTurnAlertKeyRef.current = alertKey;

      if (!wasAlreadyMyRollTurn) {
        playTurnAlertChime();
        setTurnAlert({ id: alertKey, title, subtitle });
        if (turnAlertTimerRef.current) clearTimeout(turnAlertTimerRef.current);
        turnAlertTimerRef.current = setTimeout(() => {
          setTurnAlert((prev) => (prev?.id === alertKey ? null : prev));
        }, 4500);
      }
    } else if (!alertKey) {
      lastTurnAlertKeyRef.current = '';
      setTurnAlert(null);
      if (turnAlertTimerRef.current) {
        clearTimeout(turnAlertTimerRef.current);
        turnAlertTimerRef.current = null;
      }
    }
  }, [
    myPlayerId,
    state.phase,
    state.turnNumber,
    state.setupTurnIndex,
    state.lastSetupVertexId,
    isRollPhase,
    isMySetupTurn,
    needsDiscard,
    isMyRobberTurn,
    state.currentTurnPlayerId,
    state.pairedPlayerId,
    isCK,
  ]);

  // Detect resource & commodity gains and losses in self and trigger floating animations
  useEffect(() => {
    if (!self?.resources) return;
    const currentRes = self.resources;
    const currentCom = self.commodities || { cloth: 0, coin: 0, paper: 0 };

    if (!prevResourcesRef.current) {
      prevResourcesRef.current = { ...currentRes };
      prevCommoditiesRef.current = { ...currentCom };
      return;
    }

    const prevRes = prevResourcesRef.current;
    const prevCom = prevCommoditiesRef.current || { cloth: 0, coin: 0, paper: 0 };
    const changed: Partial<Record<TradeableCardType, { delta: number; seq: number }>> = {};
    const toastBatch: Array<{ id: string; cardType: TradeableCardType; delta: number }> = [];
    const nowSeq = Date.now();

    for (const r of RESOURCES) {
      const diff = (currentRes[r] || 0) - (prevRes[r] || 0);
      if (diff !== 0) {
        changed[r] = { delta: diff, seq: nowSeq };
        toastBatch.push({ id: `${r}_${nowSeq}`, cardType: r, delta: diff });
      }
    }

    for (const c of COMMODITIES) {
      const diff = (currentCom[c] || 0) - (prevCom[c] || 0);
      if (diff !== 0) {
        changed[c] = { delta: diff, seq: nowSeq };
        toastBatch.push({ id: `${c}_${nowSeq}`, cardType: c, delta: diff });
      }
    }

    prevResourcesRef.current = { ...currentRes };
    prevCommoditiesRef.current = { ...currentCom };

    if (toastBatch.length > 0) {
      setResourceDeltas((old) => ({ ...old, ...changed }));
      setResourceToastItems(toastBatch);
      const timer = setTimeout(() => {
        setResourceDeltas((old) => {
          const next = { ...old };
          const cutoff = Date.now() - 2100;
          for (const k of Object.keys(next) as TradeableCardType[]) {
            if (next[k]?.seq === nowSeq || (next[k]?.seq || 0) <= cutoff) {
              delete next[k];
            }
          }
          return next;
        });
        setResourceToastItems((old) =>
          old.filter((item) => !toastBatch.some((b) => b.id === item.id)),
        );
      }, 2200);
      deltaTimersRef.current.push(timer);
    }
  }, [
    self?.resources?.wood,
    self?.resources?.brick,
    self?.resources?.wheat,
    self?.resources?.sheep,
    self?.resources?.ore,
    self?.commodities?.cloth,
    self?.commodities?.coin,
    self?.commodities?.paper,
  ]);

  const isSeparateActionTimer =
    state.phase === 'DISCARD_PHASE' ||
    state.phase === 'ROBBER_PLACEMENT' ||
    state.phase === 'ROBBER_STEAL' ||
    state.freeRoadsRemaining > 0 ||
    Boolean(state.pendingDisplacedKnight) ||
    Boolean(state.pendingDeserter) ||
    Boolean(state.pendingGuildDues) ||
    Boolean(state.pendingEspionage) ||
    (state.pendingWeddingPlayerIds?.length || 0) > 0 ||
    (state.pendingCommercialHarbor?.length || 0) > 0 ||
    (state.pendingAqueductPlayerIds?.length || 0) > 0 ||
    (state.pendingBarbarianRewardPlayerIds?.length || 0) > 0 ||
    (state.pendingBarbarianPillagePlayerIds?.length || 0) > 0;

  const displayedDice: [number, number] = isRollingAnim
    ? animDice
    : state.diceRoll || [1, 1];
  const displayedEventDie: EventDieFace = isRollingAnim
    ? animEventDie
    : state.eventDie || 'barbarian';
  const diceSum = displayedDice[0] + displayedDice[1];

  const handleRollDice = () => {
    if (isRollPhase && myPlayerId) {
      sendAction({ type: 'ROLL_DICE', playerId: myPlayerId });
    }
  };

  const handleSendChat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = chatInput.trim();
    if (!trimmed) return;
    sendChatMessage(trimmed);
    setChatInput('');
  };

  const orderedPlayers =
    state.playerOrder && state.playerOrder.length > 0
      ? state.playerOrder.map((id) => state.players[id]).filter(Boolean)
      : Object.values(state.players);

  const diceHistory = state.diceHistory || {
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: 0,
    7: 0,
    8: 0,
    9: 0,
    10: 0,
    11: 0,
    12: 0,
  };
  const totalRolls = Object.values(diceHistory).reduce((s, n) => s + n, 0);
  const maxRollCount = Math.max(1, ...Object.values(diceHistory));

  const isBankHidden = state.resourceBank === null || Boolean(state.settings?.houseRules?.hiddenBank);
  const totalBankResources =
    !isBankHidden && state.resourceBank
      ? Object.values(state.resourceBank).reduce((s, n) => s + n, 0)
      : null;

  const activeAwardBanner =
    state.latestAwardEvent && visibleAwardId === state.latestAwardEvent.id
      ? state.latestAwardEvent
      : null;

  const houseRules = state.settings?.houseRules;

  // Focused Dev Card or Progress Card in Upper-Right Panel
  const activeFocusedCard =
    self?.devCards.find((c) => c.id === focusedDevCardId) || self?.devCards[0] || null;
  const activeFocusedProgressCard =
    self?.progressCards?.find((c) => c.id === focusedProgressCardId) ||
    self?.progressCards?.[0] ||
    null;

  // C&K Barbarian & Knight strength metrics
  const barbarianStrength = isCK ? getBarbarianStrength(state.board) : 0;
  const totalActiveKnightStrength = isCK ? getTotalActiveKnightStrength(state.board) : 0;

  // Selected Knight on the board
  const selectedKnight =
    isCK && selectedKnightVertexId ? state.board.knights?.[selectedKnightVertexId] || null : null;

  const canSelectedKnightChaseRobber = (() => {
    if (!isCK || !isMyTurn || !selectedKnight || selectedKnight.playerId !== myPlayerId) return false;
    if (!selectedKnight.active || selectedKnight.activatedTurn === state.turnNumber) return false;
    if (!state.robberActive) return false;
    const rHex = state.board.hexes[state.board.robberHexId];
    const v = state.board.vertices[selectedKnight.vertexId];
    if (!rHex || !v) return false;
    return v.hexCoords.includes(`${rHex.q},${rHex.r},${rHex.s}`);
  })();

  const handlePlayProgressCardClick = (cardId: string, cardType: ProgressCardType) => {
    if (!myPlayerId) return;

    // Immediate non-targeted cards
    if (
      [
        'crane',
        'irrigation',
        'medicine',
        'mining',
        'road_building',
        'smithing',
        'printing',
        'constitution',
        'sabotage',
        'wedding',
        'encouragement',
      ].includes(cardType)
    ) {
      sendAction({ type: 'PLAY_PROGRESS_CARD', playerId: myPlayerId, cardId });
      if (cardType === 'crane') {
        setShowCityImprovementsModal(true);
      } else if (cardType === 'medicine') {
        setBuildMode('city');
      }
      return;
    }

    // Board-targeted cards
    if (cardType === 'engineering') {
      setActiveProgressCardId(cardId);
      setBuildMode('city_wall');
      return;
    }
    if (cardType === 'merchant') {
      setActiveProgressCardId(cardId);
      setBuildMode('merchant');
      return;
    }
    if (cardType === 'taxation') {
      setActiveProgressCardId(cardId);
      setBuildMode('taxation');
      return;
    }
    if (cardType === 'diplomacy') {
      setActiveProgressCardId(cardId);
      setBuildMode('diplomacy');
      return;
    }
    if (cardType === 'intrigue') {
      setActiveProgressCardId(cardId);
      setBuildMode('intrigue');
      return;
    }
    if (cardType === 'invention') {
      setActiveProgressCardId(cardId);
      setBuildMode('invention');
      return;
    }

    // Modal-targeted cards
    const firstOpponent = orderedPlayers.find((p) => p.id !== myPlayerId)?.id || '';
    setSelectedTargetPlayerId(firstOpponent);
    setPendingProgressModal({ cardId, type: cardType });
  };

  return (
    <div className="pointer-events-none absolute inset-0 flex justify-between p-2.5 sm:p-3.5 z-10 overflow-hidden gap-3">
      {/* 1. LEFT SIDEBAR: Players & VPs + Bank Supply + Resizable Event Log + Resizable Player Chat */}
      <div className="flex flex-col items-start gap-2 max-h-full overflow-y-auto overflow-x-visible pr-1 shrink-0">
        {/* Players & Victory Points Leaderboard */}
        <div className="pointer-events-auto w-[295px] sm:w-[315px] max-w-[33vw] bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] font-black text-amber-400 uppercase tracking-wider">
              Players & VPs (Goal: {state.settings.victoryPointsToWin})
            </span>
            <span className="text-[10px] font-bold text-slate-400 select-none">
              Turn {state.turnNumber}
            </span>
          </div>

          <div className="flex flex-col gap-1">
            {orderedPlayers.map((p, orderIdx) => {
              const isCurrentActive = p.id === activeTurnPlayerId;
              const isPairedP2 = state.settings.pairedPlayersTurn && p.id === state.pairedPlayerId;
              const isMe = p.id === myPlayerId;
              const hasSecretVp =
                isMe &&
                self &&
                self.secretVictoryPoints > p.victoryPoints &&
                state.phase !== 'GAME_OVER';
              const activeKnightStr = isCK ? getPlayerActiveKnightStrength(state.board, p.id) : 0;

              return (
                <div
                  key={p.id}
                  className={`flex flex-col gap-1 px-2 py-1.5 rounded-xl border transition ${
                    isCurrentActive
                      ? 'bg-amber-500/15 border-amber-400 shadow-md'
                      : isMe
                        ? 'bg-slate-800/80 border-slate-600'
                        : 'bg-slate-950/60 border-slate-800/80'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-[10px] font-mono font-bold text-slate-500 w-3">
                        {orderIdx + 1}.
                      </span>
                      <span
                        className={`w-3 h-3 rounded-full shrink-0 border border-white/40 ${PLAYER_BADGES[p.color]}`}
                      />
                      <span className="text-xs font-bold text-white truncate">
                        {p.name} {isMe && '(You)'}
                      </span>
                      {isCurrentActive && (
                        <span className="text-[9px] bg-amber-500 text-slate-950 font-black px-1.5 py-0.2 rounded-full">
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

                    <div className="flex items-center gap-1 text-[10px] shrink-0 ml-1">
                      <span
                        title={
                          p.hasLongestRoute
                            ? `Longest Road Holder! Length: ${p.longestRouteLength} (+2 VP)`
                            : `Longest Continuous Road Length: ${p.longestRouteLength}`
                        }
                        className={`px-1 py-0.5 rounded font-bold flex items-center gap-0.5 ${
                          p.hasLongestRoute
                            ? 'bg-amber-500/25 border border-amber-400 text-amber-300 font-black'
                            : 'bg-slate-900/90 text-slate-400'
                        }`}
                      >
                        🛣️{p.longestRouteLength}
                      </span>

                      {!isCK ? (
                        <span
                          title={
                            p.hasLargestArmy
                              ? `Largest Army Holder! Knights Played: ${p.playedKnightsCount} (+2 VP)`
                              : `Played Knights: ${p.playedKnightsCount}`
                          }
                          className={`px-1 py-0.5 rounded font-bold flex items-center gap-0.5 ${
                            p.hasLargestArmy
                              ? 'bg-rose-500/25 border border-rose-400 text-rose-300 font-black'
                              : 'bg-slate-900/90 text-slate-400'
                          }`}
                        >
                          ⚔️{p.playedKnightsCount}
                        </span>
                      ) : (
                        <span
                          title={`Active Knight Strength on Board: ${activeKnightStr}`}
                          className={`px-1 py-0.5 rounded font-bold flex items-center gap-0.5 ${
                            activeKnightStr > 0
                              ? 'bg-sky-500/25 border border-sky-400 text-sky-300 font-black'
                              : 'bg-slate-900/90 text-slate-400'
                          }`}
                        >
                          🛡️{activeKnightStr}
                        </span>
                      )}

                      {houseRules?.harborMaster && (
                        <span
                          title={
                            p.hasHarborMaster
                              ? `Harbor Master Holder! Harbor Points: ${p.harborPoints || 0} (+2 VP)`
                              : `Harbor Points: ${p.harborPoints || 0} (3+ required for Harbor Master)`
                          }
                          className={`px-1 py-0.5 rounded font-bold flex items-center gap-0.5 ${
                            p.hasHarborMaster
                              ? 'bg-cyan-500/25 border border-cyan-400 text-cyan-300 font-black'
                              : 'bg-slate-900/90 text-slate-400'
                          }`}
                        >
                          ⚓{p.harborPoints || 0}
                        </span>
                      )}

                      <span title="Resource + Commodity Cards in Hand" className="font-semibold text-slate-300">
                        {p.cardCount}🎴
                      </span>
                      <span
                        title={isCK ? 'Progress Cards in Hand' : 'Unplayed Dev Cards'}
                        className="font-semibold text-indigo-300"
                      >
                        {isCK ? p.progressCardCount : p.devCardCount}📜
                      </span>
                      <span
                        title={
                          hasSecretVp
                            ? `Public VP: ${p.victoryPoints} | True Total: ${self?.secretVictoryPoints} VP`
                            : `Victory Points: ${p.victoryPoints}`
                        }
                        className="font-black text-amber-300 bg-amber-950/80 px-1.5 py-0.5 rounded-lg border border-amber-700/80 flex items-center gap-0.5"
                      >
                        {p.victoryPoints} VP
                        {hasSecretVp && (
                          <span className="text-[9px] text-emerald-300 font-extrabold flex items-center">
                            ({self?.secretVictoryPoints}
                            <Lock className="w-2.5 h-2.5 inline" />)
                          </span>
                        )}
                      </span>

                      {isHost && !isMe && orderedPlayers.length > 1 && state.phase !== 'GAME_OVER' && (
                        <button
                          type="button"
                          onClick={() => kickPlayer(p.id)}
                          title={`Kick ${p.name}`}
                          className="p-1 bg-rose-950/90 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-700/80 rounded-lg transition cursor-pointer"
                        >
                          <UserMinus className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* C&K Sub-row: City Improvements, Metropolises, Defender of Catan, Merchant */}
                  {isCK && (
                    <div className="flex items-center justify-between text-[9px] text-slate-300 pt-0.5 border-t border-slate-800/70">
                      <div className="flex items-center gap-1.5">
                        <span title="Trade Improvement Level" className="text-amber-300 font-bold">
                          🟡T{p.cityImprovements?.trade || 0}
                        </span>
                        <span title="Politics Improvement Level" className="text-sky-300 font-bold">
                          🔵P{p.cityImprovements?.politics || 0}
                        </span>
                        <span title="Science Improvement Level" className="text-emerald-300 font-bold">
                          🟢S{p.cityImprovements?.science || 0}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {p.metropolises?.length > 0 && (
                          <span
                            title={`Metropolises Owned: ${p.metropolises.join(', ')} (+2 VP each)`}
                            className="bg-amber-950/90 border border-amber-500/70 text-amber-200 px-1 rounded font-bold"
                          >
                            🏛️×{p.metropolises.length}
                          </span>
                        )}
                        {p.defenderPoints > 0 && (
                          <span
                            title={`Defender of Catan (+${p.defenderPoints} VP)`}
                            className="bg-emerald-950/90 border border-emerald-500/70 text-emerald-200 px-1 rounded font-bold"
                          >
                            🏆+{p.defenderPoints}
                          </span>
                        )}
                        {p.hasMerchant && (
                          <span
                            title="Controls the Merchant (+1 VP & 2:1 trade rate)"
                            className="bg-purple-950/90 border border-purple-500/70 text-purple-200 px-1 rounded font-bold"
                          >
                            🟣Merch
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Resource Deck, Commodity Deck & Progress/Dev Card Bank Supply Counter */}
        <div className="pointer-events-auto w-[295px] sm:w-[315px] max-w-[33vw] bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2 shadow-2xl flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />{' '}
              {isBankHidden ? 'Bank Supply (Hidden)' : `Bank Supply (${totalBankResources})`}
            </span>
            {isCK ? (
              <span className="text-[9px] font-bold text-slate-300 flex items-center gap-1.5">
                <span className="flex items-center gap-0.5" title="Trade Progress Deck">
                  <img
                    src="/assets/cards/progress_trade_back.png"
                    alt="Trade Deck"
                    className="w-3 h-4 object-cover rounded-xs"
                  />
                  {state.progressDeckCounts?.trade ?? 0}
                </span>
                <span className="flex items-center gap-0.5" title="Politics Progress Deck">
                  <img
                    src="/assets/cards/progress_politics_back.png"
                    alt="Politics Deck"
                    className="w-3 h-4 object-cover rounded-xs"
                  />
                  {state.progressDeckCounts?.politics ?? 0}
                </span>
                <span className="flex items-center gap-0.5" title="Science Progress Deck">
                  <img
                    src="/assets/cards/progress_science_back.png"
                    alt="Science Deck"
                    className="w-3 h-4 object-cover rounded-xs"
                  />
                  {state.progressDeckCounts?.science ?? 0}
                </span>
              </span>
            ) : (
              <span className="text-[10px] font-bold text-indigo-300">
                Dev Pile: {state.devCardDeckCount}
              </span>
            )}
          </div>

          {isBankHidden || !state.resourceBank ? (
            <div className="flex items-center justify-center gap-2 bg-slate-950/80 py-2 px-3 rounded-xl border border-amber-700/40 text-[11px] font-bold text-amber-300">
              <EyeOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Hidden Bank House Rule Active</span>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="grid grid-cols-5 gap-1">
                {RESOURCES.map((r) => {
                  const remaining = state.resourceBank?.[r] ?? 0;
                  return (
                    <div
                      key={r}
                      title={`${RESOURCE_LABELS[r]} remaining in bank: ${remaining}`}
                      className="flex flex-col items-center bg-slate-950/80 py-1 px-1 rounded-xl border border-slate-800"
                    >
                      <img
                        src={RESOURCE_ICONS[r]}
                        alt={r}
                        className="w-5 h-7 object-cover rounded shadow-sm mb-0.5"
                      />
                      <span
                        className={`text-[10px] font-black ${
                          remaining === 0
                            ? 'text-rose-400'
                            : remaining <= 4
                              ? 'text-amber-400'
                              : 'text-slate-200'
                        }`}
                      >
                        {remaining}
                      </span>
                    </div>
                  );
                })}
              </div>

              {isCK && state.commodityBank && (
                <div className="grid grid-cols-5 gap-1">
                  {COMMODITIES.map((c) => {
                    const remaining = state.commodityBank?.[c] ?? 0;
                    return (
                      <div
                        key={c}
                        title={`${COMMODITY_LABELS[c]} remaining in bank: ${remaining}`}
                        className="flex flex-col items-center bg-slate-950/80 py-1 px-1 rounded-xl border border-slate-800"
                      >
                        <img
                          src={COMMODITY_ICONS[c]}
                          alt={COMMODITY_LABELS[c]}
                          className="w-5 h-7 object-cover rounded shadow-sm mb-0.5"
                        />
                        <span
                          className={`text-[10px] font-black ${
                            remaining === 0
                              ? 'text-rose-400'
                              : remaining <= 3
                                ? 'text-amber-400'
                                : 'text-slate-200'
                          }`}
                        >
                          {remaining}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Event Log Panel */}
        <ResizableHudBox
          storageKey="catan_event_log_size"
          defaultWidth={315}
          defaultHeight={180}
          minWidth={230}
          maxWidth={600}
          minHeight={115}
          maxHeight={460}
          className="pointer-events-auto bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between px-1 shrink-0">
            <span className="text-[10px] font-black text-sky-400 uppercase tracking-wider flex items-center gap-1">
              <ScrollText className="w-3.5 h-3.5" /> Event Log
            </span>
            <span className="text-[10px] font-semibold text-slate-500">
              {state.actionLog.length} events • drag corner ⤡
            </span>
          </div>

          <div
            ref={logContainerRef}
            className="flex flex-col gap-1 overflow-y-auto pr-1 text-[11px] flex-1 min-h-0"
          >
            {state.actionLog.map((entry) => {
              const entryPlayer = entry.playerId ? state.players[entry.playerId] : null;
              return (
                <div
                  key={entry.id}
                  className="flex items-start gap-1.5 bg-slate-950/75 px-2 py-1 rounded-lg border border-slate-800/80 text-slate-200 leading-snug"
                >
                  {entryPlayer ? (
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 mt-1 border border-white/40 ${
                        PLAYER_BADGES[entryPlayer.color]
                      }`}
                    />
                  ) : (
                    <span className="w-2 h-2 rounded-full shrink-0 mt-1 bg-amber-400/80" />
                  )}
                  <span className="break-words">{entry.message}</span>
                </div>
              );
            })}
          </div>
        </ResizableHudBox>

        {/* Room-Scoped Player Chat Panel */}
        <ResizableHudBox
          storageKey="catan_player_chat_size"
          defaultWidth={315}
          defaultHeight={185}
          minWidth={230}
          maxWidth={600}
          minHeight={135}
          maxHeight={480}
          className="pointer-events-auto bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-1.5"
        >
          <div className="flex items-center justify-between px-1 shrink-0">
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1">
              <MessageSquare className="w-3.5 h-3.5" /> Player Chat
            </span>
            <span className="text-[10px] font-semibold text-slate-500">
              {chatMessages.length} msgs • drag corner ⤡
            </span>
          </div>

          <div
            ref={chatContainerRef}
            className="flex flex-col gap-1 overflow-y-auto pr-1 text-[11px] flex-1 min-h-0"
          >
            {chatMessages.length === 0 ? (
              <div className="text-[10px] text-slate-500 italic text-center py-4">
                No messages yet. Say hello to the table!
              </div>
            ) : (
              chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className="bg-slate-950/80 px-2 py-1 rounded-lg border border-slate-800/80 text-slate-200 leading-snug break-words"
                >
                  <span className="inline-flex items-center gap-1 font-bold text-white mr-1.5">
                    <span
                      className={`w-2 h-2 rounded-full inline-block border border-white/40 ${
                        PLAYER_BADGES[msg.playerColor] || 'bg-amber-400'
                      }`}
                    />
                    {msg.playerName}:
                  </span>
                  <span className="text-slate-200">{msg.text}</span>
                </div>
              ))
            )}
          </div>

          <form onSubmit={handleSendChat} className="flex items-center gap-1.5 pt-0.5 shrink-0">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Message room..."
              maxLength={300}
              className="flex-1 min-w-0 px-2.5 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
            />
            <button
              type="submit"
              disabled={!chatInput.trim()}
              title="Send message"
              className="p-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-35 text-white rounded-xl transition cursor-pointer shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </form>
        </ResizableHudBox>
      </div>

      {/* 2. CENTER COLUMN: Top Turn/Timer/Dice + Barbarian Track + Middle Alerts */}
      <div className="flex-1 flex flex-col items-center justify-between min-w-0 pointer-events-none">
        {/* TOP-CENTER BAR */}
        <div className="pointer-events-auto flex flex-col items-center gap-1.5 max-w-full">
          <div className="relative flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 px-3.5 py-2 rounded-2xl shadow-2xl">
            {/* Active Player & Phase Instruction */}
            <div className="flex items-center gap-2">
              <span
                className={`w-3 h-3 rounded-full shrink-0 ${
                  state.players[activeTurnPlayerId]
                    ? PLAYER_BADGES[state.players[activeTurnPlayerId].color]
                    : 'bg-slate-500'
                }`}
              />
              <span className="text-xs sm:text-sm font-black text-white truncate max-w-[120px]">
                {state.players[activeTurnPlayerId]?.name || 'Player'}
              </span>
              <span
                className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                  isSeparateActionTimer
                    ? 'bg-indigo-950/90 text-indigo-200 border-indigo-500'
                    : 'bg-slate-800 text-amber-300 border-slate-700'
                }`}
              >
                {state.phase === 'SETUP_ROUND_1' &&
                  (state.lastSetupVertexId ? 'Setup 1: Place Road' : 'Setup 1: Settlement')}
                {state.phase === 'SETUP_ROUND_2' &&
                  (state.lastSetupVertexId
                    ? 'Setup 2: Place Road'
                    : isCK
                      ? 'Setup 2: Place City'
                      : 'Setup 2: 2nd Settlement')}
                {state.phase === 'TURN_START' && 'Roll Dice'}
                {state.phase === 'DISCARD_PHASE' && '7 Rolled: Discard Half'}
                {state.phase === 'ROBBER_PLACEMENT' && 'Move Robber'}
                {state.phase === 'ROBBER_STEAL' && 'Steal 1 Card'}
                {state.phase === 'ACTION_PHASE' &&
                  (state.freeRoadsRemaining > 0
                    ? `Place ${state.freeRoadsRemaining} Free Road(s)`
                    : 'Trade & Build')}
                {state.phase === 'PAIRED_ACTION_PHASE' &&
                  (state.freeRoadsRemaining > 0
                    ? `Place ${state.freeRoadsRemaining} Free Road(s)`
                    : 'Paired Player 2 Turn')}
                {state.phase === 'GAME_OVER' && 'Match Finished!'}
              </span>
            </div>

            {/* Countdown Timer */}
            {state.turnDeadlineMs && state.phase !== 'GAME_OVER' && (
              <TurnTimerDisplay
                turnDeadlineMs={state.turnDeadlineMs}
                phaseDurationMs={state.phaseDurationMs}
                isSeparateActionTimer={isSeparateActionTimer}
                savedActionRemainingMs={state.savedActionRemainingMs}
              />
            )}

            {/* Animated Visual Dice Controls (2d6 in Base Game; White + Red + Event Die in C&K) */}
            <div
              onClick={handleRollDice}
              title={
                isRollPhase
                  ? 'Click dice to roll for your turn!'
                  : state.diceRolledThisTurn
                    ? `Current turn roll: ${displayedDice[0]} + ${displayedDice[1]} = ${diceSum}${
                        isCK ? ` (Red Die: ${displayedDice[1]}, Event: ${displayedEventDie})` : ''
                      }`
                    : 'Waiting for dice roll'
              }
              className={`flex items-center gap-1.5 bg-slate-950/90 px-2.5 py-1 rounded-xl border transition ${
                isRollPhase
                  ? 'border-amber-400 cursor-pointer ring-2 ring-amber-400/50 hover:bg-slate-900 animate-pulse'
                  : 'border-slate-800'
              }`}
            >
              <div
                className={`flex items-center gap-1.5 transition-opacity ${
                  !state.diceRolledThisTurn && !isRollingAnim ? 'opacity-45' : 'opacity-100'
                }`}
              >
                <VisualDie
                  value={displayedDice[0]}
                  variant={isCK ? 'white' : 'red'}
                  isRolling={isRollingAnim}
                />
                <VisualDie
                  value={displayedDice[1]}
                  variant={isCK ? 'red' : 'yellow'}
                  isRolling={isRollingAnim}
                />
                {isCK && <VisualEventDie face={displayedEventDie} isRolling={isRollingAnim} />}
              </div>
              <div className="flex flex-col items-center pl-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase leading-none">
                  {state.diceRolledThisTurn ? 'Total' : 'Roll'}
                </span>
                <span
                  className={`text-base sm:text-lg font-black leading-tight ${
                    !state.diceRolledThisTurn
                      ? 'text-amber-400'
                      : diceSum === 6 || diceSum === 8 || diceSum === 7
                        ? 'text-rose-400'
                        : 'text-white'
                  }`}
                >
                  {isRollingAnim ? '…' : state.diceRolledThisTurn ? diceSum : '🎲'}
                </span>
              </div>
            </div>

            {/* Roll Dice Button */}
            {isRollPhase && (
              <button
                type="button"
                onClick={handleRollDice}
                className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs px-4 py-2 rounded-xl shadow-lg transition active:scale-95 animate-pulse cursor-pointer"
              >
                <Dices className="w-4 h-4" /> Roll Dice
              </button>
            )}

            {/* End Turn Button */}
            {isMyTurn && (
              <button
                type="button"
                onClick={() => myPlayerId && sendAction({ type: 'END_TURN', playerId: myPlayerId })}
                className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs px-4 py-2 rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
              >
                End Turn <ChevronRight className="w-4 h-4" />
              </button>
            )}

            {/* Exit to Home Screen Button when Game Ends */}
            {state.phase === 'GAME_OVER' && (
              <button
                type="button"
                onClick={exitToHomeScreen}
                className="flex items-center gap-1.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-xs px-4 py-2 rounded-xl shadow-lg transition active:scale-95 cursor-pointer"
              >
                <Home className="w-4 h-4" /> Exit to Home Screen
              </button>
            )}

            {/* Dice Statistics Positioned to the Right of Dice Controls */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDiceStats((prev) => !prev)}
                title="Toggle Dice Roll Statistics"
                className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-black transition cursor-pointer ${
                  showDiceStats
                    ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                    : 'bg-slate-950/90 hover:bg-slate-800 border-slate-800 text-slate-300'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-amber-400" />
                <span>Stats ({totalRolls})</span>
                <span>{showDiceStats ? '▴' : '▾'}</span>
              </button>

              {showDiceStats && (
                <div className="absolute right-0 top-full mt-2 w-68 bg-slate-900/95 backdrop-blur-2xl border border-slate-700 rounded-2xl p-3 shadow-2xl z-50 flex flex-col gap-1.5 max-h-[55vh] overflow-y-auto">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                    <span className="text-[11px] font-black text-amber-400 uppercase tracking-wider">
                      Dice Roll Distribution
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">
                      {houseRules?.balancedDice ? 'Balanced Deck' : 'CSPRNG 2d6'}
                    </span>
                  </div>
                  {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((sum) => {
                    const count = diceHistory[sum] || 0;
                    const pct = totalRolls > 0 ? Math.round((count / maxRollCount) * 100) : 0;
                    const expected =
                      totalRolls > 0
                        ? ((totalRolls * (DICE_WAYS_OUT_OF_36[sum] || 0)) / 36).toFixed(1)
                        : '0.0';
                    const isHighProb = sum === 6 || sum === 8;
                    const isSeven = sum === 7;
                    return (
                      <div key={sum} className="flex items-center gap-2 text-[10px]">
                        <span
                          className={`w-4 text-right font-mono font-black ${
                            isSeven
                              ? 'text-amber-400'
                              : isHighProb
                                ? 'text-rose-400'
                                : 'text-slate-300'
                          }`}
                        >
                          {sum}
                        </span>
                        <div className="flex-1 h-2 bg-slate-950 rounded-full overflow-hidden border border-slate-800/80">
                          <div
                            className={`h-full transition-all duration-300 ${
                              isSeven
                                ? 'bg-amber-500'
                                : isHighProb
                                  ? 'bg-rose-500'
                                  : 'bg-sky-500'
                            }`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-16 text-right font-mono font-bold text-slate-200">
                          {count}{' '}
                          <span className="text-[9px] text-slate-500 font-normal">({expected})</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Cities & Knights Barbarian Ship Track & Defense Status Bar */}
          {isCK && (
            <div className="flex flex-wrap items-center justify-center gap-3 bg-slate-900/92 backdrop-blur-xl border border-amber-500/40 px-3.5 py-1.5 rounded-2xl shadow-xl text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-black text-amber-300 flex items-center gap-1">
                  ⛵ Barbarians ({state.barbarianPosition || 0}/7):
                </span>
                <div className="flex items-center gap-1">
                  {[0, 1, 2, 3, 4, 5, 6, 7].map((step) => {
                    const curPos = state.barbarianPosition || 0;
                    const isCurrent = curPos === step;
                    const isAttack = step === 7;
                    return (
                      <div
                        key={step}
                        title={`Track Position ${step}${isAttack ? ' (BARBARIAN ATTACK!)' : ''}`}
                        className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black border transition ${
                          isCurrent
                            ? 'bg-rose-600 border-amber-300 text-white scale-125 shadow-lg'
                            : step < curPos
                              ? 'bg-rose-950/90 border-rose-700 text-rose-400'
                              : isAttack
                                ? 'bg-slate-950 border-rose-500/70 text-rose-400'
                                : 'bg-slate-950 border-slate-700 text-slate-500'
                        }`}
                      >
                        {isCurrent ? '⛵' : isAttack ? '⚔️' : step}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div
                className={`flex items-center gap-2 px-2.5 py-0.5 rounded-xl border text-[11px] font-black ${
                  totalActiveKnightStrength >= barbarianStrength
                    ? 'bg-emerald-950/90 border-emerald-500/80 text-emerald-300'
                    : 'bg-rose-950/90 border-rose-500/80 text-rose-300'
                }`}
                title="Active Knight Strength vs. Barbarian Strength (Total Cities on Catan)"
              >
                <span>🛡️ Knights: {totalActiveKnightStrength}</span>
                <span className="text-slate-400">vs</span>
                <span>🏰 Cities: {barbarianStrength}</span>
                <span>
                  {totalActiveKnightStrength >= barbarianStrength ? '✓ Defended' : '⚠️ Vulnerable!'}
                </span>
              </div>

              {!state.robberActive && (
                <span
                  title="In Cities & Knights, the Robber cannot move until after the first Barbarian Attack"
                  className="text-[10px] font-bold bg-slate-950/90 border border-slate-700 text-slate-400 px-2 py-0.5 rounded-lg"
                >
                  🦹 Robber Inactive (Until 1st Attack)
                </span>
              )}
            </div>
          )}

          {/* Active Board Targeting Mode Helper Banner */}
          {activeBuildMode !== 'none' && (
            <div className="bg-amber-950/95 border-2 border-amber-400 text-amber-100 px-4 py-1.5 rounded-xl shadow-xl flex items-center gap-2.5 text-xs font-bold">
              <span>
                {activeBuildMode === 'city_wall' && '🧱 Click one of your unwalled Cities on the board to place a City Wall'}
                {activeBuildMode === 'knight' && '🛡️ Click a highlighted vertex connected to your roads to recruit a Basic Knight'}
                {activeBuildMode === 'move_knight' && '⚔️ Click a highlighted vertex on the same road network to move or displace with your Knight'}
                {activeBuildMode === 'chase_robber' && '🦹 Click any highlighted hex to chase the Robber away with your Knight'}
                {activeBuildMode === 'merchant' && '🟣 Click a land hex adjacent to one of your Settlements or Cities to place the Merchant'}
                {activeBuildMode === 'taxation' && '⛪ Click any highlighted land hex to move the Robber and steal 1 card from each adjacent opponent'}
                {activeBuildMode === 'diplomacy' && '🛣️ Click any highlighted open road at the end of a road network to remove/relocate it'}
                {activeBuildMode === 'intrigue' && '🗡️ Click an opponent Knight touching one of your roads to displace it'}
                {activeBuildMode === 'invention' && '🔢 Click 2 land hexes (except 2, 6, 8, 12) to swap their number tokens'}
                {activeBuildMode === 'road' && '🛣️ Click a highlighted edge to build a Road'}
                {activeBuildMode === 'settlement' && '🏠 Click a highlighted vertex to build a Settlement'}
                {activeBuildMode === 'city' && '🏰 Click one of your Settlements to upgrade it to a City'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setBuildMode('none');
                  setActiveProgressCardId(null);
                }}
                className="px-2 py-0.5 bg-slate-900 hover:bg-slate-800 text-amber-300 rounded-lg text-[11px] font-black cursor-pointer"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Smith Free Promotions Banner */}
          {isCK && isMyTurn && (state.freeKnightPromotionsRemaining || 0) > 0 && (
            <div className="bg-indigo-950/95 border-2 border-indigo-400 text-indigo-100 px-4 py-1.5 rounded-xl shadow-xl flex items-center gap-2 text-xs font-bold">
              <span>
                ⚒️ Smith Active: You have {state.freeKnightPromotionsRemaining} free Knight promotion(s) remaining! Click one of your Knights on the board and click Promote (Free).
              </span>
            </div>
          )}

          {/* Displaced Knight / Deserter Interactive Board Prompts */}
          {isCK && myPlayerId && state.pendingDisplacedKnight?.playerId === myPlayerId && (
            <div className="bg-amber-950/95 border-2 border-amber-400 text-amber-100 px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 text-xs font-black animate-pulse">
              <span>
                ⚔️ Your Level {state.pendingDisplacedKnight.level} Knight was displaced! Click a highlighted vertex connected to your roads to relocate it.
              </span>
            </div>
          )}

          {isCK &&
            myPlayerId &&
            state.pendingDeserter?.stage === 'choose_victim_knight' &&
            state.pendingDeserter.targetPlayerId === myPlayerId && (
              <div className="bg-rose-950/95 border-2 border-rose-400 text-rose-100 px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 text-xs font-black animate-pulse">
                <span>
                  🏳️ Deserter! {state.players[state.pendingDeserter.requesterId]?.name} played Deserter against you — click one of your highlighted Knights on the board to desert!
                </span>
              </div>
            )}

          {isCK &&
            myPlayerId &&
            state.pendingDeserter?.stage === 'place_new_knight' &&
            state.pendingDeserter.requesterId === myPlayerId && (
              <div className="bg-sky-950/95 border-2 border-sky-400 text-sky-100 px-4 py-2 rounded-xl shadow-xl flex items-center gap-2 text-xs font-black animate-pulse">
                <span>
                  🛡️ Place Deserter Knight! Click a highlighted empty vertex connected to your roads to place your new Knight.
                </span>
              </div>
            )}

          {/* Turn Alert Notification Banner */}
          {turnAlert && (
            <div className="bg-gradient-to-r from-emerald-500/95 via-teal-500/95 to-sky-500/95 text-slate-950 px-5 py-2 rounded-2xl shadow-2xl border-2 border-white/90 flex items-center gap-3 animate-bounce">
              <BellRing className="w-5 h-5 text-slate-950 shrink-0" />
              <div className="flex flex-col">
                <span className="text-xs font-black uppercase tracking-wider">
                  {turnAlert.title}
                </span>
                <span className="text-[11px] font-extrabold text-slate-900">
                  {turnAlert.subtitle}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTurnAlert(null)}
                className="ml-2 px-2 py-0.5 bg-slate-950/20 hover:bg-slate-950/35 rounded-lg text-xs font-black cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Celebratory Longest Road / Largest Army / Metropolis / Defender of Catan / Harbor Master Notification Banner */}
          {activeAwardBanner && (
            <div className="bg-gradient-to-r from-amber-500/95 via-amber-400/95 to-yellow-500/95 text-slate-950 px-5 py-2 rounded-2xl shadow-2xl border-2 border-white/80 flex items-center gap-3 animate-bounce">
              {activeAwardBanner.awardType === 'longest_route' ||
              activeAwardBanner.awardType === 'metropolis' ||
              activeAwardBanner.awardType === 'harbor_master' ? (
                <Trophy className="w-5 h-5 text-slate-950 shrink-0" />
              ) : (
                <Swords className="w-5 h-5 text-slate-950 shrink-0" />
              )}
              <div className="flex flex-col">
                <span className="text-[11px] font-black uppercase tracking-wider">
                  {activeAwardBanner.awardType === 'longest_route'
                    ? '🛣️ Longest Road Claimed (+2 VP)!'
                    : activeAwardBanner.awardType === 'metropolis'
                      ? `🏛️ ${activeAwardBanner.subtitle || 'Metropolis Claimed (+2 VP)!'}`
                      : activeAwardBanner.awardType === 'defender_of_catan'
                        ? '🛡️ Defender of Catan (+1 VP)!'
                        : activeAwardBanner.awardType === 'harbor_master'
                          ? '⚓ Harbor Master Claimed (+2 VP)!'
                          : '⚔️ Largest Army Claimed (+2 VP)!'}
                </span>
                <span className="text-xs font-extrabold">
                  {activeAwardBanner.awardType === 'longest_route'
                    ? `${activeAwardBanner.playerName} now holds Longest Road (${activeAwardBanner.metricValue} roads)!`
                    : activeAwardBanner.awardType === 'metropolis'
                      ? `${activeAwardBanner.playerName} reached Level ${activeAwardBanner.metricValue} and claimed the Metropolis!`
                      : activeAwardBanner.awardType === 'defender_of_catan'
                        ? `${activeAwardBanner.playerName} led the defense of Catan (${activeAwardBanner.subtitle || `${activeAwardBanner.metricValue} Defender VP`})!`
                        : activeAwardBanner.awardType === 'harbor_master'
                          ? `${activeAwardBanner.playerName} now holds Harbor Master (${activeAwardBanner.metricValue} Harbor Points)!`
                          : `${activeAwardBanner.playerName} now holds Largest Army (${activeAwardBanner.metricValue} Knights)!`}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setVisibleAwardId(null)}
                className="ml-2 px-2 py-0.5 bg-slate-950/20 hover:bg-slate-950/35 rounded-lg text-xs font-black cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}
        </div>

        {/* MIDDLE FLOATING ALERTS & MODALS */}
        <div className="flex flex-col items-center gap-3 my-auto max-h-[75vh] overflow-y-auto px-2">
          {/* Game Over Victory Card */}
          {state.phase === 'GAME_OVER' && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-3xl p-6 shadow-2xl backdrop-blur-2xl flex flex-col items-center gap-4 max-w-md w-full text-center">
              <div className="w-14 h-14 rounded-2xl bg-amber-500/20 border-2 border-amber-400 flex items-center justify-center">
                <Trophy className="w-8 h-8 text-amber-400" />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs font-black text-amber-400 uppercase tracking-widest">
                  Victory Claimed!
                </span>
                <h2 className="text-2xl font-black text-white">
                  {state.winnerId && state.players[state.winnerId]
                    ? `${state.players[state.winnerId].name} Wins!`
                    : 'Match Complete!'}
                </h2>
                {state.winnerId && state.players[state.winnerId] && (
                  <span className="text-xs font-bold text-slate-300">
                    Reached {state.players[state.winnerId].victoryPoints} Victory Points
                  </span>
                )}
              </div>

              <div className="w-full flex flex-col gap-1.5 bg-slate-950/85 p-3 rounded-2xl border border-slate-800">
                {[...orderedPlayers]
                  .sort((a, b) => b.victoryPoints - a.victoryPoints)
                  .map((p, idx) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-400">#{idx + 1}</span>
                        <span
                          className={`w-3 h-3 rounded-full border border-white/40 ${PLAYER_BADGES[p.color]}`}
                        />
                        <span className="font-bold text-white">
                          {p.name} {p.id === myPlayerId && '(You)'}
                        </span>
                      </div>
                      <span className="font-black text-amber-400">{p.victoryPoints} VP</span>
                    </div>
                  ))}
              </div>

              <button
                type="button"
                onClick={exitToHomeScreen}
                className="w-full py-3.5 px-6 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-black text-sm rounded-2xl shadow-xl transition flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
              >
                <Home className="w-4 h-4" /> Exit to Home Screen
              </button>
            </div>
          )}

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

          {/* City Improvements Flip-Chart Modal (Cities & Knights) */}
          {isCK && showCityImprovementsModal && self && myPlayerId && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-lg w-full">
              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-amber-400" />
                  <span className="text-sm font-black text-white">
                    City Improvements & Metropolises
                  </span>
                  {(state.craneDiscountsRemaining || 0) > 0 && (
                    <span className="text-[10px] font-black bg-emerald-950 border border-emerald-500 text-emerald-300 px-2 py-0.5 rounded-full">
                      🏗️ Crane Active (-1 Commodity Cost!)
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setShowCityImprovementsModal(false)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-2.5">
                {DISCIPLINES.map((disc) => {
                  const style = DISCIPLINE_STYLES[disc];
                  const comm = DISCIPLINE_COMMODITY[disc];
                  const curLevel = self.cityImprovements?.[disc] || 0;
                  const nextLevel = curLevel + 1;
                  const baseCost = nextLevel;
                  const cost =
                    (state.craneDiscountsRemaining || 0) > 0 ? Math.max(0, baseCost - 1) : baseCost;
                  const heldComm = self.commodities?.[comm] || 0;
                  const hasCity = Object.values(state.board.buildings).some(
                    (b) => b.playerId === myPlayerId && b.type === 'city',
                  );
                  const metroState = state.metropolises?.[disc];
                  const metroOwner = metroState?.ownerId ? state.players[metroState.ownerId] : null;
                  const canUpgrade =
                    isMyTurn &&
                    curLevel < 5 &&
                    hasCity &&
                    heldComm >= cost &&
                    !(nextLevel === 5 && metroState?.ownerId && (metroState.level || 0) >= 5);

                  const specialBonus =
                    disc === 'trade'
                      ? 'Lv 3 Trading House: Trade any Commodity 2:1 with Bank'
                      : disc === 'politics'
                        ? 'Lv 3 Fortress: Promote Strong Knights to Mighty Knights (Lv 3)'
                        : 'Lv 3 Aqueduct: Take 1 free Resource if non-7 roll produces 0 resources for you';

                  return (
                    <div
                      key={disc}
                      className={`flex flex-col gap-1.5 bg-slate-950/90 p-3 rounded-xl border ${style.border}/50`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-base">{style.emoji}</span>
                          <span className={`text-xs font-black uppercase ${style.text}`}>
                            {style.label} ({COMMODITY_EMOJIS[comm]} {COMMODITY_LABELS[comm]})
                          </span>
                          <span className="text-[11px] font-bold text-white bg-slate-800 px-2 py-0.5 rounded-lg">
                            Level {curLevel}/5
                          </span>
                        </div>
                        {metroOwner ? (
                          <span className="text-[10px] font-bold bg-amber-950/90 border border-amber-500 text-amber-300 px-2 py-0.5 rounded-lg">
                            🏛️ Metropolis: {metroOwner.name} (Lv {metroState?.level})
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold text-slate-400">
                            🏛️ Metropolis Open at Lv 4!
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-5 gap-1">
                        {[1, 2, 3, 4, 5].map((lv) => {
                          const name = CITY_IMPROVEMENT_NAMES[disc][lv - 1];
                          const unlocked = curLevel >= lv;
                          return (
                            <div
                              key={lv}
                              className={`flex flex-col items-center p-1.5 rounded-lg border text-center ${
                                unlocked
                                  ? `${style.badgeBg} ${style.border} text-white`
                                  : 'bg-slate-900/70 border-slate-800 text-slate-500'
                              }`}
                            >
                              <span className="text-[9px] font-black">
                                Lv {lv} {lv >= 4 ? '🏛️' : ''}
                              </span>
                              <span className="text-[8px] font-bold truncate w-full">{name}</span>
                            </div>
                          );
                        })}
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-slate-300">{specialBonus}</span>
                        {curLevel < 5 ? (
                          <button
                            type="button"
                            disabled={!canUpgrade}
                            onClick={() =>
                              sendAction({
                                type: 'UPGRADE_CITY_IMPROVEMENT',
                                playerId: myPlayerId,
                                discipline: disc,
                              })
                            }
                            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 disabled:opacity-35 text-slate-950 font-black text-xs rounded-xl transition cursor-pointer shrink-0"
                          >
                            Upgrade to Lv {nextLevel} ({cost} {COMMODITY_EMOJIS[comm]})
                          </button>
                        ) : (
                          <span className="text-[10px] font-black text-emerald-400">
                            Max Level (5) Reached!
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selected Knight Control Card */}
          {isCK && selectedKnight && selectedKnight.playerId === myPlayerId && myPlayerId && self && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-sky-400 rounded-2xl p-3.5 shadow-2xl backdrop-blur-2xl flex flex-col gap-2.5 max-w-md w-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-sky-400" />
                  <span className="text-xs font-black text-white">
                    {selectedKnight.level === 1
                      ? 'Basic Knight (Lv 1)'
                      : selectedKnight.level === 2
                        ? 'Strong Knight (Lv 2)'
                        : 'Mighty Knight (Lv 3)'}{' '}
                    •{' '}
                    <span className={selectedKnight.active ? 'text-emerald-400' : 'text-slate-400'}>
                      {selectedKnight.active ? 'Active ⚡' : 'Inactive 💤'}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedKnightVertexId(null);
                    if (activeBuildMode === 'move_knight' || activeBuildMode === 'chase_robber') {
                      setBuildMode('none');
                    }
                  }}
                  className="text-xs text-slate-400 hover:text-white px-1.5 py-0.5 rounded bg-slate-800 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {/* 1. Activate Knight */}
                <button
                  type="button"
                  disabled={!isMyTurn || selectedKnight.active || (self.resources.wheat || 0) < 1}
                  onClick={() =>
                    sendAction({
                      type: 'ACTIVATE_KNIGHT',
                      playerId: myPlayerId,
                      vertexId: selectedKnight.vertexId,
                    })
                  }
                  className="py-2 px-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-35 text-white font-black text-[11px] rounded-xl transition cursor-pointer"
                >
                  ⚡ Activate (1🌾)
                </button>

                {/* 2. Promote Knight */}
                <button
                  type="button"
                  disabled={
                    !isMyTurn ||
                    selectedKnight.level >= 3 ||
                    selectedKnight.promotedTurn === state.turnNumber ||
                    (selectedKnight.level === 2 && (self.cityImprovements?.politics || 0) < 3) ||
                    ((state.freeKnightPromotionsRemaining || 0) <= 0 &&
                      ((self.resources.sheep || 0) < 1 || (self.resources.ore || 0) < 1))
                  }
                  onClick={() =>
                    sendAction({
                      type: 'PROMOTE_KNIGHT',
                      playerId: myPlayerId,
                      vertexId: selectedKnight.vertexId,
                    })
                  }
                  className="py-2 px-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-35 text-white font-black text-[11px] rounded-xl transition cursor-pointer"
                >
                  ⬆️ Promote ({(state.freeKnightPromotionsRemaining || 0) > 0 ? 'Free' : '1🐑1🪨'})
                </button>

                {/* 3. Move / Displace */}
                <button
                  type="button"
                  disabled={
                    !isMyTurn ||
                    !selectedKnight.active ||
                    selectedKnight.activatedTurn === state.turnNumber
                  }
                  onClick={() =>
                    setBuildMode(activeBuildMode === 'move_knight' ? 'none' : 'move_knight')
                  }
                  className={`py-2 px-2 font-black text-[11px] rounded-xl transition cursor-pointer ${
                    activeBuildMode === 'move_knight'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-sky-600 hover:bg-sky-500 disabled:opacity-35 text-white'
                  }`}
                >
                  🏃 Move / Displace
                </button>

                {/* 4. Chase Robber */}
                <button
                  type="button"
                  disabled={!canSelectedKnightChaseRobber}
                  onClick={() =>
                    setBuildMode(activeBuildMode === 'chase_robber' ? 'none' : 'chase_robber')
                  }
                  className={`py-2 px-2 font-black text-[11px] rounded-xl transition cursor-pointer ${
                    activeBuildMode === 'chase_robber'
                      ? 'bg-amber-500 text-slate-950'
                      : 'bg-rose-600 hover:bg-rose-500 disabled:opacity-35 text-white'
                  }`}
                >
                  🦹 Chase Robber
                </button>
              </div>
            </div>
          )}

          {/* C&K Interactive Prompt 1: Aqueduct Free Resource Choice */}
          {myPlayerId && state.pendingAqueductPlayerIds?.includes(myPlayerId) && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-emerald-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-2.5 max-w-md w-full">
              <span className="text-xs font-black text-emerald-300">
                🌊 Aqueduct (Science Lv 3): Choose 1 Free Resource from the Bank!
              </span>
              <div className="grid grid-cols-5 gap-1.5">
                {RESOURCES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() =>
                      sendAction({
                        type: 'CHOOSE_AQUEDUCT_RESOURCE',
                        playerId: myPlayerId,
                        resource: r,
                      })
                    }
                    className="flex flex-col items-center p-2 bg-slate-950 hover:bg-emerald-950/80 border border-slate-700 hover:border-emerald-400 rounded-xl transition cursor-pointer"
                  >
                    <img src={RESOURCE_ICONS[r]} alt={r} className="w-8 h-10 object-cover rounded mb-1" />
                    <span className="text-[10px] font-bold text-white">{RESOURCE_LABELS[r]}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* C&K Interactive Prompt 2: Defender of Catan Tie Progress Card Choice */}
          {myPlayerId && state.pendingBarbarianRewardPlayerIds?.includes(myPlayerId) && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-2.5 max-w-md w-full">
              <span className="text-xs font-black text-amber-300">
                🛡️ Barbarians Defeated (Tie for Highest Strength): Choose 1 Progress Card Deck!
              </span>
              <div className="grid grid-cols-3 gap-2">
                {DISCIPLINES.map((disc) => {
                  const st = DISCIPLINE_STYLES[disc];
                  return (
                    <button
                      key={disc}
                      type="button"
                      onClick={() =>
                        sendAction({
                          type: 'CHOOSE_BARBARIAN_REWARD',
                          playerId: myPlayerId,
                          discipline: disc,
                        })
                      }
                      className={`py-2.5 px-3 ${st.badgeBg} border ${st.border} ${st.text} font-black text-xs rounded-xl hover:opacity-90 transition cursor-pointer`}
                    >
                      {st.emoji} {st.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* C&K Interactive Prompt 3: Barbarian Pillage City Selection */}
          {myPlayerId && state.pendingBarbarianPillagePlayerIds?.includes(myPlayerId) && (
            <div className="pointer-events-auto bg-rose-950/95 border-2 border-rose-500 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-2 max-w-md w-full">
              <span className="text-xs font-black text-rose-200">
                🔥 Barbarians Pillage Catan! Click one of your highlighted Cities on the board (or below) to downgrade to a Settlement:
              </span>
              <div className="flex flex-wrap gap-2">
                {getPlayerVulnerableCityVertices(state.board, myPlayerId).map((vId, idx) => (
                  <button
                    key={vId}
                    type="button"
                    onClick={() =>
                      sendAction({
                        type: 'CHOOSE_PILLAGED_CITY',
                        playerId: myPlayerId,
                        vertexId: vId,
                      })
                    }
                    className="px-3 py-1.5 bg-rose-700 hover:bg-rose-600 text-white font-black text-xs rounded-xl cursor-pointer"
                  >
                    Downgrade City #{idx + 1} ({vId})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* C&K Interactive Prompt 4: Guild Dues / Espionage Opponent Hand Inspection */}
          {myPlayerId &&
            state.inspectedTargetHand &&
            (state.pendingGuildDues?.playerId === myPlayerId ||
              state.pendingEspionage?.playerId === myPlayerId) && (
              <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-md w-full">
                {state.pendingGuildDues?.playerId === myPlayerId ? (
                  <>
                    <span className="text-xs font-black text-amber-300">
                      🕵️ Master Merchant: Inspecting{' '}
                      {state.players[state.inspectedTargetHand.targetPlayerId]?.name}&apos;s Hand — Take up to 2 Cards:
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {([...RESOURCES, ...COMMODITIES] as TradeableCardType[]).map((k) => {
                        const isRes = k in RESOURCE_ICONS;
                        const iconSrc = isRes
                          ? RESOURCE_ICONS[k as ResourceType]
                          : COMMODITY_ICONS[k as CommodityType];
                        const targetHeld =
                          state.inspectedTargetHand?.resources && k in state.inspectedTargetHand.resources
                            ? state.inspectedTargetHand.resources[k as ResourceType] || 0
                            : state.inspectedTargetHand?.commodities?.[k as CommodityType] || 0;
                        const sel = guildDuesPayload[k] || 0;
                        const totalSel = Object.values(guildDuesPayload).reduce((s, n) => s + (n || 0), 0);
                        return (
                          <div
                            key={k}
                            className="flex flex-col items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-[10px]"
                          >
                            <img
                              src={iconSrc}
                              alt={k}
                              className="w-7 h-10 object-cover rounded shadow mb-0.5"
                            />
                            <span className="font-bold text-slate-200 uppercase">{k}</span>
                            <span className="text-slate-400">Held: {targetHeld}</span>
                            <div className="flex items-center gap-1 mt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setGuildDuesPayload((p) => ({ ...p, [k]: Math.max(0, sel - 1) }))
                                }
                                className="w-4 h-4 bg-slate-800 rounded font-bold cursor-pointer"
                              >
                                −
                              </button>
                              <span className="font-black text-amber-300">{sel}</span>
                              <button
                                type="button"
                                disabled={sel >= targetHeld || totalSel >= 2}
                                onClick={() =>
                                  setGuildDuesPayload((p) => ({
                                    ...p,
                                    [k]: Math.min(targetHeld, sel + 1),
                                  }))
                                }
                                className="w-4 h-4 bg-slate-800 disabled:opacity-30 rounded font-bold cursor-pointer"
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
                      onClick={() => {
                        const cardsList: TradeableCardType[] = [];
                        for (const [k, cnt] of Object.entries(guildDuesPayload) as Array<
                          [TradeableCardType, number]
                        >) {
                          for (let i = 0; i < (cnt || 0); i++) {
                            cardsList.push(k);
                          }
                        }
                        sendAction({
                          type: 'RESOLVE_GUILD_DUES',
                          playerId: myPlayerId,
                          cards: cardsList.slice(0, 2),
                        });
                        setGuildDuesPayload({
                          wood: 0,
                          brick: 0,
                          wheat: 0,
                          sheep: 0,
                          ore: 0,
                          cloth: 0,
                          coin: 0,
                          paper: 0,
                        });
                      }}
                      className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl cursor-pointer"
                    >
                      Take Selected Cards
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-black text-sky-300">
                      🕵️ Spy: Inspecting{' '}
                      {state.players[state.inspectedTargetHand.targetPlayerId]?.name}&apos;s Progress Cards — Click 1 to Steal:
                    </span>
                    <div className="flex flex-col gap-1.5">
                      {(state.inspectedTargetHand.progressCards || []).map((pc) => {
                        const meta = PROGRESS_CARD_METADATA[pc.type];
                        return (
                          <button
                            key={pc.id}
                            type="button"
                            onClick={() =>
                              sendAction({
                                type: 'RESOLVE_ESPIONAGE',
                                playerId: myPlayerId,
                                cardId: pc.id,
                              })
                            }
                            className="flex items-center justify-between gap-2.5 p-2 bg-slate-950 hover:bg-sky-950/80 border border-slate-700 hover:border-sky-400 rounded-xl text-left cursor-pointer"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <img
                                src={PROGRESS_CARD_ICONS[pc.type]}
                                alt={meta?.name || pc.type}
                                className="w-9 h-13 object-cover rounded border border-slate-600 shrink-0"
                              />
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-black text-white">{meta?.name || pc.type}</span>
                                <span className="text-[10px] text-slate-400 line-clamp-2">{meta?.description}</span>
                              </div>
                            </div>
                            <span className="text-[10px] font-bold text-sky-300 shrink-0">Steal Card →</span>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}

          {/* C&K Interactive Prompt 5: Wedding Gift 2 Cards */}
          {myPlayerId && state.pendingWeddingPlayerIds?.includes(myPlayerId) && self && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-sky-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-2.5 max-w-md w-full">
              <span className="text-xs font-black text-sky-300">
                💍 Wedding! Choose 2 resources/commodities to gift to{' '}
                {state.players[state.weddingRequesterId || state.currentTurnPlayerId]?.name}:
              </span>
              <div className="grid grid-cols-4 gap-1.5">
                {([...RESOURCES, ...COMMODITIES] as TradeableCardType[]).map((k) => {
                  const isRes = k in RESOURCE_ICONS;
                  const iconSrc = isRes
                    ? RESOURCE_ICONS[k as ResourceType]
                    : COMMODITY_ICONS[k as CommodityType];
                  const held =
                    k in self.resources
                      ? self.resources[k as ResourceType]
                      : self.commodities?.[k as CommodityType] || 0;
                  const sel = weddingGiftPayload[k] || 0;
                  const totalSel = Object.values(weddingGiftPayload).reduce((s, n) => s + (n || 0), 0);
                  return (
                    <div
                      key={k}
                      className="flex flex-col items-center bg-slate-950 p-1.5 rounded-xl border border-slate-800 text-[10px]"
                    >
                      <img
                        src={iconSrc}
                        alt={k}
                        className="w-7 h-10 object-cover rounded shadow mb-0.5"
                      />
                      <span className="font-bold text-slate-200 uppercase">{k}</span>
                      <span className="text-slate-400">Held: {held}</span>
                      <div className="flex items-center gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() =>
                            setWeddingGiftPayload((p) => ({ ...p, [k]: Math.max(0, sel - 1) }))
                          }
                          className="w-4 h-4 bg-slate-800 rounded font-bold cursor-pointer"
                        >
                          −
                        </button>
                        <span className="font-black text-sky-300">{sel}</span>
                        <button
                          type="button"
                          disabled={sel >= held || totalSel >= 2}
                          onClick={() =>
                            setWeddingGiftPayload((p) => ({ ...p, [k]: Math.min(held, sel + 1) }))
                          }
                          className="w-4 h-4 bg-slate-800 disabled:opacity-30 rounded font-bold cursor-pointer"
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
                onClick={() => {
                  sendAction({
                    type: 'GIVE_WEDDING_CARDS',
                    playerId: myPlayerId,
                    cards: weddingGiftPayload,
                  });
                  setWeddingGiftPayload({
                    wood: 0,
                    brick: 0,
                    wheat: 0,
                    sheep: 0,
                    ore: 0,
                    cloth: 0,
                    coin: 0,
                    paper: 0,
                  });
                }}
                className="w-full py-2 bg-sky-500 hover:bg-sky-400 text-slate-950 font-black text-xs rounded-xl cursor-pointer"
              >
                Send Wedding Gift
              </button>
            </div>
          )}

          {/* C&K Interactive Prompt 6: Commercial Harbor Response */}
          {myPlayerId &&
            state.pendingCommercialHarbor?.some((o) => o.targetPlayerId === myPlayerId) &&
            self && (
              <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-2.5 max-w-md w-full">
                {state.pendingCommercialHarbor
                  .filter((o) => o.targetPlayerId === myPlayerId)
                  .map((offer, i) => (
                    <div key={i} className="flex flex-col gap-2">
                      <span className="text-xs font-black text-amber-300">
                        ⚓ Commercial Harbor: {state.players[offer.fromPlayerId]?.name} gives you 1{' '}
                        {RESOURCE_LABELS[offer.offeredResource]} — Choose 1 Commodity to Give:
                      </span>
                      <div className="grid grid-cols-3 gap-2">
                        {COMMODITIES.map((c) => {
                          const held = self.commodities?.[c] || 0;
                          return (
                            <button
                              key={c}
                              type="button"
                              disabled={held <= 0}
                              onClick={() =>
                                sendAction({
                                  type: 'RESPOND_COMMERCIAL_HARBOR',
                                  playerId: myPlayerId,
                                  commodity: c,
                                })
                              }
                              className="flex flex-col items-center gap-1 py-2 px-2 bg-slate-950 hover:bg-amber-950 border border-slate-700 hover:border-amber-400 disabled:opacity-35 rounded-xl text-xs font-black text-white cursor-pointer"
                            >
                              <img
                                src={COMMODITY_ICONS[c]}
                                alt={COMMODITY_LABELS[c]}
                                className="w-8 h-11 object-cover rounded shadow"
                              />
                              <span>
                                {COMMODITY_LABELS[c]} ({held})
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}

          {/* C&K Modal for Progress Cards Requiring Options */}
          {pendingProgressModal && myPlayerId && self && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-amber-400 rounded-2xl p-4 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-md w-full">
              <div className="flex items-center justify-between gap-2.5">
                <div className="flex items-center gap-2.5">
                  <img
                    src={PROGRESS_CARD_ICONS[pendingProgressModal.type]}
                    alt={PROGRESS_CARD_METADATA[pendingProgressModal.type]?.name}
                    className="w-10 h-14 object-cover rounded-lg border border-amber-400/70 shadow shrink-0"
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-black text-amber-300">
                      Play {PROGRESS_CARD_METADATA[pendingProgressModal.type]?.name}
                    </span>
                    <span className="text-[10px] text-slate-300 leading-snug">
                      {PROGRESS_CARD_METADATA[pendingProgressModal.type]?.description}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingProgressModal(null)}
                  className="text-slate-400 hover:text-white cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {pendingProgressModal.type === 'alchemy' && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs text-slate-300">
                    Choose the White Die and Red Die values (1–6) for your roll:
                  </span>
                  {[0, 1].map((idx) => (
                    <div key={idx} className="flex items-center justify-between bg-slate-950 p-2 rounded-xl">
                      <span className="text-xs font-bold text-white">
                        {idx === 0 ? 'White Die:' : 'Red Die:'}
                      </span>
                      <div className="flex gap-1">
                        {[1, 2, 3, 4, 5, 6].map((val) => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              const next: [number, number] = [...alchemyDice] as [number, number];
                              next[idx] = val;
                              setAlchemyDice(next);
                            }}
                            className={`w-7 h-7 rounded-lg font-black text-xs border cursor-pointer ${
                              alchemyDice[idx] === val
                                ? 'bg-amber-500 text-slate-950 border-white'
                                : 'bg-slate-800 text-white border-slate-700'
                            }`}
                          >
                            {val}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {pendingProgressModal.type === 'resource_monopoly' && (
                <div className="grid grid-cols-5 gap-1.5">
                  {RESOURCES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedResourceOption(r)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-center text-[10px] font-bold cursor-pointer ${
                        selectedResourceOption === r
                          ? 'bg-amber-500/30 border-amber-400 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                    >
                      <img
                        src={RESOURCE_ICONS[r]}
                        alt={RESOURCE_LABELS[r]}
                        className="w-7 h-10 object-cover rounded shadow"
                      />
                      <span>{RESOURCE_LABELS[r]}</span>
                    </button>
                  ))}
                </div>
              )}

              {pendingProgressModal.type === 'trade_monopoly' && (
                <div className="grid grid-cols-3 gap-2">
                  {COMMODITIES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setSelectedCommodityOption(c)}
                      className={`flex flex-col items-center gap-1 p-2 rounded-xl border text-center text-xs font-bold cursor-pointer ${
                        selectedCommodityOption === c
                          ? 'bg-amber-500/30 border-amber-400 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300'
                      }`}
                    >
                      <img
                        src={COMMODITY_ICONS[c]}
                        alt={COMMODITY_LABELS[c]}
                        className="w-8 h-11 object-cover rounded shadow"
                      />
                      <span>{COMMODITY_LABELS[c]}</span>
                    </button>
                  ))}
                </div>
              )}

              {pendingProgressModal.type === 'merchant_fleet' && (
                <div className="grid grid-cols-4 gap-1.5">
                  {([...RESOURCES, ...COMMODITIES] as TradeableCardType[]).map((k) => {
                    const isRes = k in RESOURCE_ICONS;
                    const iconSrc = isRes
                      ? RESOURCE_ICONS[k as ResourceType]
                      : COMMODITY_ICONS[k as CommodityType];
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setSelectedTradeableOption(k)}
                        className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border text-center text-[10px] font-bold uppercase cursor-pointer ${
                          selectedTradeableOption === k
                            ? 'bg-amber-500/30 border-amber-400 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300'
                        }`}
                      >
                        <img
                          src={iconSrc}
                          alt={k}
                          className="w-7 h-10 object-cover rounded shadow"
                        />
                        <span>{k}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {['guild_dues', 'espionage', 'treason', 'commercial_harbor'].includes(
                pendingProgressModal.type,
              ) && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-bold text-slate-300">Select Target Player:</span>
                  <div className="flex flex-wrap gap-1.5">
                    {orderedPlayers
                      .filter((p) => p.id !== myPlayerId)
                      .map((p) => {
                        const knightCount = Object.values(state.board.knights || {}).filter(
                          (k) => k.playerId === p.id,
                        ).length;
                        const detail =
                          pendingProgressModal.type === 'guild_dues'
                            ? `${p.victoryPoints} VP • ${p.cardCount}🎴`
                            : pendingProgressModal.type === 'espionage'
                              ? `${p.progressCardCount}📜`
                              : pendingProgressModal.type === 'treason'
                                ? `${knightCount}🛡️`
                                : `${p.cardCount}🎴`;
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setSelectedTargetPlayerId(p.id)}
                            className={`px-3 py-1.5 rounded-xl border text-xs font-bold cursor-pointer ${
                              selectedTargetPlayerId === p.id
                                ? 'bg-amber-500 text-slate-950 border-white'
                                : 'bg-slate-950 text-white border-slate-700'
                            }`}
                          >
                            {p.name} ({detail})
                          </button>
                        );
                      })}
                  </div>

                  {pendingProgressModal.type === 'commercial_harbor' && (
                    <>
                      <span className="text-xs font-bold text-slate-300 mt-1">
                        Select Resource to Offer (1 card):
                      </span>
                      <div className="grid grid-cols-5 gap-1">
                        {RESOURCES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            disabled={(self.resources[r] || 0) <= 0}
                            onClick={() => setSelectedResourceOption(r)}
                            className={`p-1.5 rounded-lg border text-[10px] font-bold disabled:opacity-30 cursor-pointer ${
                              selectedResourceOption === r
                                ? 'bg-amber-500 text-slate-950 border-white'
                                : 'bg-slate-950 text-white border-slate-800'
                            }`}
                          >
                            {RESOURCE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const t = pendingProgressModal.type;
                    sendAction({
                      type: 'PLAY_PROGRESS_CARD',
                      playerId: myPlayerId,
                      cardId: pendingProgressModal.cardId,
                      options: {
                        ...(t === 'alchemy' ? { alchemyDice } : {}),
                        ...(t === 'resource_monopoly' ? { resource: selectedResourceOption } : {}),
                        ...(t === 'trade_monopoly' ? { commodity: selectedCommodityOption } : {}),
                        ...(t === 'merchant_fleet' ? { tradeableType: selectedTradeableOption } : {}),
                        ...(['guild_dues', 'espionage', 'treason'].includes(t)
                          ? { targetPlayerId: selectedTargetPlayerId }
                          : {}),
                        ...(t === 'commercial_harbor'
                          ? {
                              commercialHarborOffers: [
                                {
                                  targetPlayerId: selectedTargetPlayerId,
                                  offeredResource: selectedResourceOption,
                                },
                              ],
                            }
                          : {}),
                      },
                    });
                    setPendingProgressModal(null);
                  }}
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs rounded-xl cursor-pointer"
                >
                  Confirm & Play Card
                </button>
                <button
                  type="button"
                  onClick={() => setPendingProgressModal(null)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Base Game Interactive Modal for Year of Plenty / Monopoly */}
          {pendingDevCard && myPlayerId && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-indigo-500 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-md w-full">
              <span className="text-sm font-black text-indigo-300 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                {pendingDevCard.type === 'year_of_plenty'
                  ? 'Year of Plenty: Choose 2 Free Resources from Bank'
                  : 'Monopoly: Choose 1 Resource to Claim from All Players'}
              </span>

              {pendingDevCard.type === 'year_of_plenty' ? (
                <div className="flex flex-col gap-2">
                  {[0, 1].map((slotIdx) => (
                    <div
                      key={slotIdx}
                      className="flex items-center justify-between bg-slate-950 p-2 rounded-xl border border-slate-800"
                    >
                      <span className="text-xs font-bold text-slate-300">Resource #{slotIdx + 1}:</span>
                      <div className="flex gap-1.5">
                        {RESOURCES.map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => {
                              const next: [ResourceType, ResourceType] = [...yopSelection] as [
                                ResourceType,
                                ResourceType,
                              ];
                              next[slotIdx] = r;
                              setYopSelection(next);
                            }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition cursor-pointer ${
                              yopSelection[slotIdx] === r
                                ? 'bg-indigo-600 border-amber-400 text-white'
                                : 'bg-slate-800 border-slate-700 text-slate-300'
                            }`}
                          >
                            {RESOURCE_LABELS[r]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {RESOURCES.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setMonopolySelection(r)}
                      className={`flex flex-col items-center p-2 rounded-xl border transition cursor-pointer ${
                        monopolySelection === r
                          ? 'bg-indigo-900/80 border-amber-400 scale-105'
                          : 'bg-slate-950 border-slate-800 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <img src={RESOURCE_ICONS[r]} alt={r} className="w-9 h-12 object-cover rounded mb-1" />
                      <span className="text-[10px] font-bold text-white">{RESOURCE_LABELS[r]}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => {
                    sendAction({
                      type: 'PLAY_DEV_CARD',
                      playerId: myPlayerId,
                      cardId: pendingDevCard.cardId,
                      options:
                        pendingDevCard.type === 'year_of_plenty'
                          ? { yearOfPlentyResources: yopSelection }
                          : { monopolyResource: monopolySelection },
                    });
                    setPendingDevCard(null);
                  }}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 font-bold text-xs text-white rounded-xl shadow cursor-pointer"
                >
                  Play Card
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDevCard(null)}
                  className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 font-semibold text-xs text-slate-300 rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Discard Dialog Modal (Supports both Resources & Commodities in C&K) */}
          {needsDiscard && self && (
            <div className="pointer-events-auto bg-slate-900/95 border-2 border-rose-500 rounded-2xl p-5 shadow-2xl backdrop-blur-2xl flex flex-col gap-3 max-w-lg w-full">
              <span className="text-sm font-black text-rose-400 flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4" /> Discard {needsDiscard} Cards:
              </span>
              <div className={`grid ${isCK ? 'grid-cols-4' : 'grid-cols-5'} gap-2`}>
                {RESOURCES.map((r) => {
                  const held = self.resources[r] || 0;
                  const selected = discardSelection[r] || 0;
                  return (
                    <div key={r} className="flex flex-col items-center bg-slate-950 p-2 rounded-xl border border-slate-800">
                      <img src={RESOURCE_ICONS[r]} alt={RESOURCE_LABELS[r]} className="w-8 h-10 object-cover rounded shadow mb-0.5" />
                      <span className="text-[10px] font-bold text-slate-300">{RESOURCE_LABELS[r]}</span>
                      <span className="text-[9px] text-slate-400">Held: {held}</span>
                      <div className="flex items-center gap-1.5 mt-1">
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
                {isCK &&
                  COMMODITIES.map((c) => {
                    const held = self.commodities?.[c] || 0;
                    const selected = discardSelection[c] || 0;
                    return (
                      <div key={c} className="flex flex-col items-center bg-slate-950 p-2 rounded-xl border border-slate-800">
                        <img
                          src={COMMODITY_ICONS[c]}
                          alt={COMMODITY_LABELS[c]}
                          className="w-8 h-10 object-cover rounded shadow mb-0.5"
                        />
                        <span className="text-[10px] font-bold text-slate-300">{COMMODITY_LABELS[c]}</span>
                        <span className="text-[9px] text-slate-400">Held: {held}</span>
                        <div className="flex items-center gap-1.5 mt-1">
                          <button
                            type="button"
                            onClick={() => setDiscardSelection({ ...discardSelection, [c]: Math.max(0, selected - 1) })}
                            className="w-5 h-5 bg-slate-800 hover:bg-rose-600 rounded text-xs font-bold cursor-pointer"
                          >
                            −
                          </button>
                          <span className="text-xs font-black">{selected}</span>
                          <button
                            type="button"
                            onClick={() => setDiscardSelection({ ...discardSelection, [c]: Math.min(held, selected + 1) })}
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
                onClick={() => {
                  if (!myPlayerId) return;
                  sendAction({ type: 'DISCARD_CARDS', playerId: myPlayerId, resources: discardSelection });
                  setDiscardSelection({
                    wood: 0,
                    brick: 0,
                    wheat: 0,
                    sheep: 0,
                    ore: 0,
                    cloth: 0,
                    coin: 0,
                    paper: 0,
                  });
                }}
                className="w-full py-2.5 bg-rose-600 hover:bg-rose-500 font-bold text-xs text-white rounded-xl shadow mt-1 cursor-pointer"
              >
                Confirm Discard ({Object.values(discardSelection).reduce((s, n) => s + (n || 0), 0)}/{needsDiscard})
              </button>
            </div>
          )}

          {/* Steal Target Modal */}
          {state.phase === 'ROBBER_STEAL' &&
            (state.robberControllerPlayerId
              ? state.robberControllerPlayerId === myPlayerId
              : state.currentTurnPlayerId === myPlayerId || state.pairedPlayerId === myPlayerId) && (
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

        <div />
      </div>

      {/* 3. RIGHT SIDEBAR: Room/Rules Pill + Upper-Right Progress/Dev Cards + Center-Right Builds + Bottom-Right Hand */}
      <div className="flex flex-col items-end justify-between gap-2 w-[265px] sm:w-[295px] max-w-[32vw] max-h-full overflow-y-auto pl-0.5 shrink-0">
        {/* TOP-RIGHT GROUP */}
        <div className="flex flex-col items-end gap-2 w-full">
          {/* Room & Active Rules Pill */}
          <div className="pointer-events-auto flex flex-col gap-1 bg-slate-900/90 backdrop-blur-xl px-3 py-2 rounded-2xl border border-slate-700/80 text-xs text-slate-300 shadow-xl w-full">
            <div className="flex items-center justify-between">
              <span className="truncate">
                Seat: <strong className="text-amber-400">{state.players[myPlayerId || '']?.name || 'Spectator'}</strong>
              </span>
              {room && (
                <span>
                  Room: <strong className="text-white font-mono">{room.code}</strong>
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800">
              <span
                className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                  isCK
                    ? 'bg-amber-950 text-amber-300 border-amber-600/80'
                    : 'bg-sky-950 text-sky-300 border-sky-700/70'
                }`}
              >
                {isCK ? '⚔️ Cities & Knights' : '🏝️ Base Game'}
              </span>
              {houseRules?.balancedDice && (
                <span className="text-[9px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/70 px-1.5 py-0.2 rounded">
                  🎲 Balanced Dice
                </span>
              )}
              {houseRules?.hiddenBank && (
                <span className="text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-700/70 px-1.5 py-0.2 rounded">
                  🔒 Hidden Bank
                </span>
              )}
              {houseRules?.freeTrades && (
                <span className="text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/70 px-1.5 py-0.2 rounded">
                  🎁 Free Trades
                </span>
              )}
              {houseRules?.friendlyRobber && (
                <span className="text-[9px] font-bold bg-teal-950 text-teal-300 border border-teal-700/70 px-1.5 py-0.2 rounded">
                  🛡️ Friendly Robber
                </span>
              )}
              {houseRules?.noEarly7s && (
                <span className="text-[9px] font-bold bg-purple-950 text-purple-300 border border-purple-700/70 px-1.5 py-0.2 rounded">
                  🚫 No Early 7s
                </span>
              )}
              {houseRules?.combined2And12 && (
                <span className="text-[9px] font-bold bg-orange-950 text-orange-300 border border-orange-700/70 px-1.5 py-0.2 rounded">
                  🎲 2&12 Combined
                </span>
              )}
              {houseRules?.playDevCardSameTurn && !isCK && (
                <span className="text-[9px] font-bold bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-700/70 px-1.5 py-0.2 rounded">
                  ⚡ Instant DCs
                </span>
              )}
              {houseRules?.harborMaster && (
                <span className="text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-700/70 px-1.5 py-0.2 rounded">
                  ⚓ Harbor Master
                </span>
              )}
            </div>
          </div>

          {/* Upper-Right Cards Panel: Progress Cards in C&K vs. Development Cards in Base Game */}
          {self && isCK ? (
            <div className="pointer-events-auto bg-slate-900/92 backdrop-blur-xl p-2.5 rounded-2xl border border-amber-500/60 shadow-2xl flex flex-col gap-2 w-full">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black text-amber-300 uppercase tracking-wider flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Progress Cards ({self.progressCards?.length || 0}/4)
                </span>
                {myPlayerId && state.pendingProgressDiscardPlayerIds?.includes(myPlayerId) && (
                  <span className="text-[9px] font-black text-rose-400 animate-pulse">
                    Discard 1 Card (Max 4)!
                  </span>
                )}
              </div>

              {!self.progressCards || self.progressCards.length === 0 ? (
                <div className="text-[10px] text-slate-500 italic text-center py-1.5 bg-slate-950/60 rounded-xl border border-slate-800/70">
                  No Progress Cards in hand
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {self.progressCards.map((c) => {
                      const isSelected = activeFocusedProgressCard?.id === c.id;
                      const st = DISCIPLINE_STYLES[c.discipline];
                      const meta = PROGRESS_CARD_METADATA[c.type];
                      return (
                        <button
                          key={c.id}
                          type="button"
                          title={`${meta?.name || c.type} (${st.label})`}
                          onMouseEnter={() => setFocusedProgressCardId(c.id)}
                          onClick={() => setFocusedProgressCardId(c.id)}
                          className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition cursor-pointer ${
                            isSelected
                              ? `${st.border} scale-105 shadow-lg`
                              : 'border-slate-700 opacity-80 hover:opacity-100'
                          }`}
                        >
                          <img
                            src={PROGRESS_CARD_ICONS[c.type]}
                            alt={meta?.name || c.type}
                            className="w-10 h-14 object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>

                  {activeFocusedProgressCard && (() => {
                    const c = activeFocusedProgressCard;
                    const meta = PROGRESS_CARD_METADATA[c.type];
                    const st = DISCIPLINE_STYLES[c.discipline];
                    const mustDiscard = Boolean(
                      (self.progressCards?.length || 0) > 4 ||
                        (myPlayerId && state.pendingProgressDiscardPlayerIds?.includes(myPlayerId)),
                    );
                    const isPlayable =
                      c.type === 'alchemy'
                        ? isRollPhase
                        : isMyTurn;

                    return (
                      <div className="flex items-center gap-2.5 bg-slate-950/90 p-2 rounded-xl border border-slate-800">
                        <img
                          src={PROGRESS_CARD_ICONS[c.type]}
                          alt={meta?.name || c.type}
                          className={`w-14 h-20 object-cover rounded-lg border ${st.border} shrink-0 shadow-md`}
                        />
                        <div className="flex flex-col gap-1 min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className={`text-xs font-black ${st.text} truncate`}>
                              {st.emoji} {meta?.name || c.type}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">
                              {st.label}
                            </span>
                          </div>
                          <p className="text-[10px] text-slate-300 leading-snug">
                            {meta?.description}
                          </p>
                          <div className="flex gap-1.5 pt-0.5">
                            {isPlayable && (
                              <button
                                type="button"
                                onClick={() => handlePlayProgressCardClick(c.id, c.type)}
                                className="flex-1 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black rounded-lg shadow transition cursor-pointer"
                              >
                                Play Card
                              </button>
                            )}
                            {mustDiscard && myPlayerId && (
                              <button
                                type="button"
                                onClick={() =>
                                  sendAction({
                                    type: 'DISCARD_PROGRESS_CARD',
                                    playerId: myPlayerId,
                                    cardId: c.id,
                                  })
                                }
                                className="flex-1 py-1.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-black rounded-lg shadow transition cursor-pointer"
                              >
                                Discard (Limit 4)
                              </button>
                            )}
                            {!isPlayable && !mustDiscard && (
                              <span className="w-full py-1 bg-slate-800/90 text-slate-400 text-[9px] font-bold rounded-lg text-center">
                                {c.type === 'alchemy'
                                  ? 'Play before rolling dice on your turn'
                                  : 'Play during your turn'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          ) : (
            self && (
              <div className="pointer-events-auto bg-slate-900/92 backdrop-blur-xl p-2.5 rounded-2xl border border-indigo-500/60 shadow-2xl flex flex-col gap-2 w-full">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-indigo-300 uppercase tracking-wider flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> Your Dev Cards ({self.devCards.length})
                  </span>
                  {self.devCards.length > 0 && (
                    <span className="text-[9px] text-slate-400">Hover or click card</span>
                  )}
                </div>

                {self.devCards.length === 0 ? (
                  <div className="text-[10px] text-slate-500 italic text-center py-1.5 bg-slate-950/60 rounded-xl border border-slate-800/70">
                    No Development Cards in hand
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                      {self.devCards.map((c) => {
                        const isSelected = activeFocusedCard?.id === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onMouseEnter={() => setFocusedDevCardId(c.id)}
                            onClick={() => setFocusedDevCardId(c.id)}
                            className={`relative shrink-0 rounded-lg overflow-hidden border-2 transition cursor-pointer ${
                              isSelected
                                ? 'border-amber-400 scale-105 shadow-lg'
                                : 'border-indigo-500/50 opacity-80 hover:opacity-100'
                            }`}
                          >
                            <img
                              src={DEV_CARD_ICONS[c.type]}
                              alt={c.type}
                              className="w-10 h-14 object-cover"
                            />
                          </button>
                        );
                      })}
                    </div>

                    {activeFocusedCard && (() => {
                      const c = activeFocusedCard;
                      const info = DEV_CARD_INFO[c.type];
                      const canPlaySameTurn = Boolean(houseRules?.playDevCardSameTurn);
                      const isBoughtThisTurn =
                        !canPlaySameTurn && c.boughtTurn === state.turnNumber && c.type !== 'victory_point';
                      const isPlayable =
                        (isMyTurn || (isRollPhase && c.type === 'knight')) &&
                        (canPlaySameTurn || c.boughtTurn !== state.turnNumber) &&
                        c.type !== 'victory_point' &&
                        !state.devCardPlayedThisTurn;

                      return (
                        <div className="flex items-center gap-2.5 bg-slate-950/90 p-2 rounded-xl border border-slate-800">
                          <img
                            src={DEV_CARD_ICONS[c.type]}
                            alt={c.type}
                            className="w-12 h-16 object-cover rounded-lg border border-indigo-400/70 shrink-0"
                          />
                          <div className="flex flex-col gap-1 min-w-0 flex-1">
                            <span className="text-xs font-black text-amber-300 leading-tight">
                              {info?.title || c.type}
                            </span>
                            <p className="text-[10px] text-slate-300 leading-snug">
                              {info?.desc}
                            </p>
                            {c.type === 'victory_point' ? (
                              <span className="w-full py-1 bg-emerald-950/90 border border-emerald-500/80 text-emerald-200 text-[10px] font-black rounded-lg text-center">
                                🔒 Secret +1 VP (Auto-Counts)
                              </span>
                            ) : isPlayable ? (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!myPlayerId) return;
                                  if (c.type === 'year_of_plenty' || c.type === 'monopoly') {
                                    setPendingDevCard({ cardId: c.id, type: c.type });
                                  } else {
                                    sendAction({
                                      type: 'PLAY_DEV_CARD',
                                      playerId: myPlayerId,
                                      cardId: c.id,
                                    });
                                  }
                                }}
                                className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-black rounded-lg shadow transition cursor-pointer"
                              >
                                Play Card
                              </button>
                            ) : (
                              <span className="w-full py-1 bg-slate-800/90 text-slate-400 text-[9px] font-bold rounded-lg text-center">
                                {isBoughtThisTurn
                                  ? 'Bought this turn (wait for next turn)'
                                  : state.devCardPlayedThisTurn
                                    ? '1 Dev Card played this turn'
                                    : 'Play on your turn'}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            )
          )}
        </div>

        {/* CENTER-RIGHT GROUP: Possible Builds & City Improvements Stack */}
        {self && (
          <div className="pointer-events-auto flex flex-col gap-1.5 w-full my-auto">
            {!isCK ? (
              /* Base Game: Buy Dev Card */
              (() => {
                const canBuy =
                  isMyTurn &&
                  canAfford(self.resources, BUILDING_COSTS.devCard) &&
                  state.devCardDeckCount > 0;
                return (
                  <button
                    type="button"
                    onClick={() =>
                      canBuy && myPlayerId && sendAction({ type: 'BUY_DEV_CARD', playerId: myPlayerId })
                    }
                    disabled={!canBuy}
                    className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition ${
                      canBuy
                        ? 'bg-slate-800/95 hover:bg-slate-700/95 border-amber-400/80 shadow-lg cursor-pointer ring-1 ring-amber-400/30'
                        : 'bg-slate-900/85 border-slate-700/70 opacity-85 cursor-default'
                    }`}
                  >
                    <div className="w-9 h-9 rounded-lg bg-indigo-950/90 border border-indigo-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                      📜
                    </div>
                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-extrabold text-slate-200">Buy Dev Card</span>
                        <span className="text-[10px] font-bold text-slate-400">{state.devCardDeckCount} left</span>
                      </div>
                      <div className="flex items-center gap-1 flex-wrap">
                        <ResourceMiniPill resource="ore" needed={1} held={self.resources.ore || 0} />
                        <ResourceMiniPill resource="wheat" needed={1} held={self.resources.wheat || 0} />
                        <ResourceMiniPill resource="sheep" needed={1} held={self.resources.sheep || 0} />
                      </div>
                    </div>
                  </button>
                );
              })()
            ) : (
              /* Cities & Knights: City Improvements Button, Recruit Knight, and City Wall */
              <>
                <button
                  type="button"
                  onClick={() => setShowCityImprovementsModal((v) => !v)}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition cursor-pointer ${
                    showCityImprovementsModal
                      ? 'bg-amber-500/25 border-amber-400 shadow-lg ring-2 ring-amber-400'
                      : 'bg-slate-800/95 hover:bg-slate-700/95 border-amber-400/80 shadow-lg'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-950/90 border border-amber-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                    🏛️
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-amber-300">City Improvements</span>
                      <span className="text-[9px] font-black text-slate-300">
                        🟡{self.cityImprovements?.trade || 0} 🔵{self.cityImprovements?.politics || 0} 🟢{self.cityImprovements?.science || 0}
                      </span>
                    </div>
                    <span className="text-[10px] font-bold text-slate-400">
                      Upgrade Trade (🧵), Politics (🪙) & Science (📜)
                    </span>
                  </div>
                </button>

                {/* Recruit Basic Knight */}
                {(() => {
                  const canRecruit =
                    isMyTurn &&
                    canAfford(self.resources, BUILDING_COSTS.knight) &&
                    self.basicKnightsLeft > 0;
                  const isSelected = activeBuildMode === 'knight';
                  return (
                    <button
                      type="button"
                      onClick={() =>
                        canRecruit && setBuildMode(activeBuildMode === 'knight' ? 'none' : 'knight')
                      }
                      disabled={!canRecruit}
                      className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition ${
                        isSelected
                          ? 'bg-amber-500/25 border-amber-400 shadow-lg cursor-pointer ring-2 ring-amber-400'
                          : canRecruit
                            ? 'bg-slate-800/95 hover:bg-slate-700/95 border-emerald-400/80 shadow-lg cursor-pointer'
                            : 'bg-slate-900/85 border-slate-700/70 opacity-85 cursor-default'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-purple-950/80 border border-purple-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                        🛡️
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-slate-200">Recruit Knight</span>
                          <span className="text-[10px] font-bold text-slate-400">
                            {self.basicKnightsLeft}/{self.strongKnightsLeft}/{self.mightyKnightsLeft} left
                          </span>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <ResourceMiniPill resource="sheep" needed={1} held={self.resources.sheep || 0} />
                          <ResourceMiniPill resource="ore" needed={1} held={self.resources.ore || 0} />
                        </div>
                      </div>
                    </button>
                  );
                })()}

                {/* Build City Wall */}
                {(() => {
                  const hasUnwalledCity = Object.values(state.board.buildings).some(
                    (b) => b.playerId === myPlayerId && b.type === 'city' && !b.hasWall,
                  );
                  const canBuildWall =
                    isMyTurn &&
                    canAfford(self.resources, BUILDING_COSTS.cityWall) &&
                    self.cityWallsLeft > 0 &&
                    hasUnwalledCity;
                  const isSelected = activeBuildMode === 'city_wall';
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        if (!canBuildWall) return;
                        setActiveProgressCardId(null);
                        setBuildMode(activeBuildMode === 'city_wall' ? 'none' : 'city_wall');
                      }}
                      disabled={!canBuildWall}
                      className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition ${
                        isSelected
                          ? 'bg-amber-500/25 border-amber-400 shadow-lg cursor-pointer ring-2 ring-amber-400'
                          : canBuildWall
                            ? 'bg-slate-800/95 hover:bg-slate-700/95 border-emerald-400/80 shadow-lg cursor-pointer'
                            : 'bg-slate-900/85 border-slate-700/70 opacity-85 cursor-default'
                      }`}
                    >
                      <div className="w-9 h-9 rounded-lg bg-rose-950/80 border border-rose-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                        🧱
                      </div>
                      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-extrabold text-slate-200">City Wall (+2 Cap)</span>
                          <span className="text-[10px] font-bold text-slate-400">{self.cityWallsLeft} left</span>
                        </div>
                        <div className="flex items-center gap-1 flex-wrap">
                          <ResourceMiniPill resource="brick" needed={2} held={self.resources.brick || 0} />
                        </div>
                      </div>
                    </button>
                  );
                })()}
              </>
            )}

            {/* Road */}
            {(() => {
              const canBuild =
                isMyTurn &&
                (canAfford(self.resources, BUILDING_COSTS.road) || state.freeRoadsRemaining > 0) &&
                self.roadsLeft > 0;
              const isSelected = activeBuildMode === 'road' || state.freeRoadsRemaining > 0;
              return (
                <button
                  type="button"
                  onClick={() => canBuild && setBuildMode(activeBuildMode === 'road' ? 'none' : 'road')}
                  disabled={!canBuild}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition ${
                    isSelected
                      ? 'bg-amber-500/25 border-amber-400 shadow-lg cursor-pointer ring-2 ring-amber-400'
                      : canBuild
                        ? 'bg-slate-800/95 hover:bg-slate-700/95 border-emerald-400/80 shadow-lg cursor-pointer'
                        : 'bg-slate-900/85 border-slate-700/70 opacity-85 cursor-default'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-950/80 border border-amber-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                    🛣️
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-200">Road</span>
                      <span className="text-[10px] font-bold text-slate-400">{self.roadsLeft} left</span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ResourceMiniPill resource="wood" needed={1} held={self.resources.wood || 0} />
                      <ResourceMiniPill resource="brick" needed={1} held={self.resources.brick || 0} />
                    </div>
                  </div>
                </button>
              );
            })()}

            {/* Settlement */}
            {(() => {
              const canBuild =
                isMyTurn &&
                canAfford(self.resources, BUILDING_COSTS.settlement) &&
                self.settlementsLeft > 0;
              const isSelected = activeBuildMode === 'settlement';
              return (
                <button
                  type="button"
                  onClick={() =>
                    canBuild && setBuildMode(activeBuildMode === 'settlement' ? 'none' : 'settlement')
                  }
                  disabled={!canBuild}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition ${
                    isSelected
                      ? 'bg-amber-500/25 border-amber-400 shadow-lg cursor-pointer ring-2 ring-amber-400'
                      : canBuild
                        ? 'bg-slate-800/95 hover:bg-slate-700/95 border-emerald-400/80 shadow-lg cursor-pointer'
                        : 'bg-slate-900/85 border-slate-700/70 opacity-85 cursor-default'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                    🏠
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-200">Settlement</span>
                      <span className="text-[10px] font-bold text-slate-400">{self.settlementsLeft} left</span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ResourceMiniPill resource="wood" needed={1} held={self.resources.wood || 0} />
                      <ResourceMiniPill resource="brick" needed={1} held={self.resources.brick || 0} />
                      <ResourceMiniPill resource="sheep" needed={1} held={self.resources.sheep || 0} />
                      <ResourceMiniPill resource="wheat" needed={1} held={self.resources.wheat || 0} />
                    </div>
                  </div>
                </button>
              );
            })()}

            {/* City (Supports Medicine Discount in C&K!) */}
            {(() => {
              const hasMedicineDiscount = isCK && (state.medicineDiscountsRemaining || 0) > 0;
              const cityCost = hasMedicineDiscount ? BUILDING_COSTS.cityMedicine : BUILDING_COSTS.city;
              const canBuild =
                isMyTurn &&
                canAfford(self.resources, cityCost) &&
                self.citiesLeft > 0;
              const isSelected = activeBuildMode === 'city';
              return (
                <button
                  type="button"
                  onClick={() => canBuild && setBuildMode(activeBuildMode === 'city' ? 'none' : 'city')}
                  disabled={!canBuild}
                  className={`w-full flex items-center gap-2.5 p-2 rounded-xl border text-left transition ${
                    isSelected
                      ? 'bg-amber-500/25 border-amber-400 shadow-lg cursor-pointer ring-2 ring-amber-400'
                      : canBuild
                        ? 'bg-slate-800/95 hover:bg-slate-700/95 border-emerald-400/80 shadow-lg cursor-pointer'
                        : 'bg-slate-900/85 border-slate-700/70 opacity-85 cursor-default'
                  }`}
                >
                  <div className="w-9 h-9 rounded-lg bg-sky-950/80 border border-sky-500/60 flex items-center justify-center shrink-0 text-lg shadow-inner">
                    🏰
                  </div>
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-slate-200">
                        City {hasMedicineDiscount ? '(Medicine!)' : ''}
                      </span>
                      <span className="text-[10px] font-bold text-slate-400">{self.citiesLeft} left</span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ResourceMiniPill
                        resource="wheat"
                        needed={hasMedicineDiscount ? 1 : 2}
                        held={self.resources.wheat || 0}
                      />
                      <ResourceMiniPill
                        resource="ore"
                        needed={hasMedicineDiscount ? 2 : 3}
                        held={self.resources.ore || 0}
                      />
                    </div>
                  </div>
                </button>
              );
            })()}
          </div>
        )}

        {/* BOTTOM-RIGHT GROUP: Resource & Commodity Hand Dock with Gain/Loss Animations */}
        {self && (
          <div className="pointer-events-auto relative flex flex-col items-end gap-1.5 w-full shrink-0">
            {/* Floating Resource / Commodity Gain / Spend Summary Toast */}
            {resourceToastItems.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl animate-bounce">
                {resourceToastItems.map((item) => {
                  const isGain = item.delta > 0;
                  const isRes = item.cardType in RESOURCE_LABELS;
                  const label = isRes
                    ? RESOURCE_LABELS[item.cardType as ResourceType]
                    : COMMODITY_LABELS[item.cardType as CommodityType];
                  return (
                    <div
                      key={item.id}
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-black border ${
                        isGain
                          ? 'bg-emerald-950/95 border-emerald-500 text-emerald-300'
                          : 'bg-rose-950/95 border-rose-500 text-rose-300'
                      }`}
                    >
                      <span>{isGain ? `+${item.delta}` : item.delta}</span>
                      <img
                        src={
                          isRes
                            ? RESOURCE_ICONS[item.cardType as ResourceType]
                            : COMMODITY_ICONS[item.cardType as CommodityType]
                        }
                        alt={label}
                        className="w-3.5 h-5 object-cover rounded"
                      />
                      <span>{label}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Commodities Row (Cities & Knights) */}
            {isCK && (
              <div className="grid grid-cols-5 gap-1.5 bg-slate-900/95 backdrop-blur-xl px-2.5 py-2 rounded-2xl border border-slate-700/80 shadow-2xl w-full">
                {COMMODITIES.map((c) => {
                  const count = self.commodities?.[c] || 0;
                  const deltaObj = resourceDeltas[c];
                  const delta = deltaObj?.delta || 0;
                  const isGain = delta > 0;
                  const isLoss = delta < 0;

                  return (
                    <div
                      key={c}
                      className={`relative flex flex-col items-center group transition-all duration-300 hover:-translate-y-0.5 ${
                        isGain
                          ? '-translate-y-1.5 scale-105'
                          : isLoss
                            ? 'translate-y-0.5 scale-95'
                            : ''
                      }`}
                    >
                      {delta !== 0 && (
                        <span
                          key={deltaObj?.seq}
                          className={`pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded-full text-[11px] font-black shadow-lg border animate-bounce whitespace-nowrap ${
                            isGain
                              ? 'bg-emerald-500 text-slate-950 border-emerald-200'
                              : 'bg-rose-600 text-white border-rose-300'
                          }`}
                        >
                          {isGain ? `+${delta}` : delta}
                        </span>
                      )}

                      <img
                        src={COMMODITY_ICONS[c]}
                        alt={COMMODITY_LABELS[c]}
                        className={`w-10 h-14 object-cover rounded-lg shadow-lg border transition-all duration-300 shrink-0 ${
                          isGain
                            ? 'border-emerald-400 ring-2 ring-emerald-400/80'
                            : isLoss
                              ? 'border-rose-500 ring-2 ring-rose-500/80'
                              : 'border-slate-700/80'
                        }`}
                      />
                      <span className="text-[9px] font-bold text-slate-300 mt-0.5">
                        {COMMODITY_LABELS[c]}
                      </span>
                      <span
                        className={`absolute -top-1.5 -right-1.5 font-black text-[10px] px-1.5 py-0.2 rounded-full shadow border transition-transform duration-300 ${
                          isGain
                            ? 'bg-emerald-400 text-slate-950 border-white scale-125'
                            : isLoss
                              ? 'bg-rose-500 text-white border-white scale-110'
                              : count > 0
                                ? 'bg-amber-500 text-slate-950 border-slate-900'
                                : 'bg-slate-800 text-slate-400 border-slate-900'
                        }`}
                      >
                        {count}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Resources Row */}
            <div className="grid grid-cols-5 gap-1.5 bg-slate-900/95 backdrop-blur-xl px-2.5 py-2 rounded-2xl border border-slate-700/80 shadow-2xl w-full">
              {RESOURCES.map((r) => {
                const count = self.resources[r] || 0;
                const deltaObj = resourceDeltas[r];
                const delta = deltaObj?.delta || 0;
                const isGain = delta > 0;
                const isLoss = delta < 0;

                return (
                  <div
                    key={r}
                    className={`relative flex flex-col items-center group transition-all duration-300 hover:-translate-y-0.5 ${
                      isGain
                        ? '-translate-y-1.5 scale-105'
                        : isLoss
                          ? 'translate-y-0.5 scale-95'
                          : ''
                    }`}
                  >
                    {delta !== 0 && (
                      <span
                        key={deltaObj?.seq}
                        className={`pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 z-20 px-1.5 py-0.5 rounded-full text-[11px] font-black shadow-lg border animate-bounce whitespace-nowrap ${
                          isGain
                            ? 'bg-emerald-500 text-slate-950 border-emerald-200'
                            : 'bg-rose-600 text-white border-rose-300'
                        }`}
                      >
                        {isGain ? `+${delta}` : delta}
                      </span>
                    )}

                    <img
                      src={RESOURCE_ICONS[r]}
                      alt={RESOURCE_LABELS[r]}
                      className={`w-10 h-14 object-cover rounded-lg shadow-lg border transition-all duration-300 shrink-0 ${
                        isGain
                          ? 'border-emerald-400 ring-2 ring-emerald-400/80'
                          : isLoss
                            ? 'border-rose-500 ring-2 ring-rose-500/80'
                            : 'border-slate-700/80'
                      }`}
                    />
                    <span className="text-[9px] font-bold text-slate-300 mt-0.5">
                      {RESOURCE_LABELS[r]}
                    </span>
                    <span
                      className={`absolute -top-1.5 -right-1.5 font-black text-[10px] px-1.5 py-0.2 rounded-full shadow border transition-transform duration-300 ${
                        isGain
                          ? 'bg-emerald-400 text-slate-950 border-white scale-125'
                          : isLoss
                            ? 'bg-rose-500 text-white border-white scale-110'
                            : count > 0
                              ? 'bg-amber-500 text-slate-950 border-slate-900'
                              : 'bg-slate-800 text-slate-400 border-slate-900'
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
      </div>
    </div>
  );
};
