import {
  BoardState,
  DevCard,
  GamePhase,
  GameState,
  HouseRules,
  PlayerColor,
  PlayerPrivateState,
  PlayerPublicState,
  RedactedGameState,
  ResourceCount,
  TimerSettings,
} from '../types/index.js';
import { cryptoRandomInt, generateBoard, hasAdjacentRedNumbers, shuffle } from '../board/generator.js';
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

export const DEFAULT_HOUSE_RULES: HouseRules = {
  balancedDice: false,
  hiddenBank: false,
  freeTrades: false,
};

export const DEFAULT_TIMER_SETTINGS: TimerSettings = {
  setupTimeoutSeconds: 45,
  rollTimeoutSeconds: 15,
  turnTimeoutSeconds: 180, // 3 minutes default normal turn duration
  robberTimeoutSeconds: 25,
};

// Default phase durations (in milliseconds)
export const PHASE_DURATIONS_MS: Record<GamePhase, number> = {
  LOBBY: 0,
  SETUP_ROUND_1: 45_000, // 45s to place settlement + road
  SETUP_ROUND_2: 45_000, // 45s to place 2nd settlement + road
  TURN_START: 15_000, // 15s to roll dice (auto-rolls on timeout)
  DISCARD_PHASE: 25_000, // 25s to discard on 7 (auto-discards on timeout)
  ROBBER_PLACEMENT: 25_000, // 25s to move robber (auto-moves on timeout)
  ROBBER_STEAL: 25_000, // 25s to choose steal victim
  ACTION_PHASE: 180_000, // 3m (180s) main turn default (auto-passes on timeout)
  PAIRED_ACTION_PHASE: 90_000, // Paired player turn (auto-passes on timeout)
  GAME_OVER: 0,
};

/**
 * Exact theoretical probability distribution of sums for two independent 6-sided dice (out of 36 ordered outcomes).
 */
export const THEORETICAL_TWO_DICE_COUNTS: Record<number, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  8: 5,
  9: 4,
  10: 3,
  11: 2,
  12: 1,
};

/**
 * Rolls two independent 6-sided dice (1..6 each) using unbiased CSPRNG by default.
 */
export function rollOrdinaryDice(rng?: () => number): [number, number] {
  const d1 = cryptoRandomInt(6, rng) + 1;
  const d2 = cryptoRandomInt(6, rng) + 1;
  return [d1, d2];
}

/**
 * Generates and shuffles all 36 ordered pairs (d1, d2) for Balanced Dice mode.
 */
export function createBalancedDiceDeck(): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  for (let d1 = 1; d1 <= 6; d1++) {
    for (let d2 = 1; d2 <= 6; d2++) {
      pairs.push([d1, d2]);
    }
  }
  return shuffle(pairs);
}

/**
 * Draws the next ordered dice pair from the state's private balanced dice deck without replacement,
 * reshuffling a fresh 36-roll deck after every 36 rolls.
 */
export function drawBalancedDiceRoll(state: GameState): [number, number] {
  if (!Array.isArray(state.balancedDiceDeck) || state.balancedDiceDeck.length === 0) {
    state.balancedDiceDeck = createBalancedDiceDeck();
  }
  const pair = state.balancedDiceDeck.shift()!;
  if (state.balancedDiceDeck.length === 0) {
    state.balancedDiceDeck = createBalancedDiceDeck();
  }
  return pair;
}

export function getPhaseDurationMs(state: GameState): number {
  const s = state.settings;
  switch (state.phase) {
    case 'SETUP_ROUND_1':
    case 'SETUP_ROUND_2':
      return (s.setupTimeoutSeconds || DEFAULT_TIMER_SETTINGS.setupTimeoutSeconds) * 1000;
    case 'TURN_START':
      return (s.rollTimeoutSeconds || DEFAULT_TIMER_SETTINGS.rollTimeoutSeconds) * 1000;
    case 'DISCARD_PHASE':
    case 'ROBBER_PLACEMENT':
    case 'ROBBER_STEAL':
      return (s.robberTimeoutSeconds || DEFAULT_TIMER_SETTINGS.robberTimeoutSeconds) * 1000;
    case 'ACTION_PHASE':
      if (state.freeRoadsRemaining > 0) {
        return (s.robberTimeoutSeconds || DEFAULT_TIMER_SETTINGS.robberTimeoutSeconds) * 1000;
      }
      return (s.turnTimeoutSeconds || DEFAULT_TIMER_SETTINGS.turnTimeoutSeconds) * 1000;
    case 'PAIRED_ACTION_PHASE':
      if (state.freeRoadsRemaining > 0) {
        return (s.robberTimeoutSeconds || DEFAULT_TIMER_SETTINGS.robberTimeoutSeconds) * 1000;
      }
      return (
        Math.max(
          15,
          Math.round((s.turnTimeoutSeconds || DEFAULT_TIMER_SETTINGS.turnTimeoutSeconds) * 0.5),
        ) * 1000
      );
    default:
      return 0;
  }
}

