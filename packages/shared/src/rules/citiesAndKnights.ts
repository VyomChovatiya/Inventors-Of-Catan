import {
  BoardState,
  CommodityCount,
  CommodityType,
  EventDieFace,
  GameState,
  MetropolisesState,
  PlayerPrivateState,
  ProgressCard,
  ProgressCardDiscipline,
  ProgressCardType,
  ResourceType,
  TerrainType,
} from '../types/index.js';
import { cryptoRandomInt, shuffle } from '../board/generator.js';

export const INITIAL_COMMODITY_BANK: CommodityCount = {
  cloth: 12,
  coin: 12,
  paper: 12,
};

export const INITIAL_COMMODITY_BANK_5_6: CommodityCount = {
  cloth: 18,
  coin: 18,
  paper: 18,
};

export const TERRAIN_TO_COMMODITY: Partial<Record<TerrainType, CommodityType>> = {
  forest: 'paper',
  pasture: 'cloth',
  mountains: 'coin',
};

export const CITY_IMPROVEMENT_NAMES: Record<ProgressCardDiscipline, [string, string, string, string, string]> = {
  trade: ['Market', 'Trading House', 'Merchant Guild', 'Bank', 'Great Exchange'],
  politics: ['Town Hall', 'Church', 'Fortress', 'Cathedral', 'Great Hall'],
  science: ['Abbey', 'Library', 'Aqueduct', 'Theater', 'University'],
};

export const PROGRESS_CARD_METADATA: Record<
  ProgressCardType,
  {
    name: string;
    discipline: ProgressCardDiscipline;
    count: number;
    description: string;
    isVictoryPoint?: boolean;
  }
> = {
  // Science (18)
  alchemy: {
    name: 'Alchemist',
    discipline: 'science',
    count: 2,
    description: 'Play before rolling the dice: choose the exact numbers on both the White and Red dice.',
  },
  crane: {
    name: 'Crane',
    discipline: 'science',
    count: 2,
    description: 'Your next City Improvement upgrade this turn costs 1 fewer commodity.',
  },
  engineering: {
    name: 'Engineer',
    discipline: 'science',
    count: 1,
    description: 'Build 1 City Wall under one of your Cities for free.',
  },
  invention: {
    name: 'Inventor',
    discipline: 'science',
    count: 2,
    description: 'Swap any two number tokens on the board (except 2, 6, 8, and 12).',
  },
  irrigation: {
    name: 'Irrigation',
    discipline: 'science',
    count: 2,
    description: 'Collect 2 Wheat for each Fields hex adjacent to at least one of your buildings.',
  },
  medicine: {
    name: 'Medicine',
    discipline: 'science',
    count: 2,
    description: 'Your next City upgrade this turn costs 1 Wheat and 2 Ore (instead of 2 Wheat and 3 Ore).',
  },
  mining: {
    name: 'Mining',
    discipline: 'science',
    count: 2,
    description: 'Collect 2 Ore for each Mountains hex adjacent to at least one of your buildings.',
  },
  road_building: {
    name: 'Road Building',
    discipline: 'science',
    count: 2,
    description: 'Build up to 2 Roads for free.',
  },
  smithing: {
    name: 'Smith',
    discipline: 'science',
    count: 2,
    description: 'Promote up to 2 of your Knights on the board 1 level each for free.',
  },
  printing: {
    name: 'Printer',
    discipline: 'science',
    count: 1,
    description: '+1 Victory Point! Revealed immediately upon draw.',
    isVictoryPoint: true,
  },

  // Trade (18)
  commercial_harbor: {
    name: 'Commercial Harbor',
    discipline: 'trade',
    count: 2,
    description: 'Offer each opponent 1 Resource card; if they hold any Commodities, they must give you 1 Commodity in exchange.',
  },
  guild_dues: {
    name: 'Master Merchant',
    discipline: 'trade',
    count: 2,
    description: 'Choose an opponent with more Victory Points than you, inspect their hand, and take up to 2 Resource/Commodity cards of your choice.',
  },
  merchant: {
    name: 'Merchant',
    discipline: 'trade',
    count: 6,
    description: 'Place the Merchant on a land hex adjacent to one of your buildings. Grants +1 VP and 2:1 bank trade on that resource.',
  },
  merchant_fleet: {
    name: 'Merchant Fleet',
    discipline: 'trade',
    count: 2,
    description: 'Choose 1 Resource or Commodity type to trade at 2:1 with the bank for the rest of this turn.',
  },
  resource_monopoly: {
    name: 'Resource Monopoly',
    discipline: 'trade',
    count: 4,
    description: 'Name 1 Resource type; each opponent must give you up to 2 cards of that Resource.',
  },
  trade_monopoly: {
    name: 'Trade Monopoly',
    discipline: 'trade',
    count: 2,
    description: 'Name 1 Commodity type; each opponent must give you 1 card of that Commodity if they have it.',
  },

  // Politics (18)
  diplomacy: {
    name: 'Diplomat',
    discipline: 'politics',
    count: 2,
    description: 'Remove any open road from the board. If you remove your own open road, you may place 1 free road.',
  },
  encouragement: {
    name: 'Warlord',
    discipline: 'politics',
    count: 2,
    description: 'Activate all of your Knights currently on the board for free.',
  },
  espionage: {
    name: 'Spy',
    discipline: 'politics',
    count: 3,
    description: "Inspect an opponent's Progress Cards and steal 1 Progress Card of your choice.",
  },
  intrigue: {
    name: 'Intrigue',
    discipline: 'politics',
    count: 2,
    description: "Displace an opponent's Knight on a vertex connected to one of your roads.",
  },
  sabotage: {
    name: 'Saboteur',
    discipline: 'politics',
    count: 2,
    description: 'Every opponent with equal or more Victory Points than you must discard half of their Resource and Commodity cards.',
  },
  taxation: {
    name: 'Bishop',
    discipline: 'politics',
    count: 2,
    description: 'Move the Robber and steal 1 random Resource/Commodity card from each opponent with a building adjacent to that hex.',
  },
  treason: {
    name: 'Deserter',
    discipline: 'politics',
    count: 2,
    description: 'Choose an opponent to remove 1 of their Knights; you may then place 1 of your available Knights of equal or lower level on the board.',
  },
  constitution: {
    name: 'Constitution',
    discipline: 'politics',
    count: 1,
    description: '+1 Victory Point! Revealed immediately upon draw.',
    isVictoryPoint: true,
  },
  wedding: {
    name: 'Wedding',
    discipline: 'politics',
    count: 2,
    description: 'Each opponent with more Victory Points than you must give you 2 Resource/Commodity cards of their choice.',
  },
};

