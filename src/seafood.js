// α33–34: seafood — fish, shellfish, crustaceans and seaweed harvested
// from water tiles.
//
// Each seafood id behaves like a generic edible (similar to meat / forage):
// it lives in FOOD_TYPES, gets stored in warehouses, can be cooked at the
// hearth into meals or workshop into preserved seafood (drying station).
//
// Three water-tile sub-kinds (ocean / river / lake) yield distinct species
// in distinct mixes, with each species peaking in a different season.

import { WaterKind } from './map/tile.js';

// α34: per-species data.
//   baseYield   — sim units dropped per successful catch (before season)
//   seasonalYield — {spring, summer, autumn, winter} multipliers; 1.0 = base
//   kind        — coarse silhouette tag the renderer uses
//
// Profiles are loosely modelled on real catch cycles:
//  - true fish peak when waters warm (spring/summer), winter is lean
//  - clams / shellfish are far more stable year-round
//  - seaweed peaks in summer (long days) and crashes in winter
//  - eel migrates downstream in autumn — sharp autumn spike
//  - crustaceans peak in late summer/autumn molt cycles
export const SEAFOOD_TYPES = {
  saltFish:   { id: 'saltFish',   label: 'Saltwater fish', edibleRaw: false, nutrition: 0.22, kind: 'fish',     baseYield: 3,
    seasonalYield: { spring: 1.30, summer: 1.20, autumn: 1.00, winter: 0.40 } },
  riverFish:  { id: 'riverFish',  label: 'River fish',     edibleRaw: false, nutrition: 0.18, kind: 'fish',     baseYield: 2,
    seasonalYield: { spring: 1.40, summer: 1.10, autumn: 0.90, winter: 0.50 } },
  lakeFish:   { id: 'lakeFish',   label: 'Lake fish',      edibleRaw: false, nutrition: 0.20, kind: 'fish',     baseYield: 2,
    seasonalYield: { spring: 1.20, summer: 1.20, autumn: 1.00, winter: 0.50 } },
  clam:       { id: 'clam',       label: 'Clam',           edibleRaw: false, nutrition: 0.18, kind: 'clam',     baseYield: 2,
    seasonalYield: { spring: 1.10, summer: 1.00, autumn: 1.10, winter: 0.90 } },
  // α34 additions ↓
  shrimp:     { id: 'shrimp',     label: 'Shrimp',         edibleRaw: false, nutrition: 0.16, kind: 'shrimp',   baseYield: 3,
    seasonalYield: { spring: 0.90, summer: 1.30, autumn: 1.40, winter: 0.50 } },
  crab:       { id: 'crab',       label: 'Crab',           edibleRaw: false, nutrition: 0.24, kind: 'crab',     baseYield: 2,
    seasonalYield: { spring: 0.70, summer: 1.10, autumn: 1.50, winter: 0.80 } },
  seaweed:    { id: 'seaweed',    label: 'Seaweed',        edibleRaw: false, nutrition: 0.12, kind: 'seaweed',  baseYield: 4,
    seasonalYield: { spring: 1.30, summer: 1.60, autumn: 0.90, winter: 0.20 } },
  eel:        { id: 'eel',        label: 'Eel',            edibleRaw: false, nutrition: 0.28, kind: 'eel',      baseYield: 2,
    seasonalYield: { spring: 0.60, summer: 0.90, autumn: 1.70, winter: 0.50 } },
  lakeShrimp: { id: 'lakeShrimp', label: 'Lake shrimp',    edibleRaw: false, nutrition: 0.14, kind: 'shrimp',   baseYield: 3,
    seasonalYield: { spring: 1.00, summer: 1.30, autumn: 1.20, winter: 0.50 } },
};

export const SEAFOOD_IDS = Object.keys(SEAFOOD_TYPES);

/** Per-nutrient profile used when the colonist eats one unit. Mirrors
 *  the meat / forage entries in foodSystem.DEFAULT_NUTRIENTS. */
export const SEAFOOD_NUTRIENTS = {
  saltFish:   { carb: 0.05, protein: 0.75, fat: 0.20, vitamin: 0.10 },
  riverFish:  { carb: 0.05, protein: 0.70, fat: 0.15, vitamin: 0.10 },
  lakeFish:   { carb: 0.05, protein: 0.72, fat: 0.18, vitamin: 0.10 },
  clam:       { carb: 0.10, protein: 0.55, fat: 0.10, vitamin: 0.40 },
  // α34 ↓
  shrimp:     { carb: 0.05, protein: 0.70, fat: 0.10, vitamin: 0.20 },
  crab:       { carb: 0.05, protein: 0.80, fat: 0.15, vitamin: 0.15 },
  // Seaweed is vitamin / fibre dominant — the only "vegetable" of the
  // water table. Gives the early coastal pre-farm colony a way to push
  // back malnutrition's vitamin track before fields exist.
  seaweed:    { carb: 0.30, protein: 0.20, fat: 0.05, vitamin: 0.70 },
  eel:        { carb: 0.05, protein: 0.65, fat: 0.50, vitamin: 0.10 },
  lakeShrimp: { carb: 0.05, protein: 0.70, fat: 0.10, vitamin: 0.20 },
};

/**
 * α34: weighted species pool per water-kind. Each entry is [id, weight];
 * pickSeafoodFor draws by weight so a coastal map yields a mix of fish,
 * shellfish, crustaceans and seaweed (not just one species).
 *
 *   ocean → saltFish (heavy) + clam, shrimp, crab, seaweed
 *   river → riverFish dominant, eel as an autumn payoff
 *   lake  → lakeFish + clam + lakeShrimp
 */
export const SEAFOOD_FOR_WATER = {
  [WaterKind.OCEAN]: [
    ['saltFish', 30],
    ['clam',     20],
    ['shrimp',   18],
    ['crab',     12],
    ['seaweed',  20],
  ],
  [WaterKind.RIVER]: [
    ['riverFish', 70],
    ['eel',       30],
  ],
  [WaterKind.LAKE]: [
    ['lakeFish',   45],
    ['clam',       25],
    ['lakeShrimp', 30],
  ],
};

/** Pick a seafood id for a given water kind by weighted random draw.
 *  Deterministic when the random source is. */
export function pickSeafoodFor(waterKind, rand = Math.random) {
  const pool = SEAFOOD_FOR_WATER[waterKind];
  if (!pool || pool.length === 0) return null;
  let total = 0;
  for (const [, w] of pool) total += w;
  let roll = rand() * total;
  for (const [id, w] of pool) {
    roll -= w;
    if (roll <= 0) return id;
  }
  return pool[pool.length - 1][0];
}

/**
 * α34: actual catch size for a species in the current season. Rounds
 * down with a floor of 1 so a winter haul is small but never zero
 * (otherwise the FISH task would feel broken). Used by game.js when
 * applying the FISH task effect.
 */
export function seafoodYield(id, season) {
  const sf = SEAFOOD_TYPES[id];
  if (!sf) return 1;
  const mult = sf.seasonalYield?.[season] ?? 1.0;
  return Math.max(1, Math.round(sf.baseYield * mult));
}
