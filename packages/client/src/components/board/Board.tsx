import React, { useState, useMemo, useEffect } from 'react';
import {
  HEX_RADIUS,
  getHexCornerPoints,
  hexToPixel,
  RedactedGameState,
  PlayerColor,
  ResourceType,
  satisfiesDistanceRule,
  isValidRobberHex,
  isValidKnightRecruitVertex,
  getReachableKnightVertices,
  isOpenRoadEdge,
  getPlayerVulnerableCityVertices,
} from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';

interface BoardProps {
  state: RedactedGameState;
  myPlayerId: string | null;
}

// High-saturation vibrant player colors
const PLAYER_COLORS: Record<
  PlayerColor,
  { primary: string; secondary: string; border: string; door: string }
> = {
  red: { primary: '#ff1a1a', secondary: '#b91c1c', border: '#ffffff', door: '#fee2e2' },
  blue: { primary: '#0055ff', secondary: '#1d4ed8', border: '#ffffff', door: '#dbeafe' },
  orange: { primary: '#ff6a00', secondary: '#c2410c', border: '#ffffff', door: '#ffedd5' },
  white: { primary: '#ffffff', secondary: '#cbd5e1', border: '#0f172a', door: '#334155' },
  green: { primary: '#00cc44', secondary: '#15803d', border: '#ffffff', door: '#dcfce7' },
  purple: { primary: '#aa00ff', secondary: '#6b21a8', border: '#ffffff', door: '#f3e8ff' },
};

const RESOURCE_PORT_ASSETS: Record<ResourceType, { img: string; ringColor: string; label: string }> = {
  wood: { img: '/assets/cards/wood.png', ringColor: '#16a34a', label: 'Lumber' },
  brick: { img: '/assets/cards/brick.png', ringColor: '#dc2626', label: 'Brick' },
  wheat: { img: '/assets/cards/wheat.png', ringColor: '#eab308', label: 'Grain' },
  sheep: { img: '/assets/cards/wool.png', ringColor: '#65a30d', label: 'Wool' },
  ore: { img: '/assets/cards/ore.png', ringColor: '#64748b', label: 'Ore' },
};

const NUMBER_PIPS: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

const METROPOLIS_STYLES: Record<
  'trade' | 'politics' | 'science',
  { fill: string; stroke: string; badge: string; label: string }
> = {
  trade: { fill: '#facc15', stroke: '#854d0e', badge: '🟡', label: 'Trade Metropolis (4 VP)' },
  politics: { fill: '#38bdf8', stroke: '#1e3a8a', badge: '🔵', label: 'Politics Metropolis (4 VP)' },
  science: { fill: '#4ade80', stroke: '#14532d', badge: '🟢', label: 'Science Metropolis (4 VP)' },
};

interface PieceTooltip {
  x: number;
  y: number;
  playerName: string;
  playerColor: PlayerColor;
  pieceLabel: string;
}