export function createProgressDecks(): Record<ProgressCardDiscipline, ProgressCard[]> {
  const decks: Record<ProgressCardDiscipline, ProgressCard[]> = {
    trade: [],
    politics: [],
    science: [],
  };
  let seq = 1;
  for (const [typeKey, meta] of Object.entries(PROGRESS_CARD_METADATA) as Array<
    [ProgressCardType, (typeof PROGRESS_CARD_METADATA)[ProgressCardType]]
  >) {
    for (let i = 0; i < meta.count; i++) {
      decks[meta.discipline].push({
        id: `pc_${meta.discipline}_${seq++}`,
        discipline: meta.discipline,
        type: typeKey,
        isVictoryPoint: Boolean(meta.isVictoryPoint),
      });
    }
  }
  return {
    trade: shuffle(decks.trade),
    politics: shuffle(decks.politics),
    science: shuffle(decks.science),
  };
}

export function createInitialMetropolises(): MetropolisesState {
  return {
    trade: { ownerId: null, vertexId: null, level: 0 },
    politics: { ownerId: null, vertexId: null, level: 0 },
    science: { ownerId: null, vertexId: null, level: 0 },
  };
}

/**
 * Rolls the 6-sided Event Die:
 * - 3 faces (0, 1, 2): 'barbarian'
 * - 1 face  (3):       'trade'
 * - 1 face  (4):       'politics'
 * - 1 face  (5):       'science'
 */
export function rollEventDie(rng?: () => number): EventDieFace {
  const face = cryptoRandomInt(6, rng);
  if (face < 3) return 'barbarian';
  if (face === 3) return 'trade';
  if (face === 4) return 'politics';
  return 'science';
}

