import { describe, it, expect } from 'vitest';
import {
  initializeGame,
  satisfiesDistanceRule,
  redactStateForPlayer,
  rollOrdinaryDice,
  THEORETICAL_TWO_DICE_COUNTS,
} from './engine.js';
import { applyAction, handleTurnTimeout, removePlayerFromGame } from './actions.js';
import { calculatePlayerLongestRoute } from './longestRoute.js';
import { generateBoard, hasAdjacentRedNumbers } from '../board/generator.js';

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

  it('guarantees zero adjacent 6/8 red tokens across 50 base and 50 expanded boards (Bug #9 & #20)', () => {
    for (let i = 0; i < 50; i++) {
      const baseBoard = generateBoard(false);
      expect(Object.keys(baseBoard.hexes).length).toBe(19);
      expect(hasAdjacentRedNumbers(baseBoard.hexes)).toBe(false);

      const expandedBoard = generateBoard(true);
      expect(Object.keys(expandedBoard.hexes).length).toBe(30);
      expect(hasAdjacentRedNumbers(expandedBoard.hexes)).toBe(false);
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
});
