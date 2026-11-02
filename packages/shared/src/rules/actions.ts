import {
  BoardState,
  Harbor,
  GameState,
  ResourceCount,
  ResourceType,
  DevCardType,
  TradeOffer,
  CounterOffer,
} from '../types/index.js';
import { BUILDING_COSTS, canAfford, deductCost, addResources } from './costs.js';
import { satisfiesDistanceRule, getAdjacentVertices, syncPlayerVPs, getPairedPlayerId } from './engine.js';
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
        hexId?: string; // for knight
        targetPlayerId?: string; // for knight steal
        freeRoadEdges?: [string, string]; // for road building
        yearOfPlentyResources?: [ResourceType, ResourceType]; // for year of plenty
        monopolyResource?: ResourceType; // for monopoly
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

      if (!satisfiesDistanceRule(action.vertexId, state.board)) {
        return { success: false, error: 'Does not satisfy distance rule.' };
      }

      // Build settlement
      state.board.buildings[action.vertexId] = {
        id: `b_${action.vertexId}`,
        type: 'settlement',
        playerId: action.playerId,
        vertexId: action.vertexId,
      };
      player.settlementsLeft--;

      // If in Round 2, grant starting resources from adjacent non-desert hexes
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
        id: `log_${Date.now()}`,
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

      const edge = state.board.edges[action.edgeId];
      if (!edge) return { success: false, error: 'Invalid edge.' };
      if (state.board.roads[action.edgeId]) {
        return { success: false, error: 'Road already exists here.' };
      }

      // In setup, road must attach to the player's settlement
      const v1Building = state.board.buildings[edge.v1];
      const v2Building = state.board.buildings[edge.v2];
      const touchesOwnSettlement =
        (v1Building && v1Building.playerId === action.playerId) ||
        (v2Building && v2Building.playerId === action.playerId);

      if (!touchesOwnSettlement) {
        return { success: false, error: 'Road must connect to your settlement.' };
      }

      // Build road
      state.board.roads[action.edgeId] = {
        id: `r_${action.edgeId}`,
        playerId: action.playerId,
        edgeId: action.edgeId,
      };
      player.roadsLeft--;

      state.actionLog.push({
        id: `log_${Date.now()}`,
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
        // Setup finished! Regular turns begin
        state.phase = 'TURN_START';
        state.currentTurnPlayerId = state.setupTurnOrder[0];
        state.turnNumber = 1;
        state.diceRolledThisTurn = false;
        state.actionLog.push({
          id: `log_${Date.now()}`,
          timestamp: Date.now(),
          message: 'Setup complete! The match begins.',
          category: 'system',
        });
      }

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
      state.diceRolledThisTurn = true;

      state.actionLog.push({
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} rolled a ${sum} (${d1} + ${d2}).`,
        category: 'dice',
      });

      if (sum === 7) {
        // Check discards
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
            id: `log_${Date.now()}`,
            timestamp: Date.now(),
            message: `A 7 was rolled! Players with more than 7 cards must discard half their hand.`,
            category: 'robber',
          });
        } else {
          state.phase = 'ROBBER_PLACEMENT';
        }
      } else {
        // Distribute resources for rolled number
        for (const hex of Object.values(state.board.hexes)) {
          if (hex.number === sum && !hex.hasRobber && hex.resource) {
            // Find all vertices touching this hex
            for (const vertex of Object.values(state.board.vertices)) {
              if (vertex.hexCoords.includes(hex.id)) {
                const b = state.board.buildings[vertex.id];
                if (b) {
                  const bPlayer = state.players[b.playerId];
                  const count = b.type === 'city' ? 2 : 1;
                  const available = state.resourceBank[hex.resource];
                  const given = Math.min(count, available);
                  if (given > 0) {
                    bPlayer.resources[hex.resource] += given;
                    state.resourceBank[hex.resource] -= given;
                  }
                }
              }
            }
          }
        }
        state.phase = 'ACTION_PHASE';
      }

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
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} discarded ${needed} cards.`,
        category: 'robber',
      });

      // If all discards done, advance to robber placement
      if (Object.keys(state.pendingDiscards).length === 0) {
        state.phase = 'ROBBER_PLACEMENT';
      }

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MOVE_ROBBER': {
      if (state.phase !== 'ROBBER_PLACEMENT') {
        return { success: false, error: 'Not in robber placement phase.' };
      }
      if (action.playerId !== state.currentTurnPlayerId) {
        return { success: false, error: 'Not your turn to move the robber.' };
      }
      if (action.hexId === state.board.robberHexId) {
        return { success: false, error: 'Robber must be moved to a different hex.' };
      }
      const targetHex = state.board.hexes[action.hexId];
      if (!targetHex) {
        return { success: false, error: 'Invalid hex.' };
      }

      // Move robber
      const oldHex = state.board.hexes[state.board.robberHexId];
      if (oldHex) oldHex.hasRobber = false;
      targetHex.hasRobber = true;
      state.board.robberHexId = action.hexId;

      // Find adjacent players who have buildings on this hex (excluding active player)
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

      const targetsArray = Array.from(stealTargets);
      if (targetsArray.length === 0) {
        state.phase = 'ACTION_PHASE';
      } else if (targetsArray.length === 1) {
        // Steal immediately from the only target
        const targetId = targetsArray[0];
        stealRandomCard(player, state.players[targetId], state);
        state.phase = 'ACTION_PHASE';
      } else {
        state.phase = 'ROBBER_STEAL';
        state.pendingStealTargets = targetsArray;
      }

      state.actionLog.push({
        id: `log_${Date.now()}`,
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
      if (action.playerId !== state.currentTurnPlayerId) {
        return { success: false, error: 'Not your turn to steal.' };
      }
      if (!state.pendingStealTargets.includes(action.targetPlayerId)) {
        return { success: false, error: 'Cannot steal from this player.' };
      }

      const target = state.players[action.targetPlayerId];
      stealRandomCard(player, target, state);
      state.pendingStealTargets = [];
      state.phase = 'ACTION_PHASE';

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
      if (!canAfford(player.resources, BUILDING_COSTS.road)) {
        return { success: false, error: 'Cannot afford road (1 Wood + 1 Brick required).' };
      }
      const edge = state.board.edges[action.edgeId];
      if (!edge) return { success: false, error: 'Invalid edge.' };
      if (state.board.roads[action.edgeId]) {
        return { success: false, error: 'Road already exists here.' };
      }

      // Check connectivity: must touch friendly road or friendly settlement/city
      const v1Building = state.board.buildings[edge.v1];
      const v2Building = state.board.buildings[edge.v2];

      const v1TouchesOwnBuilding = v1Building && v1Building.playerId === action.playerId;
      const v2TouchesOwnBuilding = v2Building && v2Building.playerId === action.playerId;

      // Check friendly roads touching v1 or v2 (provided the vertex is not blocked by an opponent building)
      const v1FriendlyRoad =
        (!v1Building || v1Building.playerId === action.playerId) &&
        Object.values(state.board.roads).some(
          (r) =>
            r.playerId === action.playerId &&
            (state.board.edges[r.edgeId].v1 === edge.v1 || state.board.edges[r.edgeId].v2 === edge.v1),
        );

      const v2FriendlyRoad =
        (!v2Building || v2Building.playerId === action.playerId) &&
        Object.values(state.board.roads).some(
          (r) =>
            r.playerId === action.playerId &&
            (state.board.edges[r.edgeId].v1 === edge.v2 || state.board.edges[r.edgeId].v2 === edge.v2),
        );

      if (!v1TouchesOwnBuilding && !v2TouchesOwnBuilding && !v1FriendlyRoad && !v2FriendlyRoad) {
        return { success: false, error: 'Road must connect to your existing network.' };
      }

      // Deduct cost and place
      player.resources = deductCost(player.resources, BUILDING_COSTS.road);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.road);
      state.board.roads[action.edgeId] = {
        id: `r_${action.edgeId}`,
        playerId: action.playerId,
        edgeId: action.edgeId,
      };
      player.roadsLeft--;

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
        id: `log_${Date.now()}`,
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
        return { success: false, error: 'Violates distance rule (too close to another building).' };
      }

      // Must connect to at least 1 friendly road
      const hasConnectingRoad = Object.values(state.board.roads).some(
        (r) =>
          r.playerId === action.playerId &&
          (state.board.edges[r.edgeId].v1 === action.vertexId || state.board.edges[r.edgeId].v2 === action.vertexId),
      );

      if (!hasConnectingRoad) {
        return { success: false, error: 'Settlement must connect to one of your roads.' };
      }

      // Deduct cost and place
      player.resources = deductCost(player.resources, BUILDING_COSTS.settlement);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.settlement);
      state.board.buildings[action.vertexId] = {
        id: `b_${action.vertexId}`,
        type: 'settlement',
        playerId: action.playerId,
        vertexId: action.vertexId,
      };
      player.settlementsLeft--;

      // Recalculate Longest Route (in case this settlement interrupts an opponent)
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
        id: `log_${Date.now()}`,
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

      // Upgrade settlement to city
      player.resources = deductCost(player.resources, BUILDING_COSTS.city);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.city);
      existingBuilding.type = 'city';
      player.citiesLeft--;
      player.settlementsLeft++; // returns settlement back to supply

      state.actionLog.push({
        id: `log_${Date.now()}`,
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
        id: `log_${Date.now()}`,
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

      // Cannot play card on turn bought (unless VP card when winning)
      if (card.boughtTurn === state.turnNumber && card.type !== 'victory_point') {
        return { success: false, error: 'Cannot play a Development Card on the turn you bought it.' };
      }

      if (card.type !== 'victory_point' && state.devCardPlayedThisTurn) {
        return { success: false, error: 'Only one Development Card can be played per turn.' };
      }

      // Handle card effects
      if (card.type === 'knight') {
        player.playedKnightsCount++;
        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        // Check Largest Army (minimum 3 needed)
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

        // Enter Robber movement
        state.phase = 'ROBBER_PLACEMENT';
        state.actionLog.push({
          id: `log_${Date.now()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played a Knight card!`,
          category: 'card',
        });
      } else if (card.type === 'year_of_plenty') {
        if (!action.options?.yearOfPlentyResources || action.options.yearOfPlentyResources.length !== 2) {
          return { success: false, error: 'Must select 2 resources for Year of Plenty.' };
        }
        const [r1, r2] = action.options.yearOfPlentyResources;
        player.resources[r1] = (player.resources[r1] || 0) + 1;
        player.resources[r2] = (player.resources[r2] || 0) + 1;
        state.resourceBank[r1] = Math.max(0, state.resourceBank[r1] - 1);
        state.resourceBank[r2] = Math.max(0, state.resourceBank[r2] - 1);

        state.devCardPlayedThisTurn = true;
        player.devCards.splice(cardIdx, 1);
        player.playedDevCards.push(card);

        state.actionLog.push({
          id: `log_${Date.now()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} played Year of Plenty (took ${r1} and ${r2}).`,
          category: 'card',
        });
      } else if (card.type === 'monopoly') {
        if (!action.options?.monopolyResource) {
          return { success: false, error: 'Must name a resource for Monopoly.' };
        }
        const targetRes = action.options.monopolyResource;
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
          id: `log_${Date.now()}`,
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

      // Check player harbors
      const bestRatio = getPlayerMaritimeRatio(player.id, action.giving, state.board);
      if (action.ratio < bestRatio) {
        return { success: false, error: `Your best maritime trade ratio for ${action.giving} is ${bestRatio}:1.` };
      }

      player.resources[action.giving] -= action.ratio;
      state.resourceBank[action.giving] += action.ratio;

      player.resources[action.asking] += 1;
      state.resourceBank[action.asking] -= 1;

      state.actionLog.push({
        id: `log_${Date.now()}`,
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
        id: `log_${Date.now()}`,
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

        // If active player wants instant execution, they can accept this acceptance
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
        id: `log_${Date.now()}`,
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

      // In a counter-offer:
      // counter.giving is what counterPlayer gives to active player
      // counter.asking is what counterPlayer receives from active player
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
      const is56 = state.settings.pairedPlayersTurn;
      state.activeTradeOffer = null;

      if (!is56) {
        // Standard 3-4 Player end turn: passes clockwise
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
        // 5-6 Player (Official 2025 6th Edition Paired Turn System)
        if (state.phase === 'ACTION_PHASE') {
          if (action.playerId !== state.currentTurnPlayerId) {
            return { success: false, error: 'Not your turn.' };
          }
          // Player 1 finishes their action phase.
          // Player 2 takes their Paired Action Phase!
          const playerIds = Object.keys(state.players);
          state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, playerIds);
          state.phase = 'PAIRED_ACTION_PHASE';

          state.actionLog.push({
            id: `log_${Date.now()}`,
            timestamp: Date.now(),
            playerId: state.pairedPlayerId,
            message: `Paired Players Turn: ${state.players[state.pairedPlayerId].name} begins their Action Phase.`,
            category: 'system',
          });
        } else if (state.phase === 'PAIRED_ACTION_PHASE') {
          if (action.playerId !== state.pairedPlayerId) {
            return { success: false, error: 'Not your paired action phase.' };
          }
          // Player 2 finishes their action phase.
          // Pass the dice and player markers clockwise!
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

      syncPlayerVPs(state);
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown action type.' };
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
    id: `log_${Date.now()}`,
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
    id: `log_${Date.now()}`,
    timestamp: Date.now(),
    message: `Trade completed between ${p1.name} and ${p2.name}!`,
    category: 'trade',
  });

  syncPlayerVPs(state);
}

export function getPlayerMaritimeRatio(playerId: string, resource: ResourceType, board: BoardState): number {
  let best = 4; // default bank trade

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