export const Board: React.FC<BoardProps> = React.memo(({ state, myPlayerId }) => {
  const {
    sendAction,
    activeBuildMode,
    setBuildMode,
    selectedKnightVertexId,
    setSelectedKnightVertexId,
    activeProgressCardId,
    setActiveProgressCardId,
  } = useGameStore();

  const [hoveredVertex, setHoveredVertex] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [hoveredPiece, setHoveredPiece] = useState<PieceTooltip | null>(null);
  const [inventionFirstHexId, setInventionFirstHexId] = useState<string | null>(null);

  useEffect(() => {
    if (activeBuildMode !== 'invention') {
      setInventionFirstHexId(null);
    }
  }, [activeBuildMode]);

  const isCK = state.settings.expansion === 'cities_and_knights';

  const isMyTurn =
    (state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId) ||
    (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId);

  const isMySetupTurn =
    (state.phase === 'SETUP_ROUND_1' || state.phase === 'SETUP_ROUND_2') &&
    state.setupTurnOrder[state.setupTurnIndex] === myPlayerId;

  // Compute bounding box of board with generous ocean margin for outer harbors
  const { minX, maxX, minY, maxY } = useMemo(() => {
    let minX = 0,
      maxX = 0,
      minY = 0,
      maxY = 0;
    for (const v of Object.values(state.board.vertices)) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { minX: minX - 140, maxX: maxX + 140, minY: minY - 130, maxY: maxY + 130 };
  }, [state.board.vertices]);

  const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;

  // Use authoritative lastSetupVertexId to know whether player is placing setup road or setup settlement
  const isSetupPlacingRoad = isMySetupTurn && state.lastSetupVertexId !== null;
  const isSetupPlacingSettlement = isMySetupTurn && state.lastSetupVertexId === null;
  const isPlacingRoad =
    isSetupPlacingRoad || (isMyTurn && (activeBuildMode === 'road' || state.freeRoadsRemaining > 0));
  const isPlacingSettlement = isSetupPlacingSettlement || (isMyTurn && activeBuildMode === 'settlement');

  // Pending C&K interactive board states
  const isMyDisplacedKnightTurn = Boolean(
    myPlayerId && state.pendingDisplacedKnight?.playerId === myPlayerId,
  );
  const isMyDeserterVictimTurn = Boolean(
    myPlayerId &&
      state.pendingDeserter?.targetPlayerId === myPlayerId &&
      state.pendingDeserter.stage === 'choose_victim_knight',
  );
  const isMyDeserterPlaceTurn = Boolean(
    myPlayerId &&
      state.pendingDeserter?.requesterId === myPlayerId &&
      state.pendingDeserter.stage === 'place_new_knight',
  );
  const isMyPillageTurn = Boolean(
    myPlayerId && state.pendingBarbarianPillagePlayerIds?.includes(myPlayerId),
  );
  const vulnerableCityVertices = useMemo(() => {
    if (!isMyPillageTurn || !myPlayerId) return new Set<string>();
    return new Set(getPlayerVulnerableCityVertices(state.board, myPlayerId));
  }, [isMyPillageTurn, myPlayerId, state.board]);

  const reachableKnightMove = useMemo(() => {
    if (!isMyTurn || activeBuildMode !== 'move_knight' || !selectedKnightVertexId || !myPlayerId) {
      return { emptyVertices: new Set<string>(), displaceableKnightVertices: new Set<string>() };
    }
    const k = state.board.knights?.[selectedKnightVertexId];
    if (!k) {
      return { emptyVertices: new Set<string>(), displaceableKnightVertices: new Set<string>() };
    }
    const res = getReachableKnightVertices(state.board, myPlayerId, selectedKnightVertexId, k.level);
    return {
      emptyVertices: new Set(res.emptyVertices),
      displaceableKnightVertices: new Set(res.displaceableKnightVertices),
    };
  }, [isMyTurn, activeBuildMode, selectedKnightVertexId, myPlayerId, state.board]);

  // Helper to check if an edge is a legal road build spot for current player
  const isEdgeLegalForRoad = (edgeId: string): boolean => {
    if (!myPlayerId) return false;
    const edge = state.board.edges[edgeId];
    if (!edge || state.board.roads[edgeId]) return false;

    if (isSetupPlacingRoad) {
      return edge.v1 === state.lastSetupVertexId || edge.v2 === state.lastSetupVertexId;
    }

    const v1Building = state.board.buildings[edge.v1];
    const v2Building = state.board.buildings[edge.v2];
    const v1Knight = state.board.knights?.[edge.v1];
    const v2Knight = state.board.knights?.[edge.v2];

    const v1BlockedByOpponent =
      (v1Building && v1Building.playerId !== myPlayerId) ||
      (v1Knight && v1Knight.playerId !== myPlayerId);
    const v2BlockedByOpponent =
      (v2Building && v2Building.playerId !== myPlayerId) ||
      (v2Knight && v2Knight.playerId !== myPlayerId);

    const v1TouchesOwnBuilding = v1Building && v1Building.playerId === myPlayerId;
    const v2TouchesOwnBuilding = v2Building && v2Building.playerId === myPlayerId;

    const v1FriendlyRoad =
      !v1BlockedByOpponent &&
      Object.values(state.board.roads).some(
        (r) =>
          r.playerId === myPlayerId &&
          (state.board.edges[r.edgeId].v1 === edge.v1 || state.board.edges[r.edgeId].v2 === edge.v1),
      );

    const v2FriendlyRoad =
      !v2BlockedByOpponent &&
      Object.values(state.board.roads).some(
        (r) =>
          r.playerId === myPlayerId &&
          (state.board.edges[r.edgeId].v1 === edge.v2 || state.board.edges[r.edgeId].v2 === edge.v2),
      );

    return Boolean(v1TouchesOwnBuilding || v2TouchesOwnBuilding || v1FriendlyRoad || v2FriendlyRoad);
  };

  // Helper to check if a vertex is a legal settlement spot for current player
  const isVertexLegalForSettlement = (vertexId: string): boolean => {
    if (!myPlayerId) return false;
    if (!satisfiesDistanceRule(vertexId, state.board)) return false;
    if (isSetupPlacingSettlement) return true;

    return Object.values(state.board.roads).some(
      (r) =>
        r.playerId === myPlayerId &&
        (state.board.edges[r.edgeId].v1 === vertexId || state.board.edges[r.edgeId].v2 === vertexId),
    );
  };

  const isVertexLegalForIntrigue = (vertexId: string): boolean => {
    if (!myPlayerId) return false;
    const k = state.board.knights?.[vertexId];
    if (!k || k.playerId === myPlayerId) return false;
    return Object.values(state.board.roads).some(
      (r) =>
        r.playerId === myPlayerId &&
        (state.board.edges[r.edgeId]?.v1 === vertexId || state.board.edges[r.edgeId]?.v2 === vertexId),
    );
  };

  const handleVertexClick = (vId: string) => {
    if (!myPlayerId) return;

    // 1. Barbarian pillage choice
    if (isMyPillageTurn && vulnerableCityVertices.has(vId)) {
      sendAction({ type: 'CHOOSE_PILLAGED_CITY', playerId: myPlayerId, vertexId: vId });
      return;
    }

    // 2. Displaced knight relocation
    if (isMyDisplacedKnightTurn && state.pendingDisplacedKnight?.validVertexIds.includes(vId)) {
      sendAction({ type: 'MOVE_DISPLACED_KNIGHT', playerId: myPlayerId, toVertexId: vId });
      return;
    }

    // 3. Deserter victim chooses knight to desert
    if (isMyDeserterVictimTurn) {
      const k = state.board.knights?.[vId];
      if (k && k.playerId === myPlayerId) {
        sendAction({ type: 'CHOOSE_DESERTER_KNIGHT', playerId: myPlayerId, vertexId: vId });
        return;
      }
    }

    // 4. Deserter chooser places knight
    if (isMyDeserterPlaceTurn && isValidKnightRecruitVertex(state.board, myPlayerId, vId)) {
      sendAction({ type: 'PLACE_DESERTER_KNIGHT', playerId: myPlayerId, vertexId: vId });
      return;
    }

    // 5. Setup round placement
    if (isSetupPlacingSettlement) {
      sendAction({ type: 'BUILD_SETUP_SETTLEMENT', playerId: myPlayerId, vertexId: vId });
      return;
    }

    if (isMyTurn) {
      if (activeBuildMode === 'settlement') {
        sendAction({ type: 'BUILD_SETTLEMENT', playerId: myPlayerId, vertexId: vId });
        setBuildMode('none');
        return;
      }
      if (activeBuildMode === 'city') {
        sendAction({ type: 'UPGRADE_CITY', playerId: myPlayerId, vertexId: vId });
        setBuildMode('none');
        return;
      }
      if (activeBuildMode === 'city_wall') {
        if (activeProgressCardId) {
          sendAction({
            type: 'PLAY_PROGRESS_CARD',
            playerId: myPlayerId,
            cardId: activeProgressCardId,
            options: { cityVertexId: vId },
          });
          setActiveProgressCardId(null);
        } else {
          sendAction({ type: 'BUILD_CITY_WALL', playerId: myPlayerId, vertexId: vId });
        }
        setBuildMode('none');
        return;
      }
      if (activeBuildMode === 'knight') {
        sendAction({ type: 'RECRUIT_KNIGHT', playerId: myPlayerId, vertexId: vId });
        setBuildMode('none');
        return;
      }
      if (activeBuildMode === 'move_knight' && selectedKnightVertexId) {
        if (
          reachableKnightMove.emptyVertices.has(vId) ||
          reachableKnightMove.displaceableKnightVertices.has(vId)
        ) {
          sendAction({
            type: 'MOVE_KNIGHT',
            playerId: myPlayerId,
            fromVertexId: selectedKnightVertexId,
            toVertexId: vId,
          });
          setSelectedKnightVertexId(null);
          setBuildMode('none');
          return;
        }
      }
      if (activeBuildMode === 'intrigue' && activeProgressCardId && isVertexLegalForIntrigue(vId)) {
        sendAction({
          type: 'PLAY_PROGRESS_CARD',
          playerId: myPlayerId,
          cardId: activeProgressCardId,
          options: { knightVertexId: vId },
        });
        setActiveProgressCardId(null);
        setBuildMode('none');
        return;
      }
    }

    // Clicking own knight selects/deselects it for Knight actions in HUD
    const clickedKnight = state.board.knights?.[vId];
    if (clickedKnight && clickedKnight.playerId === myPlayerId) {
      setSelectedKnightVertexId(selectedKnightVertexId === vId ? null : vId);
    }
  };

  const handleEdgeClick = (edgeId: string) => {
    if (!myPlayerId) return;

    if (isSetupPlacingRoad) {
      sendAction({ type: 'BUILD_SETUP_ROAD', playerId: myPlayerId, edgeId });
      return;
    }

    if (isMyTurn && activeBuildMode === 'diplomacy' && activeProgressCardId) {
      if (isOpenRoadEdge(state.board, edgeId)) {
        sendAction({
          type: 'PLAY_PROGRESS_CARD',
          playerId: myPlayerId,
          cardId: activeProgressCardId,
          options: { edgeId },
        });
        setActiveProgressCardId(null);
        setBuildMode('none');
      }
      return;
    }

    if (isMyTurn && (activeBuildMode === 'road' || state.freeRoadsRemaining > 0)) {
      sendAction({ type: 'BUILD_ROAD', playerId: myPlayerId, edgeId });
      if (state.freeRoadsRemaining <= 1) {
        setBuildMode('none');
      }
    }
  };

  const isRobberController = state.robberControllerPlayerId
    ? state.robberControllerPlayerId === myPlayerId
    : state.currentTurnPlayerId === myPlayerId || state.pairedPlayerId === myPlayerId;

  const isHexLegalForMerchant = (hexId: string): boolean => {
    if (!myPlayerId) return false;
    const hex = state.board.hexes[hexId];
    if (!hex || !['forest', 'hills', 'fields', 'pasture', 'mountains'].includes(hex.terrain)) {
      return false;
    }
    const hexKey = `${hex.q},${hex.r},${hex.s}`;
    return Object.values(state.board.vertices).some(
      (v) =>
        v.hexCoords.includes(hexKey) &&
        state.board.buildings[v.id]?.playerId === myPlayerId,
    );
  };

  const isHexLegalForInvention = (hexId: string): boolean => {
    const hex = state.board.hexes[hexId];
    if (!hex || hex.terrain === 'desert' || hex.terrain === 'sea' || !hex.number) return false;
    return ![2, 6, 8, 12].includes(hex.number);
  };

  const handleHexClick = (hexId: string) => {
    if (!myPlayerId) return;
    if (state.turnDeadlineMs && Date.now() >= state.turnDeadlineMs) return;

    const canMoveRobber = state.phase === 'ROBBER_PLACEMENT' && isRobberController;
    if (canMoveRobber) {
      sendAction({ type: 'MOVE_ROBBER', playerId: myPlayerId, hexId });
      return;
    }

    if (isMyTurn && activeBuildMode === 'chase_robber' && selectedKnightVertexId) {
      if (isValidRobberHex(state as any, hexId, myPlayerId)) {
        sendAction({
          type: 'CHASE_ROBBER',
          playerId: myPlayerId,
          knightVertexId: selectedKnightVertexId,
          hexId,
        });
        setSelectedKnightVertexId(null);
        setBuildMode('none');
      }
      return;
    }

    if (isMyTurn && activeBuildMode === 'merchant' && activeProgressCardId) {
      if (isHexLegalForMerchant(hexId)) {
        sendAction({
          type: 'PLAY_PROGRESS_CARD',
          playerId: myPlayerId,
          cardId: activeProgressCardId,
          options: { hexId },
        });
        setActiveProgressCardId(null);
        setBuildMode('none');
      }
      return;
    }

    if (isMyTurn && activeBuildMode === 'taxation' && activeProgressCardId) {
      if (isValidRobberHex(state as any, hexId, myPlayerId)) {
        sendAction({
          type: 'PLAY_PROGRESS_CARD',
          playerId: myPlayerId,
          cardId: activeProgressCardId,
          options: { hexId },
        });
        setActiveProgressCardId(null);
        setBuildMode('none');
      }
      return;
    }

    if (isMyTurn && activeBuildMode === 'invention' && activeProgressCardId) {
      if (!isHexLegalForInvention(hexId)) return;
      if (!inventionFirstHexId) {
        setInventionFirstHexId(hexId);
      } else if (inventionFirstHexId === hexId) {
        setInventionFirstHexId(null);
      } else {
        sendAction({
          type: 'PLAY_PROGRESS_CARD',
          playerId: myPlayerId,
          cardId: activeProgressCardId,
          options: { swapHexIds: [inventionFirstHexId, hexId] },
        });
        setInventionFirstHexId(null);
        setActiveProgressCardId(null);
        setBuildMode('none');
      }
    }
  };

  return (
    <div
      className="relative w-full h-full flex items-center justify-center overflow-hidden bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "url('/assets/backgrounds/bg.jpg')" }}
    >
      {/* Subtle dark ocean vignette so board hexes and HUD pop crisply over the artwork */}
      <div className="absolute inset-0 bg-slate-950/35 pointer-events-none" />

      {/* SVG Game Board */}
      <svg viewBox={viewBox} className="relative z-10 w-full h-full drop-shadow-2xl">
        <defs>
          {['forest', 'hills', 'fields', 'pasture', 'mountains', 'desert', 'sea'].map((t) => (
            <pattern
              key={t}
              id={`pat-${t}`}
              width="100%"
              height="100%"
              viewBox="0 0 400 344"
              patternUnits="objectBoundingBox"
            >
              <image href={`/assets/hexes/${t}.png`} width="400" height="344" preserveAspectRatio="none" />
            </pattern>
          ))}

          {/* Clip paths for harbor resource card circles */}
          <clipPath id="harbor-circle-clip">
            <circle cx="0" cy="0" r="18" />
          </clipPath>

          {/* CRITICAL FIX: filterUnits="userSpaceOnUse" prevents horizontal roads (dy=0) from being clipped to 0px height! */}
          <filter
            id="piece-shadow"
            filterUnits="userSpaceOnUse"
            x="-1000"
            y="-1000"
            width="2000"
            height="2000"
          >
            <feDropShadow dx="1.5" dy="3" stdDeviation="2.5" floodColor="#000" floodOpacity="0.65" />
          </filter>
        </defs>

        {/* 1. Outer Harbors & Wooden Piers (Drawn outward in the sea with official resource card artwork!) */}
        <g id="harbors-layer" className="pointer-events-none select-none">
          {Object.values(state.board.harbors).map((harbor) => {
            const edge = state.board.edges[harbor.edgeId];
            const v1 = state.board.vertices[harbor.vertexIds[0]];
            const v2 = state.board.vertices[harbor.vertexIds[1]];
            const coastalHex = state.board.hexes[harbor.coastalHexId];
            if (!edge || !v1 || !v2) return null;

            // Compute outward unit vector pointing away from the land hex into the sea
            let ux = 0;
            let uy = -1;
            if (coastalHex) {
              const hexCenter = hexToPixel({ q: coastalHex.q, r: coastalHex.r, s: coastalHex.s }, HEX_RADIUS);
              const dx = edge.midX - hexCenter.x;
              const dy = edge.midY - hexCenter.y;
              const len = Math.hypot(dx, dy) || 1;
              ux = dx / len;
              uy = dy / len;
            } else {
              const len = Math.hypot(edge.midX, edge.midY) || 1;
              ux = edge.midX / len;
              uy = edge.midY / len;
            }

            // Harbor medallion sits 46px outside the coastal edge in the ocean
            const shipX = edge.midX + ux * 46;
            const shipY = edge.midY + uy * 46;

            // Wooden pier endpoints extending from v1 and v2 into the sea toward the harbor medallion
            const pier1EndX = v1.x + (shipX - v1.x) * 0.62;
            const pier1EndY = v1.y + (shipY - v1.y) * 0.62;
            const pier2EndX = v2.x + (shipX - v2.x) * 0.62;
            const pier2EndY = v2.y + (shipY - v2.y) * 0.62;

            const is21 = harbor.ratio === 2 && harbor.resource;
            const portAsset = is21 ? RESOURCE_PORT_ASSETS[harbor.resource!] : null;

            return (
              <g key={harbor.id} filter="url(#piece-shadow)">
                {/* Wooden Dock / Pier 1 from coastal vertex v1 */}
                <line
                  x1={v1.x}
                  y1={v1.y}
                  x2={pier1EndX}
                  y2={pier1EndY}
                  stroke="#5c2409"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <line
                  x1={v1.x}
                  y1={v1.y}
                  x2={pier1EndX}
                  y2={pier1EndY}
                  stroke="#d97706"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="3.5 3.5"
                />

                {/* Wooden Dock / Pier 2 from coastal vertex v2 */}
                <line
                  x1={v2.x}
                  y1={v2.y}
                  x2={pier2EndX}
                  y2={pier2EndY}
                  stroke="#5c2409"
                  strokeWidth="8"
                  strokeLinecap="round"
                />
                <line
                  x1={v2.x}
                  y1={v2.y}
                  x2={pier2EndX}
                  y2={pier2EndY}
                  stroke="#d97706"
                  strokeWidth="5"
                  strokeLinecap="round"
                  strokeDasharray="3.5 3.5"
                />

                {/* Harbor Medallion with Actual Resource Card Artwork */}
                <g transform={`translate(${shipX}, ${shipY})`}>
                  {/* Outer nautical gold & wood frame */}
                  <circle
                    r="22"
                    fill="#3b1704"
                    stroke={portAsset ? portAsset.ringColor : '#f59e0b'}
                    strokeWidth="2.8"
                  />
                  <circle r="19" fill="#fef3c7" stroke="#b45309" strokeWidth="1.2" />

                  {is21 && portAsset ? (
                    <>
                      {/* Clipped actual official resource card illustration inside the port circle */}
                      <g clipPath="url(#harbor-circle-clip)">
                        <image
                          href={portAsset.img}
                          x="-22"
                          y="-26"
                          width="44"
                          height="52"
                          preserveAspectRatio="xMidYMid slice"
                        />
                        {/* Subtle dark vignette at bottom of circle for crisp ratio banner */}
                        <rect x="-22" y="4" width="44" height="18" fill="rgba(15, 23, 42, 0.78)" />
                      </g>
                      <circle
                        r="18"
                        fill="none"
                        stroke={portAsset.ringColor}
                        strokeWidth="2"
                      />
                      {/* Ribbon Pill for 2:1 Ratio */}
                      <rect
                        x="-14"
                        y="6"
                        width="28"
                        height="13"
                        rx="6"
                        fill="#0f172a"
                        stroke="#fbbf24"
                        strokeWidth="1.4"
                      />
                      <text
                        textAnchor="middle"
                        y="15.5"
                        fontSize="9.5"
                        fontWeight="900"
                        fill="#fef08a"
                        fontFamily="sans-serif"
                      >
                        2:1
                      </text>
                    </>
                  ) : (
                    <>
                      {/* 3:1 Any-Resource Merchant Sail Medallion */}
                      <circle r="17.5" fill="#fef3c7" />
                      {/* Mini fan of resource cards icon */}
                      <g transform="translate(0, -5)">
                        <rect
                          x="-9"
                          y="-7"
                          width="7"
                          height="10"
                          rx="1.5"
                          transform="rotate(-18)"
                          fill="#22c55e"
                          stroke="#14532d"
                          strokeWidth="0.8"
                        />
                        <rect
                          x="-3.5"
                          y="-8"
                          width="7"
                          height="10"
                          rx="1.5"
                          fill="#eab308"
                          stroke="#713f12"
                          strokeWidth="0.8"
                        />
                        <rect
                          x="2"
                          y="-7"
                          width="7"
                          height="10"
                          rx="1.5"
                          transform="rotate(18)"
                          fill="#ef4444"
                          stroke="#7f1d1d"
                          strokeWidth="0.8"
                        />
                        <text
                          textAnchor="middle"
                          y="0"
                          fontSize="8"
                          fontWeight="900"
                          fill="#0f172a"
                          fontFamily="sans-serif"
                        >
                          ?
                        </text>
                      </g>
                      <rect
                        x="-14"
                        y="6"
                        width="28"
                        height="13"
                        rx="6"
                        fill="#78350f"
                        stroke="#fbbf24"
                        strokeWidth="1.4"
                      />
                      <text
                        textAnchor="middle"
                        y="15.5"
                        fontSize="9.5"
                        fontWeight="900"
                        fill="#ffffff"
                        fontFamily="sans-serif"
                      >
                        3:1
                      </text>
                    </>
                  )}
                </g>
              </g>
            );
          })}
        </g>

        {/* 2. Hexes Layer */}
        <g id="hexes-layer">
          {Object.values(state.board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            const corners = getHexCornerPoints(center.x, center.y, HEX_RADIUS);
            const pointsStr = corners.map((p) => `${p.x},${p.y}`).join(' ');

            const isRobberTarget =
              ((state.phase === 'ROBBER_PLACEMENT' &&
                isRobberController &&
                (!state.turnDeadlineMs || Date.now() < state.turnDeadlineMs)) ||
                (isMyTurn && activeBuildMode === 'chase_robber' && selectedKnightVertexId) ||
                (isMyTurn && activeBuildMode === 'taxation' && activeProgressCardId)) &&
              isValidRobberHex(state as any, tile.id, myPlayerId || undefined);

            const isMerchantTarget =
              isMyTurn && activeBuildMode === 'merchant' && isHexLegalForMerchant(tile.id);

            const isInventionTarget =
              isMyTurn && activeBuildMode === 'invention' && isHexLegalForInvention(tile.id);
            const isInventionSelected = inventionFirstHexId === tile.id;

            const isClickableHex = isRobberTarget || isMerchantTarget || isInventionTarget;

            return (
              <g
                key={tile.id}
                onClick={() => handleHexClick(tile.id)}
                className={`transition-all duration-200 ${isClickableHex ? 'cursor-pointer hover:opacity-95' : ''}`}
              >
                <polygon
                  points={pointsStr}
                  fill={`url(#pat-${tile.terrain})`}
                  stroke="#f59e0b"
                  strokeWidth="2"
                  strokeOpacity="0.6"
                />

                <polygon
                  points={getHexCornerPoints(center.x, center.y, HEX_RADIUS - 2.5)
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke="#78350f"
                  strokeWidth="1.2"
                  strokeOpacity="0.45"
                />

                {isRobberTarget && (
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={HEX_RADIUS * 0.6}
                    fill="rgba(239, 68, 68, 0.28)"
                    stroke="#ef4444"
                    strokeWidth="3"
                    strokeDasharray="6 4"
                    className="animate-pulse"
                  />
                )}

                {isMerchantTarget && (
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={HEX_RADIUS * 0.6}
                    fill="rgba(234, 179, 8, 0.30)"
                    stroke="#facc15"
                    strokeWidth="3.5"
                    strokeDasharray="6 4"
                    className="animate-pulse"
                  />
                )}

                {isInventionTarget && (
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={HEX_RADIUS * 0.56}
                    fill={isInventionSelected ? 'rgba(34, 197, 94, 0.4)' : 'rgba(56, 189, 248, 0.26)'}
                    stroke={isInventionSelected ? '#22c55e' : '#38bdf8'}
                    strokeWidth="3.5"
                    strokeDasharray={isInventionSelected ? undefined : '6 4'}
                    className="animate-pulse"
                  />
                )}
              </g>
            );
          })}
        </g>

        {/* 3. Number Tokens, Robber Figurine & Merchant Cone */}
        <g id="tokens-layer" className="pointer-events-none select-none">
          {Object.values(state.board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            if (tile.terrain === 'desert' || !tile.number) return null;

            const isRedNumber = tile.number === 6 || tile.number === 8;
            const isCombined212Token =
              Boolean(state.settings?.houseRules?.combined2And12) &&
              (tile.number === 2 || tile.number === 12);
            const pipsCount = isCombined212Token ? 2 : NUMBER_PIPS[tile.number] || 1;

            return (
              <g key={`num-${tile.id}`} transform={`translate(${center.x}, ${center.y})`}>
                <circle r="19" fill="#fef3c7" stroke="#b45309" strokeWidth="2" filter="url(#piece-shadow)" />
                <circle r="16" fill="none" stroke="#d97706" strokeWidth="0.8" strokeDasharray="2 2" />

                <text
                  textAnchor="middle"
                  dy="2"
                  fontSize={isCombined212Token ? '11.5' : '15'}
                  fontWeight="900"
                  fill={isRedNumber ? '#dc2626' : isCombined212Token ? '#7e22ce' : '#1e293b'}
                  fontFamily="sans-serif"
                >
                  {isCombined212Token ? '2/12' : tile.number}
                </text>

                <g transform="translate(0, 9)">
                  {Array.from({ length: pipsCount }).map((_, i) => {
                    const offset = (i - (pipsCount - 1) / 2) * 4.5;
                    return (
                      <circle
                        key={i}
                        cx={offset}
                        cy="0"
                        r="1.4"
                        fill={isRedNumber ? '#dc2626' : '#334155'}
                      />
                    );
                  })}
                </g>
              </g>
            );
          })}

          {/* Custom Robber Figurine (in C&K, only rendered once robberActive is true after 1st Barbarian Attack) */}
          {state.board.robberHexId &&
            (!isCK || state.robberActive) &&
            (() => {
              const rHex = state.board.hexes[state.board.robberHexId];
              if (!rHex) return null;
              const rCenter = hexToPixel({ q: rHex.q, r: rHex.r, s: rHex.s }, HEX_RADIUS);
              const offsetX = rHex.number ? 16 : 0;
              const offsetY = rHex.number ? -6 : 0;
              return (
                <g
                  transform={`translate(${rCenter.x + offsetX}, ${rCenter.y + offsetY})`}
                  filter="url(#piece-shadow)"
                >
                  <image
                    href="/assets/pieces/robber.png"
                    x="-22"
                    y="-26"
                    width="44"
                    height="48"
                    preserveAspectRatio="xMidYMid meet"
                  />
                </g>
              );
            })()}

          {/* Cities & Knights Merchant Cone Figurine */}
          {isCK &&
            state.merchant?.hexId &&
            (() => {
              const mHex = state.board.hexes[state.merchant.hexId];
              if (!mHex) return null;
              const mCenter = hexToPixel({ q: mHex.q, r: mHex.r, s: mHex.s }, HEX_RADIUS);
              const owner = state.merchant.ownerId ? state.players[state.merchant.ownerId] : null;
              const ownerColor = owner ? PLAYER_COLORS[owner.color].primary : '#a855f7';
              return (
                <g
                  transform={`translate(${mCenter.x - 20}, ${mCenter.y + 8})`}
                  filter="url(#piece-shadow)"
                >
                  {/* Gold-trimmed purple Merchant Cone */}
                  <ellipse cx="0" cy="11" rx="11" ry="4.5" fill="#581c87" stroke="#facc15" strokeWidth="1.8" />
                  <polygon
                    points="0,-13 10,10 -10,10"
                    fill="#7e22ce"
                    stroke="#facc15"
                    strokeWidth="1.8"
                  />
                  <circle cx="0" cy="-14" r="4.5" fill={ownerColor} stroke="#ffffff" strokeWidth="1.5" />
                  <rect
                    x="-14"
                    y="12"
                    width="28"
                    height="10"
                    rx="4"
                    fill="#0f172a"
                    stroke="#facc15"
                    strokeWidth="1"
                  />
                  <text
                    textAnchor="middle"
                    y="19.5"
                    fontSize="7"
                    fontWeight="900"
                    fill="#fef08a"
                    fontFamily="sans-serif"
                  >
                    2:1 • 1VP
                  </text>
                </g>
              );
            })()}
        </g>

        {/* 4. Roads Layer */}
        <g id="roads-layer">
          {Object.values(state.board.edges).map((edge) => {
            const road = state.board.roads[edge.id];
            const v1 = state.board.vertices[edge.v1];
            const v2 = state.board.vertices[edge.v2];
            if (!v1 || !v2) return null;

            const isDiplomacyTarget =
              isMyTurn && activeBuildMode === 'diplomacy' && Boolean(road) && isOpenRoadEdge(state.board, edge.id);

            if (road) {
              const player = state.players[road.playerId];
              const colorInfo = player ? PLAYER_COLORS[player.color] : PLAYER_COLORS.red;

              // Shorten road slightly from exact vertex center so it tucks cleanly into settlements
              const dx = v2.x - v1.x;
              const dy = v2.y - v1.y;
              const x1 = v1.x + dx * 0.12;
              const y1 = v1.y + dy * 0.12;
              const x2 = v2.x - dx * 0.12;
              const y2 = v2.y - dy * 0.12;

              return (
                <g
                  key={edge.id}
                  filter="url(#piece-shadow)"
                  className="cursor-pointer"
                  onClick={() => isDiplomacyTarget && handleEdgeClick(edge.id)}
                  onMouseEnter={() =>
                    player &&
                    setHoveredPiece({
                      x: edge.midX,
                      y: edge.midY - 14,
                      playerName: player.name,
                      playerColor: player.color,
                      pieceLabel: isDiplomacyTarget ? 'Open Road (Click for Diplomat)' : 'Road',
                    })
                  }
                  onMouseLeave={() => setHoveredPiece(null)}
                >
                  {/* Transparent hit target for smooth hover tooltip */}
                  <line
                    x1={v1.x}
                    y1={v1.y}
                    x2={v2.x}
                    y2={v2.y}
                    stroke="transparent"
                    strokeWidth="18"
                    strokeLinecap="round"
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={isDiplomacyTarget ? '#fbbf24' : colorInfo.border}
                    strokeWidth={isDiplomacyTarget ? '13' : '11'}
                    strokeLinecap="round"
                  />
                  <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke={colorInfo.primary}
                    strokeWidth="8"
                    strokeLinecap="round"
                  />
                </g>
              );
            }

            if (isPlacingRoad) {
              const isLegal = isEdgeLegalForRoad(edge.id);
              const isHovered = hoveredEdge === edge.id;

              return (
                <g
                  key={edge.id}
                  onClick={() => handleEdgeClick(edge.id)}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  className="cursor-pointer"
                >
                  {/* Wide transparent hit area so clicking anywhere along the edge always registers */}
                  <line
                    x1={v1.x}
                    y1={v1.y}
                    x2={v2.x}
                    y2={v2.y}
                    stroke="transparent"
                    strokeWidth="24"
                    strokeLinecap="round"
                  />
                  {isLegal ? (
                    <line
                      x1={v1.x}
                      y1={v1.y}
                      x2={v2.x}
                      y2={v2.y}
                      stroke={isHovered ? '#fbbf24' : '#38bdf8'}
                      strokeWidth={isHovered ? '10' : '7'}
                      strokeLinecap="round"
                      strokeDasharray={isHovered ? undefined : '7 4'}
                      className="transition-all animate-pulse"
                    />
                  ) : (
                    isHovered && (
                      <line
                        x1={v1.x}
                        y1={v1.y}
                        x2={v2.x}
                        y2={v2.y}
                        stroke="#f43f5e"
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray="4 4"
                        opacity={0.75}
                      />
                    )
                  )}
                </g>
              );
            }

            return null;
          })}
        </g>

        {/* 5. Vertices Layer (Settlements, Cities, City Walls, Metropolises, Knights & Build Spots) */}
        <g id="vertices-layer">
          {Object.values(state.board.vertices).map((vertex) => {
            const building = state.board.buildings[vertex.id];
            const knight = state.board.knights?.[vertex.id];

            const isCityUpgradable =
              isMyTurn &&
              activeBuildMode === 'city' &&
              building &&
              building.type === 'settlement' &&
              building.playerId === myPlayerId;

            const isCityWallUpgradable =
              isMyTurn &&
              activeBuildMode === 'city_wall' &&
              building &&
              building.type === 'city' &&
              !building.hasWall &&
              building.playerId === myPlayerId;

            const isVulnerablePillageTarget =
              isMyPillageTurn && vulnerableCityVertices.has(vertex.id);

            if (building) {
              const player = state.players[building.playerId];
              const colorInfo = player ? PLAYER_COLORS[player.color] : PLAYER_COLORS.red;
              const isJustPlacedInSetup = state.lastSetupVertexId === vertex.id;
              const metroInfo = building.metropolis ? METROPOLIS_STYLES[building.metropolis] : null;

              const pieceLabel =
                building.type === 'city'
                  ? metroInfo
                    ? `${metroInfo.label}${building.hasWall ? ' + Wall' : ''}`
                    : `City (2 VP)${building.hasWall ? ' + City Wall (+2 Cap)' : ''}`
                  : 'Settlement (1 VP)';

              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  filter="url(#piece-shadow)"
                  onClick={() =>
                    (isCityUpgradable || isCityWallUpgradable || isVulnerablePillageTarget) &&
                    handleVertexClick(vertex.id)
                  }
                  onMouseEnter={() =>
                    player &&
                    setHoveredPiece({
                      x: vertex.x,
                      y: vertex.y - 24,
                      playerName: player.name,
                      playerColor: player.color,
                      pieceLabel,
                    })
                  }
                  onMouseLeave={() => setHoveredPiece(null)}
                  className="cursor-pointer"
                >
                  {isJustPlacedInSetup && (
                    <circle
                      r="18"
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="2.5"
                      strokeDasharray="4 3"
                      className="animate-spin"
                    />
                  )}

                  {/* City Wall Fortification Base underneath City */}
                  {building.type === 'city' && building.hasWall && (
                    <g>
                      <rect
                        x="-18"
                        y="-18"
                        width="36"
                        height="36"
                        rx="5"
                        fill={colorInfo.secondary}
                        stroke="#fde047"
                        strokeWidth="2.5"
                      />
                      <rect
                        x="-15"
                        y="-15"
                        width="30"
                        height="30"
                        rx="3"
                        fill="#0f172a"
                        stroke={colorInfo.border}
                        strokeWidth="1.2"
                      />
                    </g>
                  )}

                  {building.type === 'settlement' ? (
                    <g transform="translate(-11, -12)">
                      <polygon
                        points="11,0 22,9 22,21 0,21 0,9"
                        fill={colorInfo.primary}
                        stroke={colorInfo.border}
                        strokeWidth="2"
                      />
                      <rect x="8" y="11" width="6" height="10" fill={colorInfo.door} />
                    </g>
                  ) : (
                    <g transform="translate(-14, -15)">
                      <polygon
                        points="14,0 20,6 20,8 28,8 28,26 0,26 0,8 8,8 8,6"
                        fill={colorInfo.primary}
                        stroke={colorInfo.border}
                        strokeWidth="2"
                      />
                      <rect x="10" y="14" width="8" height="12" fill={colorInfo.door} />
                    </g>
                  )}

                  {/* Golden Metropolis Arch & Discipline Badge above City */}
                  {building.type === 'city' && metroInfo && (
                    <g transform="translate(0, -21)">
                      <path
                        d="M-13,8 L-13,0 L-6,-7 L0,-11 L6,-7 L13,0 L13,8 Z"
                        fill={metroInfo.fill}
                        stroke={metroInfo.stroke}
                        strokeWidth="2"
                      />
                      <circle cx="0" cy="-2" r="4" fill="#0f172a" stroke="#ffffff" strokeWidth="1" />
                      <text
                        textAnchor="middle"
                        y="1"
                        fontSize="6.5"
                        fontWeight="900"
                        fill={metroInfo.fill}
                        fontFamily="sans-serif"
                      >
                        4VP
                      </text>
                    </g>
                  )}

                  {(isCityUpgradable || isCityWallUpgradable) && (
                    <circle r="19" fill="none" stroke="#22c55e" strokeWidth="3.5" className="animate-pulse" />
                  )}

                  {isVulnerablePillageTarget && (
                    <circle r="21" fill="rgba(239, 68, 68, 0.25)" stroke="#ef4444" strokeWidth="4" className="animate-pulse" />
                  )}
                </g>
              );
            }

            // Render Knight Piece on Vertex
            if (knight) {
              const player = state.players[knight.playerId];
              const colorInfo = player ? PLAYER_COLORS[player.color] : PLAYER_COLORS.red;
              const isSelectedKnight = selectedKnightVertexId === vertex.id;
              const isDisplaceableTarget = reachableKnightMove.displaceableKnightVertices.has(vertex.id);
              const isIntrigueTarget =
                isMyTurn && activeBuildMode === 'intrigue' && isVertexLegalForIntrigue(vertex.id);
              const isDeserterVictimChoice =
                isMyDeserterVictimTurn && knight.playerId === myPlayerId;

              const levelLabel =
                knight.level === 1
                  ? 'Basic Knight (Str 1)'
                  : knight.level === 2
                    ? 'Strong Knight (Str 2)'
                    : 'Mighty Knight (Str 3)';
              const statusLabel = knight.active ? 'Active ⚡' : 'Inactive 💤';

              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  filter="url(#piece-shadow)"
                  onClick={() => handleVertexClick(vertex.id)}
                  onMouseEnter={() =>
                    player &&
                    setHoveredPiece({
                      x: vertex.x,
                      y: vertex.y - 24,
                      playerName: player.name,
                      playerColor: player.color,
                      pieceLabel: `${levelLabel} • ${statusLabel}`,
                    })
                  }
                  onMouseLeave={() => setHoveredPiece(null)}
                  className="cursor-pointer"
                >
                  {/* Active Knight Glowing Aura */}
                  {knight.active && (
                    <circle
                      r="17.5"
                      fill="rgba(56, 189, 248, 0.22)"
                      stroke="#fde047"
                      strokeWidth="2.5"
                      strokeDasharray="4 2"
                    />
                  )}

                  {/* Selected Knight Ring */}
                  {isSelectedKnight && (
                    <circle
                      r="20"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="3"
                      className="animate-pulse"
                    />
                  )}

                  {/* Displace / Intrigue / Deserter Target Ring */}
                  {(isDisplaceableTarget || isIntrigueTarget || isDeserterVictimChoice) && (
                    <circle
                      r="21"
                      fill="rgba(244, 63, 94, 0.28)"
                      stroke="#f43f5e"
                      strokeWidth="3.5"
                      className="animate-pulse"
                    />
                  )}

                  {/* Knight Token Body */}
                  <circle
                    r="13.5"
                    fill={colorInfo.primary}
                    stroke={knight.active ? '#fde047' : '#64748b'}
                    strokeWidth={knight.active ? '3' : '2.2'}
                    opacity={knight.active ? 1 : 0.78}
                  />
                  <circle
                    r="10"
                    fill="#0f172a"
                    stroke={colorInfo.border}
                    strokeWidth="1"
                    opacity={knight.active ? 0.92 : 0.75}
                  />

                  {/* Helmet / Sword Icon + Strength Stars */}
                  <text
                    textAnchor="middle"
                    y="-1"
                    fontSize="10"
                    fontWeight="900"
                    fill={knight.active ? '#fde047' : '#94a3b8'}
                    fontFamily="sans-serif"
                  >
                    {knight.active ? '⚔️' : '🛡️'}
                  </text>
                  <text
                    textAnchor="middle"
                    y="8.5"
                    fontSize="7.5"
                    fontWeight="900"
                    fill={knight.active ? '#ffffff' : '#cbd5e1'}
                    fontFamily="sans-serif"
                  >
                    {'★'.repeat(knight.level)}
                  </text>
                </g>
              );
            }

            // Empty Vertex Interactive Targets:
            // 1. Displaced Knight destination
            if (isMyDisplacedKnightTurn && state.pendingDisplacedKnight?.validVertexIds.includes(vertex.id)) {
              const isHovered = hoveredVertex === vertex.id;
              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  onClick={() => handleVertexClick(vertex.id)}
                  onMouseEnter={() => setHoveredVertex(vertex.id)}
                  onMouseLeave={() => setHoveredVertex(null)}
                  className="cursor-pointer"
                >
                  <circle r="16" fill="transparent" />
                  <circle
                    r={isHovered ? 13 : 9}
                    fill="#f59e0b"
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    className="animate-pulse"
                  />
                </g>
              );
            }

            // 2. Deserter placement or Recruit Knight or Move Knight destination
            const isKnightRecruitSpot =
              myPlayerId &&
              ((isMyTurn && activeBuildMode === 'knight') || isMyDeserterPlaceTurn) &&
              isValidKnightRecruitVertex(state.board, myPlayerId, vertex.id);

            const isKnightMoveSpot = reachableKnightMove.emptyVertices.has(vertex.id);

            if (isKnightRecruitSpot || isKnightMoveSpot) {
              const isHovered = hoveredVertex === vertex.id;
              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  onClick={() => handleVertexClick(vertex.id)}
                  onMouseEnter={() => setHoveredVertex(vertex.id)}
                  onMouseLeave={() => setHoveredVertex(null)}
                  className="cursor-pointer"
                >
                  <circle r="16" fill="transparent" />
                  <circle
                    r={isHovered ? 13 : 9}
                    fill={isHovered ? '#fbbf24' : '#a855f7'}
                    stroke="#ffffff"
                    strokeWidth="2.5"
                    className="transition-all animate-pulse"
                  />
                </g>
              );
            }

            // 3. Settlement / Setup City placement
            if (isPlacingSettlement) {
              const isLegal = isVertexLegalForSettlement(vertex.id);
              const isHovered = hoveredVertex === vertex.id;

              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  onClick={() => handleVertexClick(vertex.id)}
                  onMouseEnter={() => setHoveredVertex(vertex.id)}
                  onMouseLeave={() => setHoveredVertex(null)}
                  className="cursor-pointer"
                >
                  {/* Large hit area */}
                  <circle r="16" fill="transparent" />
                  {isLegal ? (
                    <circle
                      r={isHovered ? 12 : 8}
                      fill={isHovered ? '#fbbf24' : '#38bdf8'}
                      stroke="#ffffff"
                      strokeWidth="2.5"
                      className="transition-all animate-pulse"
                    />
                  ) : (
                    isHovered && (
                      <circle r="8" fill="rgba(244, 63, 94, 0.5)" stroke="#f43f5e" strokeWidth="2" />
                    )
                  )}
                </g>
              );
            }

            return null;
          })}
        </g>

        {/* 6. Floating SVG Tooltip when hovering any Road, Settlement, City, or Knight */}
        {hoveredPiece && (
          <g
            transform={`translate(${hoveredPiece.x}, ${hoveredPiece.y})`}
            className="pointer-events-none select-none"
            filter="url(#piece-shadow)"
          >
            <rect
              x="-95"
              y="-28"
              width="190"
              height="24"
              rx="8"
              fill="#0f172a"
              stroke={PLAYER_COLORS[hoveredPiece.playerColor].primary}
              strokeWidth="2"
            />
            <circle
              cx="-81"
              cy="-16"
              r="5"
              fill={PLAYER_COLORS[hoveredPiece.playerColor].primary}
              stroke="#ffffff"
              strokeWidth="1"
            />
            <text
              x="4"
              y="-12.5"
              textAnchor="middle"
              fontSize="9"
              fontWeight="800"
              fill="#f8fafc"
              fontFamily="sans-serif"
            >
              {hoveredPiece.playerName}&apos;s {hoveredPiece.pieceLabel}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
});
