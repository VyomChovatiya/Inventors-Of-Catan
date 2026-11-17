export type ResourceType = 'wood' | 'brick' | 'wheat' | 'sheep' | 'ore';

export type CommodityType = 'cloth' | 'coin' | 'paper';

export type TradeableCardType = ResourceType | CommodityType;

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

export type ProgressCardDiscipline = 'trade' | 'politics' | 'science';

export type ProgressCardType =
  // Science (18 cards)
  | 'alchemy'
  | 'crane'
  | 'engineering'
  | 'invention'
  | 'irrigation'
  | 'medicine'
  | 'mining'
  | 'road_building'
  | 'smithing'
  | 'printing'
  // Trade (18 cards)
  | 'commercial_harbor'
  | 'guild_dues'
  | 'merchant'
  | 'merchant_fleet'
  | 'resource_monopoly'
  | 'trade_monopoly'
  // Politics (18 cards)
  | 'diplomacy'
  | 'encouragement'
  | 'espionage'
  | 'intrigue'
  | 'sabotage'
  | 'taxation'
  | 'treason'
  | 'constitution'
  | 'wedding';

export interface ProgressCard {
  id: string;
  discipline: ProgressCardDiscipline;
  type: ProgressCardType;
  isVictoryPoint?: boolean;
}

export type EventDieFace = 'barbarian' | 'trade' | 'politics' | 'science';

export interface CityImprovements {
  trade: number; // 0..5
  politics: number; // 0..5
  science: number; // 0..5
}

export interface MetropolisTrackState {
  ownerId: string | null;
  vertexId: string | null;
  level: number; // 0 if unclaimed, 4 or 5 when claimed
}

export type MetropolisesState = Record<ProgressCardDiscipline, MetropolisTrackState>;

export interface KnightPiece {
  id: string;
  playerId: string;
  vertexId: string;
  level: 1 | 2 | 3; // 1 = Basic, 2 = Strong, 3 = Mighty
  active: boolean;
  recruitedTurn: number;
  activatedTurn: number | null;
  promotedTurn: number | null;
  actionTakenTurn: number | null;
}

export interface MerchantState {
  hexId: string | null;
  ownerId: string | null;
  resource: ResourceType | null;
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
  friendlyRobber: boolean; // default false: cannot place robber on hex with opponent at starting VPs (<=2 Base / <=3 C&K)
  noEarly7s: boolean; // default false: rolling a 7 during the first 2 full rounds is automatically re-rolled
  combined2And12: boolean; // default false: rolling a 2 or 12 produces on both 2 and 12 hexes
  playDevCardSameTurn: boolean; // default false: allow playing an action Development Card on the same turn it was bought
  harborMaster: boolean; // default false: +2 VP special award for first player to reach 3+ Harbor Points (Settlement=1, City=2 on port)
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

export interface CommodityCount {
  cloth: number;
  coin: number;
  paper: number;
}

export type TradePayload = Partial<ResourceCount & CommodityCount>;

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
  hasWall?: boolean;
  metropolis?: ProgressCardDiscipline;
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
  giving: TradePayload;
  asking: TradePayload;
  createdAt: number;
}

export interface TradeOffer {
  id: string;
  fromPlayerId: string;
  targetPlayerId: 'all' | string;
  giving: TradePayload;
  asking: TradePayload;
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
  cardCount: number; // total resource + commodity cards in hand
  devCardCount: number; // total unplayed dev cards (or progress cards in C&K)
  playedKnightsCount: number;
  longestRouteLength: number;
  hasLongestRoute: boolean;
  hasLargestArmy: boolean;
  harborPoints: number;
  hasHarborMaster: boolean;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  // Cities & Knights public state
  cityWallsLeft: number;
  basicKnightsLeft: number; // Level 1 supply (max 2)
  strongKnightsLeft: number; // Level 2 supply (max 2)
  mightyKnightsLeft: number; // Level 3 supply (max 2)
  cityImprovements: CityImprovements;
  defenderPoints: number; // Defender of Catan VP tokens (+1 each)
  progressVictoryPoints: number; // Revealed Printing / Constitution cards (+1 each)
  hasMerchant: boolean; // Controls the Merchant (+1 VP)
  metropolises: ProgressCardDiscipline[]; // Owned metropolises (+2 VP each)
  progressCardCount: number; // Hand count of unplayed progress cards (max 4)
  playedProgressCards: ProgressCard[];
}

export interface PlayerPrivateState extends PlayerPublicState {
  secretVictoryPoints: number; // total VPs including hidden VP dev cards
  resources: ResourceCount;
  commodities: CommodityCount;
  devCards: DevCard[];
  playedDevCards: DevCard[];
  progressCards: ProgressCard[];
}

export interface BoardState {
  hexes: Record<string, HexTile>;
  vertices: Record<string, VertexCoordinate>;
  edges: Record<string, EdgeCoordinate>;
  buildings: Record<string, Building>; // key is vertexId
  roads: Record<string, Road>; // key is edgeId
  knights?: Record<string, KnightPiece>; // key is vertexId (Cities & Knights)
  harbors: Record<string, Harbor>;
  robberHexId: string;
  pirateHexId?: string;
}

