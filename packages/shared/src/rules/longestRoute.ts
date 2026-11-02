import { BoardState } from '../types/index.js';

interface VertexNode {
  vertexId: string;
  roadEdges: Array<{ edgeId: string; nextVertexId: string }>;
}

export function calculatePlayerLongestRoute(playerId: string, board: BoardState): number {
  // Collect all road edges owned by this player
  const playerRoads = Object.values(board.roads).filter((r) => r.playerId === playerId);
  if (playerRoads.length === 0) return 0;

  // Build adjacency list of vertices
  // Map vertexId -> array of { edgeId, otherVertexId }
  const adjacency = new Map<string, Array<{ edgeId: string; nextVertexId: string }>>();

  for (const road of playerRoads) {
    const edge = board.edges[road.edgeId];
    if (!edge) continue;

    const { v1, v2 } = edge;
    if (!adjacency.has(v1)) adjacency.set(v1, []);
    if (!adjacency.has(v2)) adjacency.set(v2, []);

    adjacency.get(v1)!.push({ edgeId: road.edgeId, nextVertexId: v2 });
    adjacency.get(v2)!.push({ edgeId: road.edgeId, nextVertexId: v1 });
  }

  // Check if a vertex is blocked by an opponent building
  function isVertexBlocked(vId: string): boolean {
    const building = board.buildings[vId];
    if (!building) return false;
    // Blocked if it belongs to an opponent
    return building.playerId !== playerId;
  }

  let maxLen = 0;

  // DFS search for longest simple path (no edge reused)
  function dfs(currentVertex: string, visitedEdges: Set<string>, currentLength: number) {
    if (currentLength > maxLen) {
      maxLen = currentLength;
    }

    // If current vertex is blocked by opponent and we didn't just start from it with 0 length,
    // we cannot continue through this vertex!
    if (currentLength > 0 && isVertexBlocked(currentVertex)) {
      return;
    }

    const neighbors = adjacency.get(currentVertex) || [];
    for (const neighbor of neighbors) {
      if (!visitedEdges.has(neighbor.edgeId)) {
        visitedEdges.add(neighbor.edgeId);
        dfs(neighbor.nextVertexId, visitedEdges, currentLength + 1);
        visitedEdges.delete(neighbor.edgeId);
      }
    }
  }

  // Run DFS starting from every vertex in the player's network
  for (const startVertex of adjacency.keys()) {
    dfs(startVertex, new Set<string>(), 0);
  }

  return maxLen;
}

export function updateLongestRouteOwner(board: BoardState, currentOwnerId: string | null, playerIds: string[]): {
  newOwnerId: string | null;
  playerLengths: Record<string, number>;
} {
  const playerLengths: Record<string, number> = {};
  for (const pid of playerIds) {
    playerLengths[pid] = calculatePlayerLongestRoute(pid, board);
  }

  let newOwnerId = currentOwnerId;
  const currentOwnerLen = currentOwnerId ? playerLengths[currentOwnerId] || 0 : 0;

  // Check if current owner lost qualifying length (< 5)
  if (currentOwnerId && currentOwnerLen < 5) {
    newOwnerId = null;
  }

  // Find candidate with max length
  let bestCandidateId: string | null = null;
  let bestLen = 4; // minimum 5 needed

  for (const pid of playerIds) {
    const len = playerLengths[pid];
    if (len > bestLen) {
      bestLen = len;
      bestCandidateId = pid;
    }
  }

  if (newOwnerId === null) {
    // Check if there is a single player who has >= 5 and strictly more than everyone else
    const qualifying = playerIds.filter((pid) => playerLengths[pid] === bestLen && bestLen >= 5);
    if (qualifying.length === 1) {
      newOwnerId = qualifying[0];
    }
  } else {
    // Current owner only loses if someone strictly exceeds their length
    if (bestCandidateId && bestCandidateId !== newOwnerId && playerLengths[bestCandidateId] > currentOwnerLen) {
      newOwnerId = bestCandidateId;
    }
  }

  return { newOwnerId, playerLengths };
}