export function countPlayerCityWalls(board: BoardState, playerId: string): number {
  let walls = 0;
  for (const b of Object.values(board.buildings)) {
    if (b.playerId === playerId && b.type === 'city' && b.hasWall) {
      walls++;
    }
  }
  return walls;
}

export function getPlayerDiscardLimit(state: GameState, playerId: string): number {
  const baseLimit = state.settings.cardDiscardLimit || 7;
  if (state.settings.expansion !== 'cities_and_knights') {
    return baseLimit;
  }
  return baseLimit + 2 * countPlayerCityWalls(state.board, playerId);
}

export function drawProgressCardForPlayer(
  state: GameState,
  player: PlayerPrivateState,
  discipline: ProgressCardDiscipline,
): ProgressCard | null {
  if (!state.progressDecks) {
    state.progressDecks = createProgressDecks();
  }
  const deck = state.progressDecks[discipline];
  if (!deck || deck.length === 0) {
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: player.id,
      message: `${player.name} could not draw a ${discipline} Progress Card (deck is empty).`,
      category: 'card',
    });
    return null;
  }

  const card = deck.shift()!;
  const meta = PROGRESS_CARD_METADATA[card.type];

  if (card.isVictoryPoint || card.type === 'printing' || card.type === 'constitution') {
    player.playedProgressCards.push(card);
    player.progressVictoryPoints = (player.progressVictoryPoints || 0) + 1;
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      playerId: player.id,
      message: `📜 ${player.name} drew ${meta.name} (${discipline}) and immediately revealed it for +1 Victory Point!`,
      category: 'card',
    });
    return card;
  }

  player.progressCards.push(card);
  player.progressCardCount = player.progressCards.length;

  state.actionLog.push({
    id: `log_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    playerId: player.id,
    message: `📜 ${player.name} drew a ${discipline.charAt(0).toUpperCase() + discipline.slice(1)} Progress Card.`,
    category: 'card',
  });

  // Hand limit is 4 unplayed Progress Cards.
  // Any player holding >4 cards is flagged so they can discard down to 4 immediately (or play/discard during their turn).
  if (player.progressCards.length > 4) {
    if (!state.pendingProgressDiscardPlayerIds) state.pendingProgressDiscardPlayerIds = [];
    if (!state.pendingProgressDiscardPlayerIds.includes(player.id)) {
      state.pendingProgressDiscardPlayerIds.push(player.id);
    }
  }

  return card;
}

export function pillageCityAtVertex(state: GameState, playerId: string, vertexId: string): boolean {
  const b = state.board.buildings[vertexId];
  const player = state.players[playerId];
  if (!b || !player || b.playerId !== playerId || b.type !== 'city' || b.metropolis) {
    return false;
  }

  const hadWall = Boolean(b.hasWall);
  b.type = 'settlement';
  delete b.hasWall;

  player.citiesLeft = Math.min(4, player.citiesLeft + 1);
  if (player.settlementsLeft > 0) {
    player.settlementsLeft--;
  }
  if (hadWall) {
    player.cityWallsLeft = Math.min(3, (player.cityWallsLeft || 0) + 1);
  }

  state.actionLog.push({
    id: `log_${Date.now()}_${Math.random()}`,
    timestamp: Date.now(),
    playerId,
    message: `🔥 Barbarians pillaged ${player.name}'s City${hadWall ? ' (and destroyed its City Wall)' : ''}, reducing it to a Settlement!`,
    category: 'robber',
  });
  return true;
}

export function getPlayerVulnerableCityVertices(
  stateOrBoard: { board: BoardState } | BoardState,
  playerId: string,
): string[] {
  const board = 'board' in stateOrBoard ? stateOrBoard.board : stateOrBoard;
  return Object.values(board.buildings)
    .filter((b) => b.playerId === playerId && b.type === 'city' && !b.metropolis)
    .map((b) => b.vertexId);
}

export function getBarbarianStrength(board: BoardState): number {
  return Object.values(board.buildings).filter((b) => b.type === 'city').length;
}

export function getPlayerActiveKnightStrength(board: BoardState, playerId: string): number {
  if (!board.knights) return 0;
  let total = 0;
  for (const k of Object.values(board.knights)) {
    if (k.playerId === playerId && k.active) {
      total += k.level;
    }
  }
  return total;
}

