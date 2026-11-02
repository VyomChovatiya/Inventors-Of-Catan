import React, { useState, useMemo } from 'react';
import {
  HEX_RADIUS,
  getHexCornerPoints,
  hexToPixel,
  RedactedGameState,
  PlayerColor,
  ResourceType,
} from '@catan/shared';
import { useGameStore } from '../../store/gameStore.js';

interface BoardProps {
  state: RedactedGameState;
  myPlayerId: string | null;
}

const PLAYER_COLORS: Record<PlayerColor, { primary: string; secondary: string; shadow: string }> = {
  red: { primary: '#dc2626', secondary: '#991b1b', shadow: '#450a0a' },
  blue: { primary: '#2563eb', secondary: '#1e40af', shadow: '#172554' },
  orange: { primary: '#f97316', secondary: '#c2410c', shadow: '#431407' },
  white: { primary: '#f8fafc', secondary: '#94a3b8', shadow: '#334155' },
  green: { primary: '#16a34a', secondary: '#15803d', shadow: '#052e16' },
  purple: { primary: '#9333ea', secondary: '#6b21a8', shadow: '#3b0764' },
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

export const Board: React.FC<BoardProps> = ({ state, myPlayerId }) => {
  const { sendAction, activeBuildMode, setBuildMode } = useGameStore();
  const [zoom, setZoom] = useState(1);
  const [hoveredVertex, setHoveredVertex] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [hoveredHex, setHoveredHex] = useState<string | null>(null);

  const isMyTurn =
    (state.phase === 'ACTION_PHASE' && state.currentTurnPlayerId === myPlayerId) ||
    (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === myPlayerId);

  const isMySetupTurn =
    (state.phase === 'SETUP_ROUND_1' || state.phase === 'SETUP_ROUND_2') &&
    state.setupTurnOrder[state.setupTurnIndex] === myPlayerId;

  // Compute bounding box of board
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
    return { minX: minX - 100, maxX: maxX + 100, minY: minY - 100, maxY: maxY + 100 };
  }, [state.board.vertices]);

  const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;

  // Check if player has placed their setup settlement and now needs to place a road
  const isSetupPlacingRoad = useMemo(() => {
    if (!isMySetupTurn || !myPlayerId) return false;
    const player = state.players[myPlayerId];
    if (!player) return false;
    // In setup round 1: 5 settlements -> 4 left, 15 roads -> 15 left (needs road!)
    // In setup round 2: 4 settlements -> 3 left, 14 roads -> 14 left (needs road!)
    if (state.phase === 'SETUP_ROUND_1') {
      return player.settlementsLeft === 4 && player.roadsLeft === 15;
    }
    if (state.phase === 'SETUP_ROUND_2') {
      return player.settlementsLeft === 3 && player.roadsLeft === 14;
    }
    return false;
  }, [isMySetupTurn, myPlayerId, state.phase, state.players]);

  const isSetupPlacingSettlement = useMemo(() => {
    if (!isMySetupTurn || !myPlayerId) return false;
    return !isSetupPlacingRoad;
  }, [isMySetupTurn, isSetupPlacingRoad, myPlayerId]);

  // Click vertex handler
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

  // Click edge handler
  const handleEdgeClick = (edgeId: string) => {
    if (!myPlayerId) return;

    if (isSetupPlacingRoad) {
      sendAction({ type: 'BUILD_SETUP_ROAD', playerId: myPlayerId, edgeId });
      return;
    }

    if (isMyTurn && activeBuildMode === 'road') {
      sendAction({ type: 'BUILD_ROAD', playerId: myPlayerId, edgeId });
      setBuildMode('none');
    }
  };

  // Click hex handler (for Robber)
  const handleHexClick = (hexId: string) => {
    if (!myPlayerId) return;
    if (state.phase === 'ROBBER_PLACEMENT' && state.currentTurnPlayerId === myPlayerId) {
      sendAction({ type: 'MOVE_ROBBER', playerId: myPlayerId, hexId });
    }
  };

  return (
    <div className="relative w-full h-full flex items-center justify-center overflow-hidden bg-radial from-slate-900 to-slate-950">
      {/* Zoom Controls */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-2 bg-slate-800/80 backdrop-blur-md p-1.5 rounded-xl border border-slate-700 shadow-xl">
        <button
          onClick={() => setZoom((z) => Math.min(1.6, z + 0.15))}
          className="w-8 h-8 flex items-center justify-center font-bold text-lg text-slate-200 hover:text-white hover:bg-slate-700 rounded-lg transition"
        >
          +
        </button>
        <button
          onClick={() => setZoom((z) => Math.max(0.6, z - 0.15))}
          className="w-8 h-8 flex items-center justify-center font-bold text-lg text-slate-200 hover:text-white hover:bg-slate-700 rounded-lg transition"
        >
          −
        </button>
        <button
          onClick={() => setZoom(1)}
          className="w-8 h-8 flex items-center justify-center text-xs font-semibold text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition"
        >
          1x
        </button>
      </div>

      {/* SVG Game Board */}
      <svg
        viewBox={viewBox}
        className="w-full h-full transition-transform duration-300 ease-out drop-shadow-2xl"
        style={{ transform: `scale(${zoom})` }}
      >
        <defs>
          {/* Hex Terrain Texture Patterns */}
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

          {/* Filters for 3D glow & shadow */}
          <filter id="piece-shadow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="2" dy="4" stdDeviation="3" floodColor="#000" floodOpacity="0.6" />
          </filter>
          <filter id="pulse-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* 1. Hexes */}
        <g id="hexes-layer">
          {Object.values(state.board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            const corners = getHexCornerPoints(center.x, center.y, HEX_RADIUS);
            const pointsStr = corners.map((p) => `${p.x},${p.y}`).join(' ');

            const isRobberTarget =
              state.phase === 'ROBBER_PLACEMENT' &&
              state.currentTurnPlayerId === myPlayerId &&
              tile.id !== state.board.robberHexId;

            return (
              <g
                key={tile.id}
                onClick={() => handleHexClick(tile.id)}
                className={`transition-all duration-200 ${isRobberTarget ? 'cursor-pointer hover:opacity-90' : ''}`}
                onMouseEnter={() => setHoveredHex(tile.id)}
                onMouseLeave={() => setHoveredHex(null)}
              >
                {/* Hex Tile Body */}
                <polygon
                  points={pointsStr}
                  fill={`url(#pat-${tile.terrain})`}
                  stroke="#1e293b"
                  strokeWidth="2.5"
                  className="transition duration-150"
                />

                {/* Golden Inset Border for tactile board game feel */}
                <polygon
                  points={getHexCornerPoints(center.x, center.y, HEX_RADIUS - 3)
                    .map((p) => `${p.x},${p.y}`)
                    .join(' ')}
                  fill="none"
                  stroke="#ca8a04"
                  strokeWidth="1"
                  strokeOpacity="0.4"
                />

                {/* Robber Target Highlight */}
                {isRobberTarget && (
                  <circle
                    cx={center.x}
                    cy={center.y}
                    r={HEX_RADIUS * 0.65}
                    fill="rgba(239, 68, 68, 0.25)"
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

        {/* 2. Harbors Layer */}
        <g id="harbors-layer">
          {Object.values(state.board.harbors).map((harbor) => {
            const edge = state.board.edges[harbor.edgeId];
            if (!edge) return null;
            const is21 = harbor.ratio === 2;
            const label = is21 ? `2:1 ${harbor.resource?.toUpperCase()}` : '3:1';

            return (
              <g key={harbor.id} transform={`translate(${edge.midX}, ${edge.midY})`}>
                <circle r="14" fill="#1e293b" stroke="#ca8a04" strokeWidth="2" filter="url(#piece-shadow)" />
                <text
                  textAnchor="middle"
                  dy="4"
                  fontSize="9"
                  fontWeight="bold"
                  fill="#fef08a"
                  className="pointer-events-none select-none font-mono"
                >
                  {is21 ? '2:1' : '3:1'}
                </text>
              </g>
            );
          })}
        </g>

        {/* 3. Number Tokens & Robber */}
        <g id="tokens-layer">
          {Object.values(state.board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            if (tile.terrain === 'desert' || !tile.number) return null;

            const isRedNumber = tile.number === 6 || tile.number === 8;
            const pipsCount = NUMBER_PIPS[tile.number] || 1;

            return (
              <g key={`num-${tile.id}`} transform={`translate(${center.x}, ${center.y})`} className="pointer-events-none select-none">
                {/* Wooden number disc */}
                <circle r="19" fill="#fef3c7" stroke="#b45309" strokeWidth="2" filter="url(#piece-shadow)" />
                <circle r="16" fill="none" stroke="#d97706" strokeWidth="0.8" strokeDasharray="2 2" />

                {/* Number */}
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

                {/* Probability Pips Dots */}
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

          {/* Robber Figurine */}
          {state.board.robberHexId && (
            (() => {
              const rHex = state.board.hexes[state.board.robberHexId];
              if (!rHex) return null;
              const rCenter = hexToPixel({ q: rHex.q, r: rHex.r, s: rHex.s }, HEX_RADIUS);
              return (
                <g transform={`translate(${rCenter.x}, ${rCenter.y - 12})`} filter="url(#piece-shadow)">
                  <image href="/assets/pieces/robber.png" x="-18" y="-30" width="36" height="50" />
                </g>
              );
            })()
          )}
        </g>

        {/* 4. Roads Layer */}
        <g id="roads-layer">
          {Object.values(state.board.edges).map((edge) => {
            const road = state.board.roads[edge.id];
            const v1 = state.board.vertices[edge.v1];
            const v2 = state.board.vertices[edge.v2];
            if (!v1 || !v2) return null;

            const isRoadBuildable =
              (isSetupPlacingRoad || (isMyTurn && activeBuildMode === 'road')) && !road;

            if (road) {
              const player = state.players[road.playerId];
              const colorInfo = player ? PLAYER_COLORS[player.color] : PLAYER_COLORS.red;

              return (
                <line
                  key={edge.id}
                  x1={v1.x}
                  y1={v1.y}
                  x2={v2.x}
                  y2={v2.y}
                  stroke={colorInfo.primary}
                  strokeWidth="8"
                  strokeLinecap="round"
                  filter="url(#piece-shadow)"
                />
              );
            }

            if (isRoadBuildable) {
              const isHovered = hoveredEdge === edge.id;
              return (
                <g
                  key={edge.id}
                  onClick={() => handleEdgeClick(edge.id)}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  className="cursor-pointer"
                >
                  <line
                    x1={v1.x}
                    y1={v1.y}
                    x2={v2.x}
                    y2={v2.y}
                    stroke={isHovered ? '#38bdf8' : '#e0e7ff'}
                    strokeWidth={isHovered ? '9' : '5'}
                    strokeLinecap="round"
                    strokeDasharray={isHovered ? undefined : '6 4'}
                    opacity={isHovered ? 1 : 0.7}
                    className="transition-all"
                  />
                </g>
              );
            }

            return null;
          })}
        </g>

        {/* 5. Vertices (Settlements, Cities, Build Spots) */}
        <g id="vertices-layer">
          {Object.values(state.board.vertices).map((vertex) => {
            const building = state.board.buildings[vertex.id];
            const isSettlementBuildable =
              (isSetupPlacingSettlement || (isMyTurn && activeBuildMode === 'settlement')) && !building;
            const isCityUpgradable =
              isMyTurn && activeBuildMode === 'city' && building && building.type === 'settlement' && building.playerId === myPlayerId;

            if (building) {
              const player = state.players[building.playerId];
              const colorInfo = player ? PLAYER_COLORS[player.color] : PLAYER_COLORS.red;

              return (
                <g
                  key={vertex.id}
                  transform={`translate(${vertex.x}, ${vertex.y})`}
                  filter="url(#piece-shadow)"
                  onClick={() => isCityUpgradable && handleVertexClick(vertex.id)}
                  className={isCityUpgradable ? 'cursor-pointer' : ''}
                >
                  {building.type === 'settlement' ? (
                    // Settlement icon: Peaked House
                    <g transform="translate(-10, -12)">
                      <polygon points="10,0 20,9 20,20 0,20 0,9" fill={colorInfo.primary} stroke="#fff" strokeWidth="1.5" />
                      <rect x="7" y="11" width="6" height="9" fill="#f8fafc" />
                    </g>
                  ) : (
                    // City icon: Twin-Tower Castle
                    <g transform="translate(-14, -15)">
                      <polygon points="14,0 20,6 20,8 28,8 28,26 0,26 0,8 8,8 8,6" fill={colorInfo.primary} stroke="#fff" strokeWidth="1.5" />
                      <rect x="10" y="14" width="8" height="12" fill="#f8fafc" />
                    </g>
                  )}
                  {isCityUpgradable && (
                    <circle r="16" fill="none" stroke="#22c55e" strokeWidth="3" className="animate-pulse" />
                  )}
                </g>
              );
            }

            if (isSettlementBuildable) {
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
                  <circle
                    r={isHovered ? 12 : 7}
                    fill={isHovered ? '#38bdf8' : '#ffffff'}
                    stroke="#0284c7"
                    strokeWidth="2.5"
                    className="transition-all animate-pulse"
                  />
                </g>
              );
            }

            return null;
          })}
        </g>
      </svg>
    </div>
  );
};
