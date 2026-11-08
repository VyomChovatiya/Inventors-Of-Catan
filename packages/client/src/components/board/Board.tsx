import React, { useState, useMemo } from 'react';
import {
  HEX_RADIUS,
  getHexCornerPoints,
  hexToPixel,
  RedactedGameState,
  PlayerColor,
  ResourceType,
  satisfiesDistanceRule,
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

interface PieceTooltip {
  x: number;
  y: number;
  playerName: string;
  playerColor: PlayerColor;
  pieceLabel: string;
}

export const Board: React.FC<BoardProps> = React.memo(({ state, myPlayerId }) => {
  const { sendAction, activeBuildMode, setBuildMode } = useGameStore();
  const [hoveredVertex, setHoveredVertex] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [hoveredPiece, setHoveredPiece] = useState<PieceTooltip | null>(null);

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

    const v1TouchesOwnBuilding = v1Building && v1Building.playerId === myPlayerId;
    const v2TouchesOwnBuilding = v2Building && v2Building.playerId === myPlayerId;

    const v1FriendlyRoad =
      (!v1Building || v1Building.playerId === myPlayerId) &&
      Object.values(state.board.roads).some(
        (r) =>
          r.playerId === myPlayerId &&
          (state.board.edges[r.edgeId].v1 === edge.v1 || state.board.edges[r.edgeId].v2 === edge.v1),
      );

    const v2FriendlyRoad =
      (!v2Building || v2Building.playerId === myPlayerId) &&
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

  const handleVertexClick = (vId: string) => {
    if (!myPlayerId) return;

    if (isSetupPlacingSettlement) {
      sendAction({ type: 'BUILD_SETUP_SETTLEMENT', playerId: myPlayerId, vertexId: vId });
      return;
    }

    if (isMyTurn) {
      if (activeBuildMode === 'settlement') {
        sendAction({ type: 'BUILD_SETTLEMENT', playerId: myPlayerId, vertexId: vId });
        setBuildMode('none');
      } else if (activeBuildMode === 'city') {
        sendAction({ type: 'UPGRADE_CITY', playerId: myPlayerId, vertexId: vId });
        setBuildMode('none');
      }
    }
  };

  const handleEdgeClick = (edgeId: string) => {
    if (!myPlayerId) return;

    if (isSetupPlacingRoad) {
      sendAction({ type: 'BUILD_SETUP_ROAD', playerId: myPlayerId, edgeId });
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

  const handleHexClick = (hexId: string) => {
    if (!myPlayerId) return;
    if (state.turnDeadlineMs && Date.now() >= state.turnDeadlineMs) return;
    const canMoveRobber = state.phase === 'ROBBER_PLACEMENT' && isRobberController;
    if (canMoveRobber) {
      sendAction({ type: 'MOVE_ROBBER', playerId: myPlayerId, hexId });
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
              state.phase === 'ROBBER_PLACEMENT' &&
              isRobberController &&
              (!state.turnDeadlineMs || Date.now() < state.turnDeadlineMs) &&
              tile.id !== state.board.robberHexId;

            return (
              <g
                key={tile.id}
                onClick={() => handleHexClick(tile.id)}
                className={`transition-all duration-200 ${isRobberTarget ? 'cursor-pointer hover:opacity-95' : ''}`}
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
              </g>
            );
          })}
        </g>

        {/* 3. Number Tokens & Robber Figurine */}
        <g id="tokens-layer" className="pointer-events-none select-none">
          {Object.values(state.board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            if (tile.terrain === 'desert' || !tile.number) return null;

            const isRedNumber = tile.number === 6 || tile.number === 8;
            const pipsCount = NUMBER_PIPS[tile.number] || 1;

            return (
              <g key={`num-${tile.id}`} transform={`translate(${center.x}, ${center.y})`}>
                <circle r="19" fill="#fef3c7" stroke="#b45309" strokeWidth="2" filter="url(#piece-shadow)" />
                <circle r="16" fill="none" stroke="#d97706" strokeWidth="0.8" strokeDasharray="2 2" />

                <text
                  textAnchor="middle"
                  dy="2"
                  fontSize="15"
                  fontWeight="900"
                  fill={isRedNumber ? '#dc2626' : '#1e293b'}
                  fontFamily="sans-serif"
                >
                  {tile.number}
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

          {/* Custom Robber Figurine */}
          {state.board.robberHexId &&
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
        </g>

        {/* 4. Roads Layer */}
        <g id="roads-layer">
          {Object.values(state.board.edges).map((edge) => {
            const road = state.board.roads[edge.id];
            const v1 = state.board.vertices[edge.v1];
            const v2 = state.board.vertices[edge.v2];
            if (!v1 || !v2) return null;

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
                  onMouseEnter={() =>
                    player &&
                    setHoveredPiece({
                      x: edge.midX,
                      y: edge.midY - 14,
                      playerName: player.name,
                      playerColor: player.color,
                      pieceLabel: 'Road',
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
                    stroke={colorInfo.border}
                    strokeWidth="11"
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

        {/* 5. Vertices Layer (Settlements, Cities, Build Spots) */}
        <g id="vertices-layer">
          {Object.values(state.board.vertices).map((vertex) => {
            const building = state.board.buildings[vertex.id];
            const isCityUpgradable =
              isMyTurn &&
              activeBuildMode === 'city' &&
              building &&
              building.type === 'settlement' &&
              building.playerId === myPlayerId;

            if (building) {
              const player = state.players[building.playerId];
              const colorInfo = player ? PLAYER_COLORS[player.color] : PLAYER_COLORS.red;
              const isJustPlacedInSetup = state.lastSetupVertexId === vertex.id;

              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  filter="url(#piece-shadow)"
                  onClick={() => isCityUpgradable && handleVertexClick(vertex.id)}
                  onMouseEnter={() =>
                    player &&
                    setHoveredPiece({
                      x: vertex.x,
                      y: vertex.y - 20,
                      playerName: player.name,
                      playerColor: player.color,
                      pieceLabel: building.type === 'city' ? 'City (2 VP)' : 'Settlement (1 VP)',
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
                  {isCityUpgradable && (
                    <circle r="17" fill="none" stroke="#22c55e" strokeWidth="3.5" className="animate-pulse" />
                  )}
                </g>
              );
            }

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

        {/* 6. Floating SVG Tooltip when hovering any Road, Settlement, or City */}
        {hoveredPiece && (
          <g
            transform={`translate(${hoveredPiece.x}, ${hoveredPiece.y})`}
            className="pointer-events-none select-none"
            filter="url(#piece-shadow)"
          >
            <rect
              x="-75"
              y="-28"
              width="150"
              height="24"
              rx="8"
              fill="#0f172a"
              stroke={PLAYER_COLORS[hoveredPiece.playerColor].primary}
              strokeWidth="2"
            />
            <circle
              cx="-61"
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
              fontSize="9.5"
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
