import {
  CommodityCount,
  CommodityType,
  ProgressCardDiscipline,
  ResourceCount,
  ResourceType,
  TradeableCardType,
  TradePayload,
} from '../types/index.js';

export const VALID_RESOURCES: readonly ResourceType[] = [
  'wood',
  'brick',
  'wheat',
  'sheep',
  'ore',
];

export const VALID_COMMODITIES: readonly CommodityType[] = [
  'cloth',
  'coin',
  'paper',
];

export const VALID_TRADEABLES: readonly TradeableCardType[] = [
  'wood',
  'brick',
  'wheat',
  'sheep',
  'ore',
  'cloth',
  'coin',
  'paper',
];

export const VALID_DISCIPLINES: readonly ProgressCardDiscipline[] = [
  'trade',
  'politics',
  'science',
];

export const DISCIPLINE_COMMODITY: Record<ProgressCardDiscipline, CommodityType> = {
  trade: 'cloth',
  politics: 'coin',
  science: 'paper',
};

export const BUILDING_COSTS: Record<
  'road' | 'settlement' | 'city' | 'cityMedicine' | 'devCard' | 'cityWall' | 'knight' | 'activateKnight',
  Partial<ResourceCount>
> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { wheat: 2, ore: 3 },
  cityMedicine: { wheat: 1, ore: 2 },
  devCard: { wheat: 1, sheep: 1, ore: 1 },
  cityWall: { brick: 2 },
  knight: { sheep: 1, ore: 1 },
  activateKnight: { wheat: 1 },
};

export const MAX_PIECES = {
  roads: 15,
  settlements: 5,
  cities: 4,
  cityWalls: 3,
  basicKnights: 2,
  strongKnights: 2,
  mightyKnights: 2,
};

export function isValidResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && (VALID_RESOURCES as readonly string[]).includes(value);
}

export function isValidCommodityType(value: unknown): value is CommodityType {
  return typeof value === 'string' && (VALID_COMMODITIES as readonly string[]).includes(value);
}

export function isValidTradeableType(value: unknown): value is TradeableCardType {
  return typeof value === 'string' && (VALID_TRADEABLES as readonly string[]).includes(value);
}

export function isValidDiscipline(value: unknown): value is ProgressCardDiscipline {
  return typeof value === 'string' && (VALID_DISCIPLINES as readonly string[]).includes(value);
}

/**
 * Validates that a resource payload is a plain object containing only known resource keys
 * and finite, non-negative integer values.
 */
export function isValidResourcePayload(payload: unknown): payload is Partial<ResourceCount> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const proto = Object.getPrototypeOf(payload);
  if (proto !== null && proto !== Object.prototype) {
    return false;
  }

  for (const [key, val] of Object.entries(payload)) {
    if (!isValidResourceType(key)) {
      return false;
    }
    if (val === undefined) continue;
    if (typeof val !== 'number' || !Number.isFinite(val) || !Number.isInteger(val) || val < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Validates a trade/discard payload that may contain resources and (when allowCommodities is true) commodities.
 */
export function isValidTradePayload(
  payload: unknown,
  allowCommodities = true,
): payload is TradePayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return false;
  }
  const proto = Object.getPrototypeOf(payload);
  if (proto !== null && proto !== Object.prototype) {
    return false;
  }

  for (const [key, val] of Object.entries(payload)) {
    const validKey = allowCommodities ? isValidTradeableType(key) : isValidResourceType(key);
    if (!validKey) {
      return false;
    }
    if (val === undefined) continue;
    if (typeof val !== 'number' || !Number.isFinite(val) || !Number.isInteger(val) || val < 0) {
      return false;
    }
  }
  return true;
}

export function sumResources(payload: Partial<ResourceCount>): number {
  if (!isValidResourcePayload(payload)) return -1;
  let total = 0;
  for (const r of VALID_RESOURCES) {
    total += payload[r] || 0;
  }
  return total;
}

