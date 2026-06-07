// α33: seafood — fish and clams harvested from water tiles.
//
// Each seafood id behaves like a generic edible (similar to meat / forage):
// it lives in FOOD_TYPES, gets stored in warehouses, can be eaten raw or
// cooked at the hearth into meals.
//
// Three water-tile sub-kinds (ocean / river / lake) yield distinct
// species — set in WaterKind on the tile during map gen. SEAFOOD_FOR
// maps a water kind to the list of species that spawn on it.

import { WaterKind } from './map/tile.js';

// Per-species traits. `edibleRaw` follows the nutrient/foodSystem default
// pattern (false → must be cooked); `nutrition` mirrors meat / forage
// scale (0.10..0.30 raw). All seafood is high in protein with the
// shellfish leaning a bit into vitamin and fat.
export const SEAFOOD_TYPES = {
  // Saltwater catch — ocean only. The deep-water fish carry the most fat
  // / protein and are the prize haul of any coastal colony.
  saltFish:   { id: 'saltFish',   label: 'Saltwater fish', edibleRaw: false, nutrition: 0.22, kind: 'fish'  },
  // Freshwater fish — river yields these. Smaller, leaner.
  riverFish:  { id: 'riverFish',  label: 'River fish',     edibleRaw: false, nutrition: 0.18, kind: 'fish'  },
  // Lake-bound fish — between river and salt in size / nutrition.
  lakeFish:   { id: 'lakeFish',   label: 'Lake fish',      edibleRaw: false, nutrition: 0.20, kind: 'fish'  },
  // Shellfish — eaten cooked, vitamin-leaning. Spawns in calmer waters
  // (lakes + shallow ocean) but never in rivers (too current-driven).
  clam:       { id: 'clam',       label: 'Clam',           edibleRaw: false, nutrition: 0.18, kind: 'clam'  },
};

export const SEAFOOD_IDS = Object.keys(SEAFOOD_TYPES);

/** Per-nutrient profile used when the colonist eats one unit. Mirrors
 *  the meat / forage entries in foodSystem.DEFAULT_NUTRIENTS. */
export const SEAFOOD_NUTRIENTS = {
  saltFish:  { carb: 0.05, protein: 0.75, fat: 0.20, vitamin: 0.10 },
  riverFish: { carb: 0.05, protein: 0.70, fat: 0.15, vitamin: 0.10 },
  lakeFish:  { carb: 0.05, protein: 0.72, fat: 0.18, vitamin: 0.10 },
  clam:      { carb: 0.10, protein: 0.55, fat: 0.10, vitamin: 0.40 },
};

/** Which species spawn in which water kind. Used by the seafood-spawn
 *  step in world.js and by the harvest yield logic in game.js. */
export const SEAFOOD_FOR_WATER = {
  [WaterKind.OCEAN]: ['saltFish', 'clam'],
  [WaterKind.RIVER]: ['riverFish'],
  [WaterKind.LAKE]:  ['lakeFish', 'clam'],
};

/** Pick a seafood id for a given water kind, given a random function.
 *  Deterministic when the random source is. */
export function pickSeafoodFor(waterKind, rand = Math.random) {
  const pool = SEAFOOD_FOR_WATER[waterKind];
  if (!pool || pool.length === 0) return null;
  return pool[Math.floor(rand() * pool.length)];
}
