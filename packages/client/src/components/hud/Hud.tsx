import React, { useState, useEffect, useRef } from 'react';
import {
  RedactedGameState,
  ResourceType,
  ResourceCount,
  BUILDING_COSTS,
  canAfford,
  PlayerColor,
  DevCardType,
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
  variant: 'red' | 'yellow';
  isRolling: boolean;
}> = React.memo(({ value, variant, isRolling }) => {
  const pips = DIE_PIP_COORDS[value] || DIE_PIP_COORDS[1];
  const bg = variant === 'red' ? '#dc2626' : '#facc15';
  const border = variant === 'red' ? '#991b1b' : '#ca8a04';
  const pipFill = variant === 'red' ? '#fef08a' : '#dc2626';

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
              ? 'Dedicated Robber / Dev Card timer (your main turn timer is paused!)'
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
    errorMessage,
    clearError,
    room,
  } = useGameStore();
  const chatMessages = room?.chatMessages || [];
  const isHost = Boolean(room && myPlayerId && room.hostPlayerId === myPlayerId);

  const [discardSelection, setDiscardSelection] = useState<Record<ResourceType, number>>({
    wood: 0,
    brick: 0,
    wheat: 0,
    sheep: 0,
    ore: 0,
  });

  // Dev card interactive modal state (for Year of Plenty & Monopoly)
  const [pendingDevCard, setPendingDevCard] = useState<{
    cardId: string;
    type: 'year_of_plenty' | 'monopoly';
  } | null>(null);
  const [yopSelection, setYopSelection] = useState<[ResourceType, ResourceType]>(['wheat', 'ore']);
  const [monopolySelection, setMonopolySelection] = useState<ResourceType>('wheat');

  // Improvement #15: Start Dice Statistics panel minimized, positioned to the right of dice controls
  const [showDiceStats, setShowDiceStats] = useState(false);

  // Selected/Hovered Dev Card in the upper-right Dev Card panel (Improvement #16)
  const [focusedDevCardId, setFocusedDevCardId] = useState<string | null>(null);

  // Player Chat input state (Improvement #26)
  const [chatInput, setChatInput] = useState('');

  // Animated Dice state
  const [isRollingAnim, setIsRollingAnim] = useState(false);
  const [animDice, setAnimDice] = useState<[number, number]>([1, 1]);

  // Celebratory Banner for Longest Road / Largest Army Award Events
  const [visibleAwardId, setVisibleAwardId] = useState<string | null>(null);

  // Improvement #2: Turn Alert Notification Banner state
  const [turnAlert, setTurnAlert] = useState<{
    id: string;
    title: string;
    subtitle: string;
  } | null>(null);
  const lastTurnAlertKeyRef = useRef<string>('');

  // Improvement #4: Resource Gain / Loss / Use Animation state
  const prevResourcesRef = useRef<ResourceCount | null>(null);
  const [resourceDeltas, setResourceDeltas] = useState<
    Partial<Record<ResourceType, { delta: number; seq: number }>>
  >({});
  const [resourceToastItems, setResourceToastItems] = useState<
    Array<{ id: string; resource: ResourceType; delta: number }>
  >([]);

  // Auto-scroll refs for Event Log (Improvement #13) and Player Chat (Improvement #26)
  const logContainerRef = useRef<HTMLDivElement | null>(null);
  const chatContainerRef = useRef<HTMLDivElement | null>(null);

  const latestLogId = state.actionLog[state.actionLog.length - 1]?.id;
  const latestChatId = chatMessages[chatMessages.length - 1]?.id;

  // Improvement #13: Autoscroll on new events even after actionLog reaches its 100-entry cap
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [state.actionLog.length, latestLogId]);

  // Improvement #26: Autoscroll chat on new messages
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages.length, latestChatId]);

  // Show Longest Road / Largest Army celebratory notification banner for 6 seconds when awarded
  useEffect(() => {
    if (!state.latestAwardEvent) return;
    setVisibleAwardId(state.latestAwardEvent.id);
    const timer = setTimeout(() => {
      setVisibleAwardId((current) => (current === state.latestAwardEvent?.id ? null : current));
    }, 6000);
    return () => clearTimeout(timer);
  }, [state.latestAwardEvent?.id]);

  useEffect(() => {
    if (!state.lastDiceRollAt || !state.diceRoll) return;
    setIsRollingAnim(true);
    const interval = setInterval(() => {
      setAnimDice([
        cryptoRandomInt(6) + 1,
        cryptoRandomInt(6) + 1,
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

  // Improvement #2: Detect when it becomes the local player's turn to act and raise a Turn Alert notification + chime + tab title
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
        ? 'Place your starting Road connected to your settlement'
        : 'Place your starting Settlement on the board';
    } else if (needsDiscard) {
      alertKey = `discard_${state.turnNumber}_${myPlayerId}`;
      title = '⚠️ 7 ROLLED — DISCARD CARDS!';
      subtitle = `Select ${needsDiscard} resource cards to discard`;
    } else if (isMyRobberTurn) {
      alertKey = `robber_${state.phase}_${state.turnNumber}_${myPlayerId}`;
      title = state.phase === 'ROBBER_PLACEMENT' ? '🦹 MOVE THE ROBBER!' : '🦹 STEAL A RESOURCE!';
      subtitle =
        state.phase === 'ROBBER_PLACEMENT'
          ? 'Click any highlighted hex on the board to move the Robber'
          : 'Choose an adjacent player to steal 1 random card from';
    } else if (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId) {
      alertKey = `paired_${state.turnNumber}_${myPlayerId}`;
      title = "⚡ PAIRED PLAYER 2 TURN!";
      subtitle = 'You may build & trade with the Bank now';
    } else if (state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId) {
      alertKey = `action_${state.turnNumber}_${myPlayerId}`;
      title = '🛠️ YOUR TURN — TRADE & BUILD!';
      subtitle = 'Trade resources, build roads/settlements/cities, or play a Dev Card';
    }

    const isCurrentlyMyAction = Boolean(alertKey);
    document.title = isCurrentlyMyAction ? '🎲 YOUR TURN! — CATAN ONLINE' : 'CATAN ONLINE';

    if (alertKey && alertKey !== lastTurnAlertKeyRef.current) {
      // Do not re-chime if transitioning from our own ROLL_DICE straight into our own ACTION_PHASE on the same turn
      const wasAlreadyMyRollTurn =
        lastTurnAlertKeyRef.current === `roll_${state.turnNumber}_${myPlayerId}` &&
        alertKey === `action_${state.turnNumber}_${myPlayerId}`;
      lastTurnAlertKeyRef.current = alertKey;

      if (!wasAlreadyMyRollTurn) {
        playTurnAlertChime();
        setTurnAlert({ id: alertKey, title, subtitle });
        const timer = setTimeout(() => {
          setTurnAlert((prev) => (prev?.id === alertKey ? null : prev));
        }, 4500);
        return () => clearTimeout(timer);
      }
    } else if (!alertKey) {
      lastTurnAlertKeyRef.current = '';
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
  ]);

  // Improvement #4: Detect resource gains and losses/uses in self.resources and trigger floating animations
  useEffect(() => {
    if (!self?.resources) return;
    const current = self.resources;
    if (!prevResourcesRef.current) {
      prevResourcesRef.current = { ...current };
      return;
    }

    const prev = prevResourcesRef.current;
    const changed: Partial<Record<ResourceType, { delta: number; seq: number }>> = {};
    const toastBatch: Array<{ id: string; resource: ResourceType; delta: number }> = [];
    const nowSeq = Date.now();

    for (const r of RESOURCES) {
      const diff = (current[r] || 0) - (prev[r] || 0);
      if (diff !== 0) {
        changed[r] = { delta: diff, seq: nowSeq };
        toastBatch.push({ id: `${r}_${nowSeq}`, resource: r, delta: diff });
      }
    }

    prevResourcesRef.current = { ...current };

    if (toastBatch.length > 0) {
      setResourceDeltas((old) => ({ ...old, ...changed }));
      setResourceToastItems(toastBatch);
      const timer = setTimeout(() => {
        setResourceDeltas((old) => {
          const next = { ...old };
          for (const r of Object.keys(changed) as ResourceType[]) {
            if (next[r]?.seq === nowSeq) {
              delete next[r];
            }
          }
          return next;
        });
        setResourceToastItems((old) =>
          old.filter((item) => !toastBatch.some((b) => b.id === item.id)),
        );
      }, 2200);
      return () => clearTimeout(timer);
    }
  }, [
    self?.resources?.wood,
    self?.resources?.brick,
    self?.resources?.wheat,
    self?.resources?.sheep,
    self?.resources?.ore,
  ]);

  const isSeparateActionTimer =
    state.phase === 'DISCARD_PHASE' ||
    state.phase === 'ROBBER_PLACEMENT' ||
    state.phase === 'ROBBER_STEAL' ||
    state.freeRoadsRemaining > 0;

  const displayedDice: [number, number] = isRollingAnim
    ? animDice
    : state.diceRoll || [1, 1];
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

  // Improvement #17: Preserve randomized turn order in Players & VPs panel
  const orderedPlayers =
    state.playerOrder && state.playerOrder.length > 0
      ? state.playerOrder.map((id) => state.players[id]).filter(Boolean)
      : Object.values(state.players);

  // Dice Roll Statistics calculation
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

  // Improvement #24: Hidden Bank house rule support
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

  // Focused Dev Card in Upper-Right Panel
  const activeFocusedCard =
    self?.devCards.find((c) => c.id === focusedDevCardId) || self?.devCards[0] || null;

  return (
    <div className="pointer-events-none absolute inset-0 flex justify-between p-2.5 sm:p-3.5 z-10 overflow-hidden gap-3">
      {/* 1. LEFT SIDEBAR: Players & VPs (Randomized Turn Order) + Bank Supply + Resizable Event Log + Resizable Player Chat */}
      <div className="flex flex-col items-start gap-2 max-h-full overflow-y-auto overflow-x-visible pr-1 shrink-0">
        {/* Players & Victory Points Leaderboard */}
        <div className="pointer-events-auto w-[285px] sm:w-[305px] max-w-[32vw] bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2.5 shadow-2xl flex flex-col gap-1.5 shrink-0">
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

              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-xl border transition ${
                    isCurrentActive
                      ? 'bg-amber-500/15 border-amber-400 shadow-md'
                      : isMe
                        ? 'bg-slate-800/80 border-slate-600'
                        : 'bg-slate-950/60 border-slate-800/80'
                  }`}
                >
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

                    <span title="Resource Cards in Hand" className="font-semibold text-slate-300">
                      {p.cardCount}🎴
                    </span>
                    <span title="Unplayed Dev Cards" className="font-semibold text-indigo-300">
                      {p.devCardCount}📜
                    </span>
                    <span
                      title={
                        hasSecretVp
                          ? `Public VP: ${p.victoryPoints} | True Total (with secret VP cards): ${self?.secretVictoryPoints} VP`
                          : `Public Victory Points: ${p.victoryPoints}`
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
                        title={`Kick ${p.name} (returns their resources, Dev Cards & buildings to the bank)`}
                        className="p-1 bg-rose-950/90 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-700/80 rounded-lg transition cursor-pointer"
                      >
                        <UserMinus className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Resource Deck & Dev Card Bank Supply Counter (Supports Hidden Bank Rule #24) */}
        <div className="pointer-events-auto w-[285px] sm:w-[305px] max-w-[32vw] bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl p-2 shadow-2xl flex flex-col gap-1.5 shrink-0">
          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] font-black text-emerald-400 uppercase tracking-wider flex items-center gap-1">
              <Layers className="w-3.5 h-3.5" />{' '}
              {isBankHidden ? 'Bank Supply (Hidden)' : `Bank Resource Deck (${totalBankResources})`}
            </span>
            <span className="text-[10px] font-bold text-indigo-300">
              Dev Pile: {state.devCardDeckCount}
            </span>
          </div>

          {isBankHidden || !state.resourceBank ? (
            <div className="flex items-center justify-center gap-2 bg-slate-950/80 py-2 px-3 rounded-xl border border-amber-700/40 text-[11px] font-bold text-amber-300">
              <EyeOff className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>Hidden Bank House Rule Active</span>
            </div>
          ) : (
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
          )}
        </div>

        {/* Live Event Log Panel (Resizable by dragging corners + Autoscrolls at cap) */}
        <ResizableHudBox
          storageKey="catan_event_log_size"
          defaultWidth={305}
          defaultHeight={185}
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

        {/* Room-Scoped Player Chat Panel (Resizable by dragging corners) */}
        <ResizableHudBox
          storageKey="catan_player_chat_size"
          defaultWidth={305}
          defaultHeight={195}
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

      {/* 2. CENTER COLUMN: Top Turn/Timer/Dice + Right-Aligned Dice Stats (Minimized by Default) & Middle Alerts */}
      <div className="flex-1 flex flex-col items-center justify-between min-w-0 pointer-events-none">
        {/* TOP-CENTER BAR */}
        <div className="pointer-events-auto flex flex-col items-center gap-2 max-w-full">
          <div className="relative flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5 bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 px-3.5 py-2 rounded-2xl shadow-2xl">
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
                  (state.lastSetupVertexId ? 'Setup 2: Place Road' : 'Setup 2: 2nd Settlement')}
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

            {/* Animated Visual Dice Controls */}
            <div
              onClick={handleRollDice}
              title={
                isRollPhase
                  ? 'Click dice to roll for your turn!'
                  : state.diceRolledThisTurn
                    ? `Current turn roll: ${displayedDice[0]} + ${displayedDice[1]} = ${diceSum}`
                    : 'Waiting for dice roll (showing previous turn roll)'
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
                <VisualDie value={displayedDice[0]} variant="red" isRolling={isRollingAnim} />
                <VisualDie value={displayedDice[1]} variant="yellow" isRolling={isRollingAnim} />
              </div>
              <div className="flex flex-col items-center pl-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase leading-none">
                  {state.diceRolledThisTurn ? 'Total' : 'Prev / Roll'}
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

            {/* Improvement #15: Dice Statistics Positioned to the Right of Dice Controls, Minimized by Default */}
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

          {/* Improvement #2: Prominent Turn Alert Notification Banner when it becomes the player's turn */}
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

          {/* Celebratory Longest Road / Largest Army Notification Banner */}
          {activeAwardBanner && (
            <div className="bg-gradient-to-r from-amber-500/95 via-amber-400/95 to-yellow-500/95 text-slate-950 px-5 py-2 rounded-2xl shadow-2xl border-2 border-white/80 flex items-center gap-3 animate-bounce">
              {activeAwardBanner.awardType === 'longest_route' ? (
                <Trophy className="w-5 h-5 text-slate-950 shrink-0" />
              ) : (
                <Swords className="w-5 h-5 text-slate-950 shrink-0" />
              )}
              <div className="flex flex-col">
                <span className="text-[11px] font-black uppercase tracking-wider">
                  {activeAwardBanner.awardType === 'longest_route'
                    ? '🛣️ Longest Road Claimed (+2 VP)!'
                    : '⚔️ Largest Army Claimed (+2 VP)!'}
                </span>
                <span className="text-xs font-extrabold">
                  {activeAwardBanner.playerName} now holds{' '}
                  {activeAwardBanner.awardType === 'longest_route'
                    ? `Longest Road (${activeAwardBanner.metricValue} roads)`
                    : `Largest Army (${activeAwardBanner.metricValue} Knights)`}
                  !
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
        <div className="flex flex-col items-center gap-3 my-auto">
          {/* Game Over Victory Card with Exit to Home Screen Button */}
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

          {/* Interactive Modal for Year of Plenty / Monopoly Dev Card Resource Selection */}
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
                      <img src={RESOURCE_ICONS[r]} alt={RESOURCE_LABELS[r]} className="w-9 h-12 object-cover rounded shadow mb-0.5" />
                      <span className="text-[10px] font-bold text-slate-300">{RESOURCE_LABELS[r]}</span>
                      <span className="text-[10px] text-slate-400">Held: {held}</span>
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

      {/* 3. RIGHT SIDEBAR: Room/Rules Pill + Upper-Right Development Cards (Improvement #16) + Center-Right Possible Builds + Bottom-Right Resource Hand */}
      <div className="flex flex-col items-end justify-between gap-2 w-[250px] sm:w-[270px] max-w-[30vw] max-h-full overflow-y-auto pl-0.5 shrink-0">
        {/* TOP-RIGHT GROUP: Room & House Rules Info + Upper-Right Development Cards Panel */}
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
            {houseRules && (houseRules.balancedDice || houseRules.hiddenBank || houseRules.freeTrades) && (
              <div className="flex flex-wrap gap-1 pt-1 border-t border-slate-800">
                {houseRules.balancedDice && (
                  <span className="text-[9px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-700/70 px-1.5 py-0.2 rounded">
                    🎲 Balanced Dice
                  </span>
                )}
                {houseRules.hiddenBank && (
                  <span className="text-[9px] font-bold bg-amber-950 text-amber-300 border border-amber-700/70 px-1.5 py-0.2 rounded">
                    🔒 Hidden Bank
                  </span>
                )}
                {houseRules.freeTrades && (
                  <span className="text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-700/70 px-1.5 py-0.2 rounded">
                    🎁 Free Trades
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Improvement #16: Upper-Right Development Cards Panel (Always Visible & Usable without Clipping!) */}
          {self && (
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
                  {/* Thumbnail Row */}
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

                  {/* Expanded Focused Card Inspector (Guaranteed inside viewport with usable Play button!) */}
                  {activeFocusedCard && (() => {
                    const c = activeFocusedCard;
                    const info = DEV_CARD_INFO[c.type];
                    const isBoughtThisTurn = c.boughtTurn === state.turnNumber && c.type !== 'victory_point';
                    const isPlayable =
                      (isMyTurn || (isRollPhase && c.type === 'knight')) &&
                      c.boughtTurn !== state.turnNumber &&
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
          )}
        </div>

        {/* CENTER-RIGHT GROUP: Always-Visible Possible Builds Stack */}
        {self && (
          <div className="pointer-events-auto flex flex-col gap-1.5 w-full my-auto">
            {/* 1. Dev Card */}
            {(() => {
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
            })()}

            {/* 2. Road */}
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

            {/* 3. Settlement */}
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

            {/* 4. City */}
            {(() => {
              const canBuild =
                isMyTurn &&
                canAfford(self.resources, BUILDING_COSTS.city) &&
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
                      <span className="text-xs font-extrabold text-slate-200">City</span>
                      <span className="text-[10px] font-bold text-slate-400">{self.citiesLeft} left</span>
                    </div>
                    <div className="flex items-center gap-1 flex-wrap">
                      <ResourceMiniPill resource="wheat" needed={2} held={self.resources.wheat || 0} />
                      <ResourceMiniPill resource="ore" needed={3} held={self.resources.ore || 0} />
                    </div>
                  </div>
                </button>
              );
            })()}
          </div>
        )}

        {/* BOTTOM-RIGHT GROUP: Resource Hand Dock with Gain/Loss Animations (Improvement #4) */}
        {self && (
          <div className="pointer-events-auto relative flex flex-col items-end gap-1.5 w-full shrink-0">
            {/* Floating Resource Gain / Spend Summary Toast */}
            {resourceToastItems.length > 0 && (
              <div className="flex flex-wrap items-center justify-end gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-950/95 border border-slate-700 shadow-2xl animate-bounce">
                {resourceToastItems.map((item) => {
                  const isGain = item.delta > 0;
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
                        src={RESOURCE_ICONS[item.resource]}
                        alt={RESOURCE_LABELS[item.resource]}
                        className="w-3.5 h-5 object-cover rounded"
                      />
                      <span>{RESOURCE_LABELS[item.resource]}</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-between gap-1.5 bg-slate-900/95 backdrop-blur-xl px-2.5 py-2 rounded-2xl border border-slate-700/80 shadow-2xl w-full">
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
                    {/* Animated Floating +N / -N Badge Above Card */}
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