export function getTotalActiveKnightStrength(board: BoardState): number {
  if (!board.knights) return 0;
  let total = 0;
  for (const k of Object.values(board.knights)) {
    if (k.active) {
      total += k.level;
    }
  }
  return total;
}

export function resolveBarbarianAttack(state: GameState, orderedPlayerIds: string[]) {
  state.barbariansAttackedCount = (state.barbariansAttackedCount || 0) + 1;

  // After the first barbarian attack, the Robber becomes active on the board
  if (!state.robberActive) {
    state.robberActive = true;
    const robberHex = state.board.hexes[state.board.robberHexId];
    if (robberHex) {
      robberHex.hasRobber = true;
    }
  }

  const barbarianStrength = getBarbarianStrength(state.board);
  const contribByPlayer: Record<string, number> = {};
  let defendersStrength = 0;

  for (const pid of orderedPlayerIds) {
    const strength = getPlayerActiveKnightStrength(state.board, pid);
    contribByPlayer[pid] = strength;
    defendersStrength += strength;
  }

  if (barbarianStrength === 0) {
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      message: `⚔️ The Barbarian fleet arrived at Catan, but there are 0 Cities on the island! The Barbarians depart.`,
      category: 'robber',
    });
  } else if (defendersStrength >= barbarianStrength) {
    // Defenders win!
    let maxContrib = 0;
    for (const pid of orderedPlayerIds) {
      if (contribByPlayer[pid] > maxContrib) {
        maxContrib = contribByPlayer[pid];
      }
    }

    const topContributors = orderedPlayerIds.filter((pid) => contribByPlayer[pid] === maxContrib && maxContrib > 0);

    if (topContributors.length === 1) {
      const heroId = topContributors[0];
      const hero = state.players[heroId];
      if (hero) {
        hero.defenderPoints = (hero.defenderPoints || 0) + 1;
        state.latestAwardEvent = {
          id: `award_def_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          awardType: 'defender_of_catan',
          playerId: hero.id,
          playerName: hero.name,
          playerColor: hero.color,
          metricValue: hero.defenderPoints,
          subtitle: `Defended Catan (${defendersStrength} vs ${barbarianStrength} Barbarians)`,
        };
        state.actionLog.push({
          id: `log_${Date.now()}_${Math.random()}`,
          timestamp: Date.now(),
          playerId: hero.id,
          message: `🛡️ Catan is saved (${defendersStrength} Knights vs ${barbarianStrength} Barbarians)! ${hero.name} contributed ${maxContrib} strength and earned +1 Defender of Catan VP!`,
          category: 'system',
        });
      }
    } else if (topContributors.length > 1) {
      // Turn order starting from currentTurnPlayerId
      const startIdx = Math.max(0, orderedPlayerIds.indexOf(state.currentTurnPlayerId));
      const rotatedOrder = [
        ...orderedPlayerIds.slice(startIdx),
        ...orderedPlayerIds.slice(0, startIdx),
      ];
      const tiedInTurnOrder = rotatedOrder.filter((pid) => topContributors.includes(pid));
      state.pendingBarbarianRewardPlayerIds = [
        ...(state.pendingBarbarianRewardPlayerIds || []),
        ...tiedInTurnOrder,
      ];
      const names = tiedInTurnOrder.map((pid) => state.players[pid]?.name).join(', ');
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        message: `🛡️ Catan is saved (${defendersStrength} Knights vs ${barbarianStrength} Barbarians)! ${names} tied for highest defense (${maxContrib}) and each choose 1 Progress Card!`,
        category: 'system',
      });
    }
  } else {
    // Barbarians win!
    const vulnerablePlayers = orderedPlayerIds.filter(
      (pid) => getPlayerVulnerableCityVertices(state, pid).length > 0,
    );

    if (vulnerablePlayers.length === 0) {
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        message: `⚔️ Barbarians overwhelmed Catan (${barbarianStrength} vs ${defendersStrength} Knights), but all Cities are protected by Metropolises!`,
        category: 'robber',
      });
    } else {
      let minContrib = Infinity;
      for (const pid of vulnerablePlayers) {
        if (contribByPlayer[pid] < minContrib) {
          minContrib = contribByPlayer[pid];
        }
      }
      const lowestVulnerable = vulnerablePlayers.filter((pid) => contribByPlayer[pid] === minContrib);
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        message: `🔥 Barbarians defeated Catan's defenders (${barbarianStrength} Barbarians vs ${defendersStrength} Knights)!`,
        category: 'robber',
      });

      for (const pid of lowestVulnerable) {
        const cityVertices = getPlayerVulnerableCityVertices(state, pid);
        if (cityVertices.length === 1) {
          pillageCityAtVertex(state, pid, cityVertices[0]);
        } else if (cityVertices.length > 1) {
          if (!state.pendingBarbarianPillagePlayerIds) state.pendingBarbarianPillagePlayerIds = [];
          if (!state.pendingBarbarianPillagePlayerIds.includes(pid)) {
            state.pendingBarbarianPillagePlayerIds.push(pid);
          }
        }
      }
    }
  }

  // Reset barbarian ship to 0 and deactivate all knights on the board
  state.barbarianPosition = 0;
  if (state.board.knights) {
    for (const k of Object.values(state.board.knights)) {
      k.active = false;
    }
  }
}

