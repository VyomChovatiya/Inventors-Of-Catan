import {
  BoardState,
  DevCard,
  DevCardType,
  GameLogEntry,
  GamePhase,
  GameState,
  HarborType,
  PlayerColor,
  PlayerPrivateState,
  RedactedGameState,
  ResourceCount,
  ResourceType,
  TradeOffer,
  CounterOffer,
} from '../types/index.js';
import { generateBoard } from '../board/generator.js';
import { BUILDING_COSTS, canAfford, deductCost, addResources, MAX_PIECES } from './costs.js';
import { updateLongestRouteOwner } from './longestRoute.js';

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

export function createDevCardDeck(is5to6: boolean): DevCard[] {
  const cards: DevCard[] = [];
  let id = 1;

  // Base dev cards
  const knightsCount = is5to6 ? 20 : 14;
  const vpCount = 5;
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

  // Shuffle
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
  const pairedPlayerId = isExpanded ? getPairedPlayerId(firstPlayerId, playerIds) : undefined;

  return {
    id: gameId,
    settings: {
      expansion: 'base',
      maxPlayers: isExpanded ? 6 : 4,
      pairedPlayersTurn: isExpanded,
      victoryPointsToWin: 10,
      cardDiscardLimit: 7,
      turnTimeoutSeconds: 0,
    },
    phase: 'SETUP_ROUND_1',
    turnNumber: 1,
    currentTurnPlayerId: firstPlayerId,
    pairedPlayerId,
    setupTurnOrder,
    setupTurnIndex: 0,
    diceRoll: null,
    diceRolledThisTurn: false,
    devCardPlayedThisTurn: false,
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
}

// Player 2 is 3 seats clockwise from Player 1 (seatIndex + 3 % totalPlayers)
export function getPairedPlayerId(player1Id: string, playerIds: string[]): string {
  const p1Index = playerIds.indexOf(player1Id);
  const p2Index = (p1Index + 3) % playerIds.length;
  return playerIds[p2Index];
}

// Find adjacent vertices to a given vertex
export function getAdjacentVertices(vertexId: string, board: BoardState): string[] {
  const adjacent = new Set<string>();
  for (const edge of Object.values(board.edges)) {
    if (edge.v1 === vertexId) adjacent.add(edge.v2);
    if (edge.v2 === vertexId) adjacent.add(edge.v1);
  }
  return Array.from(adjacent);
}

// Check distance rule: no building on vertexId or any adjacent vertex
export function satisfiesDistanceRule(vertexId: string, board: BoardState): boolean {
  if (board.buildings[vertexId]) return false;
  const adj = getAdjacentVertices(vertexId, board);
  for (const v of adj) {
    if (board.buildings[v]) return false;
  }
  return true;
}

// Calculate victory points for a player
export function computeVictoryPoints(player: PlayerPrivateState): number {
  let vps = 0;
  // Settlements: 1 VP each (calculated from remaining)
  const settlementsBuilt = MAX_PIECES.settlements - player.settlementsLeft;
  vps += settlementsBuilt;

  // Cities: 2 VPs each
  const citiesBuilt = MAX_PIECES.cities - player.citiesLeft;
  vps += citiesBuilt * 2;

  // Longest Route: 2 VPs
  if (player.hasLongestRoute) vps += 2;

  // Largest Army: 2 VPs
  if (player.hasLargestArmy) vps += 2;

  // Victory point development cards
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
      state.actionLog.push({
        id: `log_${Date.now()}`,
        timestamp: Date.now(),
        playerId: player.id,
        message: `🏆 ${player.name} has reached ${player.victoryPoints} Victory Points and won the game!`,
        category: 'system',
      });
    }
  }
}

// Redact state for a specific client (Anti-cheat)
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
