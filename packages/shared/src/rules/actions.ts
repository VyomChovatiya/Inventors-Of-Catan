import {
  BoardState,
  GameState,
  ResourceCount,
  ResourceType,
  TradeOffer,
  CounterOffer,
} from '../types/index.js';
import {
  BUILDING_COSTS,
  VALID_RESOURCES,
  canAfford,
  deductCost,
  addResources,
  isValidResourcePayload,
  isValidResourceType,
  sumResources,
} from './costs.js';
import {
  satisfiesDistanceRule,
  syncPlayerVPs,
  getPairedPlayerId,
  getOrderedPlayerIds,
  refreshTurnTimer,
  pauseNormalTurnTimer,
  resumeNormalTurnTimer,
  isValidRoadEdge,
  isValidSettlementVertex,
  rollOrdinaryDice,
  drawBalancedDiceRoll,
} from './engine.js';
import { updateLongestRouteOwner } from './longestRoute.js';
import { cryptoRandomInt } from '../board/generator.js';

export type GameAction =
  | { type: 'BUILD_SETUP_SETTLEMENT'; playerId: string; vertexId: string }
  | { type: 'BUILD_SETUP_ROAD'; playerId: string; edgeId: string }
  | { type: 'ROLL_DICE'; playerId: string }
  | { type: 'DISCARD_CARDS'; playerId: string; resources: Partial<ResourceCount> }
  | { type: 'MOVE_ROBBER'; playerId: string; hexId: string }
  | { type: 'STEAL_FROM_PLAYER'; playerId: string; targetPlayerId: string }
  | { type: 'BUILD_ROAD'; playerId: string; edgeId: string }
  | { type: 'BUILD_SETTLEMENT'; playerId: string; vertexId: string }
  | { type: 'UPGRADE_CITY'; playerId: string; vertexId: string }
  | { type: 'BUY_DEV_CARD'; playerId: string }
  | {
      type: 'PLAY_DEV_CARD';
      playerId: string;
      cardId: string;
      options?: {
        hexId?: string;
        targetPlayerId?: string;
        freeRoadEdges?: [string, string];
        yearOfPlentyResources?: [ResourceType, ResourceType];
        monopolyResource?: ResourceType;
      };
    }
  | { type: 'MARITIME_TRADE'; playerId: string; giving: ResourceType; asking: ResourceType; ratio: number }
  | {
      type: 'MARITIME_BATCH_TRADE';
      playerId: string;
      giving: Partial<ResourceCount>;
      asking: Partial<ResourceCount>;
    }
  | {
      type: 'PROPOSE_TRADE';
      playerId: string;
      giving: Partial<ResourceCount>;
      asking: Partial<ResourceCount>;
      targetPlayerId?: string;
    }
  | { type: 'RESPOND_TRADE'; playerId: string; tradeId: string; accept: boolean }
  | {
      type: 'COUNTER_TRADE';
      playerId: string;
      tradeId: string;
      giving: Partial<ResourceCount>;
      asking: Partial<ResourceCount>;
    }
  | { type: 'ACCEPT_COUNTER_TRADE'; playerId: string; tradeId: string; counterId: string }
  | { type: 'CANCEL_TRADE'; playerId: string; tradeId: string }
  | { type: 'END_TURN'; playerId: string };

export interface ActionResult {
  success: boolean;
  error?: string;
  stateChanged?: boolean;
}

function validateDomesticTradePayloads(
  giving: unknown,
  asking: unknown,
  freeTradesEnabled: boolean,
): { valid: true; cleanGiving: Partial<ResourceCount>; cleanAsking: Partial<ResourceCount> } | { valid: false; error: string } {
  if (!isValidResourcePayload(giving) || !isValidResourcePayload(asking)) {
    return { valid: false, error: 'Invalid resource quantities: must be non-negative integers for valid resources.' };
  }

  const totalGiving = sumResources(giving);
  const totalAsking = sumResources(asking);

  if (totalGiving <= 0 && totalAsking <= 0) {
    return { valid: false, error: 'Entirely empty trades are not allowed.' };
  }

  if (!freeTradesEnabled && (totalGiving <= 0 || totalAsking <= 0)) {
    return {
      valid: false,
      error: 'Free trades are disabled! Both sides must give at least 1 resource card.',
    };
  }

  for (const res of VALID_RESOURCES) {
    if ((giving[res] || 0) > 0 && (asking[res] || 0) > 0) {
      return {
        valid: false,
        error: `Cannot trade ${res} for ${res} in the same offer!`,
      };
    }
  }

  const cleanGiving: Partial<ResourceCount> = {};
  const cleanAsking: Partial<ResourceCount> = {};
  for (const res of VALID_RESOURCES) {
    if ((giving[res] || 0) > 0) cleanGiving[res] = giving[res];
    if ((asking[res] || 0) > 0) cleanAsking[res] = asking[res];
  }

  return { valid: true, cleanGiving, cleanAsking };
}

function evaluateAndNotifyLongestRoute(state: GameState) {
  const prevOwnerId = state.longestRouteOwnerId;
  const orderedPlayerIds = getOrderedPlayerIds(state);
  const { newOwnerId, playerLengths } = updateLongestRouteOwner(
    state.board,
    prevOwnerId,
    orderedPlayerIds,
  );
  state.longestRouteOwnerId = newOwnerId;
  for (const [pid, p] of Object.entries(state.players)) {
    p.longestRouteLength = playerLengths[pid] || 0;
    p.hasLongestRoute = pid === newOwnerId;
  }

  if (newOwnerId && newOwnerId !== prevOwnerId) {
    const newOwner = state.players[newOwnerId];
    const len = playerLengths[newOwnerId] || 5;
    state.latestAwardEvent = {
      id: `award_lr_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      awardType: 'longest_route',
      playerId: newOwner.id,
      playerName: newOwner.name,
      playerColor: newOwner.color,
      metricValue: len,
    };
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: newOwner.id,
      message: `🛣️ ${newOwner.name} claimed Longest Road (${len} connected roads, +2 VP)!`,
      category: 'build',
    });
  } else if (!newOwnerId && prevOwnerId) {
    const oldOwner = state.players[prevOwnerId];
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: prevOwnerId,
      message: `🛣️ ${oldOwner?.name || 'Player'}'s road was broken and they lost Longest Road!`,
      category: 'build',
    });
  }
}