export function resolveEventDie(
  state: GameState,
  eventDie: EventDieFace,
  redDie: number,
  orderedPlayerIds: string[],
) {
  if (eventDie === 'barbarian') {
    state.barbarianPosition = (state.barbarianPosition || 0) + 1;
    state.actionLog.push({
      id: `log_${Date.now()}_${Math.random()}`,
      timestamp: Date.now(),
      message: `⛵ Barbarian Ship advanced to ${state.barbarianPosition}/7.`,
      category: 'dice',
    });

    if (state.barbarianPosition >= 7) {
      resolveBarbarianAttack(state, orderedPlayerIds);
    }
    return;
  }

  // City Gate ('trade' | 'politics' | 'science'): check each player's City Improvement level in turn order
  const startIdx = Math.max(0, orderedPlayerIds.indexOf(state.currentTurnPlayerId));
  const rotatedOrder = [
    ...orderedPlayerIds.slice(startIdx),
    ...orderedPlayerIds.slice(0, startIdx),
  ];

  for (const pid of rotatedOrder) {
    const p = state.players[pid];
    if (!p || !p.cityImprovements) continue;
    const level = p.cityImprovements[eventDie] || 0;
    // Level 1 covers Red Die 1..2, Level 2 covers 1..3, Level 3 covers 1..4, Level 4 covers 1..5, Level 5 covers 1..6
    if (level > 0 && redDie <= level + 1) {
      drawProgressCardForPlayer(state, p, eventDie);
    }
  }
}

