import { DevCardType, ResourceCount, ResourceType } from '../types/index.js';

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

export function canAfford(playerResources: ResourceCount, cost: Partial<ResourceCount>): boolean {
  for (const [res, amt] of Object.entries(cost) as Array<[ResourceType, number]>) {
    if ((playerResources[res] || 0) < amt) {
      return false;
    }
  }
  return true;
}

export function deductCost(playerResources: ResourceCount, cost: Partial<ResourceCount>): ResourceCount {
  const updated = { ...playerResources };
  for (const [res, amt] of Object.entries(cost) as Array<[ResourceType, number]>) {
    updated[res] = Math.max(0, (updated[res] || 0) - amt);
  }
  return updated;
}

export function addResources(playerResources: ResourceCount, added: Partial<ResourceCount>): ResourceCount {
  const updated = { ...playerResources };
  for (const [res, amt] of Object.entries(added) as Array<[ResourceType, number]>) {
    updated[res] = (updated[res] || 0) + amt;
  }
  return updated;
}
