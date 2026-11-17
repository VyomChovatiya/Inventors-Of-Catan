import {
  BoardState,
  CommodityCount,
  CommodityType,
  CounterOffer,
  GameState,
  ProgressCardDiscipline,
  ResourceCount,
  ResourceType,
  TradeOffer,
  TradePayload,
  TradeableCardType,
} from '../types/index.js';
import {
  BUILDING_COSTS,
  DISCIPLINE_COMMODITY,
  VALID_COMMODITIES,
  VALID_RESOURCES,
  VALID_TRADEABLES,
  addResources,
  addTradePayloadToPlayer,
  canAfford,
  canAffordTradePayload,
  deductCost,
  deductTradePayloadFromPlayer,
  isValidCommodityType,
  isValidDiscipline,
  isValidResourcePayload,
  isValidResourceType,
  isValidTradePayload,
  isValidTradeableType,
  sumCommodities,
  sumResources,
  sumTradePayload,
} from './costs.js';
import {
  drawBalancedDiceRoll,
  evaluateAndNotifyHarborMaster,
  getNormalTurnDurationMs,
  getOrderedPlayerIds,
  getPairedPlayerId,
  isValidRoadEdge,
  isValidRobberHex,
  isValidSettlementVertex,
  pauseNormalTurnTimer,
  refreshTurnTimer,
  resumeNormalTurnTimer,
  rollOrdinaryDice,
  satisfiesDistanceRule,
  syncPlayerVPs,
} from './engine.js';
import {
  CITY_IMPROVEMENT_NAMES,
  PROGRESS_CARD_METADATA,
  drawProgressCardForPlayer,
  getPlayerDiscardLimit,
  getPlayerVulnerableCityVertices,
  getReachableKnightVertices,
  isOpenRoadEdge,
  isValidKnightRecruitVertex,
  pillageCityAtVertex,
  resolveCKProduction,
  resolveEventDie,
  rollEventDie,
} from './citiesAndKnights.js';
import { updateLongestRouteOwner } from './longestRoute.js';
import { cryptoRandomInt, shuffle } from '../board/generator.js';

export interface PlayProgressCardOptions {
  // Alchemy
  alchemyDice?: [number, number];
  // Engineering
  cityVertexId?: string;
  // Invention
  swapHexIds?: [string, string];
  // Smithing
  knightVertexIds?: string[];
  // Merchant / Taxation
  hexId?: string;
  // Merchant Fleet
  tradeableType?: TradeableCardType;
  // Resource Monopoly
  resource?: ResourceType;
  // Trade Monopoly
  commodity?: CommodityType;
  // Diplomacy
  edgeId?: string;
  // Intrigue
  knightVertexId?: string;
  // Guild Dues / Espionage / Treason
  targetPlayerId?: string;
  chosenCards?: TradeableCardType[];
  stolenCardId?: string;
  // Commercial Harbor
  commercialHarborOffers?: Array<{ targetPlayerId: string; offeredResource: ResourceType }>;
}

export type GameAction =
  | { type: 'BUILD_SETUP_SETTLEMENT'; playerId: string; vertexId: string }
  | { type: 'BUILD_SETUP_ROAD'; playerId: string; edgeId: string }
  | { type: 'ROLL_DICE'; playerId: string }
  | {
      type: 'DISCARD_CARDS';
      playerId: string;
      resources: TradePayload;
      commodities?: Partial<CommodityCount>;
    }
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
  | {
      type: 'MARITIME_TRADE';
      playerId: string;
      giving: TradeableCardType;
      asking: TradeableCardType;
      ratio: number;
    }
  | {
      type: 'MARITIME_BATCH_TRADE';
      playerId: string;
      giving: TradePayload;
      asking: TradePayload;
    }
  | {
      type: 'PROPOSE_TRADE';
      playerId: string;
      giving: TradePayload;
      asking: TradePayload;
      targetPlayerId?: string;
    }
  | { type: 'RESPOND_TRADE'; playerId: string; tradeId: string; accept: boolean }
  | {
      type: 'COUNTER_TRADE';
      playerId: string;
      tradeId: string;
      giving: TradePayload;
      asking: TradePayload;
    }
  | { type: 'ACCEPT_COUNTER_TRADE'; playerId: string; tradeId: string; counterId: string }
  | { type: 'CANCEL_TRADE'; playerId: string; tradeId: string }
  | { type: 'END_TURN'; playerId: string }
  // Cities & Knights Actions
  | { type: 'BUILD_CITY_WALL'; playerId: string; vertexId: string }
  | {
      type: 'UPGRADE_CITY_IMPROVEMENT';
      playerId: string;
      discipline: ProgressCardDiscipline;
      cityVertexId?: string;
    }
  | { type: 'RECRUIT_KNIGHT'; playerId: string; vertexId: string }
  | { type: 'ACTIVATE_KNIGHT'; playerId: string; vertexId: string }
  | { type: 'PROMOTE_KNIGHT'; playerId: string; vertexId: string }
  | { type: 'MOVE_KNIGHT'; playerId: string; fromVertexId: string; toVertexId: string }
  | { type: 'MOVE_DISPLACED_KNIGHT'; playerId: string; toVertexId: string }
  | { type: 'CHASE_ROBBER'; playerId: string; knightVertexId: string; hexId: string }
  | {
      type: 'PLAY_PROGRESS_CARD';
      playerId: string;
      cardId: string;
      options?: PlayProgressCardOptions;
    }
  | { type: 'DISCARD_PROGRESS_CARD'; playerId: string; cardId: string }
  | { type: 'CHOOSE_AQUEDUCT_RESOURCE'; playerId: string; resource: ResourceType }
  | { type: 'CHOOSE_BARBARIAN_REWARD'; playerId: string; discipline: ProgressCardDiscipline }
  | { type: 'CHOOSE_PILLAGED_CITY'; playerId: string; vertexId: string }
  | { type: 'RESOLVE_GUILD_DUES'; playerId: string; cards: TradeableCardType[] }
  | { type: 'RESOLVE_ESPIONAGE'; playerId: string; cardId: string }
  | { type: 'GIVE_WEDDING_CARDS'; playerId: string; cards: TradePayload }
  | { type: 'RESPOND_COMMERCIAL_HARBOR'; playerId: string; commodity: CommodityType }
  | { type: 'CHOOSE_DESERTER_KNIGHT'; playerId: string; vertexId: string }
  | { type: 'PLACE_DESERTER_KNIGHT'; playerId: string; vertexId: string; level?: 1 | 2 | 3 };

export interface ActionResult {
  success: boolean;
  error?: string;
  stateChanged?: boolean;
}

function validateDomesticTradePayloads(
  giving: unknown,
  asking: unknown,
  freeTradesEnabled: boolean,
  allowCommodities = false,
):
  | { valid: true; cleanGiving: TradePayload; cleanAsking: TradePayload }
  | { valid: false; error: string } {
  if (!isValidTradePayload(giving, allowCommodities) || !isValidTradePayload(asking, allowCommodities)) {
    return {
      success: false,
      valid: false,
      error: 'Invalid resource quantities: must be non-negative integers for valid resources.',
    } as any;
  }

  const totalGiving = sumTradePayload(giving, allowCommodities);
  const totalAsking = sumTradePayload(asking, allowCommodities);

  if (totalGiving <= 0 && totalAsking <= 0) {
    return { valid: false, error: 'Entirely empty trades are not allowed.' };
  }

  if (!freeTradesEnabled && (totalGiving <= 0 || totalAsking <= 0)) {
    return {
      valid: false,
      error: 'Free trades are disabled! Both sides must give at least 1 card.',
    };
  }

  const validKeys = allowCommodities ? VALID_TRADEABLES : VALID_RESOURCES;

  for (const res of validKeys) {
    if ((giving[res] || 0) > 0 && (asking[res] || 0) > 0) {
      return {
        valid: false,
        error: `Cannot trade ${res} for ${res} in the same offer!`,
      };
    }
  }

  const cleanGiving: TradePayload = {};
  const cleanAsking: TradePayload = {};
  for (const res of validKeys) {
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

function returnKnightLevelToSupply(player: any, level: 1 | 2 | 3) {
  if (level === 1) player.basicKnightsLeft = Math.min(2, (player.basicKnightsLeft ?? 0) + 1);
  else if (level === 2) player.strongKnightsLeft = Math.min(2, (player.strongKnightsLeft ?? 0) + 1);
  else if (level === 3) player.mightyKnightsLeft = Math.min(2, (player.mightyKnightsLeft ?? 0) + 1);
}

function deductKnightLevelFromSupply(player: any, level: 1 | 2 | 3): boolean {
  if (level === 1) {
    if ((player.basicKnightsLeft ?? 0) <= 0) return false;
    player.basicKnightsLeft--;
    return true;
  }
  if (level === 2) {
    if ((player.strongKnightsLeft ?? 0) <= 0) return false;
    player.strongKnightsLeft--;
    return true;
  }
  if ((player.mightyKnightsLeft ?? 0) <= 0) return false;
  player.mightyKnightsLeft--;
  return true;
}

function handleDisplacedOpponentKnight(
  state: GameState,
  displacedKnight: NonNullable<BoardState['knights']>[string],
  displacerName: string,
) {
  const victim = state.players[displacedKnight.playerId];
  const { emptyVertices } = getReachableKnightVertices(
    state.board,
    displacedKnight.playerId,
    displacedKnight.vertexId,
    displacedKnight.level,
  );

  if (emptyVertices.length === 0) {
    if (victim) {
      returnKnightLevelToSupply(victim, displacedKnight.level);
    }
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: displacedKnight.playerId,
      message: `⚔️ ${displacerName} displaced ${victim?.name || 'opponent'}'s Level ${displacedKnight.level} Knight! With no connected empty vertex, it was removed from the board.`,
      category: 'build',
    });
  } else if (emptyVertices.length === 1) {
    const destV = emptyVertices[0];
    if (!state.board.knights) state.board.knights = {};
    state.board.knights[destV] = {
      ...displacedKnight,
      vertexId: destV,
    };
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: displacedKnight.playerId,
      message: `⚔️ ${displacerName} displaced ${victim?.name || 'opponent'}'s Level ${displacedKnight.level} Knight to an adjacent road vertex.`,
      category: 'build',
    });
  } else {
    pauseNormalTurnTimer(state);
    state.pendingDisplacedKnight = {
      playerId: displacedKnight.playerId,
      knightId: displacedKnight.id,
      fromVertexId: displacedKnight.vertexId,
      level: displacedKnight.level,
      active: displacedKnight.active,
      recruitedTurn: displacedKnight.recruitedTurn,
      activatedTurn: displacedKnight.activatedTurn,
      promotedTurn: displacedKnight.promotedTurn,
      actionTakenTurn: displacedKnight.actionTakenTurn,
      validVertexIds: emptyVertices,
    };
    refreshTurnTimer(state);
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: displacedKnight.playerId,
      message: `⚔️ ${displacerName} displaced ${victim?.name || 'opponent'}'s Level ${displacedKnight.level} Knight! ${victim?.name || 'Opponent'} must choose where to relocate it.`,
      category: 'build',
    });
  }
}

function hasAnyPendingCKPrompts(state: GameState): boolean {
  return (
    Boolean(state.pendingDisplacedKnight) ||
    Boolean(state.pendingDeserter) ||
    Boolean(state.pendingGuildDues) ||
    Boolean(state.pendingEspionage) ||
    (state.pendingWeddingPlayerIds?.length || 0) > 0 ||
    (state.pendingCommercialHarbor?.length || 0) > 0 ||
    (state.pendingAqueductPlayerIds?.length || 0) > 0 ||
    (state.pendingBarbarianRewardPlayerIds?.length || 0) > 0 ||
    (state.pendingBarbarianPillagePlayerIds?.length || 0) > 0
  );
}

function resumeTimerIfCKPromptsCleared(state: GameState) {
  if (!hasAnyPendingCKPrompts(state) && state.freeRoadsRemaining === 0) {
    resumeNormalTurnTimer(state);
  }
}

function getBankSupply(state: GameState, type: TradeableCardType): number {
  if (isValidResourceType(type)) {
    return state.resourceBank[type] || 0;
  }
  return state.commodityBank?.[type] || 0;
}

function adjustBankSupply(state: GameState, type: TradeableCardType, delta: number) {
  if (isValidResourceType(type)) {
    state.resourceBank[type] = Math.max(0, (state.resourceBank[type] || 0) + delta);
  } else if (isValidCommodityType(type)) {
    if (!state.commodityBank) state.commodityBank = { cloth: 0, coin: 0, paper: 0 };
    state.commodityBank[type] = Math.max(0, (state.commodityBank[type] || 0) + delta);
  }
}

function getPlayerCardSupply(player: any, type: TradeableCardType): number {
  if (isValidResourceType(type)) {
    return player.resources[type] || 0;
  }
  return player.commodities?.[type] || 0;
}