export function applyAction(
  state: GameState,
  action: GameAction,
  isSystemTimeout = false,
): ActionResult {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    return { success: false, error: 'Invalid action format.' };
  }

  if (state.phase === 'GAME_OVER') {
    return { success: false, error: 'Game is already over!' };
  }

  // Enforce strict timer deadline so players cannot act after their phase timer has already expired!
  if (!isSystemTimeout && state.turnDeadlineMs && Date.now() >= state.turnDeadlineMs) {
    const stateChanged = handleTurnTimeout(state);
    return { success: false, error: 'Time ran out for that phase!', stateChanged };
  }

  const player = state.players[action.playerId];
  if (!player) {
    return { success: false, error: 'Player does not exist.' };
  }

  switch (action.type) {
    case 'BUILD_SETUP_SETTLEMENT': {
      if (state.phase !== 'SETUP_ROUND_1' && state.phase !== 'SETUP_ROUND_2') {
        return { success: false, error: 'Not in setup phase.' };
      }
      const currentSetupPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      if (action.playerId !== currentSetupPlayerId) {
        return { success: false, error: 'Not your turn in setup.' };
      }
      if (state.lastSetupVertexId !== null) {
        return { success: false, error: 'You already placed your settlement. Now place a road attached to it!' };
      }
      if (typeof action.vertexId !== 'string' || !state.board.vertices[action.vertexId]) {
        return { success: false, error: 'Invalid vertex.' };
      }
      if (!satisfiesDistanceRule(action.vertexId, state.board)) {
        return { success: false, error: 'Violates Distance Rule: must be at least 2 edges away from any settlement.' };
      }

      state.board.buildings[action.vertexId] = {
        id: `b_${action.vertexId}`,
        type: 'settlement',
        playerId: action.playerId,
        vertexId: action.vertexId,
      };
      player.settlementsLeft--;
      state.lastSetupVertexId = action.vertexId;

      if (state.phase === 'SETUP_ROUND_2') {
        const received: string[] = [];
        const vertex = state.board.vertices[action.vertexId];
        if (vertex) {
          for (const hexCoord of vertex.hexCoords) {
            const hex = state.board.hexes[hexCoord];
            if (hex && hex.resource && hex.terrain !== 'desert' && state.resourceBank[hex.resource] > 0) {
              player.resources[hex.resource] = (player.resources[hex.resource] || 0) + 1;
              state.resourceBank[hex.resource] = Math.max(0, state.resourceBank[hex.resource] - 1);
              received.push(hex.resource);
            }
          }
        }
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message:
            received.length > 0
              ? `${player.name} placed 2nd settlement and received starting resources (${received.join(', ')}).`
              : `${player.name} placed 2nd settlement.`,
          category: 'build',
        });
      } else {
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} placed 1st starting settlement.`,
          category: 'build',
        });
      }

      refreshTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'BUILD_SETUP_ROAD': {
      if (state.phase !== 'SETUP_ROUND_1' && state.phase !== 'SETUP_ROUND_2') {
        return { success: false, error: 'Not in setup phase.' };
      }
      const currentSetupPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      if (action.playerId !== currentSetupPlayerId) {
        return { success: false, error: 'Not your turn in setup.' };
      }
      if (!state.lastSetupVertexId) {
        return { success: false, error: 'Place your starting settlement first!' };
      }
      if (typeof action.edgeId !== 'string') {
        return { success: false, error: 'Invalid edge.' };
      }

      const edge = state.board.edges[action.edgeId];
      if (!edge) return { success: false, error: 'Invalid edge.' };
      if (state.board.roads[action.edgeId]) {
        return { success: false, error: 'Road already exists here.' };
      }

      // In setup, road MUST connect directly to the settlement just placed (state.lastSetupVertexId)
      const connectsToLastSettlement =
        edge.v1 === state.lastSetupVertexId || edge.v2 === state.lastSetupVertexId;

      if (!connectsToLastSettlement) {
        return {
          success: false,
          error: 'Starting road must connect directly to the settlement you just placed!',
        };
      }

      state.board.roads[action.edgeId] = {
        id: `r_${action.edgeId}`,
        playerId: action.playerId,
        edgeId: action.edgeId,
      };
      player.roadsLeft--;
      state.lastSetupVertexId = null;

      evaluateAndNotifyLongestRoute(state);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} placed a starting road.`,
        category: 'build',
      });

      // Advance setup index
      state.setupTurnIndex++;
      const orderedIds = getOrderedPlayerIds(state);
      const totalPlayers = orderedIds.length;

      if (state.setupTurnIndex < totalPlayers) {
        state.phase = 'SETUP_ROUND_1';
        state.currentTurnPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      } else if (state.setupTurnIndex < totalPlayers * 2) {
        state.phase = 'SETUP_ROUND_2';
        state.currentTurnPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      } else {
        state.phase = 'TURN_START';
        state.currentTurnPlayerId = orderedIds[0];
        if (state.settings.pairedPlayersTurn && totalPlayers >= 5) {
          state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, orderedIds);
        }
        state.turnNumber = 1;
        state.diceRolledThisTurn = false;
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          message: 'Setup complete! Roll the dice to begin.',
          category: 'system',
        });
      }

      refreshTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'ROLL_DICE': {
      if (state.phase !== 'TURN_START') {
        return { success: false, error: 'Cannot roll dice right now.' };
      }
      if (action.playerId !== state.currentTurnPlayerId) {
        return { success: false, error: 'Not your turn to roll.' };
      }
      if (state.diceRolledThisTurn) {
        return { success: false, error: 'Dice already rolled this turn.' };
      }

      const [d1, d2] = state.settings?.houseRules?.balancedDice
        ? drawBalancedDiceRoll(state)
        : rollOrdinaryDice();

      const sum = d1 + d2;
      state.diceRoll = [d1, d2];
      if (!state.diceHistory) {
        state.diceHistory = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 };
      }
      state.diceHistory[sum] = (state.diceHistory[sum] || 0) + 1;
      state.lastDiceRollAt = Date.now();
      state.diceRolledThisTurn = true;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} rolled ${sum} (${d1} + ${d2}).`,
        category: 'dice',
      });

      if (sum === 7) {
        state.robberControllerPlayerId = action.playerId;
        const discards: Record<string, number> = {};
        for (const p of Object.values(state.players)) {
          const totalCards = Object.values(p.resources).reduce((s, n) => s + n, 0);
          if (totalCards > state.settings.cardDiscardLimit) {
            discards[p.id] = Math.floor(totalCards / 2);
          }
        }

        if (Object.keys(discards).length > 0) {
          state.phase = 'DISCARD_PHASE';
          state.pendingDiscards = discards;
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            message: `A 7 was rolled! Players with >7 cards must discard half.`,
            category: 'robber',
          });
        } else {
          state.phase = 'ROBBER_PLACEMENT';
        }
      } else {
        // Check resource distribution (official shortage rule: if bank lacks enough for all players owed that resource, no one gets it unless only 1 player is owed)
        const owedByResource: Record<ResourceType, Record<string, number>> = {
          wood: {},
          brick: {},
          wheat: {},
          sheep: {},
          ore: {},
        };

        for (const hex of Object.values(state.board.hexes)) {
          if (hex.number === sum && !hex.hasRobber && hex.resource) {
            for (const vertex of Object.values(state.board.vertices)) {
              if (vertex.hexCoords.includes(hex.id)) {
                const b = state.board.buildings[vertex.id];
                if (b) {
                  const count = b.type === 'city' ? 2 : 1;
                  owedByResource[hex.resource][b.playerId] =
                    (owedByResource[hex.resource][b.playerId] || 0) + count;
                }
              }
            }
          }
        }

        const receivedByPlayer: Record<string, string[]> = {};

        for (const [res, playerAmounts] of Object.entries(owedByResource) as Array<
          [ResourceType, Record<string, number>]
        >) {
          const entries = Object.entries(playerAmounts);
          if (entries.length === 0) continue;
          const totalNeeded = entries.reduce((s, [_, amt]) => s + amt, 0);
          const available = state.resourceBank[res];

          if (available >= totalNeeded) {
            for (const [pid, amt] of entries) {
              state.players[pid].resources[res] += amt;
              state.resourceBank[res] -= amt;
              if (!receivedByPlayer[pid]) receivedByPlayer[pid] = [];
              receivedByPlayer[pid].push(`${amt} ${res}`);
            }
          } else if (entries.length === 1 && available > 0) {
            const [pid] = entries[0];
            state.players[pid].resources[res] += available;
            state.resourceBank[res] = 0;
            if (!receivedByPlayer[pid]) receivedByPlayer[pid] = [];
            receivedByPlayer[pid].push(`${available} ${res}`);
          } else {
            state.actionLog.push({
              id: `log_${Date.now()}_${Math.random()}`,
              timestamp: Date.now(),
              message: `Bank shortage of ${res}! Nobody received ${res} this roll.`,
              category: 'dice',
            });
          }
        }

        const payoutEntries = Object.entries(receivedByPlayer);
        if (payoutEntries.length > 0) {
          const summary = payoutEntries
            .map(([pid, items]) => `${state.players[pid]?.name}: +${items.join(', +')}`)
            .join(' • ');
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            message: `Production: ${summary}`,
            category: 'dice',
          });
        } else {
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            message: `No resources produced on roll ${sum}.`,
            category: 'dice',
          });
        }

        state.phase = 'ACTION_PHASE';
      }

      refreshTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'DISCARD_CARDS': {
      if (state.phase !== 'DISCARD_PHASE') {
        return { success: false, error: 'Not in discard phase.' };
      }
      const needed = state.pendingDiscards[action.playerId];
      if (!needed) {
        return { success: false, error: 'You do not need to discard.' };
      }

      if (!isValidResourcePayload(action.resources)) {
        return {
          success: false,
          error: 'Invalid resource quantities: must be non-negative integers.',
        };
      }

      const totalDiscarded = sumResources(action.resources);
      if (totalDiscarded !== needed) {
        return { success: false, error: `You must discard exactly ${needed} cards.` };
      }

      if (!canAfford(player.resources, action.resources)) {
        return { success: false, error: 'You do not hold these cards.' };
      }

      player.resources = deductCost(player.resources, action.resources);
      state.resourceBank = addResources(state.resourceBank, action.resources);
      delete state.pendingDiscards[action.playerId];

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} discarded ${needed} cards.`,
        category: 'robber',
      });

      if (Object.keys(state.pendingDiscards).length === 0) {
        state.phase = 'ROBBER_PLACEMENT';
        state.robberControllerPlayerId = state.currentTurnPlayerId;
        refreshTurnTimer(state);
      }

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MOVE_ROBBER': {
      if (state.phase !== 'ROBBER_PLACEMENT') {
        return { success: false, error: 'Not in robber placement phase.' };
      }
      const expectedController = state.robberControllerPlayerId || state.currentTurnPlayerId;
      if (action.playerId !== expectedController) {
        return { success: false, error: 'Not your turn to move the robber.' };
      }
      if (typeof action.hexId !== 'string') {
        return { success: false, error: 'Invalid hex.' };
      }
      if (action.hexId === state.board.robberHexId) {
        return { success: false, error: 'Robber must be moved to a different hex.' };
      }
      const targetHex = state.board.hexes[action.hexId];
      if (!targetHex) {
        return { success: false, error: 'Invalid hex.' };
      }

      const oldHex = state.board.hexes[state.board.robberHexId];
      if (oldHex) oldHex.hasRobber = false;
      targetHex.hasRobber = true;
      state.board.robberHexId = action.hexId;

      const stealTargets = new Set<string>();
      for (const vertex of Object.values(state.board.vertices)) {
        if (vertex.hexCoords.includes(action.hexId)) {
          const b = state.board.buildings[vertex.id];
          if (b && b.playerId !== action.playerId) {
            const targetP = state.players[b.playerId];
            if (targetP && Object.values(targetP.resources).some((n) => n > 0)) {
              stealTargets.add(b.playerId);
            }
          }
        }
      }

      const nextPhaseAfterRobber = !state.diceRolledThisTurn
        ? 'TURN_START'
        : action.playerId === state.pairedPlayerId && state.settings.pairedPlayersTurn
          ? 'PAIRED_ACTION_PHASE'
          : 'ACTION_PHASE';

      const targetsArray = Array.from(stealTargets);
      if (targetsArray.length === 0) {
        state.phase = nextPhaseAfterRobber;
        state.robberControllerPlayerId = null;
        resumeNormalTurnTimer(state);
      } else if (targetsArray.length === 1) {
        const targetId = targetsArray[0];
        stealRandomCard(player, state.players[targetId], state);
        state.phase = nextPhaseAfterRobber;
        state.robberControllerPlayerId = null;
        resumeNormalTurnTimer(state);
      } else {
        state.phase = 'ROBBER_STEAL';
        state.pendingStealTargets = targetsArray;
        refreshTurnTimer(state);
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} moved the robber.`,
        category: 'robber',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'STEAL_FROM_PLAYER': {
      if (state.phase !== 'ROBBER_STEAL') {
        return { success: false, error: 'Not in robber steal phase.' };
      }
      const expectedController = state.robberControllerPlayerId || state.currentTurnPlayerId;
      if (action.playerId !== expectedController) {
        return { success: false, error: 'Not your turn to steal.' };
      }
      if (!state.pendingStealTargets.includes(action.targetPlayerId)) {
        return { success: false, error: 'Cannot steal from this player.' };
      }

      const target = state.players[action.targetPlayerId];
      if (!target) {
        return { success: false, error: 'Target player not found.' };
      }
      stealRandomCard(player, target, state);
      state.pendingStealTargets = [];
      state.robberControllerPlayerId = null;
      state.phase = !state.diceRolledThisTurn
        ? 'TURN_START'
        : action.playerId === state.pairedPlayerId && state.settings.pairedPlayersTurn
          ? 'PAIRED_ACTION_PHASE'
          : 'ACTION_PHASE';

      resumeNormalTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'BUILD_ROAD': {
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if (player.roadsLeft <= 0) {
        return { success: false, error: 'No roads remaining in supply.' };
      }

      const isFreeRoad = state.freeRoadsRemaining > 0;
      if (!isFreeRoad && !canAfford(player.resources, BUILDING_COSTS.road)) {
        return { success: false, error: 'Cannot afford road (1 Wood + 1 Brick required).' };
      }
      if (typeof action.edgeId !== 'string') {
        return { success: false, error: 'Invalid edge.' };
      }
      const edge = state.board.edges[action.edgeId];
      if (!edge) return { success: false, error: 'Invalid edge.' };
      if (state.board.roads[action.edgeId]) {
        return { success: false, error: 'Road already exists here.' };
      }

      if (!isValidRoadEdge(state, action.playerId, action.edgeId)) {
        return { success: false, error: 'Road must connect to your existing roads or buildings.' };
      }

      if (isFreeRoad) {
        state.freeRoadsRemaining--;
        if (state.freeRoadsRemaining === 0) {
          resumeNormalTurnTimer(state);
        }
      } else {
        player.resources = deductCost(player.resources, BUILDING_COSTS.road);
        state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.road);
      }

      state.board.roads[action.edgeId] = {
        id: `r_${action.edgeId}`,
        playerId: action.playerId,
        edgeId: action.edgeId,
      };
      player.roadsLeft--;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} built a road.`,
        category: 'build',
      });

      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'BUILD_SETTLEMENT': {
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if (player.settlementsLeft <= 0) {
        return { success: false, error: 'No settlements remaining in supply.' };
      }
      if (!canAfford(player.resources, BUILDING_COSTS.settlement)) {
        return { success: false, error: 'Cannot afford settlement (1 Wood, 1 Brick, 1 Wheat, 1 Sheep).' };
      }
      if (typeof action.vertexId !== 'string' || !state.board.vertices[action.vertexId]) {
        return { success: false, error: 'Invalid vertex.' };
      }
      if (!satisfiesDistanceRule(action.vertexId, state.board)) {
        return { success: false, error: 'Violates Distance Rule: too close to another building.' };
      }
      if (!isValidSettlementVertex(state, action.playerId, action.vertexId)) {
        return { success: false, error: 'Settlement must connect to one of your roads.' };
      }

      player.resources = deductCost(player.resources, BUILDING_COSTS.settlement);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.settlement);
      state.board.buildings[action.vertexId] = {
        id: `b_${action.vertexId}`,
        type: 'settlement',
        playerId: action.playerId,
        vertexId: action.vertexId,
      };
      player.settlementsLeft--;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} built a settlement.`,
        category: 'build',
      });

      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'UPGRADE_CITY': {
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if (player.citiesLeft <= 0) {
        return { success: false, error: 'No cities remaining in supply.' };
      }
      if (!canAfford(player.resources, BUILDING_COSTS.city)) {
        return { success: false, error: 'Cannot afford city (2 Wheat + 3 Ore required).' };
      }
      if (typeof action.vertexId !== 'string' || !state.board.vertices[action.vertexId]) {
        return { success: false, error: 'Invalid vertex.' };
      }

      const existingBuilding = state.board.buildings[action.vertexId];
      if (!existingBuilding || existingBuilding.playerId !== action.playerId || existingBuilding.type !== 'settlement') {
        return { success: false, error: 'Must upgrade an existing settlement of your own.' };
      }

      player.resources = deductCost(player.resources, BUILDING_COSTS.city);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.city);
      existingBuilding.type = 'city';
      player.citiesLeft--;
      player.settlementsLeft++;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} upgraded a settlement to a City!`,
        category: 'build',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'BUY_DEV_CARD': {
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if (state.devCardDeck.length === 0) {
        return { success: false, error: 'No development cards remaining in deck.' };
      }
      if (!canAfford(player.resources, BUILDING_COSTS.devCard)) {
        return { success: false, error: 'Cannot afford Development Card (1 Wheat, 1 Sheep, 1 Ore).' };
      }

      player.resources = deductCost(player.resources, BUILDING_COSTS.devCard);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.devCard);

      const card = state.devCardDeck.shift()!;
      card.boughtTurn = state.turnNumber;
      player.devCards.push(card);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} bought a Development Card.`,
        category: 'card',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'PLAY_DEV_CARD': {
      const isPlayer1Action =
        (state.phase === 'ACTION_PHASE' || state.phase === 'TURN_START') && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your phase to play development cards.' };
      }

      const cardIdx = player.devCards.findIndex((c) => c.id === action.cardId);
      if (cardIdx === -1) {
        return { success: false, error: 'You do not own this Development Card.' };
      }
      const card = player.devCards[cardIdx];

      if (card.type === 'victory_point') {
        return { success: false, error: 'Victory Point cards are kept hidden and revealed automatically when you win.' };
      }

      if (state.phase === 'TURN_START' && card.type !== 'knight') {
        return { success: false, error: 'Only Knight cards can be played before rolling the dice.' };
      }

      if (card.boughtTurn === state.turnNumber) {
        return { success: false, error: 'Cannot play a Development Card on the turn you bought it.' };
      }

      if (state.devCardPlayedThisTurn) {
        return { success: false, error: 'Only one Development Card can be played per turn.' };
      }

      if (card.type === 'knight') {
        player.playedKnightsCount++;
        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played a Knight card (${player.playedKnightsCount} total)!`,
          category: 'card',
        });

        if (player.playedKnightsCount >= 3) {
          const prevArmyOwnerId = state.largestArmyOwnerId;
          const currentArmyOwner = prevArmyOwnerId ? state.players[prevArmyOwnerId] : null;
          const currentMax = currentArmyOwner ? currentArmyOwner.playedKnightsCount : 2;
          if (player.playedKnightsCount > currentMax) {
            state.largestArmyOwnerId = player.id;
            for (const p of Object.values(state.players)) {
              p.hasLargestArmy = p.id === player.id;
            }
            if (prevArmyOwnerId !== player.id) {
              state.latestAwardEvent = {
                id: `award_la_${Date.now()}_${Math.random()}`,
                timestamp: Date.now(),
                awardType: 'largest_army',
                playerId: player.id,
                playerName: player.name,
                playerColor: player.color,
                metricValue: player.playedKnightsCount,
              };
              state.actionLog.push({
                id: `log_${Date.now()}_${Math.random()}`,
                timestamp: Date.now(),
                playerId: player.id,
                message: `⚔️ ${player.name} claimed Largest Army (${player.playedKnightsCount} Knights played, +2 VP)!`,
                category: 'card',
              });
            }
          }
        }

        // Pause normal turn timer and start dedicated Robber/Dev Card timer
        pauseNormalTurnTimer(state);
        state.phase = 'ROBBER_PLACEMENT';
        state.robberControllerPlayerId = action.playerId;
        refreshTurnTimer(state);
      } else if (card.type === 'road_building') {
        if (player.roadsLeft <= 0) {
          return { success: false, error: 'You have no road pieces remaining in your supply.' };
        }
        state.freeRoadsRemaining = Math.min(2, player.roadsLeft);
        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        // Pause normal turn timer and start dedicated Dev Card placement timer
        if (state.freeRoadsRemaining > 0) {
          pauseNormalTurnTimer(state);
          refreshTurnTimer(state);
        }

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played Road Building (${state.freeRoadsRemaining} free road(s))!`,
          category: 'card',
        });
      } else if (card.type === 'year_of_plenty') {
        const yop = action.options?.yearOfPlentyResources;
        if (!Array.isArray(yop) || yop.length !== 2 || !isValidResourceType(yop[0]) || !isValidResourceType(yop[1])) {
          return { success: false, error: 'Year of Plenty requires selecting 2 valid resource types.' };
        }
        const [r1, r2] = yop;

        // Validate bank supply BEFORE consuming the development card or mutating state!
        if (r1 === r2) {
          if ((state.resourceBank[r1] || 0) < 2) {
            return {
              success: false,
              error: `Bank does not have 2 ${r1} remaining (available: ${state.resourceBank[r1] || 0}).`,
            };
          }
        } else {
          if ((state.resourceBank[r1] || 0) < 1) {
            return {
              success: false,
              error: `Bank has no ${r1} remaining.`,
            };
          }
          if ((state.resourceBank[r2] || 0) < 1) {
            return {
              success: false,
              error: `Bank has no ${r2} remaining.`,
            };
          }
        }

        player.resources[r1] = (player.resources[r1] || 0) + 1;
        player.resources[r2] = (player.resources[r2] || 0) + 1;
        state.resourceBank[r1] -= 1;
        state.resourceBank[r2] -= 1;

        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played Year of Plenty (took ${r1} and ${r2}).`,
          category: 'card',
        });
      } else if (card.type === 'monopoly') {
        const targetRes = action.options?.monopolyResource;
        if (!isValidResourceType(targetRes)) {
          return { success: false, error: 'Monopoly requires selecting 1 valid resource type.' };
        }
        let totalStolen = 0;
        for (const otherPlayer of Object.values(state.players)) {
          if (otherPlayer.id !== player.id) {
            const count = otherPlayer.resources[targetRes] || 0;
            if (count > 0) {
              totalStolen += count;
              otherPlayer.resources[targetRes] = 0;
            }
          }
        }
        player.resources[targetRes] = (player.resources[targetRes] || 0) + totalStolen;

        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} declared Monopoly on ${targetRes}! Stole ${totalStolen} cards.`,
          category: 'card',
        });
      }

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MARITIME_TRADE': {
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if (!isValidResourceType(action.giving) || !isValidResourceType(action.asking)) {
        return { success: false, error: 'Invalid resource type for bank trade.' };
      }
      if (action.giving === action.asking) {
        return { success: false, error: 'Cannot trade a resource for the same resource.' };
      }
      if (
        typeof action.ratio !== 'number' ||
        !Number.isInteger(action.ratio) ||
        (action.ratio !== 2 && action.ratio !== 3 && action.ratio !== 4)
      ) {
        return { success: false, error: 'Invalid maritime trade ratio.' };
      }

      const bestRatio = getPlayerMaritimeRatio(player.id, action.giving, state.board);
      if (action.ratio < bestRatio) {
        return { success: false, error: `Your best maritime trade ratio for ${action.giving} is ${bestRatio}:1.` };
      }
      if ((player.resources[action.giving] || 0) < action.ratio) {
        return { success: false, error: `You need at least ${action.ratio} ${action.giving} to trade.` };
      }
      if ((state.resourceBank[action.asking] || 0) < 1) {
        return { success: false, error: `Bank has no ${action.asking} remaining.` };
      }

      player.resources[action.giving] -= action.ratio;
      state.resourceBank[action.giving] += action.ratio;

      player.resources[action.asking] += 1;
      state.resourceBank[action.asking] -= 1;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} traded ${action.ratio} ${action.giving} to the bank for 1 ${action.asking}.`,
        category: 'trade',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MARITIME_BATCH_TRADE': {
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if (!isValidResourcePayload(action.giving) || !isValidResourcePayload(action.asking)) {
        return {
          success: false,
          error: 'Invalid resource quantities: must be non-negative integers.',
        };
      }

      for (const r of VALID_RESOURCES) {
        if ((action.giving[r] || 0) > 0 && (action.asking[r] || 0) > 0) {
          return {
            success: false,
            error: `Cannot give and ask for ${r} in the same bank trade.`,
          };
        }
      }

      if (!canAfford(player.resources, action.giving)) {
        return { success: false, error: 'You do not hold the resources you are offering.' };
      }

      // Compute total credits earned using the best harbor ratio per resource
      let totalCreditsEarned = 0;
      const givenDescriptions: string[] = [];
      for (const res of VALID_RESOURCES) {
        const count = action.giving[res] || 0;
        if (count <= 0) continue;
        const bestRatio = getPlayerMaritimeRatio(player.id, res, state.board);
        if (count % bestRatio !== 0) {
          return {
            success: false,
            error: `${res} must be given in multiples of your best harbor rate (${bestRatio}:1).`,
          };
        }
        totalCreditsEarned += count / bestRatio;
        givenDescriptions.push(`${count} ${res} (${bestRatio}:1)`);
      }

      const askedDescriptions: string[] = [];
      let totalAskedCards = 0;
      for (const res of VALID_RESOURCES) {
        const count = action.asking[res] || 0;
        if (count <= 0) continue;
        if ((state.resourceBank[res] || 0) < count) {
          return { success: false, error: `Bank does not have enough ${res} remaining.` };
        }
        totalAskedCards += count;
        askedDescriptions.push(`${count} ${res}`);
      }

      if (totalCreditsEarned <= 0 || totalAskedCards <= 0) {
        return { success: false, error: 'Must give and ask for at least 1 resource.' };
      }

      if (totalCreditsEarned !== totalAskedCards) {
        return {
          success: false,
          error: `Your offered cards yield ${totalCreditsEarned} bank trade(s), but you asked for ${totalAskedCards} card(s).`,
        };
      }

      player.resources = deductCost(player.resources, action.giving);
      state.resourceBank = addResources(state.resourceBank, action.giving);

      player.resources = addResources(player.resources, action.asking);
      state.resourceBank = deductCost(state.resourceBank, action.asking);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} traded ${givenDescriptions.join(' + ')} with the bank for ${askedDescriptions.join(' + ')}.`,
        category: 'trade',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'PROPOSE_TRADE': {
      if (state.phase !== 'ACTION_PHASE' || action.playerId !== state.currentTurnPlayerId) {
        return { success: false, error: 'Domestic trade can only be initiated by active Player 1.' };
      }

      const freeTradesEnabled = Boolean(state.settings?.houseRules?.freeTrades);
      const validation = validateDomesticTradePayloads(action.giving, action.asking, freeTradesEnabled);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      if (!canAfford(player.resources, validation.cleanGiving)) {
        return { success: false, error: 'You do not hold the resources you are offering.' };
      }

      const offer: TradeOffer = {
        id: `trade_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        fromPlayerId: action.playerId,
        targetPlayerId: action.targetPlayerId || 'all',
        giving: validation.cleanGiving,
        asking: validation.cleanAsking,
        status: {},
        counterOffers: [],
        createdAt: Date.now(),
      };

      for (const p of Object.values(state.players)) {
        if (p.id !== action.playerId) {
          offer.status[p.id] = 'pending';
        }
      }

      state.activeTradeOffer = offer;
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} proposed a trade offer.`,
        category: 'trade',
      });

      return { success: true };
    }

    case 'RESPOND_TRADE': {
      if (!state.activeTradeOffer || state.activeTradeOffer.id !== action.tradeId) {
        return { success: false, error: 'No active trade offer.' };
      }
      if (action.playerId === state.activeTradeOffer.fromPlayerId) {
        return { success: false, error: 'Cannot respond to your own trade offer.' };
      }
      if (
        state.activeTradeOffer.targetPlayerId !== 'all' &&
        state.activeTradeOffer.targetPlayerId !== action.playerId
      ) {
        return { success: false, error: 'This trade offer is not directed to you.' };
      }

      if (action.accept) {
        const activeP = state.players[state.activeTradeOffer.fromPlayerId];
        if (!activeP) {
          return { success: false, error: 'Offering player not found.' };
        }

        const freeTradesEnabled = Boolean(state.settings?.houseRules?.freeTrades);
        const validation = validateDomesticTradePayloads(
          state.activeTradeOffer.giving,
          state.activeTradeOffer.asking,
          freeTradesEnabled,
        );
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // Recheck BOTH participants' resources immediately before completing the trade!
        if (!canAfford(activeP.resources, validation.cleanGiving)) {
          return {
            success: false,
            error: `${activeP.name} no longer holds the resources offered in this trade.`,
          };
        }
        if (!canAfford(player.resources, validation.cleanAsking)) {
          return { success: false, error: 'You do not have the requested cards to accept.' };
        }

        state.activeTradeOffer.status[action.playerId] = 'accepted';
        executeTrade(activeP, player, validation.cleanGiving, validation.cleanAsking, state);
        state.activeTradeOffer = null;
      } else {
        state.activeTradeOffer.status[action.playerId] = 'declined';
        // Remove any prior counter-offers submitted by this declining player
        state.activeTradeOffer.counterOffers = state.activeTradeOffer.counterOffers.filter(
          (c) => c.fromPlayerId !== action.playerId,
        );

        // If all eligible players have declined and no counter-offers remain, dismiss the trade offer completely
        const offer = state.activeTradeOffer;
        const targetIds =
          offer.targetPlayerId === 'all' ? Object.keys(offer.status) : [offer.targetPlayerId];
        const allDeclined =
          targetIds.length > 0 && targetIds.every((pid) => offer.status[pid] === 'declined');

        if (allDeclined && offer.counterOffers.length === 0) {
          const proposerName = state.players[offer.fromPlayerId]?.name || 'Player';
          state.activeTradeOffer = null;
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            playerId: offer.fromPlayerId,
            message: `All players declined ${proposerName}'s trade offer.`,
            category: 'trade',
          });
        }
      }

      return { success: true };
    }

    case 'COUNTER_TRADE': {
      if (!state.activeTradeOffer || state.activeTradeOffer.id !== action.tradeId) {
        return { success: false, error: 'No active trade offer.' };
      }
      if (action.playerId === state.activeTradeOffer.fromPlayerId) {
        return { success: false, error: 'Cannot counter your own trade.' };
      }

      const freeTradesEnabled = Boolean(state.settings?.houseRules?.freeTrades);
      const validation = validateDomesticTradePayloads(action.giving, action.asking, freeTradesEnabled);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Reject if the counter-offer is identical to the original trade offer
      const origGiving = state.activeTradeOffer.giving;
      const origAsking = state.activeTradeOffer.asking;
      const matchesOriginalDeal = VALID_RESOURCES.every(
        (r) =>
          (validation.cleanGiving[r] || 0) === (origAsking[r] || 0) &&
          (validation.cleanAsking[r] || 0) === (origGiving[r] || 0),
      );
      const matchesOriginalSameDirection = VALID_RESOURCES.every(
        (r) =>
          (validation.cleanGiving[r] || 0) === (origGiving[r] || 0) &&
          (validation.cleanAsking[r] || 0) === (origAsking[r] || 0),
      );
      if (matchesOriginalDeal || matchesOriginalSameDirection) {
        return {
          success: false,
          error: 'Counter-offer cannot be identical to the original trade offer!',
        };
      }

      // Reject if the exact same counter-offer has already been offered
      const isDuplicateCounter = state.activeTradeOffer.counterOffers.some((c) =>
        VALID_RESOURCES.every(
          (r) =>
            (c.giving[r] || 0) === (validation.cleanGiving[r] || 0) &&
            (c.asking[r] || 0) === (validation.cleanAsking[r] || 0),
        ),
      );
      if (isDuplicateCounter) {
        return {
          success: false,
          error: 'This exact counter-offer has already been offered!',
        };
      }

      if (!canAfford(player.resources, validation.cleanGiving)) {
        return { success: false, error: 'You do not have the cards for your counter-offer.' };
      }

      const counter: CounterOffer = {
        id: `counter_${Date.now()}_${action.playerId}`,
        tradeOfferId: action.tradeId,
        fromPlayerId: action.playerId,
        giving: validation.cleanGiving,
        asking: validation.cleanAsking,
        createdAt: Date.now(),
      };

      state.activeTradeOffer.counterOffers.push(counter);
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} submitted a counter-offer.`,
        category: 'trade',
      });

      return { success: true };
    }

    case 'ACCEPT_COUNTER_TRADE': {
      if (!state.activeTradeOffer || state.activeTradeOffer.id !== action.tradeId) {
        return { success: false, error: 'No active trade offer.' };
      }
      if (action.playerId !== state.activeTradeOffer.fromPlayerId) {
        return { success: false, error: 'Only the active player can accept a counter-offer.' };
      }

      const counter = state.activeTradeOffer.counterOffers.find((c) => c.id === action.counterId);
      if (!counter) return { success: false, error: 'Counter-offer not found.' };

      const freeTradesEnabled = Boolean(state.settings?.houseRules?.freeTrades);
      const validation = validateDomesticTradePayloads(counter.giving, counter.asking, freeTradesEnabled);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const counterPlayer = state.players[counter.fromPlayerId];
      if (!counterPlayer) return { success: false, error: 'Counter player not found.' };

      if (!canAfford(player.resources, validation.cleanAsking)) {
        return { success: false, error: 'You no longer have the cards required for this counter-offer.' };
      }
      if (!canAfford(counterPlayer.resources, validation.cleanGiving)) {
        return { success: false, error: 'Other player no longer has the cards for this counter-offer.' };
      }

      executeTrade(player, counterPlayer, validation.cleanAsking, validation.cleanGiving, state);
      state.activeTradeOffer = null;
      return { success: true };
    }

    case 'CANCEL_TRADE': {
      if (state.activeTradeOffer && state.activeTradeOffer.fromPlayerId === action.playerId) {
        state.activeTradeOffer = null;
        return { success: true };
      }
      return { success: false, error: 'Cannot cancel trade.' };
    }

    case 'END_TURN': {
      const orderedIds = getOrderedPlayerIds(state);
      const is56 = state.settings.pairedPlayersTurn && orderedIds.length >= 5;

      // Validate phase and player ownership FIRST before mutating any state!
      if (!is56) {
        if (state.phase !== 'ACTION_PHASE') {
          return { success: false, error: 'Cannot end turn right now: mandatory phase in progress.' };
        }
        if (action.playerId !== state.currentTurnPlayerId) {
          return { success: false, error: 'Not your turn.' };
        }
      } else {
        if (state.phase === 'ACTION_PHASE') {
          if (action.playerId !== state.currentTurnPlayerId) {
            return { success: false, error: 'Not your turn.' };
          }
        } else if (state.phase === 'PAIRED_ACTION_PHASE') {
          if (action.playerId !== state.pairedPlayerId) {
            return { success: false, error: 'Not your paired action phase.' };
          }
        } else {
          return { success: false, error: 'Cannot end turn right now: mandatory phase in progress.' };
        }
      }

      // Now safe to clear turn-scoped offers & temporary road counters
      state.activeTradeOffer = null;
      state.freeRoadsRemaining = 0;
      state.savedActionRemainingMs = null;

      if (!is56) {
        const nextIndex = (orderedIds.indexOf(state.currentTurnPlayerId) + 1) % orderedIds.length;
        state.currentTurnPlayerId = orderedIds[nextIndex];
        state.phase = 'TURN_START';
        state.diceRolledThisTurn = false;
        state.devCardPlayedThisTurn = false;
        state.turnNumber++;
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: state.currentTurnPlayerId,
          message: `Turn ${state.turnNumber}: ${state.players[state.currentTurnPlayerId]?.name}'s turn to roll.`,
          category: 'system',
        });
      } else {
        if (state.phase === 'ACTION_PHASE') {
          state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, orderedIds);
          state.phase = 'PAIRED_ACTION_PHASE';
          state.devCardPlayedThisTurn = false;

          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            playerId: state.pairedPlayerId,
            message: `Paired Players Turn: ${state.players[state.pairedPlayerId].name} begins their Action Phase.`,
            category: 'system',
          });
        } else {
          const nextP1Index = (orderedIds.indexOf(state.currentTurnPlayerId) + 1) % orderedIds.length;
          state.currentTurnPlayerId = orderedIds[nextP1Index];
          state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, orderedIds);
          state.phase = 'TURN_START';
          state.diceRolledThisTurn = false;
          state.devCardPlayedThisTurn = false;
          state.turnNumber++;
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            playerId: state.currentTurnPlayerId,
            message: `Turn ${state.turnNumber}: ${state.players[state.currentTurnPlayerId]?.name}'s turn to roll.`,
            category: 'system',
          });
        }
      }

      refreshTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown action type.' };
  }
}

