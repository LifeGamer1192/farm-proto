// Biomes (alpha 22). Picked at game start. Each biome dials the map
// generator, the wild-life spawn mix and the climate offsets so playing
// in the arid badlands feels different from a wetland start.
//
// A biome is a flat data record — no logic. The map generator and world
// scatterer accept a biome and override their defaults from it; the game
// blends biome temperature / daylight offsets onto the seasonal curve.

export const BIOMES = {
  temperate: {
    id: 'temperate',
    // Terrain (overrides config defaults when set).
    waterLevel: 0.4,
    minWaterFraction: 0.08,
    moistureRange: 6,
    fertilityBonus: 0,
    // Wildlife / vegetation density.
    treeChance: 0.08,
    wildPlantChance: 0.012,
    animalSpawnMix: [
      { species: 'boar',   n: 2 },
      { species: 'wolf',   n: 1 },
      { species: 'deer',   n: 3 },
      { species: 'rabbit', n: 2 },
    ],
    // Climate offsets added to the seasonal curve (°C and 0..1 daylight).
    tempOffset: 0,
    daylightOffset: 0,
    // Optional tint multiplied over the map render (rgba).
    mapTint: null,
  },
  arid: {
    id: 'arid',
    // waterLevel is the elevation threshold below which a tile is
    // water — LOWER = drier (fewer tiles dip below the cutoff).
    waterLevel: 0.32,
    minWaterFraction: 0.03,
    moistureRange: 3,
    fertilityBonus: -0.1,
    treeChance: 0.025,
    wildPlantChance: 0.008,
    animalSpawnMix: [
      { species: 'boar',   n: 3 },
      { species: 'wolf',   n: 2 },
      { species: 'deer',   n: 1 },
      { species: 'rabbit', n: 2 },
    ],
    tempOffset: +8,
    daylightOffset: +0.1,
    mapTint: 'rgba(220,160,80,0.10)',
  },
  cold: {
    id: 'cold',
    waterLevel: 0.42,
    minWaterFraction: 0.10,
    moistureRange: 7,
    fertilityBonus: -0.05,
    treeChance: 0.14,
    wildPlantChance: 0.010,
    animalSpawnMix: [
      { species: 'boar',   n: 1 },
      { species: 'wolf',   n: 2 },
      { species: 'deer',   n: 3 },
      { species: 'rabbit', n: 2 },
    ],
    tempOffset: -10,
    daylightOffset: -0.05,
    mapTint: 'rgba(180,210,235,0.14)',
  },
  wetlands: {
    id: 'wetlands',
    // Higher cutoff → more land falls below it → more water tiles.
    waterLevel: 0.50,
    minWaterFraction: 0.20,
    moistureRange: 9,
    fertilityBonus: +0.05,
    treeChance: 0.10,
    wildPlantChance: 0.025,
    animalSpawnMix: [
      { species: 'boar',   n: 3 },
      { species: 'wolf',   n: 1 },
      { species: 'deer',   n: 2 },
      { species: 'rabbit', n: 2 },
    ],
    tempOffset: +2,
    daylightOffset: 0,
    mapTint: 'rgba(80,160,180,0.10)',
  },
};

/** Ordered list — used by the picker UI. */
export const BIOME_IDS = Object.keys(BIOMES);

/** Default biome for a fresh game when none is requested. */
export const DEFAULT_BIOME = 'temperate';

/** Resolve a biome id (or `null/undefined`) to a biome record. */
export function getBiome(id) {
  return BIOMES[id] || BIOMES[DEFAULT_BIOME];
}
