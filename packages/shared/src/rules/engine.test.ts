import { describe, it, expect } from 'vitest';
import { initializeGame, satisfiesDistanceRule } from './engine.js';
import { applyAction } from './actions.js';
import { calculatePlayerLongestRoute, updateLongestRouteOwner } from './longestRoute.js';

describe('Catan Rules Engine - Phase 1', () => {
  it('initializes a 4-player game with snake draft setup order', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
      { id: 'p4', name: 'Diana', color: 'white' as const },
    ];
    const game = initializeGame('test_game_1', players, false);

    expect(game.phase).toBe('SETUP_ROUND_1');
    expect(game.setupTurnOrder).toEqual(['p1', 'p2', 'p3', 'p4', 'p4', 'p3', 'p2', 'p1']);
    expect(game.currentTurnPlayerId).toBe('p1');
    expect(Object.keys(game.board.hexes).length).toBe(19);
  });

  it('initializes a 6-player game with 30 hexes and paired player markers', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
      { id: 'p4', name: 'Diana', color: 'white' as const },
      { id: 'p5', name: 'Eve', color: 'green' as const },
      { id: 'p6', name: 'Frank', color: 'purple' as const },
    ];
    const game = initializeGame('test_game_6p', players, true);

    expect(game.phase).toBe('SETUP_ROUND_1');
    expect(Object.keys(game.board.hexes).length).toBe(30);
    expect(game.settings.pairedPlayersTurn).toBe(true);
    // Player 2 is 3 seats to the left of Player 1: index (0 + 3) = 3 -> Diana ('p4')
    expect(game.pairedPlayerId).toBe('p4');
  });

  it('enforces the distance rule', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
    ];
    const game = initializeGame('test_dist', players, false);

    // Pick a valid vertex
    const vertexIds = Object.keys(game.board.vertices);
    const v1 = vertexIds[0];

    // Alice builds a settlement
    const res1 = applyAction(game, { type: 'BUILD_SETUP_SETTLEMENT', playerId: 'p1', vertexId: v1 });
    expect(res1.success).toBe(true);

    // Find an adjacent vertex
    const edge = Object.values(game.board.edges).find((e) => e.v1 === v1 || e.v2 === v1)!;
    const vAdjacent = edge.v1 === v1 ? edge.v2 : edge.v1;

    // Distance rule check
    expect(satisfiesDistanceRule(vAdjacent, game.board)).toBe(false);
  });

  it('accurately computes longest continuous route with opponent interruption', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
    ];
    const game = initializeGame('test_lr', players, false);

    // Find a chain of 5 connected edges
    // Build a simple 5-road line for Alice
    const edgesList = Object.values(game.board.edges);
    const pathEdges: string[] = [];

    let currentVertex = edgesList[0].v1;
    while (pathEdges.length < 5) {
      const nextEdge = edgesList.find(
        (e) => (e.v1 === currentVertex || e.v2 === currentVertex) && !pathEdges.includes(e.id),
      );
      if (!nextEdge) break;
      pathEdges.push(nextEdge.id);
      currentVertex = nextEdge.v1 === currentVertex ? nextEdge.v2 : nextEdge.v1;
    }

    if (pathEdges.length >= 5) {
      for (const eId of pathEdges) {
        game.board.roads[eId] = { id: `r_${eId}`, playerId: 'p1', edgeId: eId };
      }

      const length = calculatePlayerLongestRoute('p1', game.board);
      expect(length).toBe(pathEdges.length);

      // Now Bob places a settlement right in the middle of Alice's road chain
      const middleEdge = game.board.edges[pathEdges[2]];
      const middleVertex = middleEdge.v1;

      game.board.buildings[middleVertex] = {
        id: `b_${middleVertex}`,
        type: 'settlement',
        playerId: 'p2', // Bob interrupts Alice's route!
        vertexId: middleVertex,
      };

      const interruptedLength = calculatePlayerLongestRoute('p1', game.board);
      expect(interruptedLength).toBeLessThan(length);
    }
  });
});