// Auto-roller / Auto-pass handler when turn timer expires
export function handleTurnTimeout(state: GameState): boolean {
  if (state.phase === 'GAME_OVER' || state.phase === 'LOBBY') return false;
  if (!state.turnDeadlineMs || Date.now() < state.turnDeadlineMs) return false;

  switch (state.phase) {
    case 'SETUP_ROUND_1':
    case 'SETUP_ROUND_2': {
      const setupPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      if (!state.lastSetupVertexId) {
        const validVertices = Object.keys(state.board.vertices).filter((vid) =>
          satisfiesDistanceRule(vid, state.board),
        );
        if (validVertices.length > 0) {
          const randomV = validVertices[cryptoRandomInt(validVertices.length)];
          applyAction(
            state,
            { type: 'BUILD_SETUP_SETTLEMENT', playerId: setupPlayerId, vertexId: randomV },
            true,
          );
        }
      }
      if (state.lastSetupVertexId) {
        const validEdges = Object.values(state.board.edges).filter(
          (e) =>
            !state.board.roads[e.id] &&
            (e.v1 === state.lastSetupVertexId || e.v2 === state.lastSetupVertexId),
        );
        if (validEdges.length > 0) {
          const randomE = validEdges[cryptoRandomInt(validEdges.length)];
          applyAction(
            state,
            { type: 'BUILD_SETUP_ROAD', playerId: setupPlayerId, edgeId: randomE.id },
            true,
          );
        }
      }
      return true;
    }

    case 'TURN_START': {
      applyAction(state, { type: 'ROLL_DICE', playerId: state.currentTurnPlayerId }, true);
      return true;
    }

    case 'DISCARD_PHASE': {
      for (const [pid, needed] of Object.entries(state.pendingDiscards)) {
        const p = state.players[pid];
        if (!p || needed <= 0) continue;
        const pool: ResourceType[] = [];
        for (const [res, count] of Object.entries(p.resources) as Array<[ResourceType, number]>) {
          for (let i = 0; i < count; i++) pool.push(res);
        }
        const toDiscard: Partial<ResourceCount> = {};
        for (let i = 0; i < needed && pool.length > 0; i++) {
          const idx = cryptoRandomInt(pool.length);
          const chosen = pool.splice(idx, 1)[0];
          toDiscard[chosen] = (toDiscard[chosen] || 0) + 1;
        }
        applyAction(state, { type: 'DISCARD_CARDS', playerId: pid, resources: toDiscard }, true);
      }
      return true;
    }

    case 'ROBBER_PLACEMENT': {
      const controllerId = state.robberControllerPlayerId || state.currentTurnPlayerId;
      const candidateHexes = Object.keys(state.board.hexes).filter(
        (hid) => hid !== state.board.robberHexId && state.board.hexes[hid].terrain !== 'desert',
      );
      const chosenHex =
        candidateHexes[cryptoRandomInt(candidateHexes.length)] ||
        Object.keys(state.board.hexes).find((hid) => hid !== state.board.robberHexId)!;
      applyAction(
        state,
        {
          type: 'MOVE_ROBBER',
          playerId: controllerId,
          hexId: chosenHex,
        },
        true,
      );
      return true;
    }

    case 'ROBBER_STEAL': {
      const controllerId = state.robberControllerPlayerId || state.currentTurnPlayerId;
      const targetId = state.pendingStealTargets[0];
      if (targetId) {
        applyAction(
          state,
          {
            type: 'STEAL_FROM_PLAYER',
            playerId: controllerId,
            targetPlayerId: targetId,
          },
          true,
        );
      }
      return true;
    }

    case 'ACTION_PHASE': {
      if (state.freeRoadsRemaining > 0) {
        state.freeRoadsRemaining = 0;
        resumeNormalTurnTimer(state);
        return true;
      }
      applyAction(state, { type: 'END_TURN', playerId: state.currentTurnPlayerId }, true);
      return true;
    }

    case 'PAIRED_ACTION_PHASE': {
      if (state.freeRoadsRemaining > 0) {
        state.freeRoadsRemaining = 0;
        resumeNormalTurnTimer(state);
        return true;
      }
      if (state.pairedPlayerId) {
        applyAction(state, { type: 'END_TURN', playerId: state.pairedPlayerId }, true);
      }
      return true;
    }

    default:
      return false;
  }
}