export function resolveCKProduction(
  state: GameState,
  sum: number,
  orderedPlayerIds: string[],
) {
  if (!state.commodityBank) {
    state.commodityBank = { ...INITIAL_COMMODITY_BANK };
  }

  const owedByResource: Record<ResourceType, Record<string, number>> = {
    wood: {},
    brick: {},
    wheat: {},
    sheep: {},
    ore: {},
  };

  const owedByCommodity: Record<CommodityType, Record<string, number>> = {
    cloth: {},
    coin: {},
    paper: {},
  };

  const isCombined2And12 = Boolean(state.settings?.houseRules?.combined2And12);
  const matchesRoll = (hexNum?: number) =>
    hexNum === sum || (isCombined2And12 && (sum === 2 || sum === 12) && (hexNum === 2 || hexNum === 12));

  for (const hex of Object.values(state.board.hexes)) {
    const isBlockedByRobber = Boolean(state.robberActive && hex.hasRobber);
    if (matchesRoll(hex.number) && !isBlockedByRobber && hex.resource) {
      const commodityType = TERRAIN_TO_COMMODITY[hex.terrain];
      for (const vertex of Object.values(state.board.vertices)) {
        if (vertex.hexCoords.includes(hex.id)) {
          const b = state.board.buildings[vertex.id];
          if (!b) continue;
          if (b.type === 'settlement') {
            owedByResource[hex.resource][b.playerId] =
              (owedByResource[hex.resource][b.playerId] || 0) + 1;
          } else if (b.type === 'city') {
            if (commodityType) {
              // Forest -> 1 Wood + 1 Paper; Pasture -> 1 Sheep + 1 Cloth; Mountains -> 1 Ore + 1 Coin
              owedByResource[hex.resource][b.playerId] =
                (owedByResource[hex.resource][b.playerId] || 0) + 1;
              owedByCommodity[commodityType][b.playerId] =
                (owedByCommodity[commodityType][b.playerId] || 0) + 1;
            } else {
              // Hills (Brick) and Fields (Wheat) -> 2 Resources
              owedByResource[hex.resource][b.playerId] =
                (owedByResource[hex.resource][b.playerId] || 0) + 2;
            }
          }
        }
      }
    }
  }

  const receivedByPlayer: Record<string, string[]> = {};
  const totalCardsReceivedByPlayer: Record<string, number> = {};

  for (const [res, playerAmounts] of Object.entries(owedByResource) as Array<
    [ResourceType, Record<string, number>]
  >) {
    const entries = Object.entries(playerAmounts);
    if (entries.length === 0) continue;
    const totalNeeded = entries.reduce((s, [_, amt]) => s + amt, 0);
    const available = state.resourceBank[res] || 0;

    if (available >= totalNeeded) {
      for (const [pid, amt] of entries) {
        state.players[pid].resources[res] += amt;
        state.resourceBank[res] -= amt;
        if (!receivedByPlayer[pid]) receivedByPlayer[pid] = [];
        receivedByPlayer[pid].push(`${amt} ${res}`);
        totalCardsReceivedByPlayer[pid] = (totalCardsReceivedByPlayer[pid] || 0) + amt;
      }
    } else if (entries.length === 1 && available > 0) {
      const [pid] = entries[0];
      state.players[pid].resources[res] += available;
      state.resourceBank[res] = 0;
      if (!receivedByPlayer[pid]) receivedByPlayer[pid] = [];
      receivedByPlayer[pid].push(`${available} ${res}`);
      totalCardsReceivedByPlayer[pid] = (totalCardsReceivedByPlayer[pid] || 0) + available;
    } else {
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        message: `Bank shortage of ${res}! Nobody received ${res} this roll.`,
        category: 'dice',
      });
    }
  }

  for (const [comm, playerAmounts] of Object.entries(owedByCommodity) as Array<
    [CommodityType, Record<string, number>]
  >) {
    const entries = Object.entries(playerAmounts);
    if (entries.length === 0) continue;
    const totalNeeded = entries.reduce((s, [_, amt]) => s + amt, 0);
    const available = state.commodityBank[comm] || 0;

    if (available >= totalNeeded) {
      for (const [pid, amt] of entries) {
        state.players[pid].commodities[comm] = (state.players[pid].commodities[comm] || 0) + amt;
        state.commodityBank[comm] -= amt;
        if (!receivedByPlayer[pid]) receivedByPlayer[pid] = [];
        receivedByPlayer[pid].push(`${amt} ${comm}`);
        totalCardsReceivedByPlayer[pid] = (totalCardsReceivedByPlayer[pid] || 0) + amt;
      }
    } else if (entries.length === 1 && available > 0) {
      const [pid] = entries[0];
      state.players[pid].commodities[comm] = (state.players[pid].commodities[comm] || 0) + available;
      state.commodityBank[comm] = 0;
      if (!receivedByPlayer[pid]) receivedByPlayer[pid] = [];
      receivedByPlayer[pid].push(`${available} ${comm}`);
      totalCardsReceivedByPlayer[pid] = (totalCardsReceivedByPlayer[pid] || 0) + available;
    } else {
      state.actionLog.push({
        id: `log_${Date.now()}_${Math.random()}`,
        timestamp: Date.now(),
        message: `Bank shortage of ${comm}! Nobody received ${comm} this roll.`,
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
      message: `No resources or commodities produced on roll ${sum}.`,
      category: 'dice',
    });
  }

  // Science Level 3 (Aqueduct): Any player with Science >= 3 who received 0 total cards on a non-7 roll
  // may choose 1 resource of their choice from the bank!
  const anyBankResourceAvailable = Object.values(state.resourceBank).some((n) => n > 0);
  if (anyBankResourceAvailable) {
    const startIdx = Math.max(0, orderedPlayerIds.indexOf(state.currentTurnPlayerId));
    const rotatedOrder = [
      ...orderedPlayerIds.slice(startIdx),
      ...orderedPlayerIds.slice(0, startIdx),
    ];
    for (const pid of rotatedOrder) {
      const p = state.players[pid];
      if (!p) continue;
      if ((p.cityImprovements?.science || 0) >= 3 && (totalCardsReceivedByPlayer[pid] || 0) === 0) {
        if (!state.pendingAqueductPlayerIds) state.pendingAqueductPlayerIds = [];
        if (!state.pendingAqueductPlayerIds.includes(pid)) {
          state.pendingAqueductPlayerIds.push(pid);
          state.actionLog.push({
            id: `log_${Date.now()}_${Math.random()}`,
            timestamp: Date.now(),
            playerId: pid,
            message: `🏛️ Aqueduct: ${p.name} received no production and may take 1 free Resource of their choice!`,
            category: 'dice',
          });
        }
      }
    }
  }
}

