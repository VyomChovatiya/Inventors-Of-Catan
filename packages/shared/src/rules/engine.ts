import {
  BoardState,
  DevCard,
  GamePhase,
  GameState,
  PlayerColor,
  PlayerPrivateState,
  RedactedGameState,
  ResourceCount,
} from '../types/index.js';
import { generateBoard } from '../board/generator.js';
import { MAX_PIECES } from './costs.js';

export const INITIAL_BANK: ResourceCount = {
  wood: 19,
  brick: 19,
  wheat: 19,
  sheep: 19,
  ore: 19,
};

export const INITIAL_BANK_5_6: ResourceCount = {
  wood: 24,
  brick: 24,
  wheat: 24,
  sheep: 24,
  ore: 24,
};

// PlaySettlr-inspired phase durations (in milliseconds)
export const PHASE_DURATIONS_MS: Record<GamePhase, number> = {
  LOBBY: 0,
  SETUP_ROUND_1: 45_000, // 45s to place settlement + road
  SETUP_ROUND_2: 45_000, // 45s to place 2nd settlement + road
  TURN_START: 15_000, // 15s to roll dice (auto-rolls on timeout)
  DISCARD_PHASE: 30_000, // 30s to discard on 7 (auto-discards on timeout)
  ROBBER_PLACEMENT: 25_000, // 25s to move robber (auto-moves on timeout)
  ROBBER_STEAL: 20_000, // 20s to choose steal victim
  ACTION_PHASE: 60_000, // 60s main turn (auto-passes on timeout)
  PAIRED_ACTION_PHASE: 30_000, // 30s paired player turn (auto-passes on timeout)
  GAME_OVER: 0,
};

export function refreshTurnTimer(state: GameState) {
  const duration = PHASE_DURATIONS_MS[state.phase] || 0;
  state.phaseDurationMs = duration;
  state.turnDeadlineMs = duration > 0 ? Date.now() + duration : null;
}

export function createDevCardDeck(is5to6: boolean): DevCard[] {
  const cards: DevCard[] = [];
  let id = 1;

  const knightsCount = is5to6 ? 20 : 14;
  const roadBuildingCount = is5to6 ? 3 : 2;
  const yearOfPlentyCount = is5to6 ? 3 : 2;
  const monopolyCount = is5to6 ? 3 : 2;

  for (let i = 0; i < knightsCount; i++) cards.push({ id: `dc_${id++}`, type: 'knight' });
  for (let i = 0; i < roadBuildingCount; i++) cards.push({ id: `dc_${id++}`, type: 'road_building' });
  for (let i = 0; i < yearOfPlentyCount; i++) cards.push({ id: `dc_${id++}`, type: 'year_of_plenty' });
  for (let i = 0; i < monopolyCount; i++) cards.push({ id: `dc_${id++}`, type: 'monopoly' });

  const vpNames: Array<'chapel' | 'great_hall' | 'market' | 'university' | 'library'> = [
    'chapel',
    'great_hall',
    'market',
    'university',
    'library',
  ];
  for (const name of vpNames) {
    cards.push({ id: `dc_${id++}`, type: 'victory_point', vpName: name });
  }

  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }

  return cards;
}

export function createInitialPlayer(
  id: string,
  name: string,
  color: PlayerColor,
  seatIndex: number,
): PlayerPrivateState {
  return {
    id,
    name,
    color,
    seatIndex,
    isConnected: true,
    victoryPoints: 0,
    cardCount: 0,
    devCardCount: 0,
    playedKnightsCount: 0,
    longestRouteLength: 0,
    hasLongestRoute: false,
    hasLargestArmy: false,
    roadsLeft: MAX_PIECES.roads,
    settlementsLeft: MAX_PIECES.settlements,
    citiesLeft: MAX_PIECES.cities,
    resources: { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 },
    devCards: [],
    playedDevCards: [],
  };
}

