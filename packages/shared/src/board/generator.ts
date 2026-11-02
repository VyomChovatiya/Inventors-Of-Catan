import {
  BoardState,
  Harbor,
  HarborType,
  HexTile,
  ResourceType,
  TerrainType,
  VertexCoordinate,
  EdgeCoordinate,
} from '../types/index.js';
import {
  CubeCoord,
  HEX_RADIUS,
  hexNeighbors,
  hexCoordToString,
} from '../coordinates/hex.js';
import { generateVerticesForHex } from '../coordinates/vertex.js';
import { generateEdgesForHex } from '../coordinates/edge.js';

// Base game 19-hex terrain distribution
export const BASE_TERRAIN_COUNTS: Record<TerrainType, number> = {
  forest: 4,
  fields: 4,
  pasture: 4,
  hills: 3,
  mountains: 3,
  desert: 1,
  sea: 0,
  gold: 0,
};

// 5-6 Player 30-hex terrain distribution
export const EXPANDED_TERRAIN_COUNTS: Record<TerrainType, number> = {
  forest: 6,
  fields: 6,
  pasture: 6,
  hills: 5,
  mountains: 5,
  desert: 2,
  sea: 0,
  gold: 0,
};

// Standard official number tokens for 3-4 player
export const BASE_NUMBER_TOKENS = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11,
];

// Official 5-6 player number tokens (28 tokens)
export const EXPANDED_NUMBER_TOKENS = [
  2, 5, 4, 6, 3, 9, 8, 11, 11, 10, 6, 3, 8, 4, 8, 10, 11, 12, 10, 5, 4, 9, 5, 9, 12, 3, 2, 6,
];

export const TERRAIN_TO_RESOURCE: Partial<Record<TerrainType, ResourceType>> = {
  forest: 'wood',
  hills: 'brick',
  fields: 'wheat',
  pasture: 'sheep',
  mountains: 'ore',
};

// Harbors for 3-4 player
export const BASE_HARBORS: HarborType[] = [
  'generic_3_1',
  'wheat_2_1',
  'ore_2_1',
  'generic_3_1',
  'sheep_2_1',
  'generic_3_1',
  'generic_3_1',
  'brick_2_1',
  'wood_2_1',
];

export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function getBaseHexCoords(): CubeCoord[] {
  const coords: CubeCoord[] = [];
  for (let q = -2; q <= 2; q++) {
    const r1 = Math.max(-2, -q - 2);
    const r2 = Math.min(2, -q + 2);
    for (let r = r1; r <= r2; r++) {
      coords.push({ q, r, s: -q - r });
    }
  }
  return coords;
}

export function get56HexCoords(): CubeCoord[] {
  const coords: CubeCoord[] = [];
  const colRanges: Record<number, [number, number]> = {
    [-3]: [0, 2],
    [-2]: [-1, 2],
    [-1]: [-2, 2],
    [0]: [-3, 2],
    [1]: [-3, 1],
    [2]: [-3, 0],
    [3]: [-3, -1],
  };

  for (let q = -3; q <= 3; q++) {
    const [rMin, rMax] = colRanges[q];
    for (let r = rMin; r <= rMax; r++) {
      coords.push({ q, r, s: -q - r });
    }
  }
  return coords;
}

