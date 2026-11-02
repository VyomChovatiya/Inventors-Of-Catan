import { EdgeCoordinate, VertexCoordinate } from '../types/index.js';
import { CubeCoord, HEX_RADIUS, getHexCornerPoints, hexToPixel } from './hex.js';
import { getVertexId } from './vertex.js';

export function getEdgeId(v1Id: string, v2Id: string): string {
  return v1Id < v2Id ? `${v1Id}--${v2Id}` : `${v2Id}--${v1Id}`;
}

export function generateEdgesForHex(hex: CubeCoord, radius = HEX_RADIUS): EdgeCoordinate[] {
  const center = hexToPixel(hex, radius);
  const corners = getHexCornerPoints(center.x, center.y, radius);
  const edges: EdgeCoordinate[] = [];

  for (let i = 0; i < 6; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 6];
    const v1Id = getVertexId(p1.x, p1.y);
    const v2Id = getVertexId(p2.x, p2.y);
    const id = getEdgeId(v1Id, v2Id);

    edges.push({
      id,
      v1: v1Id < v2Id ? v1Id : v2Id,
      v2: v1Id < v2Id ? v2Id : v1Id,
      midX: Math.round(((p1.x + p2.x) / 2) * 10) / 10,
      midY: Math.round(((p1.y + p2.y) / 2) * 10) / 10,
    });
  }

  return edges;
}
