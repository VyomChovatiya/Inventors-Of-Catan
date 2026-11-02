import {
  BoardState,
  GameState,
  ResourceCount,
  ResourceType,
  TradeOffer,
  CounterOffer,
} from '../types/index.js';
import { BUILDING_COSTS, canAfford, deductCost, addResources } from './costs.js';
import {
  satisfiesDistanceRule,
  syncPlayerVPs,
  getPairedPlayerId,
  refreshTurnTimer,
  isValidRoadEdge,
  isValidSettlementVertex,
} from './engine.js';
import { updateLongestRouteOwner } from './longestRoute.js';

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

export function applyAction(state: GameState, action: GameAction): { success: boolean; error?: string } {
  if (state.phase === 'GAME_OVER') {
    return { success: false, error: 'Game is already over!' };
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
        const vertex = state.board.vertices[action.vertexId];
        if (vertex) {
          for (const hexCoord of vertex.hexCoords) {
            const hex = state.board.hexes[hexCoord];
            if (hex && hex.resource && hex.terrain !== 'desert') {
              player.resources[hex.resource] = (player.resources[hex.resource] || 0) + 1;
              state.resourceBank[hex.resource] = Math.max(0, state.resourceBank[hex.resource] - 1);
            }
          }
        }
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} placed a starting settlement.`,
        category: 'build',
      });

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

      // Recalculate Longest Route
      const { newOwnerId, playerLengths } = updateLongestRouteOwner(
        state.board,
        state.longestRouteOwnerId,
        Object.keys(state.players),
      );
      state.longestRouteOwnerId = newOwnerId;
      for (const [pid, p] of Object.entries(state.players)) {
        p.longestRouteLength = playerLengths[pid] || 0;
        p.hasLongestRoute = pid === newOwnerId;
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} placed a starting road.`,
        category: 'build',
      });

      // Advance setup index
      state.setupTurnIndex++;
      const totalPlayers = Object.keys(state.players).length;

      if (state.setupTurnIndex < totalPlayers) {
        state.phase = 'SETUP_ROUND_1';
        state.currentTurnPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      } else if (state.setupTurnIndex < totalPlayers * 2) {
        state.phase = 'SETUP_ROUND_2';
        state.currentTurnPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      } else {
        state.phase = 'TURN_START';
        state.currentTurnPlayerId = state.setupTurnOrder[0];
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

      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      const sum = d1 + d2;
      state.diceRoll = [d1, d2];
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
            }
          } else if (entries.length === 1 && available > 0) {
            const [pid] = entries[0];
            state.players[pid].resources[res] += available;
            state.resourceBank[res] = 0;
          }
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

      const totalDiscarded = Object.values(action.resources).reduce((s, n) => s + (n || 0), 0);
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
        refreshTurnTimer(state);
      }

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MOVE_ROBBER': {
      if (state.phase !== 'ROBBER_PLACEMENT') {
        return { success: false, error: 'Not in robber placement phase.' };
      }
      const isActiveController =
        action.playerId === state.currentTurnPlayerId || action.playerId === state.pairedPlayerId;
      if (!isActiveController) {
        return { success: false, error: 'Not your turn to move the robber.' };
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
            if (Object.values(targetP.resources).some((n) => n > 0)) {
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
      } else if (targetsArray.length === 1) {
        const targetId = targetsArray[0];
        stealRandomCard(player, state.players[targetId], state);
        state.phase = nextPhaseAfterRobber;
      } else {
        state.phase = 'ROBBER_STEAL';
        state.pendingStealTargets = targetsArray;
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} moved the robber.`,
        category: 'robber',
      });

      refreshTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'STEAL_FROM_PLAYER': {
      if (state.phase !== 'ROBBER_STEAL') {
        return { success: false, error: 'Not in robber steal phase.' };
      }
      if (!state.pendingStealTargets.includes(action.targetPlayerId)) {
        return { success: false, error: 'Cannot steal from this player.' };
      }

      const target = state.players[action.targetPlayerId];
      stealRandomCard(player, target, state);
      state.pendingStealTargets = [];
      state.phase = !state.diceRolledThisTurn
        ? 'TURN_START'
        : action.playerId === state.pairedPlayerId && state.settings.pairedPlayersTurn
          ? 'PAIRED_ACTION_PHASE'
          : 'ACTION_PHASE';

      refreshTurnTimer(state);
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

      const { newOwnerId, playerLengths } = updateLongestRouteOwner(
        state.board,
        state.longestRouteOwnerId,
        Object.keys(state.players),
      );
      state.longestRouteOwnerId = newOwnerId;
      for (const [pid, p] of Object.entries(state.players)) {
        p.longestRouteLength = playerLengths[pid] || 0;
        p.hasLongestRoute = pid === newOwnerId;
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} built a road.`,
        category: 'build',
      });

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

      const { newOwnerId, playerLengths } = updateLongestRouteOwner(
        state.board,
        state.longestRouteOwnerId,
        Object.keys(state.players),
      );
      state.longestRouteOwnerId = newOwnerId;
      for (const [pid, p] of Object.entries(state.players)) {
        p.longestRouteLength = playerLengths[pid] || 0;
        p.hasLongestRoute = pid === newOwnerId;
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} built a settlement.`,
        category: 'build',
      });

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

      if (card.boughtTurn === state.turnNumber && card.type !== 'victory_point') {
        return { success: false, error: 'Cannot play a Development Card on the turn you bought it.' };
      }

      if (card.type !== 'victory_point' && state.devCardPlayedThisTurn) {
        return { success: false, error: 'Only one Development Card can be played per turn.' };
      }

      if (card.type === 'knight') {
        player.playedKnightsCount++;
        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        if (player.playedKnightsCount >= 3) {
          const currentArmyOwner = state.largestArmyOwnerId ? state.players[state.largestArmyOwnerId] : null;
          const currentMax = currentArmyOwner ? currentArmyOwner.playedKnightsCount : 2;
          if (player.playedKnightsCount > currentMax) {
            state.largestArmyOwnerId = player.id;
            for (const p of Object.values(state.players)) {
              p.hasLargestArmy = p.id === player.id;
            }
          }
        }

        state.phase = 'ROBBER_PLACEMENT';
        refreshTurnTimer(state);
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played a Knight card!`,
          category: 'card',
        });
      } else if (card.type === 'road_building') {
        state.freeRoadsRemaining = Math.min(2, player.roadsLeft);
        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played Road Building (2 free roads)!`,
          category: 'card',
        });
      } else if (card.type === 'year_of_plenty') {
        const [r1, r2] = action.options?.yearOfPlentyResources || ['wheat', 'ore'];
        player.resources[r1] = (player.resources[r1] || 0) + 1;
        player.resources[r2] = (player.resources[r2] || 0) + 1;
        state.resourceBank[r1] = Math.max(0, state.resourceBank[r1] - 1);
        state.resourceBank[r2] = Math.max(0, state.resourceBank[r2] - 1);

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
        const targetRes = action.options?.monopolyResource || 'wheat';
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

      if ((player.resources[action.giving] || 0) < action.ratio) {
        return { success: false, error: `You need at least ${action.ratio} ${action.giving} to trade.` };
      }
      if ((state.resourceBank[action.asking] || 0) < 1) {
        return { success: false, error: `Bank has no ${action.asking} remaining.` };
      }

      const bestRatio = getPlayerMaritimeRatio(player.id, action.giving, state.board);
      if (action.ratio < bestRatio) {
        return { success: false, error: `Your best maritime trade ratio for ${action.giving} is ${bestRatio}:1.` };
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

    case 'PROPOSE_TRADE': {
      if (state.phase !== 'ACTION_PHASE' || action.playerId !== state.currentTurnPlayerId) {
        return { success: false, error: 'Domestic trade can only be initiated by active Player 1.' };
      }
      if (!canAfford(player.resources, action.giving)) {
        return { success: false, error: 'You do not hold the resources you are offering.' };
      }

      const offer: TradeOffer = {
        id: `trade_${Date.now()}`,
        fromPlayerId: action.playerId,
        targetPlayerId: action.targetPlayerId || 'all',
        giving: action.giving,
        asking: action.asking,
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

      if (action.accept) {
        if (!canAfford(player.resources, state.activeTradeOffer.asking)) {
          return { success: false, error: 'You do not have the requested cards to accept.' };
        }
        state.activeTradeOffer.status[action.playerId] = 'accepted';

        const activeP = state.players[state.activeTradeOffer.fromPlayerId];
        executeTrade(activeP, player, state.activeTradeOffer.giving, state.activeTradeOffer.asking, state);
        state.activeTradeOffer = null;
      } else {
        state.activeTradeOffer.status[action.playerId] = 'declined';
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

      if (!canAfford(player.resources, action.giving)) {
        return { success: false, error: 'You do not have the cards for your counter-offer.' };
      }

      const counter: CounterOffer = {
        id: `counter_${Date.now()}_${action.playerId}`,
        tradeOfferId: action.tradeId,
        fromPlayerId: action.playerId,
        giving: action.giving,
        asking: action.asking,
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

      const counterPlayer = state.players[counter.fromPlayerId];
      if (!counterPlayer) return { success: false, error: 'Counter player not found.' };

      if (!canAfford(player.resources, counter.asking)) {
        return { success: false, error: 'You no longer have the cards required for this counter-offer.' };
      }
      if (!canAfford(counterPlayer.resources, counter.giving)) {
        return { success: false, error: 'Other player no longer has the cards for this counter-offer.' };
      }

      executeTrade(player, counterPlayer, counter.asking, counter.giving, state);
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
      const is56 = state.settings.pairedPlayersTurn && Object.keys(state.players).length >= 5;
      state.activeTradeOffer = null;
      state.freeRoadsRemaining = 0;

      if (!is56) {
        if (action.playerId !== state.currentTurnPlayerId) {
          return { success: false, error: 'Not your turn.' };
        }
        const playerIds = Object.keys(state.players);
        const nextIndex = (playerIds.indexOf(state.currentTurnPlayerId) + 1) % playerIds.length;
        state.currentTurnPlayerId = playerIds[nextIndex];
        state.phase = 'TURN_START';
        state.diceRolledThisTurn = false;
        state.devCardPlayedThisTurn = false;
        state.diceRoll = null;
        state.turnNumber++;
      } else {
        if (state.phase === 'ACTION_PHASE') {
          if (action.playerId !== state.currentTurnPlayerId) {
            return { success: false, error: 'Not your turn.' };
          }
          const playerIds = Object.keys(state.players);
          state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, playerIds);
          state.phase = 'PAIRED_ACTION_PHASE';
          state.devCardPlayedThisTurn = false;

          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            playerId: state.pairedPlayerId,
            message: `Paired Players Turn: ${state.players[state.pairedPlayerId].name} begins their Action Phase.`,
            category: 'system',
          });
        } else if (state.phase === 'PAIRED_ACTION_PHASE') {
          if (action.playerId !== state.pairedPlayerId) {
            return { success: false, error: 'Not your paired action phase.' };
          }
          const playerIds = Object.keys(state.players);
          const nextP1Index = (playerIds.indexOf(state.currentTurnPlayerId) + 1) % playerIds.length;
          state.currentTurnPlayerId = playerIds[nextP1Index];
          state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, playerIds);
          state.phase = 'TURN_START';
          state.diceRolledThisTurn = false;
          state.devCardPlayedThisTurn = false;
          state.diceRoll = null;
          state.turnNumber++;
        } else {
          return { success: false, error: 'Cannot end turn right now.' };
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
          const randomV = validVertices[Math.floor(Math.random() * validVertices.length)];
          applyAction(state, { type: 'BUILD_SETUP_SETTLEMENT', playerId: setupPlayerId, vertexId: randomV });
        }
      }
      if (state.lastSetupVertexId) {
        const validEdges = Object.values(state.board.edges).filter(
          (e) =>
            !state.board.roads[e.id] &&
            (e.v1 === state.lastSetupVertexId || e.v2 === state.lastSetupVertexId),
        );
        if (validEdges.length > 0) {
          const randomE = validEdges[Math.floor(Math.random() * validEdges.length)];
          applyAction(state, { type: 'BUILD_SETUP_ROAD', playerId: setupPlayerId, edgeId: randomE.id });
        }
      }
      return true;
    }

    case 'TURN_START': {
      applyAction(state, { type: 'ROLL_DICE', playerId: state.currentTurnPlayerId });
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
          const idx = Math.floor(Math.random() * pool.length);
          const chosen = pool.splice(idx, 1)[0];
          toDiscard[chosen] = (toDiscard[chosen] || 0) + 1;
        }
        applyAction(state, { type: 'DISCARD_CARDS', playerId: pid, resources: toDiscard });
      }
      return true;
    }

    case 'ROBBER_PLACEMENT': {
      const candidateHexes = Object.keys(state.board.hexes).filter(
        (hid) => hid !== state.board.robberHexId && state.board.hexes[hid].terrain !== 'desert',
      );
      const chosenHex =
        candidateHexes[Math.floor(Math.random() * candidateHexes.length)] ||
        Object.keys(state.board.hexes).find((hid) => hid !== state.board.robberHexId)!;
      applyAction(state, {
        type: 'MOVE_ROBBER',
        playerId: state.currentTurnPlayerId,
        hexId: chosenHex,
      });
      return true;
    }

    case 'ROBBER_STEAL': {
      const targetId = state.pendingStealTargets[0];
      if (targetId) {
        applyAction(state, {
          type: 'STEAL_FROM_PLAYER',
          playerId: state.currentTurnPlayerId,
          targetPlayerId: targetId,
        });
      }
      return true;
    }

    case 'ACTION_PHASE': {
      applyAction(state, { type: 'END_TURN', playerId: state.currentTurnPlayerId });
      return true;
    }

    case 'PAIRED_ACTION_PHASE': {
      if (state.pairedPlayerId) {
        applyAction(state, { type: 'END_TURN', playerId: state.pairedPlayerId });
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

  const chosen = cards[Math.floor(Math.random() * cards.length)];
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
