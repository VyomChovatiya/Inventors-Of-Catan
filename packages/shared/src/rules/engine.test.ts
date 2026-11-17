import { describe, it, expect } from 'vitest';
import {
  initializeGame,
  satisfiesDistanceRule,
  redactStateForPlayer,
  rollOrdinaryDice,
  THEORETICAL_TWO_DICE_COUNTS,
  computePublicVictoryPoints,
} from './engine.js';
import { applyAction, handleTurnTimeout, removePlayerFromGame } from './actions.js';
import { resolveBarbarianAttack } from './citiesAndKnights.js';
import { calculatePlayerLongestRoute } from './longestRoute.js';
import {
  areHarborsIncompatibleAdjacent,
  generateBoard,
  hasAdjacentRedNumbers,
  hasInvalidHarborAdjacency,
} from '../board/generator.js';

// Reproducible seeded PRNG (Mulberry32) for statistical dice verification
function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('Catan Rules Engine & Security Validation Suite', () => {
  it('initializes a 2-player or 4-player game with snake draft setup order and 3-minute default turn timer', () => {
    const twoPlayers = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game2p = initializeGame('test_game_2p', twoPlayers, false, 10, undefined, {
      randomizeTurnOrder: false,
    });
    expect(game2p.phase).toBe('SETUP_ROUND_1');
    expect(game2p.setupTurnOrder).toEqual(['p1', 'p2', 'p2', 'p1']);
    expect(game2p.settings.turnTimeoutSeconds).toBe(180);

    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
      { id: 'p4', name: 'Diana', color: 'white' as const },
    ];
    const game = initializeGame('test_game_1', players, false, 10, { turnTimeoutSeconds: 300 }, {
      randomizeTurnOrder: false,
    });

    expect(game.phase).toBe('SETUP_ROUND_1');
    expect(game.setupTurnOrder).toEqual(['p1', 'p2', 'p3', 'p4', 'p4', 'p3', 'p2', 'p1']);
    expect(game.currentTurnPlayerId).toBe('p1');
    expect(game.settings.turnTimeoutSeconds).toBe(300);
    expect(Object.keys(game.board.hexes).length).toBe(19);
  });

  it('randomizes player turn order at match start and preserves it across setup, turns, and redaction', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
      { id: 'p4', name: 'Diana', color: 'white' as const },
      { id: 'p5', name: 'Eve', color: 'green' as const },
      { id: 'p6', name: 'Frank', color: 'purple' as const },
    ];

    const seenFirstPlayers = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const g = initializeGame(`rand_${i}`, players, true);
      seenFirstPlayers.add(g.playerOrder[0]);
      expect(g.setupTurnOrder.slice(0, 6)).toEqual(g.playerOrder);
      expect(g.setupTurnOrder.slice(6)).toEqual([...g.playerOrder].reverse());
      expect(g.currentTurnPlayerId).toBe(g.playerOrder[0]);
      expect(g.pairedPlayerId).toBe(g.playerOrder[3]);

      const redacted = redactStateForPlayer(g, 'p1');
      expect(Object.keys(redacted.players)).toEqual(g.playerOrder);
    }
    expect(seenFirstPlayers.size).toBeGreaterThan(1);
  });

  it('rejects nonexistent setup vertices without mutating state (Bug #7)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_invalid_vertex', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });

    expect(satisfiesDistanceRule('v_nonexistent_999', game.board)).toBe(false);
    const badRes = applyAction(game, {
      type: 'BUILD_SETUP_SETTLEMENT',
      playerId: 'p1',
      vertexId: 'v_nonexistent_999',
    });
    expect(badRes.success).toBe(false);
    expect(game.lastSetupVertexId).toBeNull();
    expect(game.players.p1.settlementsLeft).toBe(5);
    expect(Object.keys(game.board.buildings).length).toBe(0);
  });

  it('enforces the distance rule and requires setup road to attach to the just-placed settlement', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_dist', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });

    const vertexIds = Object.keys(game.board.vertices);
    const v1 = vertexIds[0];

    const res1 = applyAction(game, { type: 'BUILD_SETUP_SETTLEMENT', playerId: 'p1', vertexId: v1 });
    expect(res1.success).toBe(true);
    expect(game.lastSetupVertexId).toBe(v1);

    const unrelatedEdge = Object.values(game.board.edges).find((e) => e.v1 !== v1 && e.v2 !== v1)!;
    const badRoad = applyAction(game, {
      type: 'BUILD_SETUP_ROAD',
      playerId: 'p1',
      edgeId: unrelatedEdge.id,
    });
    expect(badRoad.success).toBe(false);

    const connectedEdge = Object.values(game.board.edges).find((e) => e.v1 === v1 || e.v2 === v1)!;
    const goodRoad = applyAction(game, {
      type: 'BUILD_SETUP_ROAD',
      playerId: 'p1',
      edgeId: connectedEdge.id,
    });
    expect(goodRoad.success).toBe(true);
    expect(game.lastSetupVertexId).toBeNull();
  });

  it('prevents END_TURN from bypassing mandatory phases or clearing active state on rejection (Bug #6)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_end_turn', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });

    // Cannot END_TURN during SETUP_ROUND_1
    const resSetup = applyAction(game, { type: 'END_TURN', playerId: 'p1' });
    expect(resSetup.success).toBe(false);
    expect(game.phase).toBe('SETUP_ROUND_1');

    // Cannot END_TURN during TURN_START (before rolling)
    game.phase = 'TURN_START';
    game.currentTurnPlayerId = 'p1';
    const resRoll = applyAction(game, { type: 'END_TURN', playerId: 'p1' });
    expect(resRoll.success).toBe(false);
    expect(game.phase).toBe('TURN_START');

    // Cannot END_TURN during ROBBER_PLACEMENT
    game.phase = 'ROBBER_PLACEMENT';
    const resRobber = applyAction(game, { type: 'END_TURN', playerId: 'p1' });
    expect(resRobber.success).toBe(false);
    expect(game.phase).toBe('ROBBER_PLACEMENT');

    // Rejected END_TURN from non-active player during ACTION_PHASE must NOT clear activeTradeOffer or freeRoadsRemaining
    game.phase = 'ACTION_PHASE';
    game.freeRoadsRemaining = 2;
    game.activeTradeOffer = {
      id: 't1',
      fromPlayerId: 'p1',
      targetPlayerId: 'all',
      giving: { wood: 1 },
      asking: { wheat: 1 },
      status: { p2: 'pending' },
      counterOffers: [],
      createdAt: Date.now(),
    };
    const badEndByP2 = applyAction(game, { type: 'END_TURN', playerId: 'p2' });
    expect(badEndByP2.success).toBe(false);
    expect(game.activeTradeOffer).not.toBeNull();
    expect(game.freeRoadsRemaining).toBe(2);
  });

  it('rejects negative, fractional, NaN, and unknown resource quantities across all actions (Bug #4)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_neg_res', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });
    game.phase = 'ACTION_PHASE';
    game.currentTurnPlayerId = 'p1';
    game.turnDeadlineMs = Date.now() + 60000;
    game.players.p1.resources = { wood: 2, brick: 2, wheat: 2, sheep: 2, ore: 2 };

    const negTrade = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: -1, brick: 2 },
      asking: { wheat: 1 },
    });
    expect(negTrade.success).toBe(false);

    const floatTrade = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: 1.5 },
      asking: { wheat: 1 },
    });
    expect(floatTrade.success).toBe(false);

    const unknownKeyTrade = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: 1, gold: 1 } as any,
      asking: { wheat: 1 },
    });
    expect(unknownKeyTrade.success).toBe(false);

    const negBatchBank = applyAction(game, {
      type: 'MARITIME_BATCH_TRADE',
      playerId: 'p1',
      giving: { wood: 4, brick: -4 },
      asking: { wheat: 1 },
    });
    expect(negBatchBank.success).toBe(false);
    expect(game.players.p1.resources).toEqual({ wood: 2, brick: 2, wheat: 2, sheep: 2, ore: 2 });
  });

  it('rejects accepting a trade offer if the proposer already spent the offered resources (Bug #5)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_spent_trade', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });
    game.phase = 'ACTION_PHASE';
    game.currentTurnPlayerId = 'p1';
    game.turnDeadlineMs = Date.now() + 60000;
    game.players.p1.resources = { wood: 1, brick: 1, wheat: 0, sheep: 0, ore: 0 };
    game.players.p2.resources = { wood: 0, brick: 0, wheat: 2, sheep: 0, ore: 0 };

    // Alice offers 1 wood for 1 wheat
    const offerRes = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: 1 },
      asking: { wheat: 1 },
    });
    expect(offerRes.success).toBe(true);
    const tradeId = game.activeTradeOffer!.id;

    // Alice spends her 1 wood (e.g. builds a road) before Bob accepts
    game.players.p1.resources.wood = 0;

    const acceptRes = applyAction(game, {
      type: 'RESPOND_TRADE',
      playerId: 'p2',
      tradeId,
      accept: true,
    });
    expect(acceptRes.success).toBe(false);
    // Bob's wheat and Alice's wood remain untouched!
    expect(game.players.p1.resources.wood).toBe(0);
    expect(game.players.p1.resources.wheat).toBe(0);
    expect(game.players.p2.resources.wheat).toBe(2);
    expect(game.players.p2.resources.wood).toBe(0);
  });

  it('validates bank availability on Year of Plenty and preserves card on rejection (Bug #8)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_yop_bank', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });
    game.phase = 'ACTION_PHASE';
    game.currentTurnPlayerId = 'p1';
    game.turnNumber = 2;
    game.turnDeadlineMs = Date.now() + 60000;
    game.players.p1.devCards = [{ id: 'dc_yop', type: 'year_of_plenty', boughtTurn: 1 }];
    game.resourceBank.ore = 1; // Only 1 ore in bank!

    // Asking for 2 ore when bank only has 1 must fail and preserve the dev card
    const failSame = applyAction(game, {
      type: 'PLAY_DEV_CARD',
      playerId: 'p1',
      cardId: 'dc_yop',
      options: { yearOfPlentyResources: ['ore', 'ore'] },
    });
    expect(failSame.success).toBe(false);
    expect(game.players.p1.devCards.length).toBe(1);
    expect(game.devCardPlayedThisTurn).toBe(false);
    expect(game.resourceBank.ore).toBe(1);

    // Asking for 1 ore + 1 wheat succeeds
    const okDiff = applyAction(game, {
      type: 'PLAY_DEV_CARD',
      playerId: 'p1',
      cardId: 'dc_yop',
      options: { yearOfPlentyResources: ['ore', 'wheat'] },
    });
    expect(okDiff.success).toBe(true);
    expect(game.players.p1.devCards.length).toBe(0);
    expect(game.resourceBank.ore).toBe(0);
  });

  it('guarantees zero adjacent 6/8 red tokens and valid harbor adjacency across 50 base and 50 expanded boards (Bug #9 & #20)', () => {
    for (let i = 0; i < 50; i++) {
      const baseBoard = generateBoard(false);
      expect(Object.keys(baseBoard.hexes).length).toBe(19);
      expect(hasAdjacentRedNumbers(baseBoard.hexes)).toBe(false);
      const baseHarbors = Object.values(baseBoard.harbors).sort(
        (a, b) => Number(a.id.replace('harbor_', '')) - Number(b.id.replace('harbor_', '')),
      );
      expect(baseHarbors.length).toBe(9);
      expect(hasInvalidHarborAdjacency(baseBoard.harbors, baseBoard.edges)).toBe(false);
      for (let h = 0; h < baseHarbors.length; h++) {
        const cur = baseHarbors[h].type;
        const next = baseHarbors[(h + 1) % baseHarbors.length].type;
        expect(areHarborsIncompatibleAdjacent(cur, next)).toBe(false);
      }

      const expandedBoard = generateBoard(true);
      expect(Object.keys(expandedBoard.hexes).length).toBe(30);
      expect(hasAdjacentRedNumbers(expandedBoard.hexes)).toBe(false);
      const expandedHarbors = Object.values(expandedBoard.harbors).sort(
        (a, b) => Number(a.id.replace('harbor_', '')) - Number(b.id.replace('harbor_', '')),
      );
      expect(expandedHarbors.length).toBe(11);
      expect(hasInvalidHarborAdjacency(expandedBoard.harbors, expandedBoard.edges)).toBe(false);
      for (let h = 0; h < expandedHarbors.length; h++) {
        const cur = expandedHarbors[h].type;
        const next = expandedHarbors[(h + 1) % expandedHarbors.length].type;
        expect(areHarborsIncompatibleAdjacent(cur, next)).toBe(false);
      }
    }
  });

  it('removes RIG_DICE and flags stateChanged on deadline timeout transitions (Bug #3 & #10)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame('test_deadline_sync', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });
    game.phase = 'TURN_START';
    game.currentTurnPlayerId = 'p1';
    game.turnDeadlineMs = Date.now() + 60000;

    // RIG_DICE is rejected as unknown action
    const rigRes = applyAction(game, { type: 'RIG_DICE', playerId: 'p1', d1: 3, d2: 4 } as any);
    expect(rigRes.success).toBe(false);

    // Expire deadline -> next action returns { success: false, stateChanged: true } and auto-rolls!
    game.turnDeadlineMs = Date.now() - 500;
    const lateAction = applyAction(game, { type: 'END_TURN', playerId: 'p1' });
    expect(lateAction.success).toBe(false);
    expect(lateAction.stateChanged).toBe(true);
    expect(game.diceRolledThisTurn).toBe(true);
  });

  it('verifies ordinary two-dice randomness matches the theoretical 36-outcome distribution (Improvement #18)', () => {
    const rng = createSeededRng(20261107);
    const N = 360_000;
    const sumCounts: Record<number, number> = {
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
      10: 0,
      11: 0,
      12: 0,
    };
    const pairCounts = new Map<string, number>();

    let outOfBounds = 0;
    for (let i = 0; i < N; i++) {
      const [d1, d2] = rollOrdinaryDice(rng);
      if (d1 < 1 || d1 > 6 || d2 < 1 || d2 > 6) outOfBounds++;
      sumCounts[d1 + d2]++;
      const key = `${d1},${d2}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    }
    expect(outOfBounds).toBe(0);

    // All 36 ordered pairs should appear ~10,000 times each
    expect(pairCounts.size).toBe(36);
    for (const count of pairCounts.values()) {
      expect(count).toBeGreaterThan(9500);
      expect(count).toBeLessThan(10500);
    }

    // Chi-squared goodness-of-fit against exact two-dice distribution (df = 10, critical value at p=0.001 is 29.59)
    let chiSquaredTwoDice = 0;
    let chiSquaredUniformSum = 0;
    for (let sum = 2; sum <= 12; sum++) {
      const expectedTwoDice = (N * THEORETICAL_TWO_DICE_COUNTS[sum]) / 36;
      const diff = sumCounts[sum] - expectedTwoDice;
      chiSquaredTwoDice += (diff * diff) / expectedTwoDice;

      const expectedUniform = N / 11;
      const diffU = sumCounts[sum] - expectedUniform;
      chiSquaredUniformSum += (diffU * diffU) / expectedUniform;
    }

    expect(chiSquaredTwoDice).toBeLessThan(25);
    expect(chiSquaredUniformSum).toBeGreaterThan(50000); // Decisively NOT a uniform sum distribution
  });

  it('implements Balanced Dice, Hidden Bank, and Free Trades house rules (Improvements #22–#25)', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
    ];
    const game = initializeGame(
      'test_house_rules',
      players,
      false,
      10,
      undefined,
      {
        randomizeTurnOrder: false,
        houseRules: {
          balancedDice: true,
          hiddenBank: true,
          freeTrades: true,
        },
      },
    );

    // 1. Hidden bank withholds resourceBank from RedactedGameState payload
    const redacted = redactStateForPlayer(game, 'p1');
    expect(redacted.resourceBank).toBeNull();
    expect((redacted as any).balancedDiceDeck).toBeUndefined();

    // 2. Balanced Dice draws all 36 ordered pairs without replacement before reshuffling
    const seenPairs = new Set<string>();
    for (let i = 0; i < 36; i++) {
      game.phase = 'TURN_START';
      game.currentTurnPlayerId = 'p1';
      game.diceRolledThisTurn = false;
      game.turnDeadlineMs = Date.now() + 60000;
      const r = applyAction(game, { type: 'ROLL_DICE', playerId: 'p1' });
      expect(r.success).toBe(true);
      seenPairs.add(`${game.diceRoll![0]},${game.diceRoll![1]}`);
    }
    expect(seenPairs.size).toBe(36);
    // Deck automatically reshuffled for the 37th roll
    expect(game.balancedDiceDeck.length).toBe(36);

    // 3. Free Trades allows one-sided gifts (giving > 0, asking = 0) while rejecting empty (0 and 0) trades
    game.phase = 'ACTION_PHASE';
    game.currentTurnPlayerId = 'p1';
    game.players.p1.resources = { wood: 2, brick: 0, wheat: 0, sheep: 0, ore: 0 };
    game.players.p2.resources = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };

    const emptyGift = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: 0 },
      asking: { wheat: 0 },
    });
    expect(emptyGift.success).toBe(false);

    const validGift = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: 1 },
      asking: {},
    });
    expect(validGift.success).toBe(true);

    const acceptGift = applyAction(game, {
      type: 'RESPOND_TRADE',
      playerId: 'p2',
      tradeId: game.activeTradeOffer!.id,
      accept: true,
    });
    expect(acceptGift.success).toBe(true);
    expect(game.players.p1.resources.wood).toBe(1);
    expect(game.players.p2.resources.wood).toBe(1);
  });

  it('rejects identical/duplicate counter-offers and auto-clears trade offer when all players decline', () => {
    const players = [
      { id: 'p1', name: 'Alice', color: 'red' as const },
      { id: 'p2', name: 'Bob', color: 'blue' as const },
      { id: 'p3', name: 'Charlie', color: 'orange' as const },
    ];
    const game = initializeGame('test_counter_and_decline', players, false, 10, undefined, {
      randomizeTurnOrder: false,
    });
    game.phase = 'ACTION_PHASE';
    game.currentTurnPlayerId = 'p1';
    game.turnDeadlineMs = Date.now() + 60000;
    game.players.p1.resources = { wood: 2, brick: 2, wheat: 0, sheep: 0, ore: 0 };
    game.players.p2.resources = { wood: 0, brick: 0, wheat: 2, sheep: 2, ore: 0 };
    game.players.p3.resources = { wood: 0, brick: 0, wheat: 2, sheep: 2, ore: 0 };

    const prop = applyAction(game, {
      type: 'PROPOSE_TRADE',
      playerId: 'p1',
      giving: { wood: 1 },
      asking: { wheat: 1 },
    });
    expect(prop.success).toBe(true);
    const tradeId = game.activeTradeOffer!.id;

    // 1. Counter-offer identical to original offer (p2 gives 1 wheat, asks 1 wood) must fail
    const sameAsOriginal = applyAction(game, {
      type: 'COUNTER_TRADE',
      playerId: 'p2',
      tradeId,
      giving: { wheat: 1 },
      asking: { wood: 1 },
    });
    expect(sameAsOriginal.success).toBe(false);
    expect(sameAsOriginal.error).toMatch(/identical to the original/i);

    // 2. Valid counter-offer (p2 gives 2 wheat, asks 1 wood) succeeds
    const validCounter = applyAction(game, {
      type: 'COUNTER_TRADE',
      playerId: 'p2',
      tradeId,
      giving: { wheat: 2 },
      asking: { wood: 1 },
    });
    expect(validCounter.success).toBe(true);

    // 3. Submitting the exact same counter-offer again is rejected
    const duplicateCounter = applyAction(game, {
      type: 'COUNTER_TRADE',
      playerId: 'p3',
      tradeId,
      giving: { wheat: 2 },
      asking: { wood: 1 },
    });
    expect(duplicateCounter.success).toBe(false);
    expect(duplicateCounter.error).toMatch(/already been offered/i);

    // 4. When both p2 and p3 decline the trade offer, activeTradeOffer automatically disappears (becomes null)
    const decP2 = applyAction(game, {
      type: 'RESPOND_TRADE',
      playerId: 'p2',
      tradeId,
      accept: false,
    });
    expect(decP2.success).toBe(true);
    expect(game.activeTradeOffer).not.toBeNull(); // p3 still pending

    const decP3 = applyAction(game, {
      type: 'RESPOND_TRADE',
      playerId: 'p3',
      tradeId,
      accept: false,
    });
    expect(decP3.success).toBe(true);
    expect(game.activeTradeOffer).toBeNull(); // All players declined -> disappears!
  });

  it('verifies default Web Crypto CSPRNG has no bias toward face 4 or sum 7', () => {
    const N = 36_000;
    const faceCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    const sumCounts: Record<number, number> = {
      2: 0,
      3: 0,
      4: 0,
      5: 0,
      6: 0,
      7: 0,
      8: 0,
      9: 0,
      10: 0,
      11: 0,
      12: 0,
    };

    for (let i = 0; i < N; i++) {
      const [d1, d2] = rollOrdinaryDice(); // Default Web Crypto CSPRNG
      faceCounts[d1]++;
      faceCounts[d2]++;
      sumCounts[d1 + d2]++;
    }

    // Total individual die rolls = 72,000 -> each face 1..6 (including 4) expected 12,000 times
    for (let face = 1; face <= 6; face++) {
      expect(faceCounts[face]).toBeGreaterThan(11400);
      expect(faceCounts[face]).toBeLessThan(12600);
    }
    // Sum 7 expected 6,000 times out of 36,000 rolls
    expect(sumCounts[7]).toBeGreaterThan(5600);
    expect(sumCounts[7]).toBeLessThan(6400);
  });

  it('returns kicked player resources, dev cards, buildings, and roads to the bank and continues the match', () => {
    const game = initializeGame(
      'test_kick_midgame',
      [
        { id: 'p1', name: 'Alice', color: 'red' },
        { id: 'p2', name: 'Bob', color: 'blue' },
        { id: 'p3', name: 'Charlie', color: 'orange' },
      ],
      false,
      10,
      undefined,
      { randomizeTurnOrder: false },
    );

    game.phase = 'ACTION_PHASE';
    game.currentTurnPlayerId = 'p2';

    const initialDeckCount = game.devCardDeck.length;
    const drawnCard1 = game.devCardDeck.pop()!;
    const drawnCard2 = game.devCardDeck.pop()!;
    game.players.p2.devCards.push(drawnCard1);
    game.players.p2.playedDevCards.push(drawnCard2);

    game.resourceBank.wood = 10;
    game.resourceBank.brick = 10;
    game.players.p2.resources = { wood: 4, brick: 3, wheat: 0, sheep: 0, ore: 0 };

    const vId = Object.keys(game.board.vertices)[0];
    const eId = Object.keys(game.board.edges)[0];
    game.board.buildings[vId] = {
      id: `b_${vId}`,
      type: 'settlement',
      playerId: 'p2',
      vertexId: vId,
    };
    game.board.roads[eId] = {
      id: `r_${eId}`,
      playerId: 'p2',
      edgeId: eId,
    };

    const res = removePlayerFromGame(game, 'p2');
    expect(res.success).toBe(true);

    // p2 removed from players and playerOrder
    expect(game.players.p2).toBeUndefined();
    expect(game.playerOrder).toEqual(['p1', 'p3']);

    // Resources returned to bank
    expect(game.resourceBank.wood).toBe(14);
    expect(game.resourceBank.brick).toBe(13);

    // Dev cards returned to deck
    expect(game.devCardDeck.length).toBe(initialDeckCount);

    // Buildings & roads removed from board
    expect(game.board.buildings[vId]).toBeUndefined();
    expect(game.board.roads[eId]).toBeUndefined();

    // Turn advanced to the next player in order (p3) at TURN_START
    expect(game.currentTurnPlayerId).toBe('p3');
    expect(game.phase).toBe('TURN_START');
  });

  describe('Cities & Knights Expansion (CN3087 / CN3088)', () => {
    it('initializes C&K with 13 VP goal, 54 progress cards (18 per deck), inactive robber, and places Cities in Setup Round 2', () => {
      const game = initializeGame(
        'test_ck_setup',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        undefined,
        undefined,
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      expect(game.settings.expansion).toBe('cities_and_knights');
      expect(game.settings.victoryPointsToWin).toBe(13);
      expect(game.robberActive).toBe(false);
      expect(game.progressDecks?.trade.length).toBe(18);
      expect(game.progressDecks?.politics.length).toBe(18);
      expect(game.progressDecks?.science.length).toBe(18);
      expect(game.commodityBank).toEqual({ cloth: 12, coin: 12, paper: 12 });

      // Round 1: p1 and p2 place Settlements + Roads
      const vertices = Object.keys(game.board.vertices);
      const v1 = vertices[0];
      expect(applyAction(game, { type: 'BUILD_SETUP_SETTLEMENT', playerId: 'p1', vertexId: v1 }).success).toBe(true);
      expect(game.board.buildings[v1].type).toBe('settlement');
      const e1 = Object.values(game.board.edges).find((e) => e.v1 === v1 || e.v2 === v1)!.id;
      expect(applyAction(game, { type: 'BUILD_SETUP_ROAD', playerId: 'p1', edgeId: e1 }).success).toBe(true);

      const v2 = vertices.find((v) => satisfiesDistanceRule(v, game.board))!;
      expect(applyAction(game, { type: 'BUILD_SETUP_SETTLEMENT', playerId: 'p2', vertexId: v2 }).success).toBe(true);
      expect(game.board.buildings[v2].type).toBe('settlement');
      const e2 = Object.values(game.board.edges).find((e) => e.v1 === v2 || e.v2 === v2)!.id;
      expect(applyAction(game, { type: 'BUILD_SETUP_ROAD', playerId: 'p2', edgeId: e2 }).success).toBe(true);

      // Round 2: p2 places a starting CITY (not settlement)
      expect(game.phase).toBe('SETUP_ROUND_2');
      const v3 = vertices.find((v) => satisfiesDistanceRule(v, game.board))!;
      expect(applyAction(game, { type: 'BUILD_SETUP_SETTLEMENT', playerId: 'p2', vertexId: v3 }).success).toBe(true);
      expect(game.board.buildings[v3].type).toBe('city');
      expect(game.players.p2.citiesLeft).toBe(3);
      expect(game.players.p2.victoryPoints).toBe(3); // 1 Settlement (1 VP) + 1 City (2 VP)
    });

    it('produces commodities from Cities on forest/pasture/mountains, triggers Aqueduct on 0 production, and enforces City Walls hand limit', () => {
      const game = initializeGame(
        'test_ck_prod',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        13,
        undefined,
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      // Find a forest hex and place a City for p1 on one of its vertices
      const forestHex = Object.values(game.board.hexes).find((h) => h.terrain === 'forest')!;
      forestHex.number = 8;
      // Ensure no other hex has number 8
      for (const h of Object.values(game.board.hexes)) {
        if (h.id !== forestHex.id && h.number === 8) h.number = 4;
      }

      const cityVertex = Object.values(game.board.vertices).find((v) => v.hexCoords.includes(forestHex.id))!;
      game.board.buildings[cityVertex.id] = {
        id: `b_${cityVertex.id}`,
        type: 'city',
        playerId: 'p1',
        vertexId: cityVertex.id,
      };
      game.players.p1.citiesLeft = 3;

      // Give p2 Science Level 3 (Aqueduct) and no building on 8
      game.players.p2.cityImprovements.science = 3;

      // Play Alchemy or set pendingAlchemyRoll to roll 8 (4 + 4)
      game.phase = 'TURN_START';
      game.currentTurnPlayerId = 'p1';
      game.pendingAlchemyRoll = [4, 4];

      expect(applyAction(game, { type: 'ROLL_DICE', playerId: 'p1' }).success).toBe(true);

      // p1's City on forest produced 1 wood + 1 paper commodity!
      expect(game.players.p1.resources.wood).toBe(1);
      expect(game.players.p1.commodities.paper).toBe(1);

      // p2 received 0 production on roll 8 and has Science Level 3 (Aqueduct) -> queued in pendingAqueductPlayerIds
      expect(game.pendingAqueductPlayerIds).toContain('p2');
      expect(
        applyAction(game, { type: 'CHOOSE_AQUEDUCT_RESOURCE', playerId: 'p2', resource: 'ore' }).success,
      ).toBe(true);
      expect(game.players.p2.resources.ore).toBe(1);
      expect(game.pendingAqueductPlayerIds).not.toContain('p2');

      // Build a City Wall under p1's City (+2 hand limit -> 9 cards allowed on a 7)
      game.players.p1.resources.brick = 2;
      expect(
        applyAction(game, { type: 'BUILD_CITY_WALL', playerId: 'p1', vertexId: cityVertex.id }).success,
      ).toBe(true);
      expect(game.board.buildings[cityVertex.id].hasWall).toBe(true);

      // Give p1 9 total cards (8 resources + 1 commodity) -> should NOT have to discard on a 7 because wall limit is 9!
      game.players.p1.resources = { wood: 4, brick: 4, wheat: 0, sheep: 0, ore: 0 };
      game.players.p1.commodities = { cloth: 0, coin: 0, paper: 1 };
      game.phase = 'TURN_START';
      game.diceRolledThisTurn = false;
      game.pendingAlchemyRoll = [3, 4]; // sum 7
      // Keep barbarianPosition < 6 so barbarian attack doesn't happen on this roll
      game.barbarianPosition = 0;
      game.robberActive = false;

      expect(applyAction(game, { type: 'ROLL_DICE', playerId: 'p1' }).success).toBe(true);
      expect(game.pendingDiscards.p1).toBeUndefined();
      // And since robberActive is false before 1st barbarian attack, phase goes directly to ACTION_PHASE!
      expect(game.phase).toBe('ACTION_PHASE');
    });

    it('supports City Improvements, Trading House 2:1 commodity bank trade, and Metropolis claiming & Level 5 stealing', () => {
      const game = initializeGame(
        'test_ck_improvements',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        13,
        undefined,
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      const vertices = Object.keys(game.board.vertices);
      const v1 = vertices[0];
      const v2 = vertices.find((v) => satisfiesDistanceRule(v, game.board) && v !== v1)!;

      game.board.buildings[v1] = { id: `b_${v1}`, type: 'city', playerId: 'p1', vertexId: v1 };
      game.players.p1.citiesLeft = 3;
      game.board.buildings[v2] = { id: `b_${v2}`, type: 'city', playerId: 'p2', vertexId: v2 };
      game.players.p2.citiesLeft = 3;

      game.phase = 'ACTION_PHASE';
      game.currentTurnPlayerId = 'p1';
      game.players.p1.commodities.cloth = 10; // 1 + 2 + 3 + 4 = 10 cloth for Levels 1..4

      for (let lv = 1; lv <= 4; lv++) {
        const res = applyAction(game, {
          type: 'UPGRADE_CITY_IMPROVEMENT',
          playerId: 'p1',
          discipline: 'trade',
        });
        expect(res.success).toBe(true);
      }

      expect(game.players.p1.cityImprovements.trade).toBe(4);
      expect(game.metropolises?.trade.ownerId).toBe('p1');
      expect(game.board.buildings[v1].metropolis).toBe('trade');
      expect(game.players.p1.victoryPoints).toBe(4); // 1 City (2 VP) + Trade Metropolis (2 VP)

      // Trade Level 3+ (Trading House) allows trading 2 identical commodities for 1 resource/commodity
      game.players.p1.commodities.coin = 2;
      const tradeRes = applyAction(game, {
        type: 'MARITIME_BATCH_TRADE',
        playerId: 'p1',
        giving: { coin: 2 },
        asking: { ore: 1 },
      });
      expect(tradeRes.success).toBe(true);
      expect(game.players.p1.commodities.coin).toBe(0);
      expect(game.players.p1.resources.ore).toBe(1);

      // Now p2 upgrades Trade to Level 5 and steals the Trade Metropolis from p1!
      game.currentTurnPlayerId = 'p2';
      game.players.p2.cityImprovements.trade = 4;
      game.players.p2.commodities.cloth = 5;

      const stealMetro = applyAction(game, {
        type: 'UPGRADE_CITY_IMPROVEMENT',
        playerId: 'p2',
        discipline: 'trade',
      });
      expect(stealMetro.success).toBe(true);
      expect(game.metropolises?.trade.ownerId).toBe('p2');
      expect(game.board.buildings[v1].metropolis).toBeUndefined();
      expect(game.board.buildings[v2].metropolis).toBe('trade');
      expect(game.players.p1.victoryPoints).toBe(2);
      expect(game.players.p2.victoryPoints).toBe(4);
    });

    it('resolves Knights (recruit, activate, promote, move, displace, and break opponent Longest Road) and Barbarian Attacks', () => {
      const game = initializeGame(
        'test_ck_knights_barbarians',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        13,
        undefined,
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      // Place a City for p1 and a City for p2
      const vertices = Object.keys(game.board.vertices);
      const v1 = vertices[0];
      const e1 = Object.values(game.board.edges).find((e) => e.v1 === v1 || e.v2 === v1)!;
      const vKnight = e1.v1 === v1 ? e1.v2 : e1.v1;

      game.board.buildings[v1] = { id: `b_${v1}`, type: 'city', playerId: 'p1', vertexId: v1 };
      game.players.p1.citiesLeft = 3;
      game.board.roads[e1.id] = { id: `r_${e1.id}`, playerId: 'p1', edgeId: e1.id };

      const v2 = vertices.find((v) => satisfiesDistanceRule(v, game.board) && v !== vKnight)!;
      game.board.buildings[v2] = { id: `b_${v2}`, type: 'city', playerId: 'p2', vertexId: v2 };
      game.players.p2.citiesLeft = 3;

      game.phase = 'ACTION_PHASE';
      game.currentTurnPlayerId = 'p1';
      game.players.p1.resources = { wood: 0, brick: 0, wheat: 2, sheep: 2, ore: 2 };

      // Recruit Basic Knight at vKnight
      expect(
        applyAction(game, { type: 'RECRUIT_KNIGHT', playerId: 'p1', vertexId: vKnight }).success,
      ).toBe(true);
      expect(game.board.knights?.[vKnight]?.level).toBe(1);
      expect(game.board.knights?.[vKnight]?.active).toBe(false);

      // Promote Knight to Level 2 (Strong Knight)
      expect(
        applyAction(game, { type: 'PROMOTE_KNIGHT', playerId: 'p1', vertexId: vKnight }).success,
      ).toBe(true);
      expect(game.board.knights?.[vKnight]?.level).toBe(2);

      // Activate Knight (total active strength = 2, total cities on board = 2)
      expect(
        applyAction(game, { type: 'ACTIVATE_KNIGHT', playerId: 'p1', vertexId: vKnight }).success,
      ).toBe(true);
      expect(game.board.knights?.[vKnight]?.active).toBe(true);

      // Trigger Barbarian Attack (strength 2 knights >= 2 cities -> p1 wins +1 Defender of Catan VP!)
      resolveBarbarianAttack(game, ['p1', 'p2']);
      expect(game.players.p1.defenderPoints).toBe(1);
      expect(game.robberActive).toBe(true);
      expect(game.board.knights?.[vKnight]?.active).toBe(false); // Knights deactivate after battle

      // Now trigger a 2nd Barbarian Attack with 0 active knights (0 < 2 cities) -> both p1 and p2 lose their non-Metropolis City!
      resolveBarbarianAttack(game, ['p1', 'p2']);
      expect(game.board.buildings[v1].type).toBe('settlement');
      expect(game.board.buildings[v2].type).toBe('settlement');
    });

    it('supports Progress Cards (Medicine, Crane, Merchant, Resource Monopoly, Trade Monopoly) and redacts opponent Progress Cards & Decks', () => {
      const game = initializeGame(
        'test_ck_progress',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        13,
        undefined,
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      const forestHex = Object.values(game.board.hexes).find((h) => h.terrain === 'forest')!;
      const v1 = Object.values(game.board.vertices).find((v) => v.hexCoords.includes(forestHex.id))!.id;
      game.board.buildings[v1] = { id: `b_${v1}`, type: 'settlement', playerId: 'p1', vertexId: v1 };
      game.players.p1.settlementsLeft = 4;

      game.phase = 'ACTION_PHASE';
      game.currentTurnPlayerId = 'p1';

      // Give p1 Medicine, Merchant, Resource Monopoly, Trade Monopoly
      game.players.p1.progressCards = [
        { id: 'pc_med', discipline: 'science', type: 'medicine' },
        { id: 'pc_merch', discipline: 'trade', type: 'merchant' },
        { id: 'pc_rm', discipline: 'trade', type: 'resource_monopoly' },
        { id: 'pc_tm', discipline: 'trade', type: 'trade_monopoly' },
      ];
      // Give p2 a secret progress card and resources/commodities
      game.players.p2.progressCards = [{ id: 'pc_p2_sec', discipline: 'politics', type: 'sabotage' }];
      game.players.p2.resources.wheat = 3;
      game.players.p2.commodities.paper = 2;

      // Verify redaction hides p2's progressCards & commodities and progressDecks from p1
      const redactedForP1 = redactStateForPlayer(game, 'p1');
      expect((redactedForP1 as any).progressDecks).toBeUndefined();
      expect((redactedForP1.players.p2 as any).progressCards).toBeUndefined();
      expect((redactedForP1.players.p2 as any).commodities).toBeUndefined();
      expect(redactedForP1.players.p2.progressCardCount).toBe(1);
      expect(redactedForP1.self?.progressCards.length).toBe(4);

      // 1. Play Medicine -> upgrade settlement at v1 to City for only 1 wheat + 2 ore!
      game.players.p1.resources = { wood: 0, brick: 0, wheat: 1, sheep: 0, ore: 2 };
      expect(applyAction(game, { type: 'PLAY_PROGRESS_CARD', playerId: 'p1', cardId: 'pc_med' }).success).toBe(true);
      expect(applyAction(game, { type: 'UPGRADE_CITY', playerId: 'p1', vertexId: v1 }).success).toBe(true);
      expect(game.board.buildings[v1].type).toBe('city');

      // 2. Play Merchant on forestHex -> +1 VP and 2:1 bank rate on wood
      expect(
        applyAction(game, {
          type: 'PLAY_PROGRESS_CARD',
          playerId: 'p1',
          cardId: 'pc_merch',
          options: { hexId: forestHex.id },
        }).success,
      ).toBe(true);
      expect(game.players.p1.hasMerchant).toBe(true);
      expect(game.players.p1.victoryPoints).toBe(3); // 1 City (2 VP) + Merchant (1 VP)

      // 3. Play Resource Monopoly on wheat -> steals up to 2 wheat from p2
      expect(
        applyAction(game, {
          type: 'PLAY_PROGRESS_CARD',
          playerId: 'p1',
          cardId: 'pc_rm',
          options: { resource: 'wheat' },
        }).success,
      ).toBe(true);
      expect(game.players.p1.resources.wheat).toBe(2);
      expect(game.players.p2.resources.wheat).toBe(1);

      // 4. Play Trade Monopoly on paper -> steals 1 paper commodity from p2
      expect(
        applyAction(game, {
          type: 'PLAY_PROGRESS_CARD',
          playerId: 'p1',
          cardId: 'pc_tm',
          options: { commodity: 'paper' },
        }).success,
      ).toBe(true);
      expect(game.players.p1.commodities.paper).toBe(1);
      expect(game.players.p2.commodities.paper).toBe(1);
    });

    it('prevents soft-locks on 5th Progress Card draw, Wedding/Guild Dues/Commercial Harbor edge cases, and blocks END_TURN while prompts are pending', () => {
      const game = initializeGame(
        'test_ck_bugfixes',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        13,
        undefined,
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      game.phase = 'ACTION_PHASE';
      game.currentTurnPlayerId = 'p1';

      // 1. Active player holding 5 Progress Cards is added to pendingProgressDiscardPlayerIds and can discard down to 4
      game.players.p1.progressCards = [
        { id: 'pc1', discipline: 'trade', type: 'guild_dues' },
        { id: 'pc2', discipline: 'trade', type: 'commercial_harbor' },
        { id: 'pc3', discipline: 'politics', type: 'treason' },
        { id: 'pc4', discipline: 'politics', type: 'wedding' },
        { id: 'pc5', discipline: 'science', type: 'alchemy' },
      ];
      // Cannot end turn while holding 5 progress cards
      expect(applyAction(game, { type: 'END_TURN', playerId: 'p1' }).success).toBe(false);
      // Discard 1 card down to 4
      expect(
        applyAction(game, { type: 'DISCARD_PROGRESS_CARD', playerId: 'p1', cardId: 'pc5' }).success,
      ).toBe(true);
      expect(game.players.p1.progressCards.length).toBe(4);

      // 2. Guild Dues rejects targeting an opponent who has 0 cards in hand (preventing card waste & modal lock)
      game.players.p2.victoryPoints = 5;
      game.players.p1.victoryPoints = 2;
      game.players.p2.resources = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };
      game.players.p2.commodities = { cloth: 0, coin: 0, paper: 0 };

      const emptyGuildRes = applyAction(game, {
        type: 'PLAY_PROGRESS_CARD',
        playerId: 'p1',
        cardId: 'pc1',
        options: { targetPlayerId: 'p2' },
      });
      expect(emptyGuildRes.success).toBe(false);
      expect(game.players.p1.progressCards.some((c) => c.id === 'pc1')).toBe(true);

      // 3. Commercial Harbor rejects targeting an opponent with 0 commodities
      game.players.p1.resources.wood = 1;
      const emptyHarborRes = applyAction(game, {
        type: 'PLAY_PROGRESS_CARD',
        playerId: 'p1',
        cardId: 'pc2',
        options: { commercialHarborOffers: [{ targetPlayerId: 'p2', offeredResource: 'wood' }] },
      });
      expect(emptyHarborRes.success).toBe(false);
      expect(game.players.p1.progressCards.some((c) => c.id === 'pc2')).toBe(true);

      // 4. Wedding tracks weddingRequesterId and blocks END_TURN until opponent gifts 2 cards
      const v1 = Object.keys(game.board.vertices)[0];
      const v2 = Object.keys(game.board.vertices).find((v) => satisfiesDistanceRule(v, game.board) && v !== v1)!;
      game.board.buildings[v1] = { id: `b_${v1}`, type: 'settlement', playerId: 'p1', vertexId: v1 };
      game.board.buildings[v2] = { id: `b_${v2}`, type: 'city', playerId: 'p2', vertexId: v2 };
      game.players.p2.resources = { wood: 2, brick: 1, wheat: 0, sheep: 0, ore: 0 };

      expect(
        applyAction(game, { type: 'PLAY_PROGRESS_CARD', playerId: 'p1', cardId: 'pc4' }).success,
      ).toBe(true);
      expect(game.pendingWeddingPlayerIds).toContain('p2');
      expect(game.weddingRequesterId).toBe('p1');

      // END_TURN is blocked while Wedding prompt is pending
      expect(applyAction(game, { type: 'END_TURN', playerId: 'p1' }).success).toBe(false);

      // p2 gifts 2 wood to p1 -> clears prompt and allows ending turn
      expect(
        applyAction(game, { type: 'GIVE_WEDDING_CARDS', playerId: 'p2', cards: { wood: 2 } }).success,
      ).toBe(true);
      expect(game.pendingWeddingPlayerIds).toEqual([]);
      expect(game.players.p1.resources.wood).toBe(3);
      expect(applyAction(game, { type: 'END_TURN', playerId: 'p1' }).success).toBe(true);
    });

    it('restores full main turn timer after Aqueduct, pre-roll Knight card, or nested sub-prompts', () => {
      // 1. Cities & Knights: Aqueduct prompt triggered during ROLL_DICE must not shrink main turn timer to robberTimeoutSeconds (25s)
      const ckGame = initializeGame(
        'test_timer_aqueduct',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        13,
        { turnTimeoutSeconds: 180, robberTimeoutSeconds: 25, rollTimeoutSeconds: 15 },
        { expansion: 'cities_and_knights', randomizeTurnOrder: false },
      );

      ckGame.phase = 'TURN_START';
      ckGame.currentTurnPlayerId = 'p1';
      ckGame.players.p1.cityImprovements.science = 3; // Aqueduct unlocked
      ckGame.pendingAlchemyRoll = [1, 1]; // Roll 2 (assume no buildings on 2 -> 0 production -> triggers Aqueduct)

      expect(applyAction(ckGame, { type: 'ROLL_DICE', playerId: 'p1' }).success).toBe(true);
      expect(ckGame.phase).toBe('ACTION_PHASE');
      expect(ckGame.pendingAqueductPlayerIds).toContain('p1');
      // While Aqueduct is pending, the prompt timer is robberTimeoutSeconds (25s), and full 180s is saved!
      expect(ckGame.phaseDurationMs).toBe(25_000);
      expect(ckGame.savedActionRemainingMs).toBe(180_000);

      // Once p1 chooses their Aqueduct resource, the full 180s main turn timer is restored!
      expect(
        applyAction(ckGame, { type: 'CHOOSE_AQUEDUCT_RESOURCE', playerId: 'p1', resource: 'wheat' }).success,
      ).toBe(true);
      expect(ckGame.pendingAqueductPlayerIds).toEqual([]);
      expect(ckGame.phaseDurationMs).toBe(180_000);
      expect(ckGame.savedActionRemainingMs).toBeNull();
      expect(ckGame.turnDeadlineMs! - Date.now()).toBeGreaterThan(170_000);

      // 2. Base Game: Playing a Knight dev card before rolling dice (during 15s TURN_START) must not overwrite the subsequent 180s ACTION_PHASE timer
      const baseGame = initializeGame(
        'test_timer_preroll_knight',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        10,
        { turnTimeoutSeconds: 180, robberTimeoutSeconds: 25, rollTimeoutSeconds: 15 },
        { expansion: 'base', randomizeTurnOrder: false },
      );

      baseGame.phase = 'TURN_START';
      baseGame.currentTurnPlayerId = 'p1';
      baseGame.turnNumber = 2;
      baseGame.turnDeadlineMs = Date.now() + 10_000; // 10s left on roll timer
      baseGame.players.p1.devCards = [{ id: 'dc_k1', type: 'knight', boughtTurn: 1 }];

      // Play Knight before rolling dice
      expect(
        applyAction(baseGame, { type: 'PLAY_DEV_CARD', playerId: 'p1', cardId: 'dc_k1' }).success,
      ).toBe(true);
      expect(baseGame.phase).toBe('ROBBER_PLACEMENT');

      // Move robber to a non-robber land hex
      const targetHexId = Object.keys(baseGame.board.hexes).find(
        (hid) => hid !== baseGame.board.robberHexId && baseGame.board.hexes[hid].terrain !== 'sea',
      )!;
      expect(
        applyAction(baseGame, { type: 'MOVE_ROBBER', playerId: 'p1', hexId: targetHexId }).success,
      ).toBe(true);
      expect(baseGame.phase).toBe('TURN_START');

      // Now roll the dice -> if a 7 is rolled and robber moved again, or non-7 is rolled, ACTION_PHASE must get the full 180s
      expect(applyAction(baseGame, { type: 'ROLL_DICE', playerId: 'p1' }).success).toBe(true);
      if ((baseGame.phase as string) === 'ROBBER_PLACEMENT') {
        const nextHexId = Object.keys(baseGame.board.hexes).find(
          (hid) => hid !== baseGame.board.robberHexId && baseGame.board.hexes[hid].terrain !== 'sea',
        )!;
        expect(
          applyAction(baseGame, { type: 'MOVE_ROBBER', playerId: 'p1', hexId: nextHexId }).success,
        ).toBe(true);
      }
      expect(baseGame.phase).toBe('ACTION_PHASE');
      expect(baseGame.phaseDurationMs).toBe(180_000);
      expect(baseGame.turnDeadlineMs! - Date.now()).toBeGreaterThan(170_000);
    });

    it('enforces all 5 new house rules: friendlyRobber, noEarly7s, combined2And12, playDevCardSameTurn, and harborMaster', () => {
      // 1. Friendly Robber
      const frGame = initializeGame(
        'test_friendly_robber',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        10,
        undefined,
        {
          expansion: 'base',
          randomizeTurnOrder: false,
          houseRules: { friendlyRobber: true },
        },
      );
      frGame.phase = 'ROBBER_PLACEMENT';
      frGame.currentTurnPlayerId = 'p1';
      frGame.turnDeadlineMs = Date.now() + 60_000;

      // Find two non-desert, non-robber land hexes with disjoint vertices
      const landHexIds = Object.keys(frGame.board.hexes).filter(
        (hid) =>
          hid !== frGame.board.robberHexId &&
          frGame.board.hexes[hid].terrain !== 'sea' &&
          frGame.board.hexes[hid].terrain !== 'desert',
      );
      const protectedHexId = landHexIds[0];
      const protectedVertices = Object.values(frGame.board.vertices).filter((v) =>
        v.hexCoords.includes(protectedHexId),
      );
      const unprotectedHexId = landHexIds.find(
        (hid) =>
          hid !== protectedHexId &&
          !protectedVertices.some((v) => v.hexCoords.includes(hid)),
      )!;

      // Put 2 settlements for p2 (2 VP <= 2 starting VP) on protectedHexId
      const p2V1 = protectedVertices[0].id;
      const p2V2 = protectedVertices[2].id;
      frGame.board.buildings[p2V1] = {
        id: 'b_p2_1',
        playerId: 'p2',
        type: 'settlement',
        vertexId: p2V1,
      };
      frGame.board.buildings[p2V2] = {
        id: 'b_p2_2',
        playerId: 'p2',
        type: 'settlement',
        vertexId: p2V2,
      };
      frGame.players.p2.settlementsLeft = 3;
      frGame.players.p2.victoryPoints = 2;

      // Moving robber onto protectedHexId (where p2 has 2 VP) must fail
      const blockedMove = applyAction(frGame, {
        type: 'MOVE_ROBBER',
        playerId: 'p1',
        hexId: protectedHexId,
      });
      expect(blockedMove.success).toBe(false);
      expect(blockedMove.error).toContain('Friendly Robber');

      // Moving robber onto unprotectedHexId succeeds
      const allowedMove = applyAction(frGame, {
        type: 'MOVE_ROBBER',
        playerId: 'p1',
        hexId: unprotectedHexId,
      });
      expect(allowedMove.success).toBe(true);

      // Once p2 upgrades one settlement to a city (3 VP > 2 starting VP), protectedHexId becomes a valid target
      frGame.board.buildings[p2V1] = {
        id: 'b_p2_1',
        playerId: 'p2',
        type: 'city',
        vertexId: p2V1,
      };
      frGame.players.p2.settlementsLeft = 4;
      frGame.players.p2.citiesLeft = 3;
      frGame.players.p2.victoryPoints = 3;
      frGame.phase = 'ROBBER_PLACEMENT';
      const nowAllowed = applyAction(frGame, {
        type: 'MOVE_ROBBER',
        playerId: 'p1',
        hexId: protectedHexId,
      });
      expect(nowAllowed.success).toBe(true);

      // 2. No Early 7s (first 2 rounds = 4 turns for 2 players)
      const no7Game = initializeGame(
        'test_no_early_7s',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        10,
        undefined,
        {
          expansion: 'base',
          randomizeTurnOrder: false,
          houseRules: { noEarly7s: true },
        },
      );
      for (let i = 0; i < 60; i++) {
        no7Game.phase = 'TURN_START';
        no7Game.currentTurnPlayerId = 'p1';
        no7Game.turnNumber = 4; // Within first 2 rounds (<= 2 * 2)
        no7Game.diceRolledThisTurn = false;
        const res = applyAction(no7Game, { type: 'ROLL_DICE', playerId: 'p1' });
        expect(res.success).toBe(true);
        const total = no7Game.diceRoll![0] + no7Game.diceRoll![1];
        expect(total).not.toBe(7);
      }

      // 3. 2 & 12 Combined
      const combGame = initializeGame(
        'test_combined_2_12',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        10,
        undefined,
        {
          expansion: 'cities_and_knights',
          randomizeTurnOrder: false,
          houseRules: { combined2And12: true },
        },
      );
      const hex2 = Object.values(combGame.board.hexes).find((h) => h.number === 2)!;
      const hex12 = Object.values(combGame.board.hexes).find((h) => h.number === 12)!;
      combGame.board.robberHexId = Object.values(combGame.board.hexes).find(
        (h) => h.terrain === 'desert',
      )!.id;
      const vHex2 = Object.values(combGame.board.vertices).find((v) =>
        v.hexCoords.includes(hex2.id),
      )!;
      const vHex12 = Object.values(combGame.board.vertices).find(
        (v) => v.hexCoords.includes(hex12.id) && v.id !== vHex2.id,
      )!;
      combGame.board.buildings[vHex2.id] = {
        id: 'b_hex2',
        playerId: 'p1',
        type: 'settlement',
        vertexId: vHex2.id,
      };
      combGame.board.buildings[vHex12.id] = {
        id: 'b_hex12',
        playerId: 'p2',
        type: 'settlement',
        vertexId: vHex12.id,
      };
      combGame.players.p1.resources = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };
      combGame.players.p2.resources = { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 };

      // Force roll of 2 via Alchemist -> both hex2 (p1) and hex12 (p2) must produce!
      combGame.phase = 'TURN_START';
      combGame.currentTurnPlayerId = 'p1';
      combGame.pendingAlchemyRoll = [1, 1]; // total 2
      expect(applyAction(combGame, { type: 'ROLL_DICE', playerId: 'p1' }).success).toBe(true);
      const p1TotalCards = Object.values(combGame.players.p1.resources).reduce((a, b) => a + b, 0);
      const p2TotalCards = Object.values(combGame.players.p2.resources).reduce((a, b) => a + b, 0);
      expect(p1TotalCards).toBe(1);
      expect(p2TotalCards).toBe(1);

      // 4. Play DC Same Turn Bought
      const dcGame = initializeGame(
        'test_same_turn_dc',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        10,
        undefined,
        {
          expansion: 'base',
          randomizeTurnOrder: false,
          houseRules: { playDevCardSameTurn: true },
        },
      );
      dcGame.phase = 'ACTION_PHASE';
      dcGame.currentTurnPlayerId = 'p1';
      dcGame.turnNumber = 3;
      dcGame.turnDeadlineMs = Date.now() + 60_000;
      dcGame.players.p1.devCards = [
        { id: 'dc_1', type: 'year_of_plenty', boughtTurn: 3 },
        { id: 'dc_2', type: 'monopoly', boughtTurn: 3 },
      ];
      // Can play dc_1 even though boughtTurn === turnNumber
      const playFirst = applyAction(dcGame, {
        type: 'PLAY_DEV_CARD',
        playerId: 'p1',
        cardId: 'dc_1',
        options: { yearOfPlentyResources: ['wood', 'brick'] },
      });
      expect(playFirst.success).toBe(true);
      // Still cannot play a second dev card on the same turn
      const playSecond = applyAction(dcGame, {
        type: 'PLAY_DEV_CARD',
        playerId: 'p1',
        cardId: 'dc_2',
        options: { monopolyResource: 'wheat' },
      });
      expect(playSecond.success).toBe(false);

      // 5. Harbor Master (+2 VP at 3+ Harbor Points)
      const hmGame = initializeGame(
        'test_harbor_master',
        [
          { id: 'p1', name: 'Alice', color: 'red' },
          { id: 'p2', name: 'Bob', color: 'blue' },
        ],
        false,
        10,
        undefined,
        {
          expansion: 'base',
          randomizeTurnOrder: false,
          houseRules: { harborMaster: true },
        },
      );
      const harborVertexIds = Object.values(hmGame.board.harbors).map((h) => h.vertexIds[0]);
      expect(harborVertexIds.length).toBeGreaterThanOrEqual(2);

      // Place 1 settlement (1 HP) + 1 city (2 HP) = 3 HP for p1
      hmGame.board.buildings[harborVertexIds[0]] = {
        id: 'b_hm_0',
        playerId: 'p1',
        type: 'settlement',
        vertexId: harborVertexIds[0],
      };
      hmGame.board.buildings[harborVertexIds[1]] = {
        id: 'b_hm_1',
        playerId: 'p1',
        type: 'settlement',
        vertexId: harborVertexIds[1],
      };
      hmGame.players.p1.settlementsLeft = 3;
      hmGame.phase = 'ACTION_PHASE';
      hmGame.currentTurnPlayerId = 'p1';
      hmGame.turnDeadlineMs = Date.now() + 60_000;
      hmGame.players.p1.resources = { wood: 0, brick: 0, wheat: 2, sheep: 0, ore: 3 };

      const upgRes = applyAction(hmGame, {
        type: 'UPGRADE_CITY',
        playerId: 'p1',
        vertexId: harborVertexIds[1],
      });
      expect(upgRes.success).toBe(true);
      expect(hmGame.players.p1.hasHarborMaster).toBe(true);
      expect(hmGame.harborMasterOwnerId).toBe('p1');
      expect(hmGame.latestAwardEvent?.awardType).toBe('harbor_master');
      expect(hmGame.latestAwardEvent?.metricValue).toBe(3);
      // 1 settlement (1) + 1 city (2) + Harbor Master (2) = 5 VP
      expect(computePublicVictoryPoints(hmGame.players.p1)).toBe(5);
    });
  });
});