export function isValidKnightRecruitVertex(
  stateOrBoard: { board: BoardState } | BoardState,
  playerId: string,
  vertexId: string,
): boolean {
  const board = 'board' in stateOrBoard ? stateOrBoard.board : stateOrBoard;
  if (!board.vertices[vertexId]) return false;
  if (board.buildings[vertexId]) return false;
  if (board.knights?.[vertexId]) return false;

  // Must connect to at least one road owned by playerId
  return Object.values(board.roads).some(
    (r) =>
      r.playerId === playerId &&
      (board.edges[r.edgeId]?.v1 === vertexId || board.edges[r.edgeId]?.v2 === vertexId),
  );
}

/**
 * Finds all vertices reachable from `startVertexId` along `playerId`'s continuous roads
 * without passing through any vertex occupied by an opponent's building or opponent's knight.
 */
export function getReachableKnightVertices(
  board: BoardState,
  playerId: string,
  startVertexId: string,
  knightLevel: 1 | 2 | 3,
): {
  emptyVertices: string[];
  displaceableKnightVertices: string[];
} {
  const visited = new Set<string>([startVertexId]);
  const queue: string[] = [startVertexId];
  const emptyVertices: string[] = [];
  const displaceableKnightVertices: string[] = [];

  while (queue.length > 0) {
    const curr = queue.shift()!;

    // If curr is not startVertexId and is occupied by an opponent building or opponent knight,
    // we cannot continue traversing past `curr`!
    if (curr !== startVertexId) {
      const b = board.buildings[curr];
      const k = board.knights?.[curr];

      if (b && b.playerId !== playerId) {
        continue;
      }
      if (k && k.playerId !== playerId) {
        if (knightLevel > k.level) {
          displaceableKnightVertices.push(curr);
        }
        continue;
      }

      if (!b && !k) {
        emptyVertices.push(curr);
      }
    }

    // Traverse along playerId's roads incident to `curr`
    for (const road of Object.values(board.roads)) {
      if (road.playerId !== playerId) continue;
      const edge = board.edges[road.edgeId];
      if (!edge) continue;
      let nextV: string | null = null;
      if (edge.v1 === curr) nextV = edge.v2;
      else if (edge.v2 === curr) nextV = edge.v1;

      if (nextV && !visited.has(nextV)) {
        visited.add(nextV);
        queue.push(nextV);
      }
    }
  }

  return { emptyVertices, displaceableKnightVertices };
}

/**
 * Checks if a road on `edgeId` is "open" (for the Diplomacy progress card).
 * A road is open if at least one of its two endpoint vertices has:
 * - No building of any player
 * - No knight of any player
 * - No other road belonging to the same player (`road.playerId`)
 */
export function isOpenRoadEdge(board: BoardState, edgeId: string): boolean {
  const road = board.roads[edgeId];
  const edge = board.edges[edgeId];
  if (!road || !edge) return false;

  const isEndpointFree = (vId: string): boolean => {
    if (board.buildings[vId]) return false;
    if (board.knights?.[vId]) return false;
    const otherSameOwnerRoad = Object.values(board.roads).some(
      (r) =>
        r.edgeId !== edgeId &&
        r.playerId === road.playerId &&
        (board.edges[r.edgeId]?.v1 === vId || board.edges[r.edgeId]?.v2 === vId),
    );
    return !otherSameOwnerRoad;
  };

  return isEndpointFree(edge.v1) || isEndpointFree(edge.v2);
}
