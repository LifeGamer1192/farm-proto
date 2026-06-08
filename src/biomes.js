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
    // α36 followup: temperate uses a piecewise elevation curve that
    // splits the map into ~10% water / ~70% plains / ~20% hills+mountains
    // for a more pronounced "flat farmland with the occasional hill"
    // look. Other biomes keep the smoother ridge-filter default.
    flatPlainsCurve: true,
    waterLevel: 0.05,
    minWaterFraction: 0.10,
    moistureRange: 6,
    fertilityBonus: 0,
    // Wildlife / vegetation density.
    treeChance: 0.08,
    wildPlantChance: 0.012,
    // α27: every biome now spawns 11 animals across 7 species, with
    // weighting biased toward what each climate plausibly supports.
    animalSpawnMix: [
      { species: 'boar',   n: 1 },
      { species: 'wolf',   n: 1 },
      { species: 'bear',   n: 1 },
      { species: 'deer',   n: 2 },
      { species: 'rabbit', n: 2 },
      { species: 'sheep',  n: 2 },
      { species: 'fowl',   n: 2 },
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
    // Arid: light forest game, more fowl + sheep that tolerate dry land.
    animalSpawnMix: [
      { species: 'boar',   n: 1 },
      { species: 'wolf',   n: 2 },
      { species: 'bear',   n: 0 },
      { species: 'deer',   n: 1 },
      { species: 'rabbit', n: 2 },
      { species: 'sheep',  n: 2 },
      { species: 'fowl',   n: 3 },
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
    // Cold: more bears + wolves, fewer fowl.
    animalSpawnMix: [
      { species: 'boar',   n: 1 },
      { species: 'wolf',   n: 2 },
      { species: 'bear',   n: 2 },
      { species: 'deer',   n: 2 },
      { species: 'rabbit', n: 2 },
      { species: 'sheep',  n: 1 },
      { species: 'fowl',   n: 1 },
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
    // Wetlands: lush life, fowl thrive near water.
    animalSpawnMix: [
      { species: 'boar',   n: 2 },
      { species: 'wolf',   n: 1 },
      { species: 'bear',   n: 1 },
      { species: 'deer',   n: 2 },
      { species: 'rabbit', n: 2 },
      { species: 'sheep',  n: 1 },
      { species: 'fowl',   n: 2 },
    ],
    tempOffset: +2,
    daylightOffset: 0,
    mapTint: 'rgba(80,160,180,0.10)',
  },
  // C10: extreme cold — brutally cold, barely survivable. Sparse life,
  // little forage, a deep negative temperature offset that keeps crops
  // from growing for most of the year.
  frost: {
    id: 'frost',
    waterLevel: 0.44,
    minWaterFraction: 0.10,
    moistureRange: 7,
    fertilityBonus: -0.18,
    treeChance: 0.05,
    wildPlantChance: 0.004,
    animalSpawnMix: [
      { species: 'boar',   n: 0 },
      { species: 'wolf',   n: 3 },
      { species: 'bear',   n: 2 },
      { species: 'deer',   n: 1 },
      { species: 'rabbit', n: 1 },
      { species: 'sheep',  n: 0 },
      { species: 'fowl',   n: 0 },
    ],
    tempOffset: -24,
    daylightOffset: -0.12,
    mapTint: 'rgba(200,225,245,0.20)',
  },
  // C10: desert — roughly 70% parched badland, 30% scrub grassland and
  // the odd oasis. Very hot and dry; survivable but punishing.
  desert: {
    id: 'desert',
    waterLevel: 0.28,
    minWaterFraction: 0.06,
    moistureRange: 2,
    fertilityBonus: -0.14,
    treeChance: 0.012,
    wildPlantChance: 0.006,
    animalSpawnMix: [
      { species: 'boar',   n: 0 },
      { species: 'wolf',   n: 1 },
      { species: 'bear',   n: 0 },
      { species: 'deer',   n: 1 },
      { species: 'rabbit', n: 2 },
      { species: 'sheep',  n: 2 },
      { species: 'fowl',   n: 3 },
    ],
    tempOffset: +16,
    daylightOffset: +0.15,
    mapTint: 'rgba(225,180,90,0.16)',
  },
  // C10: forest — dense woodland. Trees everywhere (wood is never a
  // worry), rich undergrowth of wild plants, temperate climate.
  forest: {
    id: 'forest',
    waterLevel: 0.42,
    minWaterFraction: 0.10,
    moistureRange: 8,
    fertilityBonus: +0.04,
    treeChance: 0.38,
    wildPlantChance: 0.03,
    animalSpawnMix: [
      { species: 'boar',   n: 2 },
      { species: 'wolf',   n: 2 },
      { species: 'bear',   n: 2 },
      { species: 'deer',   n: 3 },
      { species: 'rabbit', n: 2 },
      { species: 'sheep',  n: 1 },
      { species: 'fowl',   n: 1 },
    ],
    tempOffset: -1,
    daylightOffset: -0.03,
    mapTint: 'rgba(60,120,60,0.14)',
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