export function refreshTurnTimer(state: GameState, customDurationMs?: number) {
  const duration = customDurationMs !== undefined ? customDurationMs : getPhaseDurationMs(state);
  state.phaseDurationMs = duration;
  state.turnDeadlineMs = duration > 0 ? Date.now() + duration : null;
}

export function pauseNormalTurnTimer(state: GameState) {
  if (
    (state.phase === 'ACTION_PHASE' || state.phase === 'PAIRED_ACTION_PHASE' || state.phase === 'TURN_START') &&
    state.turnDeadlineMs
  ) {
    state.savedActionRemainingMs = Math.max(5_000, state.turnDeadlineMs - Date.now());
  }
}

export function resumeNormalTurnTimer(state: GameState) {
  if (state.savedActionRemainingMs && state.savedActionRemainingMs > 0) {
    const fullDuration = getPhaseDurationMs(state);
    state.phaseDurationMs = Math.max(fullDuration, state.savedActionRemainingMs);
    state.turnDeadlineMs = Date.now() + state.savedActionRemainingMs;
    state.savedActionRemainingMs = null;
  } else {
    refreshTurnTimer(state);
  }
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

  return shuffle(cards);
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
    secretVictoryPoints: 0,
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

export interface InitializeGameOptions {
  houseRules?: Partial<HouseRules>;
  customBoard?: BoardState | null;
  randomizeTurnOrder?: boolean;
}

export function initializeGame(
  gameId: string,
  playersList: Array<{ id: string; name: string; color: PlayerColor }>,
  is5to6 = false,
  victoryPointsToWin = 10,
  timerSettings?: Partial<TimerSettings>,
  options?: InitializeGameOptions,
): GameState {
  const isExpanded = is5to6 || playersList.length > 4;
  const usePairedTurn = isExpanded && playersList.length >= 5;
  const expectedHexCount = isExpanded ? 30 : 19;

  let board: BoardState;
  if (
    options?.customBoard &&
    Object.keys(options.customBoard.hexes || {}).length === expectedHexCount &&
    !hasAdjacentRedNumbers(options.customBoard.hexes)
  ) {
    board = {
      hexes: structuredClone(options.customBoard.hexes),
      vertices: structuredClone(options.customBoard.vertices),
      edges: structuredClone(options.customBoard.edges),
      harbors: structuredClone(options.customBoard.harbors),
      robberHexId: options.customBoard.robberHexId,
      buildings: {},
      roads: {},
    };
  } else {
    board = generateBoard(isExpanded);
  }

  const devCardDeck = createDevCardDeck(isExpanded);
  const resourceBank = isExpanded ? { ...INITIAL_BANK_5_6 } : { ...INITIAL_BANK };

  // Randomize player turn order when the match starts (unless explicitly disabled by a deterministic test)
  const shouldRandomize = options?.randomizeTurnOrder ?? true;
  const orderedPlayersList = shouldRandomize ? shuffle(playersList) : [...playersList];

  const players: Record<string, PlayerPrivateState> = {};
  const playerOrder = orderedPlayersList.map((p) => p.id);

  orderedPlayersList.forEach((p, idx) => {
    players[p.id] = createInitialPlayer(p.id, p.name, p.color, idx);
  });

  // Snake draft setup order: [0, 1, ..., N-1, N-1, ..., 0]
  const setupTurnOrder: string[] = [];
  for (let i = 0; i < playerOrder.length; i++) setupTurnOrder.push(playerOrder[i]);
  for (let i = playerOrder.length - 1; i >= 0; i--) setupTurnOrder.push(playerOrder[i]);

  const firstPlayerId = playerOrder[0];
  const pairedPlayerId = usePairedTurn ? getPairedPlayerId(firstPlayerId, playerOrder) : undefined;
  const clampedVPs = Math.max(3, Math.min(20, victoryPointsToWin || 10));

  const setupTimeoutSeconds = Math.max(
    15,
    Math.min(180, timerSettings?.setupTimeoutSeconds || DEFAULT_TIMER_SETTINGS.setupTimeoutSeconds),
  );
  const rollTimeoutSeconds = Math.max(
    5,
    Math.min(90, timerSettings?.rollTimeoutSeconds || DEFAULT_TIMER_SETTINGS.rollTimeoutSeconds),
  );
  const turnTimeoutSeconds = Math.max(
    15,
    Math.min(300, timerSettings?.turnTimeoutSeconds || DEFAULT_TIMER_SETTINGS.turnTimeoutSeconds),
  );
  const robberTimeoutSeconds = Math.max(
    10,
    Math.min(120, timerSettings?.robberTimeoutSeconds || DEFAULT_TIMER_SETTINGS.robberTimeoutSeconds),
  );

  const houseRules: HouseRules = {
    balancedDice: Boolean(options?.houseRules?.balancedDice),
    hiddenBank: Boolean(options?.houseRules?.hiddenBank),
    freeTrades: Boolean(options?.houseRules?.freeTrades),
  };

  const diceHistory: Record<number, number> = {
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

  const state: GameState = {
    id: gameId,
    startedAt: Date.now(),
    settings: {
      expansion: 'base',
      maxPlayers: isExpanded ? 6 : 4,
      pairedPlayersTurn: usePairedTurn,
      victoryPointsToWin: clampedVPs,
      cardDiscardLimit: 7,
      turnTimeoutSeconds,
      setupTimeoutSeconds,
      rollTimeoutSeconds,
      robberTimeoutSeconds,
      houseRules,
    },
    phase: 'SETUP_ROUND_1',
    turnNumber: 1,
    playerOrder,
    currentTurnPlayerId: firstPlayerId,
    pairedPlayerId,
    setupTurnOrder,
    setupTurnIndex: 0,
    lastSetupVertexId: null,
    diceRoll: [1, 1],
    balancedDiceDeck: houseRules.balancedDice ? createBalancedDiceDeck() : [],
    diceHistory,
    lastDiceRollAt: null,
    diceRolledThisTurn: false,
    devCardPlayedThisTurn: false,
    freeRoadsRemaining: 0,
    turnDeadlineMs: null,
    phaseDurationMs: setupTimeoutSeconds * 1000,
    savedActionRemainingMs: null,
    robberControllerPlayerId: null,
    latestAwardEvent: null,
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
        message: `Match started! Turn order: ${orderedPlayersList.map((p) => p.name).join(' → ')}. Playing to ${clampedVPs} Victory Points.`,
        category: 'system',
      },
    ],
  };

  refreshTurnTimer(state);
  return state;
}