export function initializeGame(
  gameId: string,
  playersList: Array<{ id: string; name: string; color: PlayerColor }>,
  is5to6 = false,
): GameState {
  const isExpanded = is5to6 || playersList.length > 4;
  const usePairedTurn = isExpanded && playersList.length >= 5;
  const board = generateBoard(isExpanded);
  const devCardDeck = createDevCardDeck(isExpanded);
  const resourceBank = isExpanded ? { ...INITIAL_BANK_5_6 } : { ...INITIAL_BANK };

  const players: Record<string, PlayerPrivateState> = {};
  const playerIds = playersList.map((p) => p.id);

  playersList.forEach((p, idx) => {
    players[p.id] = createInitialPlayer(p.id, p.name, p.color, idx);
  });

  // Snake draft setup order: [0, 1, ..., N-1, N-1, ..., 0]
  const setupTurnOrder: string[] = [];
  for (let i = 0; i < playerIds.length; i++) setupTurnOrder.push(playerIds[i]);
  for (let i = playerIds.length - 1; i >= 0; i--) setupTurnOrder.push(playerIds[i]);

  const firstPlayerId = setupTurnOrder[0];
  const pairedPlayerId = usePairedTurn ? getPairedPlayerId(firstPlayerId, playerIds) : undefined;

  const state: GameState = {
    id: gameId,
    settings: {
      expansion: 'base',
      maxPlayers: isExpanded ? 6 : 4,
      pairedPlayersTurn: usePairedTurn,
      victoryPointsToWin: 10,
      cardDiscardLimit: 7,
      turnTimeoutSeconds: 60,
    },
    phase: 'SETUP_ROUND_1',
    turnNumber: 1,
    currentTurnPlayerId: firstPlayerId,
    pairedPlayerId,
    setupTurnOrder,
    setupTurnIndex: 0,
    lastSetupVertexId: null,
    diceRoll: null,
    lastDiceRollAt: null,
    diceRolledThisTurn: false,
    devCardPlayedThisTurn: false,
    freeRoadsRemaining: 0,
    turnDeadlineMs: null,
    phaseDurationMs: PHASE_DURATIONS_MS.SETUP_ROUND_1,
    board,
    players,
    devCardDeck,
    resourceBank,
    activeTradeOffer: null,
    pendingDiscards: {},
    pendingStealTargets: [],
    longestRouteOwnerId: null,
    largestArmyOwnerId: null,
    winnerId: null,
    actionLog: [
      {
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        message: 'Game started! Initial placement begins.',
        category: 'system',
      },
    ],
  };

  refreshTurnTimer(state);
  return state;
}

export function getPairedPlayerId(player1Id: string, playerIds: string[]): string {
  const p1Index = playerIds.indexOf(player1Id);
  const p2Index = (p1Index + 3) % playerIds.length;
  return playerIds[p2Index];
}

export function getAdjacentVertices(vertexId: string, board: BoardState): string[] {
  const adjacent = new Set<string>();
  for (const edge of Object.values(board.edges)) {
    if (edge.v1 === vertexId) adjacent.add(edge.v2);
    if (edge.v2 === vertexId) adjacent.add(edge.v1);
  }
  return Array.from(adjacent);
}

export function satisfiesDistanceRule(vertexId: string, board: BoardState): boolean {
  if (board.buildings[vertexId]) return false;
  const adj = getAdjacentVertices(vertexId, board);
  for (const v of adj) {
    if (board.buildings[v]) return false;
  }
  return true;
}

export function isValidSetupSettlementVertex(state: GameState, playerId: string, vertexId: string): boolean {
  if (state.phase !== 'SETUP_ROUND_1' && state.phase !== 'SETUP_ROUND_2') return false;
  if (state.setupTurnOrder[state.setupTurnIndex] !== playerId) return false;
  if (state.lastSetupVertexId !== null) return false;
  if (!state.board.vertices[vertexId]) return false;
  return satisfiesDistanceRule(vertexId, state.board);
}

export function isValidSetupRoadEdge(state: GameState, playerId: string, edgeId: string): boolean {
  if (state.phase !== 'SETUP_ROUND_1' && state.phase !== 'SETUP_ROUND_2') return false;
  if (state.setupTurnOrder[state.setupTurnIndex] !== playerId) return false;
  if (!state.lastSetupVertexId) return false;
  const edge = state.board.edges[edgeId];
  if (!edge || state.board.roads[edgeId]) return false;
  return edge.v1 === state.lastSetupVertexId || edge.v2 === state.lastSetupVertexId;
}

