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

export interface GameSettings {
  expansion: ExpansionType;
  maxPlayers: number; // 3, 4, 5, or 6
  pairedPlayersTurn: boolean; // default true for 5-6 player
  victoryPointsToWin: number; // 10 for Base, 13 for C&K
  cardDiscardLimit: number; // default 7
  turnTimeoutSeconds: number; // 0 for infinite, or 60/90/120
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
  id: string; // sorted canonical hex IDs e.g. "0,0,0|0,1,-1|1,0,-1"
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
  victoryPoints: number; // visible VPs
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

export interface GameState {
  id: string;
  settings: GameSettings;
  phase: GamePhase;
  turnNumber: number;
  currentTurnPlayerId: string; // Player 1
  pairedPlayerId?: string; // Player 2 during paired turn
  setupTurnOrder: string[]; // player IDs in snake draft order
  setupTurnIndex: number;
  diceRoll: [number, number] | null;
  diceRolledThisTurn: boolean;
  devCardPlayedThisTurn: boolean;
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

// Client redacted state
export interface RedactedGameState extends Omit<GameState, 'players' | 'devCardDeck'> {
  players: Record<string, PlayerPublicState>;
  self?: PlayerPrivateState;
  devCardDeckCount: number;
}