export function getOrderedPlayerIds(state: GameState): string[] {
  if (Array.isArray(state.playerOrder) && state.playerOrder.length > 0) {
    return state.playerOrder;
  }
  return Object.values(state.players)
    .sort((a, b) => a.seatIndex - b.seatIndex)
    .map((p) => p.id);
}

export function getPairedPlayerId(player1Id: string, playerIds: string[]): string {
  const p1Index = playerIds.indexOf(player1Id);
  if (p1Index === -1) return playerIds[0];
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
  if (!vertexId || !board.vertices[vertexId]) return false;
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

export function computePublicVictoryPoints(player: PlayerPrivateState): number {
  let vps = 0;
  const settlementsBuilt = MAX_PIECES.settlements - player.settlementsLeft;
  vps += settlementsBuilt;

  const citiesBuilt = MAX_PIECES.cities - player.citiesLeft;
  vps += citiesBuilt * 2;

  if (player.hasLongestRoute) vps += 2;
  if (player.hasLargestArmy) vps += 2;

  return vps;
}

export function computeTotalVictoryPoints(player: PlayerPrivateState): number {
  let vps = computePublicVictoryPoints(player);
  for (const card of player.devCards) {
    if (card.type === 'victory_point') {
      vps += 1;
    }
  }
  return vps;
}

// Official Catan Rule: Victory Point cards remain hidden from other players until
// a player reaches the winning total on their turn (Player 1 or Paired Player 2).
export function syncPlayerVPs(state: GameState) {
  for (const player of Object.values(state.players)) {
    const publicVP = computePublicVictoryPoints(player);
    const totalVP = computeTotalVictoryPoints(player);
    player.victoryPoints = publicVP;
    player.secretVictoryPoints = totalVP;
    player.cardCount = Object.values(player.resources).reduce((sum, n) => sum + n, 0);
    player.devCardCount = player.devCards.length;
  }

  // Only the active turn player (or Paired Player 2 during PAIRED_ACTION_PHASE) can claim victory!
  if (!state.winnerId && state.phase !== 'SETUP_ROUND_1' && state.phase !== 'SETUP_ROUND_2') {
    const eligibleWinnerIds: string[] = [];
    if (state.phase === 'PAIRED_ACTION_PHASE' && state.pairedPlayerId) {
      eligibleWinnerIds.push(state.pairedPlayerId);
    } else {
      eligibleWinnerIds.push(state.currentTurnPlayerId);
    }

    for (const pid of eligibleWinnerIds) {
      const p = state.players[pid];
      if (p && p.secretVictoryPoints >= state.settings.victoryPointsToWin) {
        state.winnerId = p.id;
        state.phase = 'GAME_OVER';
        state.turnDeadlineMs = null;

        // Reveal everyone's hidden VP cards now that the game is won
        for (const allP of Object.values(state.players)) {
          allP.victoryPoints = allP.secretVictoryPoints;
        }

        const hiddenVpCount = p.devCards.filter((c) => c.type === 'victory_point').length;
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: p.id,
          message:
            hiddenVpCount > 0
              ? `🏆 ${p.name} revealed ${hiddenVpCount} hidden Victory Point card(s) to reach ${p.secretVictoryPoints} VPs and won the game!`
              : `🏆 ${p.name} has reached ${p.secretVictoryPoints} Victory Points and won the game!`,
          category: 'system',
        });
        break;
      }
    }
  }
}