export function generateBoard(is5to6Player = false): BoardState {
  const hexCoords = is5to6Player ? get56HexCoords() : getBaseHexCoords();
  const terrainCounts = is5to6Player ? EXPANDED_TERRAIN_COUNTS : BASE_TERRAIN_COUNTS;

  // Build shuffled terrain pool
  const terrains: TerrainType[] = [];
  for (const [t, count] of Object.entries(terrainCounts)) {
    for (let i = 0; i < count; i++) {
      terrains.push(t as TerrainType);
    }
  }
  const shuffledTerrains = shuffle(terrains);
  const numbersPool = shuffle(is5to6Player ? EXPANDED_NUMBER_TOKENS : BASE_NUMBER_TOKENS);

  // Arrange so that red numbers (6 and 8) never touch
  let validAssignment = false;
  let finalTiles: HexTile[] = [];
  let attempts = 0;

  while (!validAssignment && attempts < 100) {
    attempts++;
    const currentTerrains = shuffle(shuffledTerrains);
    const currentNumbers = [...numbersPool];
    let numIdx = 0;
    const tileMap = new Map<string, HexTile>();

    for (let i = 0; i < hexCoords.length; i++) {
      const coord = hexCoords[i];
      const terrain = currentTerrains[i];
      const isDesert = terrain === 'desert';
      const number = isDesert ? undefined : currentNumbers[numIdx++];
      const id = hexCoordToString(coord);

      tileMap.set(id, {
        id,
        q: coord.q,
        r: coord.r,
        s: coord.s,
        terrain,
        resource: TERRAIN_TO_RESOURCE[terrain],
        number,
        hasRobber: isDesert,
      });
    }

    let redClash = false;
    for (const tile of tileMap.values()) {
      if (tile.number === 6 || tile.number === 8) {
        const neighbors = hexNeighbors({ q: tile.q, r: tile.r, s: tile.s });
        for (const n of neighbors) {
          const neighborTile = tileMap.get(hexCoordToString(n));
          if (neighborTile && (neighborTile.number === 6 || neighborTile.number === 8)) {
            redClash = true;
            break;
          }
        }
      }
      if (redClash) break;
    }

    if (!redClash) {
      validAssignment = true;
      finalTiles = Array.from(tileMap.values());
    }
  }

  if (!validAssignment) {
    let numIdx = 0;
    finalTiles = hexCoords.map((coord, idx) => {
      const terrain = shuffledTerrains[idx];
      const isDesert = terrain === 'desert';
      const number = isDesert ? undefined : numbersPool[numIdx++];
      const id = hexCoordToString(coord);
      return {
        id,
        q: coord.q,
        r: coord.r,
        s: coord.s,
        terrain,
        resource: TERRAIN_TO_RESOURCE[terrain],
        number,
        hasRobber: isDesert,
      };
    });
  }

  const hexes: Record<string, HexTile> = {};
  const vertices: Record<string, VertexCoordinate> = {};
  const edges: Record<string, EdgeCoordinate> = {};

  let robberHexId = '';

  for (const tile of finalTiles) {
    hexes[tile.id] = tile;
    if (tile.hasRobber) {
      robberHexId = tile.id;
    }

    const tileVerts = generateVerticesForHex(tile, HEX_RADIUS);
    for (const v of tileVerts) {
      if (!vertices[v.id]) {
        vertices[v.id] = v;
      } else {
        if (!vertices[v.id].hexCoords.includes(tile.id)) {
          vertices[v.id].hexCoords.push(tile.id);
        }
      }
    }

    const tileEdges = generateEdgesForHex(tile, HEX_RADIUS);
    for (const e of tileEdges) {
      if (!edges[e.id]) {
        edges[e.id] = e;
      }
    }
  }

  // Detect coastal edges (edges belonging to only 1 hex) and track which hex owns them
  const edgeHexOwners = new Map<string, string[]>();

  for (const tile of finalTiles) {
    const tileEdges = generateEdgesForHex(tile, HEX_RADIUS);
    for (const e of tileEdges) {
      const list = edgeHexOwners.get(e.id) || [];
      list.push(tile.id);
      edgeHexOwners.set(e.id, list);
    }
  }

  const coastalEdges: Array<{ edge: EdgeCoordinate; coastalHexId: string; angle: number }> = [];
  for (const [edgeId, owners] of edgeHexOwners.entries()) {
    if (owners.length === 1) {
      const edge = edges[edgeId];
      const angle = Math.atan2(edge.midY, edge.midX);
      coastalEdges.push({ edge, coastalHexId: owners[0], angle });
    }
  }

  // Sort coastal edges clockwise around the island perimeter
  coastalEdges.sort((a, b) => a.angle - b.angle);

  // Distribute harbors evenly around the perimeter so they never clump
  const harbors: Record<string, Harbor> = {};
  const harborTypes = is5to6Player ? [...BASE_HARBORS, 'generic_3_1', 'sheep_2_1'] : BASE_HARBORS;

  for (let i = 0; i < harborTypes.length; i++) {
    const edgeIndex = Math.floor((i * coastalEdges.length) / harborTypes.length);
    const item = coastalEdges[edgeIndex];
    if (item) {
      const type = harborTypes[i] as HarborType;
      const is21 = type.endsWith('_2_1');
      const resourceStr = is21 ? type.split('_')[0] : undefined;
      const id = `harbor_${i}`;
      harbors[id] = {
        id,
        type,
        edgeId: item.edge.id,
        coastalHexId: item.coastalHexId,
        vertexIds: [item.edge.v1, item.edge.v2],
        ratio: is21 ? 2 : 3,
        resource: resourceStr as ResourceType | undefined,
      };
    }
  }

  return {
    hexes,
    vertices,
    edges,
    buildings: {},
    roads: {},
    harbors,
    robberHexId,
  };
}
