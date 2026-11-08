export type ResourceType = 'wood' | 'brick' | 'wheat' | 'sheep' | 'ore';

export type TerrainType =
  | 'forest'
  | 'hills'
  | 'fields'
  | 'pasture'
  | 'mountains'
  | 'desert'
  | 'sea'
  | 'gold';

export type HarborType =
  | 'generic_3_1'
  | 'wood_2_1'
  | 'brick_2_1'
  | 'wheat_2_1'
  | 'sheep_2_1'
  | 'ore_2_1';

export type DevCardType =
  | 'knight'
  | 'road_building'
  | 'year_of_plenty'
  | 'monopoly'
  | 'victory_point';

export type VPDevCardName =
  | 'chapel'
  | 'great_hall'
  | 'market'
  | 'university'
  | 'library';

export interface DevCard {
  id: string;
  type: DevCardType;
  vpName?: VPDevCardName;
  boughtTurn?: number;
}

export type PlayerColor = 'red' | 'blue' | 'orange' | 'white' | 'green' | 'purple';

export type ExpansionType = 'base' | 'cities_and_knights' | 'seafarers';

export interface TimerSettings {
  setupTimeoutSeconds: number; // default 45
  rollTimeoutSeconds: number; // default 15
  turnTimeoutSeconds: number; // default 180 (3 minutes), max 300 (5 minutes)
  robberTimeoutSeconds: number; // default 25 (used for discard, robber placement, robber steal, and dev card sub-actions)
}

export interface HouseRules {
  balancedDice: boolean; // default false: shuffle 36 ordered dice pairs, draw without replacement
  hiddenBank: boolean; // default false: withhold bank resource counts from client payloads
  freeTrades: boolean; // default false: allow one-sided gifts (giving 0 or asking 0, but not both 0)
}

export interface GameSettings {
  expansion: ExpansionType;
  maxPlayers: number; // 2, 3, 4, 5, or 6
  pairedPlayersTurn: boolean; // true for 5-6 player
  victoryPointsToWin: number; // 10 for Base, 13 for C&K
  cardDiscardLimit: number; // default 7
  turnTimeoutSeconds: number; // default 180 (3 minutes)
  setupTimeoutSeconds: number; // default 45
  rollTimeoutSeconds: number; // default 15
  robberTimeoutSeconds: number; // default 25
  houseRules: HouseRules;
}

export interface ResourceCount {
  wood: number;
  brick: number;
  wheat: number;
  sheep: number;
  ore: number;
}

export type GamePhase =
  | 'LOBBY'
  | 'SETUP_ROUND_1'
  | 'SETUP_ROUND_2'
  | 'TURN_START'
  | 'DISCARD_PHASE'
  | 'ROBBER_PLACEMENT'
  | 'ROBBER_STEAL'
  | 'ACTION_PHASE'
  | 'PAIRED_ACTION_PHASE'
  | 'GAME_OVER';

export interface VertexCoordinate {
  id: string; // canonical vertex ID e.g. "v_60_0"
  hexCoords: string[];
  x: number;
  y: number;
}

export interface EdgeCoordinate {
  id: string; // canonical vertexA--vertexB sorted
  v1: string;
  v2: string;
  midX: number;
  midY: number;
}

export interface HexTile {
  id: string; // "q,r,s"
  q: number;
  r: number;
  s: number;
  terrain: TerrainType;
  resource?: ResourceType;
  number?: number; // 2..12 (excluding 7)
  letterToken?: string; // "A".."Z"
  hasRobber: boolean;
  hasPirate?: boolean;
}

export interface Harbor {
  id: string;
  type: HarborType;
  vertexIds: [string, string]; // 2 vertices on the coast
  edgeId: string;
  coastalHexId: string; // The land hex bordering this harbor
  ratio: number; // 2 or 3
  resource?: ResourceType;
}

export interface Building {
  id: string;
  type: 'settlement' | 'city';
  playerId: string;
  vertexId: string;
}

export interface Road {
  id: string;
  playerId: string;
  edgeId: string;
}

export interface CounterOffer {
  id: string;
  tradeOfferId: string;
  fromPlayerId: string;
  giving: Partial<ResourceCount>;
  asking: Partial<ResourceCount>;
  createdAt: number;
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  targetPlayerId: 'all' | string;
  giving: Partial<ResourceCount>;
  asking: Partial<ResourceCount>;
  status: Record<string, 'pending' | 'accepted' | 'declined'>;
  counterOffers: CounterOffer[];
  createdAt: number;
}

