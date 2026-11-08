import { ResourceCount, ResourceType } from '../types/index.js';

export const VALID_RESOURCES: readonly ResourceType[] = [
  'wood',
  'brick',
  'wheat',
  'sheep',
  'ore',
];

export const BUILDING_COSTS: Record<'road' | 'settlement' | 'city' | 'devCard', Partial<ResourceCount>> = {
  road: { wood: 1, brick: 1 },
  settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
  city: { wheat: 2, ore: 3 },
  devCard: { wheat: 1, sheep: 1, ore: 1 },
};

export const MAX_PIECES = {
  roads: 15,
  settlements: 5,
  cities: 4,
};

export function isValidResourceType(value: unknown): value is ResourceType {
  return typeof value === 'string' && (VALID_RESOURCES as readonly string[]).includes(value);
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

export function sumResources(payload: Partial<ResourceCount>): number {
  if (!isValidResourcePayload(payload)) return -1;
  let total = 0;
  for (const r of VALID_RESOURCES) {
    total += payload[r] || 0;
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