function stealRandomCard(stealer: any, victim: any, state: GameState) {
  const cards: ResourceType[] = [];
  for (const [res, count] of Object.entries(victim.resources) as Array<[ResourceType, number]>) {
    for (let i = 0; i < count; i++) cards.push(res);
  }
  if (cards.length === 0) return;

  const chosen = cards[cryptoRandomInt(cards.length)];
  victim.resources[chosen]--;
  stealer.resources[chosen] = (stealer.resources[chosen] || 0) + 1;

  state.actionLog.push({
    id: `log_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    playerId: stealer.id,
    message: `${stealer.name} stole a card from ${victim.name}.`,
    category: 'robber',
  });
}

function executeTrade(
  p1: any,
  p2: any,
  p1Gives: Partial<ResourceCount>,
  p2Gives: Partial<ResourceCount>,
  state: GameState,
) {
  p1.resources = deductCost(p1.resources, p1Gives);
  p1.resources = addResources(p1.resources, p2Gives);

  p2.resources = deductCost(p2.resources, p2Gives);
  p2.resources = addResources(p2.resources, p1Gives);

  state.actionLog.push({
    id: `log_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    message: `Trade completed between ${p1.name} and ${p2.name}!`,
    category: 'trade',
  });

  syncPlayerVPs(state);
}

export function getPlayerMaritimeRatio(playerId: string, resource: ResourceType, board: BoardState): number {
  let best = 4;

  for (const harbor of Object.values(board.harbors)) {
    const touchesPlayer =
      (board.buildings[harbor.vertexIds[0]] && board.buildings[harbor.vertexIds[0]].playerId === playerId) ||
      (board.buildings[harbor.vertexIds[1]] && board.buildings[harbor.vertexIds[1]].playerId === playerId);

    if (touchesPlayer) {
      if (harbor.type === 'generic_3_1' && best > 3) {
        best = 3;
      }
      if (harbor.resource === resource && harbor.ratio === 2) {
        best = 2;
      }
    }
  }

  return best;
}