export interface PlayerPublicState {
  id: string;
  name: string;
  color: PlayerColor;
  seatIndex: number;
  isConnected: boolean;
  victoryPoints: number; // visible public VPs (secret VP dev cards remain hidden until GAME_OVER)
  cardCount: number; // total resource cards in hand
  devCardCount: number; // total unplayed dev cards
  playedKnightsCount: number;
  longestRouteLength: number;
  hasLongestRoute: boolean;
  hasLargestArmy: boolean;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
}

export interface PlayerPrivateState extends PlayerPublicState {
  secretVictoryPoints: number; // total VPs including hidden VP dev cards
  resources: ResourceCount;
  devCards: DevCard[];
  playedDevCards: DevCard[];
}

export interface BoardState {
  hexes: Record<string, HexTile>;
  vertices: Record<string, VertexCoordinate>;
  edges: Record<string, EdgeCoordinate>;
  buildings: Record<string, Building>; // key is vertexId
  roads: Record<string, Road>; // key is edgeId
  harbors: Record<string, Harbor>;
  robberHexId: string;
  pirateHexId?: string;
}

export interface GameAwardEvent {
  id: string;
  timestamp: number;
  awardType: 'longest_route' | 'largest_army';
  playerId: string;
  playerName: string;
  playerColor: PlayerColor;
  metricValue: number; // road length or knights count
}

export interface ChatMessage {
  id: string;
  roomCode: string;
  playerId: string;
  playerName: string;
  playerColor: PlayerColor;
  text: string;
  timestamp: number;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface GameState {
  id: string;
  startedAt: number;
  settings: GameSettings;
  phase: GamePhase;
  turnNumber: number;
  playerOrder: string[]; // Randomized player turn order established at match start
  currentTurnPlayerId: string; // Player 1
  pairedPlayerId?: string; // Player 2 during paired turn
  setupTurnOrder: string[]; // player IDs in snake draft order
  setupTurnIndex: number;
  lastSetupVertexId: string | null; // Tracks the settlement just placed in setup so road attaches to it
  diceRoll: [number, number] | null;
  balancedDiceDeck: Array<[number, number]>; // Private deck of 36 ordered dice pairs when balancedDice is enabled
  diceHistory: Record<number, number>; // Counts of each sum (2..12) rolled during the match
  lastDiceRollAt: number | null; // Timestamp of last roll to trigger client dice animation
  diceRolledThisTurn: boolean;
  devCardPlayedThisTurn: boolean;
  freeRoadsRemaining: number; // From Road Building dev card
  turnDeadlineMs: number | null; // Unix timestamp (ms) when current sub-turn expires
  phaseDurationMs: number; // Total duration (ms) of current sub-turn for progress bar
  savedActionRemainingMs: number | null; // Paused normal turn time while resolving Robber or Road Building dev card
  robberControllerPlayerId: string | null; // Tracks who is currently controlling the robber (Player 1 or Paired Player 2)
  latestAwardEvent: GameAwardEvent | null; // Triggers client celebration banner on Longest Road / Largest Army change
  board: BoardState;
  players: Record<string, PlayerPrivateState>;
  devCardDeck: DevCard[];
  resourceBank: ResourceCount;
  activeTradeOffer: TradeOffer | null;
  pendingDiscards: Record<string, number>; // playerId -> count needed to discard
  pendingStealTargets: string[]; // playerIds that can be stolen from
  longestRouteOwnerId: string | null;
  largestArmyOwnerId: string | null;
  winnerId: string | null;
  actionLog: GameLogEntry[];
}

export interface GameLogEntry {
  id: string;
  timestamp: number;
  playerId?: string;
  message: string;
  category: 'dice' | 'trade' | 'build' | 'card' | 'robber' | 'system';
}

// Client redacted state (strips all opponent private cards, devCardDeck, balancedDiceDeck, and hides bank when hiddenBank is true)
export interface RedactedGameState
  extends Omit<GameState, 'players' | 'devCardDeck' | 'balancedDiceDeck' | 'resourceBank'> {
  players: Record<string, PlayerPublicState>;
  self?: PlayerPrivateState;
  devCardDeckCount: number;
  resourceBank: ResourceCount | null;
}
