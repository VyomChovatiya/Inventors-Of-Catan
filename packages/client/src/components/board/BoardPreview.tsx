import React, { useMemo } from 'react';
import {
  BoardState,
  HEX_RADIUS,
  getHexCornerPoints,
  hexToPixel,
  ResourceType,
} from '@catan/shared';

interface BoardPreviewProps {
  board: BoardState;
  className?: string;
}

const RESOURCE_PORT_ASSETS: Record<ResourceType, { img: string; ringColor: string }> = {
  wood: { img: '/assets/cards/wood.png', ringColor: '#16a34a' },
  brick: { img: '/assets/cards/brick.png', ringColor: '#dc2626' },
  wheat: { img: '/assets/cards/wheat.png', ringColor: '#eab308' },
  sheep: { img: '/assets/cards/wool.png', ringColor: '#65a30d' },
  ore: { img: '/assets/cards/ore.png', ringColor: '#64748b' },
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

export const BoardPreview: React.FC<BoardPreviewProps> = React.memo(({ board, className }) => {
  const { minX, maxX, minY, maxY } = useMemo(() => {
    let minX = 0,
      maxX = 0,
      minY = 0,
      maxY = 0;
    for (const v of Object.values(board.vertices)) {
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    return { minX: minX - 80, maxX: maxX + 80, minY: minY - 76, maxY: maxY + 76 };
  }, [board.vertices]);

  const viewBox = `${minX} ${minY} ${maxX - minX} ${maxY - minY}`;

  return (
    <div
      className={`relative w-full h-full flex items-center justify-center overflow-hidden rounded-2xl bg-slate-950/90 border border-slate-800 ${className || ''}`}
    >
      <svg viewBox={viewBox} className="w-full h-full drop-shadow-xl">
        <defs>
          {['forest', 'hills', 'fields', 'pasture', 'mountains', 'desert', 'sea'].map((t) => (
            <pattern
              key={t}
              id={`preview-pat-${t}`}
              width="100%"
              height="100%"
              viewBox="0 0 400 344"
              patternUnits="objectBoundingBox"
            >
              <image href={`/assets/hexes/${t}.png`} width="400" height="344" preserveAspectRatio="none" />
            </pattern>
          ))}
          <clipPath id="preview-harbor-clip">
            <circle cx="0" cy="0" r="16" />
          </clipPath>
        </defs>

        {/* Harbors */}
        <g className="pointer-events-none select-none">
          {Object.values(board.harbors).map((harbor) => {
            const edge = board.edges[harbor.edgeId];
            const v1 = board.vertices[harbor.vertexIds[0]];
            const v2 = board.vertices[harbor.vertexIds[1]];
            const coastalHex = board.hexes[harbor.coastalHexId];
            if (!edge || !v1 || !v2) return null;

            let ux = 0;
            let uy = -1;
            if (coastalHex) {
              const hexCenter = hexToPixel({ q: coastalHex.q, r: coastalHex.r, s: coastalHex.s }, HEX_RADIUS);
              const dx = edge.midX - hexCenter.x;
              const dy = edge.midY - hexCenter.y;
              const len = Math.hypot(dx, dy) || 1;
              ux = dx / len;
              uy = dy / len;
            }

            const shipX = edge.midX + ux * 42;
            const shipY = edge.midY + uy * 42;
            const pier1EndX = v1.x + (shipX - v1.x) * 0.6;
            const pier1EndY = v1.y + (shipY - v1.y) * 0.6;
            const pier2EndX = v2.x + (shipX - v2.x) * 0.6;
            const pier2EndY = v2.y + (shipY - v2.y) * 0.6;

            const is21 = harbor.ratio === 2 && harbor.resource;
            const portAsset = is21 ? RESOURCE_PORT_ASSETS[harbor.resource!] : null;

            return (
              <g key={harbor.id}>
                <line
                  x1={v1.x}
                  y1={v1.y}
                  x2={pier1EndX}
                  y2={pier1EndY}
                  stroke="#92400e"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <line
                  x1={v2.x}
                  y1={v2.y}
                  x2={pier2EndX}
                  y2={pier2EndY}
                  stroke="#92400e"
                  strokeWidth="5"
                  strokeLinecap="round"
                />
                <g transform={`translate(${shipX}, ${shipY})`}>
                  <circle
                    r="19"
                    fill="#3b1704"
                    stroke={portAsset ? portAsset.ringColor : '#f59e0b'}
                    strokeWidth="2.5"
                  />
                  {is21 && portAsset ? (
                    <>
                      <g clipPath="url(#preview-harbor-clip)">
                        <image
                          href={portAsset.img}
                          x="-20"
                          y="-24"
                          width="40"
                          height="48"
                          preserveAspectRatio="xMidYMid slice"
                        />
                      </g>
                      <rect
                        x="-12"
                        y="5"
                        width="24"
                        height="11"
                        rx="5"
                        fill="#0f172a"
                        stroke="#fbbf24"
                        strokeWidth="1.2"
                      />
                      <text
                        textAnchor="middle"
                        y="13"
                        fontSize="8.5"
                        fontWeight="900"
                        fill="#fef08a"
                        fontFamily="sans-serif"
                      >
                        2:1
                      </text>
                    </>
                  ) : (
                    <>
                      <circle r="15" fill="#fef3c7" />
                      <text
                        textAnchor="middle"
                        y="3"
                        fontSize="9.5"
                        fontWeight="900"
                        fill="#78350f"
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

        {/* Hexes */}
        <g>
          {Object.values(board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            const corners = getHexCornerPoints(center.x, center.y, HEX_RADIUS);
            const pointsStr = corners.map((p) => `${p.x},${p.y}`).join(' ');
            return (
              <polygon
                key={tile.id}
                points={pointsStr}
                fill={`url(#preview-pat-${tile.terrain})`}
                stroke="#f59e0b"
                strokeWidth="2"
                strokeOpacity="0.65"
              />
            );
          })}
        </g>

        {/* Number Tokens */}
        <g className="pointer-events-none select-none">
          {Object.values(board.hexes).map((tile) => {
            const center = hexToPixel({ q: tile.q, r: tile.r, s: tile.s }, HEX_RADIUS);
            if (tile.terrain === 'desert' || !tile.number) return null;
            const isRedNumber = tile.number === 6 || tile.number === 8;
            const pipsCount = NUMBER_PIPS[tile.number] || 1;

            return (
              <g key={`pnum-${tile.id}`} transform={`translate(${center.x}, ${center.y})`}>
                <circle r="18" fill="#fef3c7" stroke="#b45309" strokeWidth="1.8" />
                <text
                  textAnchor="middle"
                  dy="2"
                  fontSize="14"
                  fontWeight="900"
                  fill={isRedNumber ? '#dc2626' : '#1e293b'}
                  fontFamily="sans-serif"
                >
                  {tile.number}
                </text>
                <g transform="translate(0, 8.5)">
                  {Array.from({ length: pipsCount }).map((_, i) => {
                    const offset = (i - (pipsCount - 1) / 2) * 4.2;
                    return (
                      <circle
                        key={i}
                        cx={offset}
                        cy="0"
                        r="1.3"
                        fill={isRedNumber ? '#dc2626' : '#334155'}
                      />
                    );
                  })}
                </g>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
});
