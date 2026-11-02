export interface CubeCoord {
  q: number;
  r: number;
  s: number;
}

export const HEX_RADIUS = 60; // pixel radius R for board calculations
export const HEX_WIDTH = 2 * HEX_RADIUS; // 120
export const HEX_HEIGHT = Math.sqrt(3) * HEX_RADIUS; // ~103.92

// Flat-top hex 6 neighbor offsets in (q, r, s)
export const HEX_DIRECTIONS: readonly CubeCoord[] = [
  { q: 1, r: -1, s: 0 }, // North-East
  { q: 1, r: 0, s: -1 }, // South-East
  { q: 0, r: 1, s: -1 }, // South
  { q: -1, r: 1, s: 0 }, // South-West
  { q: -1, r: 0, s: 1 }, // North-West
  { q: 0, r: -1, s: 1 }, // North
] as const;

export function hexCoordToString(c: CubeCoord): string {
  return `${c.q},${c.r},${c.s}`;
}

export function parseHexCoord(str: string): CubeCoord {
  const parts = str.split(',').map(Number);
  return { q: parts[0], r: parts[1], s: parts[2] };
}

export function cubeAdd(a: CubeCoord, b: CubeCoord): CubeCoord {
  return { q: a.q + b.q, r: a.r + b.r, s: a.s + b.s };
}

export function cubeDistance(a: CubeCoord, b: CubeCoord): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));
}

export function hexNeighbors(c: CubeCoord): CubeCoord[] {
  return HEX_DIRECTIONS.map((dir) => cubeAdd(c, dir));
}

// Convert cube coord to 2D center position in pixels (flat-top)
export function hexToPixel(c: CubeCoord, radius = HEX_RADIUS): { x: number; y: number } {
  const x = radius * (1.5 * c.q);
  const y = radius * (Math.sqrt(3) * (c.r + c.q / 2));
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
}

// Returns the 6 corner points of a flat-top hexagon around center (cx, cy)
export function getHexCornerPoints(cx: number, cy: number, radius = HEX_RADIUS): Array<{ x: number; y: number }> {
  const corners: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < 6; i++) {
    const angleRad = (Math.PI / 180) * (60 * i);
    const x = cx + radius * Math.cos(angleRad);
    const y = cy + radius * Math.sin(angleRad);
    corners.push({ x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 });
  }
  return corners;
}