export function isValidRoadEdge(state: GameState, playerId: string, edgeId: string): boolean {
  const edge = state.board.edges[edgeId];
  if (!edge || state.board.roads[edgeId]) return false;

  const v1Building = state.board.buildings[edge.v1];
  const v2Building = state.board.buildings[edge.v2];

  const v1TouchesOwnBuilding = v1Building && v1Building.playerId === playerId;
  const v2TouchesOwnBuilding = v2Building && v2Building.playerId === playerId;

  const v1FriendlyRoad =
    (!v1Building || v1Building.playerId === playerId) &&
    Object.values(state.board.roads).some(
      (r) =>
        r.playerId === playerId &&
        (state.board.edges[r.edgeId].v1 === edge.v1 || state.board.edges[r.edgeId].v2 === edge.v1),
    );

  const v2FriendlyRoad =
    (!v2Building || v2Building.playerId === playerId) &&
    Object.values(state.board.roads).some(
      (r) =>
        r.playerId === playerId &&
        (state.board.edges[r.edgeId].v1 === edge.v2 || state.board.edges[r.edgeId].v2 === edge.v2),
    );

  return Boolean(v1TouchesOwnBuilding || v2TouchesOwnBuilding || v1FriendlyRoad || v2FriendlyRoad);
}

export function isValidSettlementVertex(state: GameState, playerId: string, vertexId: string): boolean {
  if (!state.board.vertices[vertexId]) return false;
  if (!satisfiesDistanceRule(vertexId, state.board)) return false;

  const hasConnectingRoad = Object.values(state.board.roads).some(
    (r) =>
      r.playerId === playerId &&
      (state.board.edges[r.edgeId].v1 === vertexId || state.board.edges[r.edgeId].v2 === vertexId),
  );
  return hasConnectingRoad;
}

export function computeVictoryPoints(player: PlayerPrivateState): number {
  let vps = 0;
  const settlementsBuilt = MAX_PIECES.settlements - player.settlementsLeft;
  vps += settlementsBuilt;

  const citiesBuilt = MAX_PIECES.cities - player.citiesLeft;
  vps += citiesBuilt * 2;

  if (player.hasLongestRoute) vps += 2;
  if (player.hasLargestArmy) vps += 2;

  for (const card of player.devCards) {
    if (card.type === 'victory_point') {
      vps += 1;
    }
  }

  return vps;
}

export function syncPlayerVPs(state: GameState) {
  for (const player of Object.values(state.players)) {
    player.victoryPoints = computeVictoryPoints(player);
    player.cardCount = Object.values(player.resources).reduce((sum, n) => sum + n, 0);
    player.devCardCount = player.devCards.length;

    if (player.victoryPoints >= state.settings.victoryPointsToWin && !state.winnerId) {
      state.winnerId = player.id;
      state.phase = 'GAME_OVER';
      state.turnDeadlineMs = null;
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🏆 ${player.name} has reached ${player.victoryPoints} Victory Points and won the game!`,
        category: 'system',
      });
    }
  }
}

export function redactStateForPlayer(state: GameState, requestingPlayerId: string): RedactedGameState {
  const publicPlayers: Record<string, any> = {};

  for (const [pid, player] of Object.entries(state.players)) {
    publicPlayers[pid] = {
      id: player.id,
      name: player.name,
      color: player.color,
      seatIndex: player.seatIndex,
      isConnected: player.isConnected,
      victoryPoints: player.victoryPoints,
      cardCount: player.cardCount,
      devCardCount: player.devCardCount,
      playedKnightsCount: player.playedKnightsCount,
      longestRouteLength: player.longestRouteLength,
      hasLongestRoute: player.hasLongestRoute,
      hasLargestArmy: player.hasLargestArmy,
      roadsLeft: player.roadsLeft,
      settlementsLeft: player.settlementsLeft,
      citiesLeft: player.citiesLeft,
    };
  }

  const self = state.players[requestingPlayerId];

  return {
    ...state,
    players: publicPlayers,
    self,
    devCardDeckCount: state.devCardDeck.length,
  };
}