function adjustPlayerCardSupply(player: any, type: TradeableCardType, delta: number) {
  if (isValidResourceType(type)) {
    player.resources[type] = Math.max(0, (player.resources[type] || 0) + delta);
  } else if (isValidCommodityType(type)) {
    if (!player.commodities) player.commodities = { cloth: 0, coin: 0, paper: 0 };
    player.commodities[type] = Math.max(0, (player.commodities[type] || 0) + delta);
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
  if (!player.commodities) {
    player.commodities = { cloth: 0, coin: 0, paper: 0 };
  }
  if (!player.progressCards) {
    player.progressCards = [];
  }
  if (!player.playedProgressCards) {
    player.playedProgressCards = [];
  }
  if (!player.cityImprovements) {
    player.cityImprovements = { trade: 0, politics: 0, science: 0 };
  }

  const isCK = state.settings.expansion === 'cities_and_knights';

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
        return {
          success: false,
          error: 'You already placed your building. Now place a road attached to it!',
        };
      }
      if (typeof action.vertexId !== 'string' || !state.board.vertices[action.vertexId]) {
        return { success: false, error: 'Invalid vertex.' };
      }
      if (!satisfiesDistanceRule(action.vertexId, state.board)) {
        return {
          success: false,
          error: 'Violates Distance Rule: must be at least 2 edges away from any building.',
        };
      }

      const placeCity = isCK && state.phase === 'SETUP_ROUND_2';

      state.board.buildings[action.vertexId] = {
        id: `b_${action.vertexId}`,
        type: placeCity ? 'city' : 'settlement',
        playerId: action.playerId,
        vertexId: action.vertexId,
      };
      if (placeCity) {
        player.citiesLeft--;
      } else {
        player.settlementsLeft--;
      }
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
        const label = placeCity ? 'starting City' : '2nd settlement';
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message:
            received.length > 0
              ? `${player.name} placed ${label} and received starting resources (${received.join(', ')}).`
              : `${player.name} placed ${label}.`,
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

      evaluateAndNotifyHarborMaster(state);
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
        return { success: false, error: 'Place your starting building first!' };
      }
      if (typeof action.edgeId !== 'string') {
        return { success: false, error: 'Invalid edge.' };
      }

      const edge = state.board.edges[action.edgeId];
      if (!edge) return { success: false, error: 'Invalid edge.' };
      if (state.board.roads[action.edgeId]) {
        return { success: false, error: 'Road already exists here.' };
      }

      const connectsToLastSettlement =
        edge.v1 === state.lastSetupVertexId || edge.v2 === state.lastSetupVertexId;

      if (!connectsToLastSettlement) {
        return {
          success: false,
          error: 'Starting road must connect directly to the building you just placed!',
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

      const orderedIds = getOrderedPlayerIds(state);
      const isNoEarly7sWindow =
        Boolean(state.settings?.houseRules?.noEarly7s) &&
        !state.pendingAlchemyRoll &&
        state.turnNumber <= orderedIds.length * 2;

      let d1: number;
      let d2: number;
      if (state.pendingAlchemyRoll) {
        [d1, d2] = state.pendingAlchemyRoll;
        state.pendingAlchemyRoll = null;
      } else if (state.settings?.houseRules?.balancedDice) {
        [d1, d2] = drawBalancedDiceRoll(state);
        let guard = 0;
        while (isNoEarly7sWindow && d1 + d2 === 7 && guard < 20) {
          [d1, d2] = drawBalancedDiceRoll(state);
          guard++;
        }
        if (isNoEarly7sWindow && d1 + d2 === 7) {
          [d1, d2] = [3, 3];
        }
      } else {
        [d1, d2] = rollOrdinaryDice();
        while (isNoEarly7sWindow && d1 + d2 === 7) {
          [d1, d2] = rollOrdinaryDice();
        }
      }

      const sum = d1 + d2;
      state.diceRoll = [d1, d2];
      state.redDie = d2;
      if (!state.diceHistory) {
        state.diceHistory = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0, 10: 0, 11: 0, 12: 0 };
      }
      state.diceHistory[sum] = (state.diceHistory[sum] || 0) + 1;
      state.lastDiceRollAt = Date.now();
      state.diceRolledThisTurn = true;

      if (isCK) {
        const eventFace = rollEventDie();
        state.eventDie = eventFace;
        const eventLabel =
          eventFace === 'barbarian'
            ? '⛵ Barbarian Ship'
            : `🏛️ ${eventFace.charAt(0).toUpperCase() + eventFace.slice(1)} Gate`;

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} rolled ${sum} (White ${d1} + Red ${d2}) • Event: ${eventLabel}.`,
          category: 'dice',
        });

        // Step 1 in Cities & Knights: Resolve Event Die first
        resolveEventDie(state, eventFace, d2, orderedIds);
        evaluateAndNotifyHarborMaster(state);
      } else {
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `${player.name} rolled ${sum} (${d1} + ${d2}).`,
          category: 'dice',
        });
      }

      // Step 2: Resolve Production or 7
      if (sum === 7) {
        state.savedActionRemainingMs = null;
        state.robberControllerPlayerId = action.playerId;
        const discards: Record<string, number> = {};
        for (const p of Object.values(state.players)) {
          const totalCards =
            Object.values(p.resources).reduce((s, n) => s + n, 0) + sumCommodities(p.commodities);
          const playerLimit = getPlayerDiscardLimit(state, p.id);
          if (totalCards > playerLimit) {
            discards[p.id] = Math.floor(totalCards / 2);
          }
        }

        if (Object.keys(discards).length > 0) {
          state.phase = 'DISCARD_PHASE';
          state.postDiscardPhase = null;
          state.pendingDiscards = discards;
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            message: `A 7 was rolled! Players over their hand limit must discard half.`,
            category: 'robber',
          });
        } else if (isCK && !state.robberActive) {
          state.robberControllerPlayerId = null;
          state.phase = 'ACTION_PHASE';
          if (hasAnyPendingCKPrompts(state)) {
            state.savedActionRemainingMs = getNormalTurnDurationMs(state);
          }
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            message: `A 7 was rolled, but the Robber remains inactive until after the first Barbarian Attack.`,
            category: 'robber',
          });
        } else {
          state.phase = 'ROBBER_PLACEMENT';
        }
      } else if (isCK) {
        state.savedActionRemainingMs = null;
        resolveCKProduction(state, sum, orderedIds);
        state.phase = 'ACTION_PHASE';
        if (hasAnyPendingCKPrompts(state)) {
          state.savedActionRemainingMs = getNormalTurnDurationMs(state);
        }
      } else {
        state.savedActionRemainingMs = null;
        // Base Game production
        const owedByResource: Record<ResourceType, Record<string, number>> = {
          wood: {},
          brick: {},
          wheat: {},
          sheep: {},
          ore: {},
        };

        const isCombined2And12 = Boolean(state.settings?.houseRules?.combined2And12);
        const matchesRoll = (hexNum?: number) =>
          hexNum === sum || (isCombined2And12 && (sum === 2 || sum === 12) && (hexNum === 2 || hexNum === 12));

        for (const hex of Object.values(state.board.hexes)) {
          if (matchesRoll(hex.number) && !hex.hasRobber && hex.resource) {
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

      evaluateAndNotifyHarborMaster(state);
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

      // Support combined TradePayload in action.resources and/or optional action.commodities
      if (!isValidTradePayload(action.resources, isCK)) {
        return {
          success: false,
          error: 'Invalid resource quantities: must be non-negative integers.',
        };
      }
      if (action.commodities !== undefined && !isValidTradePayload(action.commodities, true)) {
        return {
          success: false,
          error: 'Invalid commodity quantities: must be non-negative integers.',
        };
      }

      const combinedDiscard: TradePayload = { ...action.resources };
      if (action.commodities) {
        for (const c of VALID_COMMODITIES) {
          if ((action.commodities[c] || 0) > 0) {
            combinedDiscard[c] = (combinedDiscard[c] || 0) + (action.commodities[c] || 0);
          }
        }
      }

      const totalDiscarded = sumTradePayload(combinedDiscard, isCK);
      if (totalDiscarded !== needed) {
        return { success: false, error: `You must discard exactly ${needed} cards.` };
      }

      if (!canAffordTradePayload(player.resources, player.commodities, combinedDiscard, isCK)) {
        return { success: false, error: 'You do not hold these cards.' };
      }

      deductTradePayloadFromPlayer(player, combinedDiscard);
      for (const r of VALID_RESOURCES) {
        const amt = combinedDiscard[r] || 0;
        if (amt > 0) state.resourceBank[r] = (state.resourceBank[r] || 0) + amt;
      }
      if (isCK) {
        if (!state.commodityBank) state.commodityBank = { cloth: 0, coin: 0, paper: 0 };
        for (const c of VALID_COMMODITIES) {
          const amt = combinedDiscard[c] || 0;
          if (amt > 0) state.commodityBank[c] = (state.commodityBank[c] || 0) + amt;
        }
      }

      delete state.pendingDiscards[action.playerId];

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} discarded ${needed} cards.`,
        category: 'robber',
      });

      if (Object.keys(state.pendingDiscards).length === 0) {
        if (state.postDiscardPhase) {
          state.phase = state.postDiscardPhase;
          state.postDiscardPhase = null;
          resumeNormalTurnTimer(state);
        } else if (isCK && !state.robberActive) {
          state.phase = 'ACTION_PHASE';
          state.robberControllerPlayerId = null;
          if (hasAnyPendingCKPrompts(state)) {
            state.savedActionRemainingMs = getNormalTurnDurationMs(state);
          }
          refreshTurnTimer(state);
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            message: `Discards complete! The Robber remains inactive until after the first Barbarian Attack.`,
            category: 'robber',
          });
        } else {
          state.phase = 'ROBBER_PLACEMENT';
          state.robberControllerPlayerId = state.currentTurnPlayerId;
          refreshTurnTimer(state);
        }
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
      if (!targetHex || targetHex.terrain === 'sea') {
        return { success: false, error: 'Invalid land hex.' };
      }
      if (!isValidRobberHex(state, action.hexId, action.playerId)) {
        return {
          success: false,
          error: 'Friendly Robber is active: cannot place the Robber on a hex adjacent to a player at starting Victory Points!',
        };
      }

      const oldHex = state.board.hexes[state.board.robberHexId];
      if (oldHex) oldHex.hasRobber = false;
      targetHex.hasRobber = true;
      state.board.robberHexId = action.hexId;
      state.robberActive = true;

      const stealTargets = new Set<string>();
      for (const vertex of Object.values(state.board.vertices)) {
        if (vertex.hexCoords.includes(action.hexId)) {
          const b = state.board.buildings[vertex.id];
          if (b && b.playerId !== action.playerId) {
            const targetP = state.players[b.playerId];
            if (
              targetP &&
              (Object.values(targetP.resources).some((n) => n > 0) ||
                sumCommodities(targetP.commodities) > 0)
            ) {
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
        if (
          (state.phase === 'ACTION_PHASE' || state.phase === 'PAIRED_ACTION_PHASE') &&
          hasAnyPendingCKPrompts(state) &&
          !state.savedActionRemainingMs
        ) {
          state.savedActionRemainingMs = getNormalTurnDurationMs(state);
        }
        resumeNormalTurnTimer(state);
      } else if (targetsArray.length === 1) {
        const targetId = targetsArray[0];
        stealRandomCard(player, state.players[targetId], state);
        state.phase = nextPhaseAfterRobber;
        state.robberControllerPlayerId = null;
        if (
          (state.phase === 'ACTION_PHASE' || state.phase === 'PAIRED_ACTION_PHASE') &&
          hasAnyPendingCKPrompts(state) &&
          !state.savedActionRemainingMs
        ) {
          state.savedActionRemainingMs = getNormalTurnDurationMs(state);
        }
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

      if (
        (state.phase === 'ACTION_PHASE' || state.phase === 'PAIRED_ACTION_PHASE') &&
        hasAnyPendingCKPrompts(state) &&
        !state.savedActionRemainingMs
      ) {
        state.savedActionRemainingMs = getNormalTurnDurationMs(state);
      }
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
        return { success: false, error: 'Violates Distance Rule: too close to another building or occupied by a knight.' };
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
      evaluateAndNotifyHarborMaster(state);
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
      const hasMedicineDiscount = isCK && (state.medicineDiscountsRemaining || 0) > 0;
      const cityCost = hasMedicineDiscount ? BUILDING_COSTS.cityMedicine : BUILDING_COSTS.city;

      if (!canAfford(player.resources, cityCost)) {
        return {
          success: false,
          error: hasMedicineDiscount
            ? 'Cannot afford City with Medicine (1 Wheat + 2 Ore required).'
            : 'Cannot afford City (2 Wheat + 3 Ore required).',
        };
      }
      if (typeof action.vertexId !== 'string' || !state.board.vertices[action.vertexId]) {
        return { success: false, error: 'Invalid vertex.' };
      }

      const existingBuilding = state.board.buildings[action.vertexId];
      if (!existingBuilding || existingBuilding.playerId !== action.playerId || existingBuilding.type !== 'settlement') {
        return { success: false, error: 'Must upgrade an existing settlement of your own.' };
      }

      player.resources = deductCost(player.resources, cityCost);
      state.resourceBank = addResources(state.resourceBank, cityCost);
      if (hasMedicineDiscount) {
        state.medicineDiscountsRemaining = Math.max(0, (state.medicineDiscountsRemaining || 0) - 1);
      }
      existingBuilding.type = 'city';
      player.citiesLeft--;
      player.settlementsLeft = Math.min(5, player.settlementsLeft + 1);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} upgraded a settlement to a City${hasMedicineDiscount ? ' (using Medicine)' : ''}!`,
        category: 'build',
      });

      evaluateAndNotifyHarborMaster(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'BUILD_CITY_WALL': {
      if (!isCK) {
        return { success: false, error: 'City Walls are only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if ((player.cityWallsLeft ?? 0) <= 0) {
        return { success: false, error: 'You have no City Walls remaining in your supply (max 3).' };
      }
      if (!canAfford(player.resources, BUILDING_COSTS.cityWall)) {
        return { success: false, error: 'Cannot afford City Wall (2 Brick required).' };
      }
      const b = state.board.buildings[action.vertexId];
      if (!b || b.playerId !== action.playerId || b.type !== 'city') {
        return { success: false, error: 'City Wall must be built under one of your Cities.' };
      }
      if (b.hasWall) {
        return { success: false, error: 'This City already has a City Wall.' };
      }

      player.resources = deductCost(player.resources, BUILDING_COSTS.cityWall);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.cityWall);
      b.hasWall = true;
      player.cityWallsLeft--;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🧱 ${player.name} built a City Wall (hand limit on 7 increased to ${getPlayerDiscardLimit(state, player.id)}).`,
        category: 'build',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'UPGRADE_CITY_IMPROVEMENT': {
      if (!isCK) {
        return { success: false, error: 'City Improvements are only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }
      if (!isValidDiscipline(action.discipline)) {
        return { success: false, error: 'Invalid city improvement discipline.' };
      }

      const playerCities = Object.values(state.board.buildings).filter(
        (b) => b.playerId === action.playerId && b.type === 'city',
      );
      if (playerCities.length === 0) {
        return { success: false, error: 'You must own at least 1 City on the board to build City Improvements.' };
      }

      const currentLevel = player.cityImprovements[action.discipline] || 0;
      if (currentLevel >= 5) {
        return { success: false, error: `Your ${action.discipline} improvement is already at the maximum Level 5.` };
      }

      const targetLevel = currentLevel + 1;
      const commodityType = DISCIPLINE_COMMODITY[action.discipline];
      const hasCraneDiscount = (state.craneDiscountsRemaining || 0) > 0;
      const commodityCost = Math.max(0, targetLevel - (hasCraneDiscount ? 1 : 0));

      if ((player.commodities[commodityType] || 0) < commodityCost) {
        return {
          success: false,
          error: `Need ${commodityCost} ${commodityType} to upgrade ${action.discipline} to Level ${targetLevel}.`,
        };
      }

      // Check Metropolis rules if upgrading to Level 4 or 5:
      // To claim a Metropolis at Level 4 (when unclaimed) or steal it at Level 5 (when current owner is at Level 4),
      // the player must have at least 1 City on the board that does not already have a Metropolis.
      if (!state.metropolises) {
        state.metropolises = {
          trade: { ownerId: null, vertexId: null, level: 0 },
          politics: { ownerId: null, vertexId: null, level: 0 },
          science: { ownerId: null, vertexId: null, level: 0 },
        };
      }
      const metro = state.metropolises[action.discipline];
      const nonMetroCities = playerCities.filter((b) => !b.metropolis);
      const wouldClaimMetropolis =
        targetLevel >= 4 &&
        metro.ownerId !== player.id &&
        (metro.ownerId === null || targetLevel > metro.level);

      if (wouldClaimMetropolis && nonMetroCities.length === 0) {
        return {
          success: false,
          error: 'You must own a City without a Metropolis to claim this Metropolis!',
        };
      }

      // Deduct commodities
      if (commodityCost > 0) {
        player.commodities[commodityType] -= commodityCost;
        if (!state.commodityBank) state.commodityBank = { cloth: 0, coin: 0, paper: 0 };
        state.commodityBank[commodityType] += commodityCost;
      }
      if (hasCraneDiscount) {
        state.craneDiscountsRemaining = Math.max(0, (state.craneDiscountsRemaining || 0) - 1);
      }

      player.cityImprovements[action.discipline] = targetLevel;
      const buildingName = CITY_IMPROVEMENT_NAMES[action.discipline][targetLevel - 1];

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🏛️ ${player.name} upgraded ${action.discipline.toUpperCase()} to Level ${targetLevel} (${buildingName})${hasCraneDiscount ? ' using Crane' : ''}!`,
        category: 'build',
      });

      if (wouldClaimMetropolis) {
        // Remove Metropolis from previous owner's city if stolen
        if (metro.vertexId && state.board.buildings[metro.vertexId]) {
          delete state.board.buildings[metro.vertexId].metropolis;
        }
        const chosenCity =
          (action.cityVertexId &&
            nonMetroCities.find((c) => c.vertexId === action.cityVertexId)) ||
          nonMetroCities[0];
        chosenCity.metropolis = action.discipline;

        const prevOwnerId = metro.ownerId;
        metro.ownerId = player.id;
        metro.vertexId = chosenCity.vertexId;
        metro.level = targetLevel;

        state.latestAwardEvent = {
          id: `award_metro_${action.discipline}_${Date.now()}`,
          timestamp: Date.now(),
          awardType: 'metropolis',
          playerId: player.id,
          playerName: player.name,
          playerColor: player.color,
          metricValue: targetLevel,
          subtitle: `${action.discipline.toUpperCase()} Metropolis (+2 VP)`,
        };

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: prevOwnerId
            ? `👑 ${player.name} reached Level 5 and took the ${action.discipline.toUpperCase()} Metropolis from ${state.players[prevOwnerId]?.name || 'opponent'} (+2 VP)!`
            : `👑 ${player.name} claimed the ${action.discipline.toUpperCase()} Metropolis (+2 VP)!`,
          category: 'build',
        });
      } else if (metro.ownerId === player.id) {
        metro.level = targetLevel;
      }

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'RECRUIT_KNIGHT': {
      if (!isCK) {
        return { success: false, error: 'Knights on the board are only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      if ((player.basicKnightsLeft ?? 0) <= 0) {
        return { success: false, error: 'No Basic (Level 1) Knights remaining in your supply (max 2).' };
      }
      if (!canAfford(player.resources, BUILDING_COSTS.knight)) {
        return { success: false, error: 'Cannot afford Basic Knight (1 Sheep + 1 Ore required).' };
      }
      if (!isValidKnightRecruitVertex(state, action.playerId, action.vertexId)) {
        return {
          success: false,
          error: 'Knight must be placed on an empty vertex connected to one of your roads.',
        };
      }

      player.resources = deductCost(player.resources, BUILDING_COSTS.knight);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.knight);
      player.basicKnightsLeft--;

      if (!state.board.knights) state.board.knights = {};
      state.board.knights[action.vertexId] = {
        id: `k_${action.playerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        playerId: action.playerId,
        vertexId: action.vertexId,
        level: 1,
        active: false,
        recruitedTurn: state.turnNumber,
        activatedTurn: null,
        promotedTurn: null,
        actionTakenTurn: null,
      };

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🛡️ ${player.name} recruited a Basic Knight (Level 1, inactive).`,
        category: 'build',
      });

      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'ACTIVATE_KNIGHT': {
      if (!isCK) {
        return { success: false, error: 'Knights are only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      const knight = state.board.knights?.[action.vertexId];
      if (!knight || knight.playerId !== action.playerId) {
        return { success: false, error: 'You do not have a Knight at this vertex.' };
      }
      if (knight.active) {
        return { success: false, error: 'This Knight is already active.' };
      }
      if (!canAfford(player.resources, BUILDING_COSTS.activateKnight)) {
        return { success: false, error: 'Cannot afford to activate Knight (1 Wheat required).' };
      }

      player.resources = deductCost(player.resources, BUILDING_COSTS.activateKnight);
      state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.activateKnight);
      knight.active = true;
      knight.activatedTurn = state.turnNumber;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `⚔️ ${player.name} activated their Level ${knight.level} Knight!`,
        category: 'build',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'PROMOTE_KNIGHT': {
      if (!isCK) {
        return { success: false, error: 'Knights are only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }

      const knight = state.board.knights?.[action.vertexId];
      if (!knight || knight.playerId !== action.playerId) {
        return { success: false, error: 'You do not have a Knight at this vertex.' };
      }
      if (knight.level >= 3) {
        return { success: false, error: 'This Knight is already a Mighty Knight (Level 3).' };
      }
      if (knight.promotedTurn === state.turnNumber) {
        return { success: false, error: 'A Knight may only be promoted once per turn.' };
      }

      const nextLevel = (knight.level + 1) as 2 | 3;
      if (nextLevel === 3 && (player.cityImprovements?.politics || 0) < 3) {
        return {
          success: false,
          error: 'You need Politics Level 3 (Fortress) to promote Knights to Mighty (Level 3).',
        };
      }
      if (nextLevel === 2 && (player.strongKnightsLeft ?? 0) <= 0) {
        return { success: false, error: 'No Strong (Level 2) Knights remaining in your supply (max 2).' };
      }
      if (nextLevel === 3 && (player.mightyKnightsLeft ?? 0) <= 0) {
        return { success: false, error: 'No Mighty (Level 3) Knights remaining in your supply (max 2).' };
      }

      const isFreePromo = (state.freeKnightPromotionsRemaining || 0) > 0;
      if (!isFreePromo && !canAfford(player.resources, BUILDING_COSTS.knight)) {
        return { success: false, error: 'Cannot afford to promote Knight (1 Sheep + 1 Ore required).' };
      }

      if (isFreePromo) {
        state.freeKnightPromotionsRemaining = Math.max(0, (state.freeKnightPromotionsRemaining || 0) - 1);
      } else {
        player.resources = deductCost(player.resources, BUILDING_COSTS.knight);
        state.resourceBank = addResources(state.resourceBank, BUILDING_COSTS.knight);
      }

      returnKnightLevelToSupply(player, knight.level);
      deductKnightLevelFromSupply(player, nextLevel);
      knight.level = nextLevel;
      knight.promotedTurn = state.turnNumber;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🛡️ ${player.name} promoted their Knight to Level ${nextLevel}${isFreePromo ? ' (using Smith)' : ''}!`,
        category: 'build',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MOVE_KNIGHT': {
      if (!isCK) {
        return { success: false, error: 'Knights are only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }
      if (state.pendingDisplacedKnight) {
        return { success: false, error: 'Wait for the displaced Knight to be relocated first.' };
      }

      const knight = state.board.knights?.[action.fromVertexId];
      if (!knight || knight.playerId !== action.playerId) {
        return { success: false, error: 'You do not have a Knight at that starting vertex.' };
      }
      if (!knight.active) {
        return { success: false, error: 'Knight must be active to move or displace.' };
      }
      if (knight.activatedTurn === state.turnNumber || knight.recruitedTurn === state.turnNumber) {
        return {
          success: false,
          error: 'A Knight cannot take an action on the same turn it was activated or recruited.',
        };
      }
      if (knight.actionTakenTurn === state.turnNumber) {
        return { success: false, error: 'This Knight has already taken an action this turn.' };
      }

      const { emptyVertices, displaceableKnightVertices } = getReachableKnightVertices(
        state.board,
        action.playerId,
        action.fromVertexId,
        knight.level,
      );

      const isMovingToEmpty = emptyVertices.includes(action.toVertexId);
      const isDisplacing = displaceableKnightVertices.includes(action.toVertexId);

      if (!isMovingToEmpty && !isDisplacing) {
        return {
          success: false,
          error: 'Destination vertex is not reachable along your roads (or has an equal/stronger Knight).',
        };
      }

      if (!state.board.knights) state.board.knights = {};
      delete state.board.knights[action.fromVertexId];

      const displacedOpponentKnight = isDisplacing ? state.board.knights[action.toVertexId] : undefined;
      if (displacedOpponentKnight) {
        delete state.board.knights[action.toVertexId];
      }

      knight.vertexId = action.toVertexId;
      knight.active = false;
      knight.actionTakenTurn = state.turnNumber;
      state.board.knights[action.toVertexId] = knight;

      if (displacedOpponentKnight) {
        handleDisplacedOpponentKnight(state, displacedOpponentKnight, player.name);
      } else {
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `🐎 ${player.name} moved their Level ${knight.level} Knight.`,
          category: 'build',
        });
      }

      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'MOVE_DISPLACED_KNIGHT': {
      if (!state.pendingDisplacedKnight) {
        return { success: false, error: 'No displaced Knight is waiting to be moved.' };
      }
      if (state.pendingDisplacedKnight.playerId !== action.playerId) {
        return { success: false, error: 'It is not your displaced Knight to move.' };
      }
      if (!state.pendingDisplacedKnight.validVertexIds.includes(action.toVertexId)) {
        return { success: false, error: 'Must choose a valid empty vertex connected to your roads.' };
      }

      const pending = state.pendingDisplacedKnight;
      if (!state.board.knights) state.board.knights = {};
      state.board.knights[action.toVertexId] = {
        id: pending.knightId,
        playerId: pending.playerId,
        vertexId: action.toVertexId,
        level: pending.level,
        active: pending.active,
        recruitedTurn: pending.recruitedTurn,
        activatedTurn: pending.activatedTurn,
        promotedTurn: pending.promotedTurn,
        actionTakenTurn: pending.actionTakenTurn,
      };
      state.pendingDisplacedKnight = null;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} relocated their displaced Level ${pending.level} Knight.`,
        category: 'build',
      });

      resumeTimerIfCKPromptsCleared(state);
      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'CHASE_ROBBER': {
      if (!isCK) {
        return { success: false, error: 'Chase Away the Robber is only available in Cities & Knights.' };
      }
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Not your action phase.' };
      }
      if (!state.robberActive) {
        return {
          success: false,
          error: 'The Robber cannot be moved until after the first Barbarian Attack!',
        };
      }

      const knight = state.board.knights?.[action.knightVertexId];
      if (!knight || knight.playerId !== action.playerId) {
        return { success: false, error: 'You do not have a Knight at that vertex.' };
      }
      if (!knight.active) {
        return { success: false, error: 'Knight must be active to chase away the Robber.' };
      }
      if (knight.activatedTurn === state.turnNumber || knight.recruitedTurn === state.turnNumber) {
        return {
          success: false,
          error: 'A Knight cannot chase the Robber on the same turn it was activated or recruited.',
        };
      }
      if (knight.actionTakenTurn === state.turnNumber) {
        return { success: false, error: 'This Knight has already taken an action this turn.' };
      }

      const vertex = state.board.vertices[action.knightVertexId];
      if (!vertex || !vertex.hexCoords.includes(state.board.robberHexId)) {
        return { success: false, error: 'This Knight is not adjacent to the Robber hex.' };
      }
      if (
        typeof action.hexId !== 'string' ||
        action.hexId === state.board.robberHexId ||
        !state.board.hexes[action.hexId] ||
        state.board.hexes[action.hexId].terrain === 'sea'
      ) {
        return { success: false, error: 'Must select a different valid land hex for the Robber.' };
      }
      if (!isValidRobberHex(state, action.hexId, action.playerId)) {
        return {
          success: false,
          error: 'Friendly Robber is active: cannot place the Robber on a hex adjacent to a player at starting Victory Points!',
        };
      }

      knight.active = false;
      knight.actionTakenTurn = state.turnNumber;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `⚔️ ${player.name}'s Level ${knight.level} Knight chased away the Robber!`,
        category: 'robber',
      });

      // Transition through MOVE_ROBBER logic
      pauseNormalTurnTimer(state);
      state.phase = 'ROBBER_PLACEMENT';
      state.robberControllerPlayerId = action.playerId;
      return applyAction(state, { type: 'MOVE_ROBBER', playerId: action.playerId, hexId: action.hexId }, isSystemTimeout);
    }

    case 'PLAY_PROGRESS_CARD': {
      if (!isCK) {
        return { success: false, error: 'Progress Cards are only available in Cities & Knights.' };
      }
      const cardIdx = player.progressCards.findIndex((c) => c.id === action.cardId);
      if (cardIdx === -1) {
        return { success: false, error: 'You do not hold this Progress Card.' };
      }
      const card = player.progressCards[cardIdx];
      const meta = PROGRESS_CARD_METADATA[card.type];
      const opts = action.options || {};

      // Alchemist is played during TURN_START before rolling dice
      if (card.type === 'alchemy') {
        if (state.phase !== 'TURN_START' || action.playerId !== state.currentTurnPlayerId || state.diceRolledThisTurn) {
          return {
            success: false,
            error: 'Alchemist can only be played on your turn before rolling the dice!',
          };
        }
        const dice = opts.alchemyDice;
        if (
          !Array.isArray(dice) ||
          dice.length !== 2 ||
          !Number.isInteger(dice[0]) ||
          !Number.isInteger(dice[1]) ||
          dice[0] < 1 ||
          dice[0] > 6 ||
          dice[1] < 1 ||
          dice[1] > 6
        ) {
          return {
            success: false,
            error: 'Alchemist requires choosing valid White Die (1–6) and Red Die (1–6) numbers.',
          };
        }

        player.progressCards.splice(cardIdx, 1);
        player.playedProgressCards.push(card);
        state.progressDecks?.[card.discipline].push(card);
        state.pendingAlchemyRoll = [dice[0], dice[1]];

        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: player.id,
          message: `🧪 ${player.name} played Alchemist and set the dice to White ${dice[0]} + Red ${dice[1]}!`,
          category: 'card',
        });

        return applyAction(state, { type: 'ROLL_DICE', playerId: action.playerId }, isSystemTimeout);
      }

      // All other Progress Cards are played during the player's Action Phase
      const isPlayer1Action = state.phase === 'ACTION_PHASE' && action.playerId === state.currentTurnPlayerId;
      const isPlayer2Action = state.phase === 'PAIRED_ACTION_PHASE' && action.playerId === state.pairedPlayerId;
      if (!isPlayer1Action && !isPlayer2Action) {
        return { success: false, error: 'Progress Cards can only be played during your Action Phase.' };
      }

      switch (card.type) {
        case 'crane': {
          state.craneDiscountsRemaining = (state.craneDiscountsRemaining || 0) + 1;
          break;
        }

        case 'medicine': {
          state.medicineDiscountsRemaining = (state.medicineDiscountsRemaining || 0) + 1;
          break;
        }

        case 'engineering': {
          if ((player.cityWallsLeft ?? 0) <= 0) {
            return { success: false, error: 'You have no City Walls left in your supply (max 3).' };
          }
          const targetV =
            opts.cityVertexId ||
            Object.values(state.board.buildings).find(
              (b) => b.playerId === player.id && b.type === 'city' && !b.hasWall,
            )?.vertexId;
          if (!targetV) {
            return { success: false, error: 'You have no City without a Wall to place a City Wall on.' };
          }
          const b = state.board.buildings[targetV];
          if (!b || b.playerId !== player.id || b.type !== 'city' || b.hasWall) {
            return { success: false, error: 'Select one of your Cities that does not already have a Wall.' };
          }
          b.hasWall = true;
          player.cityWallsLeft--;
          break;
        }

        case 'invention': {
          const pair = opts.swapHexIds;
          if (!Array.isArray(pair) || pair.length !== 2 || pair[0] === pair[1]) {
            return { success: false, error: 'Select 2 different land hexes to swap number tokens.' };
          }
          const h1 = state.board.hexes[pair[0]];
          const h2 = state.board.hexes[pair[1]];
          if (!h1 || !h2 || typeof h1.number !== 'number' || typeof h2.number !== 'number') {
            return { success: false, error: 'Both hexes must have number tokens.' };
          }
          const forbidden = [2, 6, 8, 12];
          if (forbidden.includes(h1.number) || forbidden.includes(h2.number)) {
            return { success: false, error: 'Cannot swap 2, 6, 8, or 12 number tokens with Inventor!' };
          }
          const temp = h1.number;
          h1.number = h2.number;
          h2.number = temp;
          break;
        }

        case 'irrigation': {
          let fieldsCount = 0;
          for (const hex of Object.values(state.board.hexes)) {
            if (hex.terrain !== 'fields') continue;
            const touchesOwnBuilding = Object.values(state.board.vertices).some(
              (v) => v.hexCoords.includes(hex.id) && state.board.buildings[v.id]?.playerId === player.id,
            );
            if (touchesOwnBuilding) fieldsCount++;
          }
          const gained = Math.min(fieldsCount * 2, state.resourceBank.wheat || 0);
          player.resources.wheat += gained;
          state.resourceBank.wheat -= gained;
          break;
        }

        case 'mining': {
          let mountainsCount = 0;
          for (const hex of Object.values(state.board.hexes)) {
            if (hex.terrain !== 'mountains') continue;
            const touchesOwnBuilding = Object.values(state.board.vertices).some(
              (v) => v.hexCoords.includes(hex.id) && state.board.buildings[v.id]?.playerId === player.id,
            );
            if (touchesOwnBuilding) mountainsCount++;
          }
          const gained = Math.min(mountainsCount * 2, state.resourceBank.ore || 0);
          player.resources.ore += gained;
          state.resourceBank.ore -= gained;
          break;
        }

        case 'road_building': {
          if (player.roadsLeft <= 0) {
            return { success: false, error: 'You have no road pieces remaining in your supply.' };
          }
          pauseNormalTurnTimer(state);
          state.freeRoadsRemaining = (state.freeRoadsRemaining || 0) + Math.min(2, player.roadsLeft);
          refreshTurnTimer(state);
          break;
        }

        case 'smithing': {
          state.freeKnightPromotionsRemaining = (state.freeKnightPromotionsRemaining || 0) + 2;
          if (Array.isArray(opts.knightVertexIds) && opts.knightVertexIds.length > 0) {
            for (const vid of opts.knightVertexIds.slice(0, 2)) {
              const k = state.board.knights?.[vid];
              if (!k || k.playerId !== player.id || k.level >= 3 || k.promotedTurn === state.turnNumber) {
                continue;
              }
              const nextLv = (k.level + 1) as 2 | 3;
              if (nextLv === 3 && (player.cityImprovements?.politics || 0) < 3) continue;
              if (nextLv === 2 && (player.strongKnightsLeft ?? 0) <= 0) continue;
              if (nextLv === 3 && (player.mightyKnightsLeft ?? 0) <= 0) continue;
              returnKnightLevelToSupply(player, k.level);
              deductKnightLevelFromSupply(player, nextLv);
              k.level = nextLv;
              k.promotedTurn = state.turnNumber;
              state.freeKnightPromotionsRemaining = Math.max(0, (state.freeKnightPromotionsRemaining || 0) - 1);
            }
          }
          break;
        }

        case 'merchant': {
          if (!opts.hexId || !state.board.hexes[opts.hexId]) {
            return { success: false, error: 'Select a land hex adjacent to one of your buildings.' };
          }
          const hex = state.board.hexes[opts.hexId];
          if (!hex.resource || hex.terrain === 'desert' || hex.terrain === 'sea') {
            return { success: false, error: 'Merchant must be placed on a resource-producing land hex.' };
          }
          const touchesPlayerBuilding = Object.values(state.board.vertices).some(
            (v) => v.hexCoords.includes(hex.id) && state.board.buildings[v.id]?.playerId === player.id,
          );
          if (!touchesPlayerBuilding) {
            return { success: false, error: 'Merchant must be placed on a hex adjacent to one of your buildings.' };
          }
          state.merchant = {
            hexId: hex.id,
            ownerId: player.id,
            resource: hex.resource,
          };
          break;
        }

        case 'merchant_fleet': {
          if (!isValidTradeableType(opts.tradeableType)) {
            return { success: false, error: 'Select a valid Resource or Commodity type for Merchant Fleet.' };
          }
          if (!state.merchantFleetTypes) state.merchantFleetTypes = [];
          if (!state.merchantFleetTypes.includes(opts.tradeableType)) {
            state.merchantFleetTypes.push(opts.tradeableType);
          }
          break;
        }

        case 'resource_monopoly': {
          if (!isValidResourceType(opts.resource)) {
            return { success: false, error: 'Select a valid Resource type for Resource Monopoly.' };
          }
          const res = opts.resource;
          let totalTaken = 0;
          for (const opp of Object.values(state.players)) {
            if (opp.id === player.id) continue;
            const take = Math.min(2, opp.resources[res] || 0);
            if (take > 0) {
              opp.resources[res] -= take;
              totalTaken += take;
            }
          }
          player.resources[res] += totalTaken;
          break;
        }

        case 'trade_monopoly': {
          if (!isValidCommodityType(opts.commodity)) {
            return { success: false, error: 'Select a valid Commodity type for Trade Monopoly.' };
          }
          const comm = opts.commodity;
          let totalTaken = 0;
          for (const opp of Object.values(state.players)) {
            if (opp.id === player.id) continue;
            const take = Math.min(1, opp.commodities?.[comm] || 0);
            if (take > 0) {
              opp.commodities[comm] -= take;
              totalTaken += take;
            }
          }
          player.commodities[comm] += totalTaken;
          break;
        }

        case 'commercial_harbor': {
          const offers = opts.commercialHarborOffers || [];
          if (!Array.isArray(offers) || offers.length === 0) {
            return { success: false, error: 'Select at least 1 opponent who holds a Commodity and a Resource to offer.' };
          }
          const pendingOffers: NonNullable<GameState['pendingCommercialHarbor']> = [];
          for (const offer of offers) {
            const opp = state.players[offer.targetPlayerId];
            if (!opp || opp.id === player.id) continue;
            if (!isValidResourceType(offer.offeredResource)) continue;
            if ((player.resources[offer.offeredResource] || 0) <= 0) continue;
            if (sumCommodities(opp.commodities) <= 0) continue;

            // Deduct offered resource from player and give to opponent; opponent must now give 1 commodity
            player.resources[offer.offeredResource]--;
            opp.resources[offer.offeredResource]++;
            pendingOffers.push({
              fromPlayerId: player.id,
              targetPlayerId: opp.id,
              offeredResource: offer.offeredResource,
            });
          }
          if (pendingOffers.length === 0) {
            return {
              success: false,
              error: 'Selected opponent has 0 Commodity cards (or you do not hold the offered Resource).',
            };
          }
          pauseNormalTurnTimer(state);
          state.pendingCommercialHarbor = pendingOffers;
          refreshTurnTimer(state);
          break;
        }

        case 'guild_dues': {
          if (!opts.targetPlayerId || !state.players[opts.targetPlayerId] || opts.targetPlayerId === player.id) {
            return { success: false, error: 'Select a valid opponent with more Victory Points than you.' };
          }
          const targetP = state.players[opts.targetPlayerId];
          if (targetP.victoryPoints <= player.victoryPoints) {
            return {
              success: false,
              error: 'Master Merchant can only target an opponent with strictly more Victory Points than you!',
            };
          }
          const targetTotalCards =
            Object.values(targetP.resources).reduce((s, n) => s + n, 0) + sumCommodities(targetP.commodities);
          if (targetTotalCards === 0) {
            return {
              success: false,
              error: 'That opponent has 0 Resource and Commodity cards in their hand.',
            };
          }
          if (Array.isArray(opts.chosenCards) && opts.chosenCards.length > 0) {
            for (const cType of opts.chosenCards.slice(0, 2)) {
              if (isValidTradeableType(cType) && getPlayerCardSupply(targetP, cType) > 0) {
                adjustPlayerCardSupply(targetP, cType, -1);
                adjustPlayerCardSupply(player, cType, 1);
              }
            }
          } else {
            pauseNormalTurnTimer(state);
            state.pendingGuildDues = {
              playerId: player.id,
              targetPlayerId: targetP.id,
            };
            refreshTurnTimer(state);
          }
          break;
        }

        case 'diplomacy': {
          if (!opts.edgeId || !state.board.roads[opts.edgeId]) {
            return { success: false, error: 'Select an open road on the board to remove.' };
          }
          if (!isOpenRoadEdge(state.board, opts.edgeId)) {
            return {
              success: false,
              error: 'Diplomat can only remove an open road (unbound at one end by another road, building, or knight).',
            };
          }
          const removedRoad = state.board.roads[opts.edgeId];
          const roadOwner = state.players[removedRoad.playerId];
          delete state.board.roads[opts.edgeId];
          if (roadOwner) {
            roadOwner.roadsLeft = Math.min(15, roadOwner.roadsLeft + 1);
          }
          if (removedRoad.playerId === player.id) {
            pauseNormalTurnTimer(state);
            state.freeRoadsRemaining = (state.freeRoadsRemaining || 0) + 1;
            refreshTurnTimer(state);
          }
          evaluateAndNotifyLongestRoute(state);
          break;
        }

        case 'encouragement': {
          if (state.board.knights) {
            for (const k of Object.values(state.board.knights)) {
              if (k.playerId === player.id && !k.active) {
                k.active = true;
                k.activatedTurn = state.turnNumber;
              }
            }
          }
          break;
        }

        case 'espionage': {
          if (!opts.targetPlayerId || !state.players[opts.targetPlayerId] || opts.targetPlayerId === player.id) {
            return { success: false, error: 'Select a valid opponent with Progress Cards.' };
          }
          const targetP = state.players[opts.targetPlayerId];
          if (!targetP.progressCards || targetP.progressCards.length === 0) {
            return { success: false, error: 'That opponent has no Progress Cards to steal.' };
          }
          if (opts.stolenCardId) {
            const sIdx = targetP.progressCards.findIndex((c) => c.id === opts.stolenCardId);
            if (sIdx === -1) {
              return { success: false, error: 'Selected Progress Card not found in opponent hand.' };
            }
            const [stolen] = targetP.progressCards.splice(sIdx, 1);
            player.progressCards.push(stolen);
            if (player.progressCards.length > 4) {
              if (!state.pendingProgressDiscardPlayerIds) state.pendingProgressDiscardPlayerIds = [];
              if (!state.pendingProgressDiscardPlayerIds.includes(player.id)) {
                state.pendingProgressDiscardPlayerIds.push(player.id);
              }
            }
          } else {
            pauseNormalTurnTimer(state);
            state.pendingEspionage = {
              playerId: player.id,
              targetPlayerId: targetP.id,
            };
            refreshTurnTimer(state);
          }
          break;
        }

        case 'intrigue': {
          if (!opts.knightVertexId || !state.board.knights?.[opts.knightVertexId]) {
            return { success: false, error: 'Select an opponent Knight touching one of your roads.' };
          }
          const oppKnight = state.board.knights[opts.knightVertexId];
          if (oppKnight.playerId === player.id) {
            return { success: false, error: 'Cannot displace your own Knight with Intrigue.' };
          }
          const touchesPlayerRoad = Object.values(state.board.roads).some(
            (r) =>
              r.playerId === player.id &&
              (state.board.edges[r.edgeId]?.v1 === opts.knightVertexId ||
                state.board.edges[r.edgeId]?.v2 === opts.knightVertexId),
          );
          if (!touchesPlayerRoad) {
            return {
              success: false,
              error: 'Intrigue can only displace an opponent Knight on a vertex connected to one of your roads!',
            };
          }
          delete state.board.knights[opts.knightVertexId];
          handleDisplacedOpponentKnight(state, oppKnight, player.name);
          evaluateAndNotifyLongestRoute(state);
          break;
        }

        case 'sabotage': {
          const discards: Record<string, number> = {};
          for (const opp of Object.values(state.players)) {
            if (opp.id === player.id) continue;
            if (opp.victoryPoints >= player.victoryPoints) {
              const total =
                Object.values(opp.resources).reduce((s, n) => s + n, 0) +
                sumCommodities(opp.commodities);
              const half = Math.floor(total / 2);
              if (half > 0) {
                discards[opp.id] = half;
              }
            }
          }
          if (Object.keys(discards).length > 0) {
            pauseNormalTurnTimer(state);
            state.postDiscardPhase = state.phase;
            state.pendingDiscards = discards;
            state.phase = 'DISCARD_PHASE';
            refreshTurnTimer(state);
          }
          break;
        }

        case 'taxation': {
          if (!state.robberActive) {
            return {
              success: false,
              error: 'Bishop cannot move the Robber until after the first Barbarian Attack!',
            };
          }
          if (
            !opts.hexId ||
            opts.hexId === state.board.robberHexId ||
            !state.board.hexes[opts.hexId] ||
            state.board.hexes[opts.hexId].terrain === 'sea'
          ) {
            return { success: false, error: 'Select a different valid land hex to move the Robber to.' };
          }
          if (!isValidRobberHex(state, opts.hexId, action.playerId)) {
            return {
              success: false,
              error: 'Friendly Robber is active: cannot place the Robber on a hex adjacent to a player at starting Victory Points!',
            };
          }
          const oldHex = state.board.hexes[state.board.robberHexId];
          if (oldHex) oldHex.hasRobber = false;
          state.board.hexes[opts.hexId].hasRobber = true;
          state.board.robberHexId = opts.hexId;

          const adjacentOpponents = new Set<string>();
          for (const v of Object.values(state.board.vertices)) {
            if (v.hexCoords.includes(opts.hexId)) {
              const b = state.board.buildings[v.id];
              if (b && b.playerId !== player.id) {
                adjacentOpponents.add(b.playerId);
              }
            }
          }
          for (const victimId of adjacentOpponents) {
            const victim = state.players[victimId];
            if (victim) {
              stealRandomCard(player, victim, state);
            }
          }
          break;
        }

        case 'treason': {
          if (!opts.targetPlayerId || !state.players[opts.targetPlayerId] || opts.targetPlayerId === player.id) {
            return { success: false, error: 'Select an opponent who has at least 1 Knight on the board.' };
          }
          const targetKnights = Object.values(state.board.knights || {}).filter(
            (k) => k.playerId === opts.targetPlayerId,
          );
          if (targetKnights.length === 0) {
            return { success: false, error: 'That opponent has no Knights on the board.' };
          }
          pauseNormalTurnTimer(state);
          state.pendingDeserter = {
            requesterId: player.id,
            targetPlayerId: opts.targetPlayerId,
            stage: 'choose_victim_knight',
          };
          refreshTurnTimer(state);
          break;
        }

        case 'wedding': {
          const pendingWeddings: string[] = [];
          for (const opp of Object.values(state.players)) {
            if (opp.id === player.id) continue;
            if (opp.victoryPoints > player.victoryPoints) {
              const total =
                Object.values(opp.resources).reduce((s, n) => s + n, 0) +
                sumCommodities(opp.commodities);
              if (total > 0 && total <= 2) {
                // Automatically transfer all 1 or 2 cards
                for (const t of VALID_TRADEABLES) {
                  const amt = getPlayerCardSupply(opp, t);
                  if (amt > 0) {
                    adjustPlayerCardSupply(opp, t, -amt);
                    adjustPlayerCardSupply(player, t, amt);
                  }
                }
              } else if (total > 2) {
                pendingWeddings.push(opp.id);
              }
            }
          }
          if (pendingWeddings.length > 0) {
            pauseNormalTurnTimer(state);
            state.pendingWeddingPlayerIds = pendingWeddings;
            state.weddingRequesterId = player.id;
            refreshTurnTimer(state);
          } else {
            state.pendingWeddingPlayerIds = [];
            state.weddingRequesterId = null;
          }
          break;
        }

        default:
          return { success: false, error: 'This Progress Card cannot be played manually.' };
      }

      // Consume the played card and return it to the bottom of its discipline deck
      const currentIdx = player.progressCards.findIndex((c) => c.id === card.id);
      if (currentIdx !== -1) {
        player.progressCards.splice(currentIdx, 1);
      }
      player.playedProgressCards.push(card);
      state.progressDecks?.[card.discipline].push(card);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `📜 ${player.name} played ${meta.name} (${card.discipline})!`,
        category: 'card',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'DISCARD_PROGRESS_CARD': {
      const idx = player.progressCards.findIndex((c) => c.id === action.cardId);
      if (idx === -1) {
        return { success: false, error: 'Progress Card not found in your hand.' };
      }
      if (player.progressCards.length <= 4) {
        return { success: false, error: 'You only need to discard Progress Cards when holding more than 4.' };
      }
      const [discarded] = player.progressCards.splice(idx, 1);
      state.progressDecks?.[discarded.discipline].push(discarded);

      if (player.progressCards.length <= 4 && state.pendingProgressDiscardPlayerIds) {
        state.pendingProgressDiscardPlayerIds = state.pendingProgressDiscardPlayerIds.filter(
          (id) => id !== player.id,
        );
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} discarded a ${discarded.discipline} Progress Card (4-card hand limit).`,
        category: 'card',
      });

      syncPlayerVPs(state);
      return { success: true };
    }

    case 'CHOOSE_AQUEDUCT_RESOURCE': {
      if (!state.pendingAqueductPlayerIds?.includes(action.playerId)) {
        return { success: false, error: 'You do not have a pending Aqueduct resource choice.' };
      }
      if (!isValidResourceType(action.resource)) {
        return { success: false, error: 'Select a valid Resource type.' };
      }
      if ((state.resourceBank[action.resource] || 0) <= 0) {
        return { success: false, error: `Bank has no ${action.resource} remaining.` };
      }

      player.resources[action.resource]++;
      state.resourceBank[action.resource]--;
      state.pendingAqueductPlayerIds = state.pendingAqueductPlayerIds.filter((id) => id !== action.playerId);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🏛️ ${player.name} took 1 ${action.resource} using their Aqueduct!`,
        category: 'dice',
      });

      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'CHOOSE_BARBARIAN_REWARD': {
      if (!state.pendingBarbarianRewardPlayerIds?.includes(action.playerId)) {
        return { success: false, error: 'You do not have a pending Defender of Catan reward choice.' };
      }
      if (!isValidDiscipline(action.discipline)) {
        return { success: false, error: 'Select a valid Progress Card discipline (trade, politics, or science).' };
      }

      state.pendingBarbarianRewardPlayerIds = state.pendingBarbarianRewardPlayerIds.filter(
        (id) => id !== action.playerId,
      );
      drawProgressCardForPlayer(state, player, action.discipline);

      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'CHOOSE_PILLAGED_CITY': {
      if (!state.pendingBarbarianPillagePlayerIds?.includes(action.playerId)) {
        return { success: false, error: 'You do not need to select a City to pillage.' };
      }
      if (!pillageCityAtVertex(state, action.playerId, action.vertexId)) {
        return { success: false, error: 'Must select one of your non-Metropolis Cities.' };
      }
      state.pendingBarbarianPillagePlayerIds = state.pendingBarbarianPillagePlayerIds.filter(
        (id) => id !== action.playerId,
      );

      evaluateAndNotifyHarborMaster(state);
      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'RESOLVE_GUILD_DUES': {
      if (!state.pendingGuildDues || state.pendingGuildDues.playerId !== action.playerId) {
        return { success: false, error: 'No pending Master Merchant selection.' };
      }
      const targetP = state.players[state.pendingGuildDues.targetPlayerId];
      if (!targetP) {
        state.pendingGuildDues = null;
        resumeTimerIfCKPromptsCleared(state);
        return { success: false, error: 'Target player not found.' };
      }
      const targetTotalCards =
        Object.values(targetP.resources).reduce((s, n) => s + n, 0) + sumCommodities(targetP.commodities);
      if (targetTotalCards === 0) {
        state.pendingGuildDues = null;
        resumeTimerIfCKPromptsCleared(state);
        return { success: true };
      }
      if (!Array.isArray(action.cards) || action.cards.length === 0 || action.cards.length > 2) {
        return { success: false, error: 'Select up to 2 cards from the opponent hand.' };
      }

      for (const cType of action.cards.slice(0, 2)) {
        if (isValidTradeableType(cType) && getPlayerCardSupply(targetP, cType) > 0) {
          adjustPlayerCardSupply(targetP, cType, -1);
          adjustPlayerCardSupply(player, cType, 1);
        }
      }
      state.pendingGuildDues = null;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `${player.name} collected ${action.cards.length} card(s) from ${targetP.name} via Master Merchant.`,
        category: 'card',
      });

      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'RESOLVE_ESPIONAGE': {
      if (!state.pendingEspionage || state.pendingEspionage.playerId !== action.playerId) {
        return { success: false, error: 'No pending Spy selection.' };
      }
      const targetP = state.players[state.pendingEspionage.targetPlayerId];
      if (!targetP) {
        state.pendingEspionage = null;
        resumeTimerIfCKPromptsCleared(state);
        return { success: false, error: 'Target player not found.' };
      }
      const idx = targetP.progressCards.findIndex((c) => c.id === action.cardId);
      if (idx === -1) {
        return { success: false, error: 'Selected Progress Card not found in opponent hand.' };
      }
      const [stolen] = targetP.progressCards.splice(idx, 1);
      player.progressCards.push(stolen);
      if (player.progressCards.length > 4) {
        if (!state.pendingProgressDiscardPlayerIds) state.pendingProgressDiscardPlayerIds = [];
        if (!state.pendingProgressDiscardPlayerIds.includes(player.id)) {
          state.pendingProgressDiscardPlayerIds.push(player.id);
        }
      }
      state.pendingEspionage = null;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🕵️ ${player.name} stole a Progress Card from ${targetP.name} using Spy!`,
        category: 'card',
      });

      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'GIVE_WEDDING_CARDS': {
      if (!state.pendingWeddingPlayerIds?.includes(action.playerId)) {
        return { success: false, error: 'You do not need to give Wedding gift cards.' };
      }
      if (!isValidTradePayload(action.cards, true)) {
        return { success: false, error: 'Invalid card selection.' };
      }
      const total = sumTradePayload(action.cards, true);
      if (total !== 2) {
        return { success: false, error: 'You must select exactly 2 cards to give as a Wedding gift.' };
      }
      if (!canAffordTradePayload(player.resources, player.commodities, action.cards, true)) {
        return { success: false, error: 'You do not hold the selected cards.' };
      }

      const recipientId = state.weddingRequesterId || state.currentTurnPlayerId;
      const recipient = state.players[recipientId];
      deductTradePayloadFromPlayer(player, action.cards);
      if (recipient) {
        addTradePayloadToPlayer(recipient, action.cards);
      }
      state.pendingWeddingPlayerIds = state.pendingWeddingPlayerIds.filter((id) => id !== action.playerId);
      if (state.pendingWeddingPlayerIds.length === 0) {
        state.weddingRequesterId = null;
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `💍 ${player.name} gave 2 cards to ${recipient?.name || 'the bride/groom'} for Wedding.`,
        category: 'card',
      });

      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'RESPOND_COMMERCIAL_HARBOR': {
      const idx = (state.pendingCommercialHarbor || []).findIndex(
        (o) => o.targetPlayerId === action.playerId,
      );
      if (idx === -1 || !state.pendingCommercialHarbor) {
        return { success: false, error: 'No pending Commercial Harbor exchange for you.' };
      }
      if (!isValidCommodityType(action.commodity) || (player.commodities[action.commodity] || 0) <= 0) {
        return { success: false, error: 'You must select a Commodity card you hold.' };
      }
      const offer = state.pendingCommercialHarbor[idx];
      const requester = state.players[offer.fromPlayerId];
      player.commodities[action.commodity]--;
      if (requester) {
        requester.commodities[action.commodity] = (requester.commodities[action.commodity] || 0) + 1;
      }
      state.pendingCommercialHarbor.splice(idx, 1);

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `⚓ ${player.name} gave 1 commodity to ${requester?.name || 'player'} for Commercial Harbor.`,
        category: 'trade',
      });

      resumeTimerIfCKPromptsCleared(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'CHOOSE_DESERTER_KNIGHT': {
      if (
        !state.pendingDeserter ||
        state.pendingDeserter.stage !== 'choose_victim_knight' ||
        state.pendingDeserter.targetPlayerId !== action.playerId
      ) {
        return { success: false, error: 'You do not have a pending Deserter Knight selection.' };
      }
      const k = state.board.knights?.[action.vertexId];
      if (!k || k.playerId !== action.playerId) {
        return { success: false, error: 'Select one of your Knights on the board.' };
      }

      delete state.board.knights![action.vertexId];
      returnKnightLevelToSupply(player, k.level);

      const requester = state.players[state.pendingDeserter.requesterId];
      const hasValidSpot = Object.keys(state.board.vertices).some((vid) =>
        isValidKnightRecruitVertex(state, state.pendingDeserter!.requesterId, vid),
      );
      const hasAvailableKnightPiece =
        requester &&
        ((requester.basicKnightsLeft ?? 0) > 0 ||
          (k.level >= 2 && (requester.strongKnightsLeft ?? 0) > 0) ||
          (k.level >= 3 && (requester.mightyKnightsLeft ?? 0) > 0));

      if (requester && hasValidSpot && hasAvailableKnightPiece) {
        state.pendingDeserter = {
          ...state.pendingDeserter,
          stage: 'place_new_knight',
          removedLevel: k.level,
          removedActive: k.active,
        };
        refreshTurnTimer(state);
      } else {
        state.pendingDeserter = null;
        resumeTimerIfCKPromptsCleared(state);
      }

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🏳️ ${player.name}'s Level ${k.level} Knight deserted!`,
        category: 'card',
      });

      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'PLACE_DESERTER_KNIGHT': {
      if (
        !state.pendingDeserter ||
        state.pendingDeserter.stage !== 'place_new_knight' ||
        state.pendingDeserter.requesterId !== action.playerId
      ) {
        return { success: false, error: 'You do not have a pending Deserter Knight to place.' };
      }
      if (!isValidKnightRecruitVertex(state, action.playerId, action.vertexId)) {
        return { success: false, error: 'Select an empty vertex connected to one of your roads.' };
      }

      const maxLevel = state.pendingDeserter.removedLevel || 1;
      let placeLevel: 1 | 2 | 3 | null = null;
      const candidateLevels: Array<1 | 2 | 3> = [3, 2, 1].filter((lv) => lv <= maxLevel) as Array<1 | 2 | 3>;
      for (const lv of candidateLevels) {
        if (deductKnightLevelFromSupply(player, lv)) {
          placeLevel = lv;
          break;
        }
      }

      if (!placeLevel) {
        state.pendingDeserter = null;
        resumeTimerIfCKPromptsCleared(state);
        return { success: false, error: 'You have no available Knight pieces of equal or lower level.' };
      }

      if (!state.board.knights) state.board.knights = {};
      state.board.knights[action.vertexId] = {
        id: `k_${action.playerId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        playerId: action.playerId,
        vertexId: action.vertexId,
        level: placeLevel,
        active: Boolean(state.pendingDeserter.removedActive),
        recruitedTurn: state.turnNumber,
        activatedTurn: state.pendingDeserter.removedActive ? state.turnNumber : null,
        promotedTurn: null,
        actionTakenTurn: null,
      };
      state.pendingDeserter = null;

      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🛡️ ${player.name} placed a Level ${placeLevel} Deserter Knight on the board!`,
        category: 'card',
      });

      resumeTimerIfCKPromptsCleared(state);
      evaluateAndNotifyLongestRoute(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    case 'BUY_DEV_CARD': {
      if (isCK) {
        return {
          success: false,
          error: 'Development Cards are replaced by City Improvements and Progress Cards in Cities & Knights.',
        };
      }
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
      if (isCK) {
        return { success: false, error: 'Use Progress Cards in Cities & Knights.' };
      }
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

      if (card.boughtTurn === state.turnNumber && !state.settings?.houseRules?.playDevCardSameTurn) {
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

      const validCheck = isCK ? isValidTradeableType : isValidResourceType;
      if (!validCheck(action.giving) || !validCheck(action.asking)) {
        return { success: false, error: 'Invalid card type for bank trade.' };
      }
      if (action.giving === action.asking) {
        return { success: false, error: 'Cannot trade a card for the same card.' };
      }
      if (
        typeof action.ratio !== 'number' ||
        !Number.isInteger(action.ratio) ||
        (action.ratio !== 2 && action.ratio !== 3 && action.ratio !== 4)
      ) {
        return { success: false, error: 'Invalid maritime trade ratio.' };
      }

      const bestRatio = getPlayerMaritimeRatio(player.id, action.giving, state.board, state);
      if (action.ratio < bestRatio) {
        return { success: false, error: `Your best bank trade ratio for ${action.giving} is ${bestRatio}:1.` };
      }
      if (getPlayerCardSupply(player, action.giving) < action.ratio) {
        return { success: false, error: `You need at least ${action.ratio} ${action.giving} to trade.` };
      }
      if (getBankSupply(state, action.asking) < 1) {
        return { success: false, error: `Bank has no ${action.asking} remaining.` };
      }

      adjustPlayerCardSupply(player, action.giving, -action.ratio);
      adjustBankSupply(state, action.giving, action.ratio);

      adjustPlayerCardSupply(player, action.asking, 1);
      adjustBankSupply(state, action.asking, -1);

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

      if (!isValidTradePayload(action.giving, isCK) || !isValidTradePayload(action.asking, isCK)) {
        return {
          success: false,
          error: 'Invalid card quantities: must be non-negative integers.',
        };
      }

      const validKeys = isCK ? VALID_TRADEABLES : VALID_RESOURCES;

      for (const r of validKeys) {
        if ((action.giving[r] || 0) > 0 && (action.asking[r] || 0) > 0) {
          return {
            success: false,
            error: `Cannot give and ask for ${r} in the same bank trade.`,
          };
        }
      }

      if (!canAffordTradePayload(player.resources, player.commodities, action.giving, isCK)) {
        return { success: false, error: 'You do not hold the cards you are offering.' };
      }

      // Compute total credits earned using the best harbor/Trading House/Merchant ratio per card type
      let totalCreditsEarned = 0;
      const givenDescriptions: string[] = [];
      for (const res of validKeys) {
        const count = action.giving[res] || 0;
        if (count <= 0) continue;
        const bestRatio = getPlayerMaritimeRatio(player.id, res, state.board, state);
        if (count % bestRatio !== 0) {
          return {
            success: false,
            error: `${res} must be given in multiples of your best bank rate (${bestRatio}:1).`,
          };
        }
        totalCreditsEarned += count / bestRatio;
        givenDescriptions.push(`${count} ${res} (${bestRatio}:1)`);
      }

      const askedDescriptions: string[] = [];
      let totalAskedCards = 0;
      for (const res of validKeys) {
        const count = action.asking[res] || 0;
        if (count <= 0) continue;
        if (getBankSupply(state, res) < count) {
          return { success: false, error: `Bank does not have enough ${res} remaining.` };
        }
        totalAskedCards += count;
        askedDescriptions.push(`${count} ${res}`);
      }

      if (totalCreditsEarned <= 0 || totalAskedCards <= 0) {
        return { success: false, error: 'Must give and ask for at least 1 card.' };
      }

      if (totalCreditsEarned !== totalAskedCards) {
        return {
          success: false,
          error: `Your offered cards yield ${totalCreditsEarned} bank trade(s), but you asked for ${totalAskedCards} card(s).`,
        };
      }

      for (const res of validKeys) {
        const giveAmt = action.giving[res] || 0;
        if (giveAmt > 0) {
          adjustPlayerCardSupply(player, res, -giveAmt);
          adjustBankSupply(state, res, giveAmt);
        }
        const askAmt = action.asking[res] || 0;
        if (askAmt > 0) {
          adjustPlayerCardSupply(player, res, askAmt);
          adjustBankSupply(state, res, -askAmt);
        }
      }

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
      const validation = validateDomesticTradePayloads(action.giving, action.asking, freeTradesEnabled, isCK);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      if (!canAffordTradePayload(player.resources, player.commodities, validation.cleanGiving, isCK)) {
        return { success: false, error: 'You do not hold the cards you are offering.' };
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
          isCK,
        );
        if (!validation.valid) {
          return { success: false, error: validation.error };
        }

        // Recheck BOTH participants' cards immediately before completing the trade!
        if (!canAffordTradePayload(activeP.resources, activeP.commodities, validation.cleanGiving, isCK)) {
          return {
            success: false,
            error: `${activeP.name} no longer holds the cards offered in this trade.`,
          };
        }
        if (!canAffordTradePayload(player.resources, player.commodities, validation.cleanAsking, isCK)) {
          return { success: false, error: 'You do not have the requested cards to accept.' };
        }

        state.activeTradeOffer.status[action.playerId] = 'accepted';
        executeTrade(activeP, player, validation.cleanGiving, validation.cleanAsking, state);
        state.activeTradeOffer = null;
      } else {
        state.activeTradeOffer.status[action.playerId] = 'declined';
        state.activeTradeOffer.counterOffers = state.activeTradeOffer.counterOffers.filter(
          (c) => c.fromPlayerId !== action.playerId,
        );

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
      const validation = validateDomesticTradePayloads(action.giving, action.asking, freeTradesEnabled, isCK);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const validKeys = isCK ? VALID_TRADEABLES : VALID_RESOURCES;

      const origGiving = state.activeTradeOffer.giving;
      const origAsking = state.activeTradeOffer.asking;
      const matchesOriginalDeal = validKeys.every(
        (r) =>
          (validation.cleanGiving[r] || 0) === (origAsking[r] || 0) &&
          (validation.cleanAsking[r] || 0) === (origGiving[r] || 0),
      );
      const matchesOriginalSameDirection = validKeys.every(
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

      const isDuplicateCounter = state.activeTradeOffer.counterOffers.some((c) =>
        validKeys.every(
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

      if (!canAffordTradePayload(player.resources, player.commodities, validation.cleanGiving, isCK)) {
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
      const validation = validateDomesticTradePayloads(counter.giving, counter.asking, freeTradesEnabled, isCK);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      const counterPlayer = state.players[counter.fromPlayerId];
      if (!counterPlayer) return { success: false, error: 'Counter player not found.' };

      if (!canAffordTradePayload(player.resources, player.commodities, validation.cleanAsking, isCK)) {
        return { success: false, error: 'You no longer have the cards required for this counter-offer.' };
      }
      if (!canAffordTradePayload(counterPlayer.resources, counterPlayer.commodities, validation.cleanGiving, isCK)) {
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

      // In Cities & Knights, block ending the turn while mandatory sub-prompts are still waiting on a player
      if (isCK && !isSystemTimeout && hasAnyPendingCKPrompts(state)) {
        return {
          success: false,
          error: 'Please finish resolving the active prompt before ending the turn!',
        };
      }

      // In Cities & Knights, enforce the 4 Progress Card hand limit at the end of turn (auto-discard if timeout)
      if (isCK && player.progressCards.length > 4) {
        if (!isSystemTimeout) {
          return {
            success: false,
            error: `You hold ${player.progressCards.length} Progress Cards (max 4). Play or discard down to 4 before ending your turn!`,
          };
        }
        while (player.progressCards.length > 4) {
          const discarded = player.progressCards.pop()!;
          state.progressDecks?.[discarded.discipline].push(discarded);
        }
      }
      if (isCK && (state.pendingProgressDiscardPlayerIds?.length || 0) > 0) {
        for (const pid of [...(state.pendingProgressDiscardPlayerIds || [])]) {
          const p = state.players[pid];
          while (p && p.progressCards.length > 4) {
            const d = p.progressCards.pop()!;
            state.progressDecks?.[d.discipline].push(d);
          }
        }
        state.pendingProgressDiscardPlayerIds = [];
      }

      // Clear turn-scoped offers & temporary modifiers
      state.activeTradeOffer = null;
      state.freeRoadsRemaining = 0;
      state.savedActionRemainingMs = null;
      state.craneDiscountsRemaining = 0;
      state.medicineDiscountsRemaining = 0;
      state.freeKnightPromotionsRemaining = 0;
      state.merchantFleetTypes = [];
      state.pendingAlchemyRoll = null;

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

      evaluateAndNotifyHarborMaster(state);
      refreshTurnTimer(state);
      syncPlayerVPs(state);
      return { success: true };
    }

    default:
      return { success: false, error: 'Unknown action type.' };
  }
}

function autoResolvePendingCKPrompts(state: GameState) {
  if (state.pendingBarbarianPillagePlayerIds && state.pendingBarbarianPillagePlayerIds.length > 0) {
    for (const pid of [...state.pendingBarbarianPillagePlayerIds]) {
      const cities = getPlayerVulnerableCityVertices(state, pid);
      if (cities.length > 0) {
        pillageCityAtVertex(state, pid, cities[0]);
      }
    }
    state.pendingBarbarianPillagePlayerIds = [];
    evaluateAndNotifyHarborMaster(state);
  }
  if (state.pendingBarbarianRewardPlayerIds && state.pendingBarbarianRewardPlayerIds.length > 0) {
    for (const pid of [...state.pendingBarbarianRewardPlayerIds]) {
      const p = state.players[pid];
      if (p) drawProgressCardForPlayer(state, p, 'science');
    }
    state.pendingBarbarianRewardPlayerIds = [];
  }
  if (state.pendingAqueductPlayerIds && state.pendingAqueductPlayerIds.length > 0) {
    for (const pid of [...state.pendingAqueductPlayerIds]) {
      const p = state.players[pid];
      const availRes = VALID_RESOURCES.find((r) => (state.resourceBank[r] || 0) > 0);
      if (p && availRes) {
        p.resources[availRes]++;
        state.resourceBank[availRes]--;
      }
    }
    state.pendingAqueductPlayerIds = [];
  }
  if (state.pendingDisplacedKnight) {
    const dk = state.pendingDisplacedKnight;
    const dest = dk.validVertexIds[0];
    if (dest) {
      applyAction(state, { type: 'MOVE_DISPLACED_KNIGHT', playerId: dk.playerId, toVertexId: dest }, true);
    } else {
      state.pendingDisplacedKnight = null;
    }
  }
  if (state.pendingProgressDiscardPlayerIds && state.pendingProgressDiscardPlayerIds.length > 0) {
    for (const pid of [...state.pendingProgressDiscardPlayerIds]) {
      const p = state.players[pid];
      while (p && p.progressCards.length > 4) {
        const d = p.progressCards.pop()!;
        state.progressDecks?.[d.discipline].push(d);
      }
    }
    state.pendingProgressDiscardPlayerIds = [];
  }
  if (state.pendingGuildDues) {
    const inspector = state.players[state.pendingGuildDues.playerId];
    const targetP = state.players[state.pendingGuildDues.targetPlayerId];
    if (inspector && targetP) {
      let taken = 0;
      for (const t of VALID_TRADEABLES) {
        while (taken < 2 && getPlayerCardSupply(targetP, t) > 0) {
          adjustPlayerCardSupply(targetP, t, -1);
          adjustPlayerCardSupply(inspector, t, 1);
          taken++;
        }
      }
    }
    state.pendingGuildDues = null;
  }
  if (state.pendingEspionage) {
    const inspector = state.players[state.pendingEspionage.playerId];
    const targetP = state.players[state.pendingEspionage.targetPlayerId];
    if (inspector && targetP && targetP.progressCards.length > 0) {
      const stolen = targetP.progressCards.pop()!;
      inspector.progressCards.push(stolen);
    }
    state.pendingEspionage = null;
  }
  if (state.pendingDeserter) {
    const des = state.pendingDeserter;
    if (des.stage === 'choose_victim_knight') {
      const victimKnight = Object.values(state.board.knights || {}).find(
        (k) => k.playerId === des.targetPlayerId,
      );
      if (victimKnight) {
        applyAction(
          state,
          { type: 'CHOOSE_DESERTER_KNIGHT', playerId: des.targetPlayerId, vertexId: victimKnight.vertexId },
          true,
        );
      } else {
        state.pendingDeserter = null;
      }
    }
    if (state.pendingDeserter && state.pendingDeserter.stage === 'place_new_knight') {
      const reqId = state.pendingDeserter.requesterId;
      const validV = Object.keys(state.board.vertices).find((vid) =>
        isValidKnightRecruitVertex(state, reqId, vid),
      );
      if (validV) {
        applyAction(state, { type: 'PLACE_DESERTER_KNIGHT', playerId: reqId, vertexId: validV }, true);
      } else {
        state.pendingDeserter = null;
      }
    }
  }
  if (state.pendingWeddingPlayerIds && state.pendingWeddingPlayerIds.length > 0) {
    const recipient = state.players[state.weddingRequesterId || state.currentTurnPlayerId];
    for (const pid of [...state.pendingWeddingPlayerIds]) {
      const giver = state.players[pid];
      if (!giver || !recipient) continue;
      let given = 0;
      for (const t of VALID_TRADEABLES) {
        while (given < 2 && getPlayerCardSupply(giver, t) > 0) {
          adjustPlayerCardSupply(giver, t, -1);
          adjustPlayerCardSupply(recipient, t, 1);
          given++;
        }
      }
    }
    state.pendingWeddingPlayerIds = [];
    state.weddingRequesterId = null;
  }
  if (state.pendingCommercialHarbor && state.pendingCommercialHarbor.length > 0) {
    for (const offer of [...state.pendingCommercialHarbor]) {
      const responder = state.players[offer.targetPlayerId];
      const requester = state.players[offer.fromPlayerId];
      if (!responder || !requester) continue;
      const comm = VALID_COMMODITIES.find((c) => (responder.commodities[c] || 0) > 0);
      if (comm) {
        responder.commodities[comm]--;
        requester.commodities[comm] = (requester.commodities[comm] || 0) + 1;
      }
    }
    state.pendingCommercialHarbor = [];
  }
  syncPlayerVPs(state);
}

// Auto-roller / Auto-pass handler when turn timer expires
export function handleTurnTimeout(state: GameState): boolean {
  if (state.phase === 'GAME_OVER' || state.phase === 'LOBBY') return false;
  if (!state.turnDeadlineMs || Date.now() < state.turnDeadlineMs) return false;

  const hadPendingCKPrompt = hasAnyPendingCKPrompts(state);
  autoResolvePendingCKPrompts(state);

  if (
    hadPendingCKPrompt &&
    (state.phase === 'ACTION_PHASE' || state.phase === 'PAIRED_ACTION_PHASE')
  ) {
    resumeNormalTurnTimer(state);
    return true;
  }

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
      const isCK = state.settings.expansion === 'cities_and_knights';
      for (const [pid, needed] of Object.entries(state.pendingDiscards)) {
        const p = state.players[pid];
        if (!p || needed <= 0) continue;
        const pool: TradeableCardType[] = [];
        for (const [res, count] of Object.entries(p.resources) as Array<[ResourceType, number]>) {
          for (let i = 0; i < count; i++) pool.push(res);
        }
        if (isCK && p.commodities) {
          for (const [comm, count] of Object.entries(p.commodities) as Array<[CommodityType, number]>) {
            for (let i = 0; i < count; i++) pool.push(comm);
          }
        }
        const toDiscard: TradePayload = {};
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
      const validNonDesertHexes = Object.keys(state.board.hexes).filter(
        (hid) =>
          state.board.hexes[hid].terrain !== 'desert' &&
          isValidRobberHex(state, hid, controllerId),
      );
      const validAnyHexes = Object.keys(state.board.hexes).filter((hid) =>
        isValidRobberHex(state, hid, controllerId),
      );
      const chosenHex =
        validNonDesertHexes[cryptoRandomInt(validNonDesertHexes.length)] ||
        validAnyHexes[cryptoRandomInt(validAnyHexes.length)] ||
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
  const cards: TradeableCardType[] = [];
  for (const [res, count] of Object.entries(victim.resources) as Array<[ResourceType, number]>) {
    for (let i = 0; i < count; i++) cards.push(res);
  }
  if (victim.commodities) {
    for (const [comm, count] of Object.entries(victim.commodities) as Array<[CommodityType, number]>) {
      for (let i = 0; i < count; i++) cards.push(comm);
    }
  }
  if (cards.length === 0) return;

  const chosen = cards[cryptoRandomInt(cards.length)];
  adjustPlayerCardSupply(victim, chosen, -1);
  adjustPlayerCardSupply(stealer, chosen, 1);

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
  p1Gives: TradePayload,
  p2Gives: TradePayload,
  state: GameState,
) {
  deductTradePayloadFromPlayer(p1, p1Gives);
  addTradePayloadToPlayer(p1, p2Gives);

  deductTradePayloadFromPlayer(p2, p2Gives);
  addTradePayloadToPlayer(p2, p1Gives);

  state.actionLog.push({
    id: `log_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    message: `Trade completed between ${p1.name} and ${p2.name}!`,
    category: 'trade',
  });

  syncPlayerVPs(state);
}

export function getPlayerMaritimeRatio(
  playerId: string,
  item: TradeableCardType,
  board: BoardState,
  state?: GameState,
): number {
  let best = 4;

  // Check 3:1 generic and 2:1 resource harbors
  for (const harbor of Object.values(board.harbors)) {
    const touchesPlayer =
      (board.buildings[harbor.vertexIds[0]] && board.buildings[harbor.vertexIds[0]].playerId === playerId) ||
      (board.buildings[harbor.vertexIds[1]] && board.buildings[harbor.vertexIds[1]].playerId === playerId);

    if (touchesPlayer) {
      if (harbor.type === 'generic_3_1' && best > 3) {
        best = 3;
      }
      if (harbor.resource === item && harbor.ratio === 2) {
        best = 2;
      }
    }
  }

  // Cities & Knights special 2:1 rates:
  if (state && state.settings.expansion === 'cities_and_knights') {
    const player = state.players[playerId];
    // 1. Trade Level 3 (Trading House): trade any 2 identical commodities for any 1 resource or commodity
    if (isValidCommodityType(item) && (player?.cityImprovements?.trade || 0) >= 3) {
      best = 2;
    }
    // 2. Merchant: 2:1 on the resource of the hex where the Merchant is placed
    if (state.merchant?.ownerId === playerId && state.merchant.resource === item) {
      best = 2;
    }
    // 3. Merchant Fleet progress card: 2:1 on chosen resource or commodity for the rest of this turn
    if (
      (state.currentTurnPlayerId === playerId || state.pairedPlayerId === playerId) &&
      state.merchantFleetTypes?.includes(item)
    ) {
      best = 2;
    }
  }

  return best;
}

/**
 * Removes a player mid-game, returning all of their resources, commodities, development/progress cards,
 * settlements, cities, knights, and roads back to the bank/deck and continuing the match seamlessly.
 */
export function removePlayerFromGame(
  state: GameState,
  targetPlayerId: string,
): { success: boolean; error?: string } {
  const target = state.players[targetPlayerId];
  if (!target) {
    return { success: false, error: 'Player not found in active game.' };
  }

  const orderedBefore = getOrderedPlayerIds(state);
  if (orderedBefore.length <= 1) {
    return { success: false, error: 'Cannot remove the last remaining player.' };
  }

  const kickedOrderIdx = orderedBefore.indexOf(targetPlayerId);
  const kickedName = target.name;

  // 1. Return all resources and commodities held by the player back to the bank
  for (const res of VALID_RESOURCES) {
    const amt = target.resources[res] || 0;
    if (amt > 0) {
      state.resourceBank[res] = (state.resourceBank[res] || 0) + amt;
    }
    target.resources[res] = 0;
  }
  if (target.commodities && state.commodityBank) {
    for (const comm of VALID_COMMODITIES) {
      const amt = target.commodities[comm] || 0;
      if (amt > 0) {
        state.commodityBank[comm] = (state.commodityBank[comm] || 0) + amt;
      }
      target.commodities[comm] = 0;
    }
  }

  // 2. Return all unplayed and played Development Cards & Progress Cards back into their decks
  const returnedDevCards = [
    ...(target.devCards || []),
    ...(target.playedDevCards || []),
  ].map((card) => ({
    id: card.id,
    type: card.type,
    ...(card.vpName ? { vpName: card.vpName } : {}),
  }));

  if (returnedDevCards.length > 0) {
    state.devCardDeck = shuffle([...state.devCardDeck, ...returnedDevCards]);
  }
  target.devCards = [];
  target.playedDevCards = [];

  if (state.progressDecks) {
    const returnedProgress = [
      ...(target.progressCards || []),
      ...(target.playedProgressCards || []),
    ];
    for (const pc of returnedProgress) {
      state.progressDecks[pc.discipline].push(pc);
    }
    state.progressDecks.trade = shuffle(state.progressDecks.trade);
    state.progressDecks.politics = shuffle(state.progressDecks.politics);
    state.progressDecks.science = shuffle(state.progressDecks.science);
  }
  target.progressCards = [];
  target.playedProgressCards = [];

  // 3. Remove all settlements, cities, roads, knights, metropolises, and merchant owned by the kicked player
  for (const [vid, building] of Object.entries(state.board.buildings)) {
    if (building.playerId === targetPlayerId) {
      delete state.board.buildings[vid];
    }
  }
  for (const [eid, road] of Object.entries(state.board.roads)) {
    if (road.playerId === targetPlayerId) {
      delete state.board.roads[eid];
    }
  }
  if (state.board.knights) {
    for (const [vid, knight] of Object.entries(state.board.knights)) {
      if (knight.playerId === targetPlayerId) {
        delete state.board.knights[vid];
      }
    }
  }
  if (state.metropolises) {
    for (const disc of ['trade', 'politics', 'science'] as ProgressCardDiscipline[]) {
      if (state.metropolises[disc].ownerId === targetPlayerId) {
        state.metropolises[disc] = { ownerId: null, vertexId: null, level: 0 };
      }
    }
  }
  if (state.merchant?.ownerId === targetPlayerId) {
    state.merchant = { hexId: null, ownerId: null, resource: null };
  }

  // 4. Remove player from state.players and state.playerOrder, and re-index seatIndex
  delete state.players[targetPlayerId];
  state.playerOrder = orderedBefore.filter((id) => id !== targetPlayerId);
  state.playerOrder.forEach((pid, idx) => {
    if (state.players[pid]) {
      state.players[pid].seatIndex = idx;
    }
  });

  state.settings.pairedPlayersTurn =
    state.settings.maxPlayers === 6 && state.playerOrder.length >= 5;

  // 5. Recompute Largest Army if the kicked player held it
  if (state.largestArmyOwnerId === targetPlayerId) {
    let bestPlayerId: string | null = null;
    let bestKnights = 2; // Need at least 3 knights
    let tie = false;

    for (const pid of state.playerOrder) {
      const p = state.players[pid];
      if (!p) continue;
      if (p.playedKnightsCount > bestKnights) {
        bestKnights = p.playedKnightsCount;
        bestPlayerId = pid;
        tie = false;
      } else if (p.playedKnightsCount === bestKnights && bestPlayerId !== null) {
        tie = true;
      }
    }

    state.largestArmyOwnerId = !tie ? bestPlayerId : null;
    for (const p of Object.values(state.players)) {
      p.hasLargestArmy = p.id === state.largestArmyOwnerId;
    }
  }

  // 6. Recompute Longest Road and Harbor Master across remaining players
  if (state.longestRouteOwnerId === targetPlayerId) {
    state.longestRouteOwnerId = null;
  }
  evaluateAndNotifyLongestRoute(state);
  if (state.harborMasterOwnerId === targetPlayerId) {
    state.harborMasterOwnerId = null;
  }
  evaluateAndNotifyHarborMaster(state);

  // 7. Clean up active trade offers involving the kicked player
  if (state.activeTradeOffer) {
    if (state.activeTradeOffer.fromPlayerId === targetPlayerId) {
      state.activeTradeOffer = null;
    } else {
      delete state.activeTradeOffer.status[targetPlayerId];
      state.activeTradeOffer.counterOffers = state.activeTradeOffer.counterOffers.filter(
        (c) => c.fromPlayerId !== targetPlayerId,
      );
      const remainingStatuses = Object.values(state.activeTradeOffer.status);
      if (
        remainingStatuses.length > 0 &&
        remainingStatuses.every((s) => s === 'declined') &&
        state.activeTradeOffer.counterOffers.length === 0
      ) {
        state.activeTradeOffer = null;
      }
    }
  }

  // 8. Clean up pending discards & C&K prompts
  delete state.pendingDiscards[targetPlayerId];
  state.pendingStealTargets = state.pendingStealTargets.filter((id) => id !== targetPlayerId);
  if (state.pendingAqueductPlayerIds) {
    state.pendingAqueductPlayerIds = state.pendingAqueductPlayerIds.filter((id) => id !== targetPlayerId);
  }
  if (state.pendingBarbarianRewardPlayerIds) {
    state.pendingBarbarianRewardPlayerIds = state.pendingBarbarianRewardPlayerIds.filter(
      (id) => id !== targetPlayerId,
    );
  }
  if (state.pendingBarbarianPillagePlayerIds) {
    state.pendingBarbarianPillagePlayerIds = state.pendingBarbarianPillagePlayerIds.filter(
      (id) => id !== targetPlayerId,
    );
  }
  if (state.pendingProgressDiscardPlayerIds) {
    state.pendingProgressDiscardPlayerIds = state.pendingProgressDiscardPlayerIds.filter(
      (id) => id !== targetPlayerId,
    );
  }
  if (state.pendingWeddingPlayerIds) {
    state.pendingWeddingPlayerIds = state.pendingWeddingPlayerIds.filter((id) => id !== targetPlayerId);
  }
  if (state.pendingCommercialHarbor) {
    state.pendingCommercialHarbor = state.pendingCommercialHarbor.filter(
      (o) => o.fromPlayerId !== targetPlayerId && o.targetPlayerId !== targetPlayerId,
    );
  }
  if (state.pendingDisplacedKnight?.playerId === targetPlayerId) {
    state.pendingDisplacedKnight = null;
  }
  if (
    state.pendingDeserter?.requesterId === targetPlayerId ||
    state.pendingDeserter?.targetPlayerId === targetPlayerId
  ) {
    state.pendingDeserter = null;
  }
  if (
    state.pendingGuildDues?.playerId === targetPlayerId ||
    state.pendingGuildDues?.targetPlayerId === targetPlayerId
  ) {
    state.pendingGuildDues = null;
  }
  if (
    state.pendingEspionage?.playerId === targetPlayerId ||
    state.pendingEspionage?.targetPlayerId === targetPlayerId
  ) {
    state.pendingEspionage = null;
  }

  // 9. Adjust Setup Turn Order or Active Turn Progression
  if (state.phase === 'SETUP_ROUND_1' || state.phase === 'SETUP_ROUND_2') {
    const wasActiveSetupTurn = state.setupTurnOrder[state.setupTurnIndex] === targetPlayerId;
    let removedBeforeCurrent = 0;
    for (let i = 0; i < state.setupTurnIndex && i < state.setupTurnOrder.length; i++) {
      if (state.setupTurnOrder[i] === targetPlayerId) {
        removedBeforeCurrent++;
      }
    }
    state.setupTurnOrder = state.setupTurnOrder.filter((id) => id !== targetPlayerId);
    state.setupTurnIndex = Math.max(0, state.setupTurnIndex - removedBeforeCurrent);

    if (wasActiveSetupTurn) {
      state.lastSetupVertexId = null;
    }

    if (state.setupTurnIndex >= state.setupTurnOrder.length) {
      state.phase = 'TURN_START';
      state.currentTurnPlayerId = state.playerOrder[0];
      state.pairedPlayerId = state.settings.pairedPlayersTurn
        ? getPairedPlayerId(state.currentTurnPlayerId, state.playerOrder)
        : undefined;
      state.diceRolledThisTurn = false;
      state.devCardPlayedThisTurn = false;
      refreshTurnTimer(state);
    } else {
      state.phase =
        state.setupTurnIndex >= state.playerOrder.length ? 'SETUP_ROUND_2' : 'SETUP_ROUND_1';
      state.currentTurnPlayerId = state.setupTurnOrder[state.setupTurnIndex];
      if (wasActiveSetupTurn) {
        refreshTurnTimer(state);
      }
    }
  } else if (state.phase !== 'GAME_OVER') {
    const wasCurrentTurnPlayer = state.currentTurnPlayerId === targetPlayerId;
    const wasPairedTurnPlayer =
      state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId === targetPlayerId;
    const wasRobberController = state.robberControllerPlayerId === targetPlayerId;

    if (wasCurrentTurnPlayer) {
      const nextIdx =
        kickedOrderIdx >= 0 && state.playerOrder.length > 0
          ? kickedOrderIdx % state.playerOrder.length
          : 0;
      state.currentTurnPlayerId = state.playerOrder[nextIdx];
      state.pairedPlayerId = state.settings.pairedPlayersTurn
        ? getPairedPlayerId(state.currentTurnPlayerId, state.playerOrder)
        : undefined;
      state.phase = 'TURN_START';
      state.diceRolledThisTurn = false;
      state.devCardPlayedThisTurn = false;
      state.freeRoadsRemaining = 0;
      state.savedActionRemainingMs = null;
      state.robberControllerPlayerId = null;
      state.pendingDiscards = {};
      state.pendingStealTargets = [];
      state.activeTradeOffer = null;
      refreshTurnTimer(state);
    } else if (wasPairedTurnPlayer) {
      const currIdx = state.playerOrder.indexOf(state.currentTurnPlayerId);
      const nextP1Idx = currIdx >= 0 ? (currIdx + 1) % state.playerOrder.length : 0;
      state.currentTurnPlayerId = state.playerOrder[nextP1Idx];
      state.pairedPlayerId = state.settings.pairedPlayersTurn
        ? getPairedPlayerId(state.currentTurnPlayerId, state.playerOrder)
        : undefined;
      state.phase = 'TURN_START';
      state.diceRolledThisTurn = false;
      state.devCardPlayedThisTurn = false;
      state.freeRoadsRemaining = 0;
      state.savedActionRemainingMs = null;
      state.robberControllerPlayerId = null;
      refreshTurnTimer(state);
    } else {
      if (state.settings.pairedPlayersTurn) {
        state.pairedPlayerId = getPairedPlayerId(state.currentTurnPlayerId, state.playerOrder);
      } else {
        state.pairedPlayerId = undefined;
      }

      if (state.phase === 'DISCARD_PHASE' && Object.keys(state.pendingDiscards).length === 0) {
        if (state.postDiscardPhase) {
          state.phase = state.postDiscardPhase;
          state.postDiscardPhase = null;
          resumeNormalTurnTimer(state);
        } else if (state.settings.expansion === 'cities_and_knights' && !state.robberActive) {
          state.phase = 'ACTION_PHASE';
          state.robberControllerPlayerId = null;
          refreshTurnTimer(state);
        } else {
          state.phase = 'ROBBER_PLACEMENT';
          state.robberControllerPlayerId = state.currentTurnPlayerId;
          refreshTurnTimer(state);
        }
      } else if (
        (state.phase === 'ROBBER_PLACEMENT' || state.phase === 'ROBBER_STEAL') &&
        wasRobberController
      ) {
        state.robberControllerPlayerId = null;
        state.pendingStealTargets = [];
        state.phase = state.diceRolledThisTurn ? 'ACTION_PHASE' : 'TURN_START';
        resumeNormalTurnTimer(state);
      } else if (state.phase === 'ROBBER_STEAL' && state.pendingStealTargets.length === 0) {
        const resumePhase =
          state.pairedPlayerId && state.robberControllerPlayerId === state.pairedPlayerId
            ? 'PAIRED_ACTION_PHASE'
            : state.diceRolledThisTurn
              ? 'ACTION_PHASE'
              : 'TURN_START';
        state.robberControllerPlayerId = null;
        state.phase = resumePhase;
        resumeNormalTurnTimer(state);
      }
    }
  }

  state.actionLog.push({
    id: `log_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    message: `🚫 ${kickedName} was removed by the host. Their cards and pieces were returned to the bank.`,
    category: 'system',
  });

  syncPlayerVPs(state);
  return { success: true };
}
