import { CubeCoord, HEX_RADIUS, getHexCornerPoints, hexCoordToString, hexToPixel } from './hex.js';
import { VertexCoordinate } from '../types/index.js';

export function getVertexId(x: number, y: number): string {
  return `v_${Math.round(x)}_${Math.round(y)}`;
}

export function generateVerticesForHex(hex: CubeCoord, radius = HEX_RADIUS): VertexCoordinate[] {
  const center = hexToPixel(hex, radius);
  const corners = getHexCornerPoints(center.x, center.y, radius);
  const hexStr = hexCoordToString(hex);

  return corners.map((corner) => {
    const id = getVertexId(corner.x, corner.y);
    return {
      id,
      hexCoords: [hexStr],
      x: corner.x,
      y: corner.y,
    };
  });
}