export function redactStateForPlayer(state: GameState, requestingPlayerId: string): RedactedGameState {
  const publicPlayers: Record<string, PlayerPublicState> = {};
  const orderedIds = getOrderedPlayerIds(state);

  for (const pid of orderedIds) {
    const player = state.players[pid];
    if (!player) continue;
    publicPlayers[pid] = {
      id: player.id,
      name: player.name,
      color: player.color,
      seatIndex: player.seatIndex,
      isConnected: player.isConnected,
      victoryPoints: state.phase === 'GAME_OVER' ? player.secretVictoryPoints : player.victoryPoints,
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

  // Fallback for any player key not in playerOrder
  for (const [pid, player] of Object.entries(state.players)) {
    if (!publicPlayers[pid]) {
      publicPlayers[pid] = {
        id: player.id,
        name: player.name,
        color: player.color,
        seatIndex: player.seatIndex,
        isConnected: player.isConnected,
        victoryPoints: state.phase === 'GAME_OVER' ? player.secretVictoryPoints : player.victoryPoints,
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
  }

  const rawSelf = state.players[requestingPlayerId];
  const self: PlayerPrivateState | undefined = rawSelf
    ? {
        ...publicPlayers[requestingPlayerId],
        secretVictoryPoints: rawSelf.secretVictoryPoints,
        resources: { ...rawSelf.resources },
        devCards: rawSelf.devCards.map((c) => ({ ...c })),
        playedDevCards: rawSelf.playedDevCards.map((c) => ({ ...c })),
      }
    : undefined;

  const { devCardDeck, balancedDiceDeck, players: _allPlayers, resourceBank, ...restState } = state;
  const isBankHidden = Boolean(state.settings?.houseRules?.hiddenBank);

  return {
    ...restState,
    playerOrder: orderedIds,
    players: publicPlayers,
    self,
    devCardDeckCount: devCardDeck.length,
    resourceBank: isBankHidden ? null : { ...resourceBank },
  };
}