export interface GameAwardEvent {
  id: string;
  timestamp: number;
  awardType:
    | 'longest_route'
    | 'largest_army'
    | 'harbor_master'
    | 'metropolis'
    | 'defender_of_catan'
    | 'barbarian_attack';
  playerId: string;
  playerName: string;
  playerColor: PlayerColor;
  metricValue: number; // road length, knights count, harbor points, or level
  subtitle?: string;
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

export interface PendingDisplacedKnight {
  playerId: string;
  knightId: string;
  fromVertexId: string;
  level: 1 | 2 | 3;
  active: boolean;
  recruitedTurn: number;
  activatedTurn: number | null;
  promotedTurn: number | null;
  actionTakenTurn: number | null;
  validVertexIds: string[];
}

export interface PendingDeserter {
  requesterId: string;
  targetPlayerId: string;
  stage: 'choose_victim_knight' | 'place_new_knight';
  removedLevel?: 1 | 2 | 3;
  removedActive?: boolean;
}

export interface PendingCardInspection {
  playerId: string;
  targetPlayerId: string;
}

export interface PendingCommercialHarborOffer {
  fromPlayerId: string;
  targetPlayerId: string;
  offeredResource: ResourceType;
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
  lastSetupVertexId: string | null; // Tracks the settlement/city just placed in setup so road attaches to it
  diceRoll: [number, number] | null;
  eventDie?: EventDieFace | null; // Cities & Knights Event Die ('barbarian' | 'trade' | 'politics' | 'science')
  redDie?: number | null; // Cities & Knights Red Die (1..6, equals diceRoll[1])
  balancedDiceDeck: Array<[number, number]>; // Private deck of 36 ordered dice pairs when balancedDice is enabled
  diceHistory: Record<number, number>; // Counts of each sum (2..12) rolled during the match
  lastDiceRollAt: number | null; // Timestamp of last roll to trigger client dice animation
  diceRolledThisTurn: boolean;
  devCardPlayedThisTurn: boolean;
  freeRoadsRemaining: number; // From Road Building dev/progress card or Diplomacy
  turnDeadlineMs: number | null; // Unix timestamp (ms) when current sub-turn expires
  phaseDurationMs: number; // Total duration (ms) of current sub-turn for progress bar
  savedActionRemainingMs: number | null; // Paused normal turn time while resolving Robber or Road Building dev card
  robberControllerPlayerId: string | null; // Tracks who is currently controlling the robber (Player 1 or Paired Player 2)
  latestAwardEvent: GameAwardEvent | null; // Triggers client celebration banner on Longest Road / Largest Army / Metropolis / Defender
  board: BoardState;
  players: Record<string, PlayerPrivateState>;
  devCardDeck: DevCard[];
  resourceBank: ResourceCount;
  commodityBank?: CommodityCount; // Cities & Knights commodity bank
  activeTradeOffer: TradeOffer | null;
  pendingDiscards: Record<string, number>; // playerId -> count needed to discard
  postDiscardPhase?: GamePhase | null; // Used when Sabotage triggers a discard during ACTION_PHASE
  pendingStealTargets: string[]; // playerIds that can be stolen from
  longestRouteOwnerId: string | null;
  largestArmyOwnerId: string | null;
  harborMasterOwnerId?: string | null;
  winnerId: string | null;
  actionLog: GameLogEntry[];

  // Cities & Knights Expansion state
  barbarianPosition?: number; // 0..7 (attack happens at 7, then resets to 0)
  barbariansAttackedCount?: number; // Number of completed barbarian attacks
  robberActive?: boolean; // False in C&K until first Barbarian Attack completes
  metropolises?: MetropolisesState;
  merchant?: MerchantState;
  progressDecks?: Record<ProgressCardDiscipline, ProgressCard[]>;
  pendingAlchemyRoll?: [number, number] | null;
  craneDiscountsRemaining?: number;
  medicineDiscountsRemaining?: number;
  freeKnightPromotionsRemaining?: number;
  merchantFleetTypes?: TradeableCardType[];
  pendingAqueductPlayerIds?: string[];
  pendingBarbarianRewardPlayerIds?: string[];
  pendingBarbarianPillagePlayerIds?: string[];
  pendingProgressDiscardPlayerIds?: string[]; // Players holding >4 progress cards who must discard down to 4
  pendingDisplacedKnight?: PendingDisplacedKnight | null;
  pendingDeserter?: PendingDeserter | null;
  pendingGuildDues?: PendingCardInspection | null;
  pendingEspionage?: PendingCardInspection | null;
  pendingWeddingPlayerIds?: string[];
  weddingRequesterId?: string | null;
  pendingCommercialHarbor?: PendingCommercialHarborOffer[];
}

export interface GameLogEntry {
  id: string;
  timestamp: number;
  playerId?: string;
  message: string;
  category: 'dice' | 'trade' | 'build' | 'card' | 'robber' | 'system';
}

// Client redacted state (strips all opponent private cards, devCardDeck, progressDecks, balancedDiceDeck, and hides bank when hiddenBank is true)
export interface RedactedGameState
  extends Omit<
    GameState,
    'players' | 'devCardDeck' | 'progressDecks' | 'balancedDiceDeck' | 'resourceBank' | 'commodityBank'
  > {
  players: Record<string, PlayerPublicState>;
  self?: PlayerPrivateState;
  devCardDeckCount: number;
  progressDeckCounts?: Record<ProgressCardDiscipline, number>;
  resourceBank: ResourceCount | null;
  commodityBank?: CommodityCount | null;
  // Scoped inspection data revealed ONLY to the active player resolving Guild Dues or Espionage
  inspectedTargetHand?: {
    targetPlayerId: string;
    resources?: ResourceCount;
    commodities?: CommodityCount;
    progressCards?: ProgressCard[];
  } | null;
}
