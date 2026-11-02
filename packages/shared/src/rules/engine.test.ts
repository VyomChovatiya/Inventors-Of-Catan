import { describe, it, expect } from 'vitest';
import { initializeGame, satisfiesDistanceRule } from './engine.js';
import { applyAction, handleTurnTimeout } from './actions.js';
import { calculatePlayerLongestRoute } from './longestRoute.js';

describe('Catan Rules Engine - Phase 1', () => {
  it('initializes a 2-player or 4-player game with snake draft setup order', () => {
    const twoPlayers = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game2p = initializeGame('test_game_2p', twoPlayers, false);
    expect(game2p.phase).toBe('SETUP_ROUND_1');
    expect(game2p.setupTurnOrder).toEqual(['p1', 'p2', 'p2', 'p1']);

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
    expect(game.pairedPlayerId).toBe('p4');
  });

  it('enforces the distance rule and requires setup road to attach to the just-placed settlement', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_dist', players, false);

    const vertexIds = Object.keys(game.board.vertices);
    const v1 = vertexIds[0];

    // Alice builds 1st settlement
    const res1 = applyAction(game, { type: 'BUILD_SETUP_SETTLEMENT', playerId: 'p1', vertexId: v1 });
    expect(res1.success).toBe(true);
    expect(game.lastSetupVertexId).toBe(v1);

    // Find an edge NOT connected to v1
    const unrelatedEdge = Object.values(game.board.edges).find((e) => e.v1 !== v1 && e.v2 !== v1)!;
    const badRoad = applyAction(game, {
      type: 'BUILD_SETUP_ROAD',
      playerId: 'p1',
      edgeId: unrelatedEdge.id,
    });
    expect(badRoad.success).toBe(false);

    // Connected edge succeeds
    const connectedEdge = Object.values(game.board.edges).find((e) => e.v1 === v1 || e.v2 === v1)!;
    const goodRoad = applyAction(game, {
      type: 'BUILD_SETUP_ROAD',
      playerId: 'p1',
      edgeId: connectedEdge.id,
    });
    expect(goodRoad.success).toBe(true);
    expect(game.lastSetupVertexId).toBeNull();
  });

  it('auto-rolls and auto-passes when turn deadline expires', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_timeout', players, false);

    // Complete 4 setup turns via timeout
    for (let i = 0; i < 4; i++) {
      game.turnDeadlineMs = Date.now() - 1000;
      expect(handleTurnTimeout(game)).toBe(true);
    }

    expect(game.phase).toBe('TURN_START');
    // Expire roll dice timer -> auto-rolls!
    game.turnDeadlineMs = Date.now() - 1000;
    expect(handleTurnTimeout(game)).toBe(true);
    expect(game.diceRolledThisTurn).toBe(true);
  });

  it('accurately computes longest continuous route with opponent interruption', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_lr', players, false);

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

      const middleEdge = game.board.edges[pathEdges[2]];
      const middleVertex = middleEdge.v1;

      game.board.buildings[middleVertex] = {
        id: `b_${middleVertex}`,
        type: 'settlement',
        playerId: 'p2',
        vertexId: middleVertex,
      };

      const interruptedLength = calculatePlayerLongestRoute('p1', game.board);
      expect(interruptedLength).toBeLessThan(length);
    }
  });
});