export function sumCommodities(payload?: Partial<CommodityCount> | null): number {
  if (!payload || typeof payload !== 'object') return 0;
  let total = 0;
  for (const c of VALID_COMMODITIES) {
    total += payload[c] || 0;
  }
  return total;
}

export function sumTradePayload(payload: TradePayload, allowCommodities = true): number {
  if (!isValidTradePayload(payload, allowCommodities)) return -1;
  let total = 0;
  for (const k of allowCommodities ? VALID_TRADEABLES : VALID_RESOURCES) {
    total += payload[k] || 0;
  }
  return total;
}

export function canAfford(playerResources: ResourceCount, cost: Partial<ResourceCount>): boolean {
  if (!isValidResourcePayload(cost)) return false;
  for (const r of VALID_RESOURCES) {
    const amt = cost[r] || 0;
    if (amt < 0) return false;
    if ((playerResources[r] || 0) < amt) {
      return false;
    }
  }
  return true;
}

export function canAffordTradePayload(
  playerResources: ResourceCount,
  playerCommodities: CommodityCount | undefined,
  cost: TradePayload,
  allowCommodities = true,
): boolean {
  if (!isValidTradePayload(cost, allowCommodities)) return false;
  for (const r of VALID_RESOURCES) {
    const amt = cost[r] || 0;
    if (amt < 0) return false;
    if ((playerResources[r] || 0) < amt) return false;
  }
  for (const c of VALID_COMMODITIES) {
    const amt = cost[c] || 0;
    if (amt < 0) return false;
    if (!allowCommodities && amt > 0) return false;
    if (((playerCommodities && playerCommodities[c]) || 0) < amt) return false;
  }
  return true;
}

export function deductCost(playerResources: ResourceCount, cost: Partial<ResourceCount>): ResourceCount {
  if (!isValidResourcePayload(cost)) {
    throw new Error('Invalid resource cost payload');
  }
  const updated = { ...playerResources };
  for (const r of VALID_RESOURCES) {
    const amt = cost[r] || 0;
    if (amt > 0) {
      updated[r] = Math.max(0, (updated[r] || 0) - amt);
    }
  }
  return updated;
}

export function addResources(playerResources: ResourceCount, added: Partial<ResourceCount>): ResourceCount {
  if (!isValidResourcePayload(added)) {
    throw new Error('Invalid resource addition payload');
  }
  const updated = { ...playerResources };
  for (const r of VALID_RESOURCES) {
    const amt = added[r] || 0;
    if (amt > 0) {
      updated[r] = (updated[r] || 0) + amt;
    }
  }
  return updated;
}

export function deductTradePayloadFromPlayer(
  player: { resources: ResourceCount; commodities: CommodityCount },
  payload: TradePayload,
) {
  for (const r of VALID_RESOURCES) {
    const amt = payload[r] || 0;
    if (amt > 0) {
      player.resources[r] = Math.max(0, (player.resources[r] || 0) - amt);
    }
  }
  if (!player.commodities) {
    player.commodities = { cloth: 0, coin: 0, paper: 0 };
  }
  for (const c of VALID_COMMODITIES) {
    const amt = payload[c] || 0;
    if (amt > 0) {
      player.commodities[c] = Math.max(0, (player.commodities[c] || 0) - amt);
    }
  }
}

export function addTradePayloadToPlayer(
  player: { resources: ResourceCount; commodities: CommodityCount },
  payload: TradePayload,
) {
  for (const r of VALID_RESOURCES) {
    const amt = payload[r] || 0;
    if (amt > 0) {
      player.resources[r] = (player.resources[r] || 0) + amt;
    }
  }
  if (!player.commodities) {
    player.commodities = { cloth: 0, coin: 0, paper: 0 };
  }
  for (const c of VALID_COMMODITIES) {
    const amt = payload[c] || 0;
    if (amt > 0) {
      player.commodities[c] = (player.commodities[c] || 0) + amt;
    }
  }
}
