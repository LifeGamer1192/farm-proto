// Crop types for the alpha-4 farming loop.
//
// A sown crop grows over time (growth 0 → 1). Once growth reaches 1 it is
// ripe and can be harvested for `yield` units of food. But the initial
// crop strains are weak: a sown crop may wither before it ripens, and how
// likely it is to survive depends on how well the tile's soil suits it.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export const CROP_TYPES = {
  wheat: {
    id: 'wheat',
    label: 'Wheat',
    growthTime: 35, // seconds from sown to ripe
    yield: 4, // food units when harvested ripe
    color: '#caa63f', // young/growing
    ripeColor: '#f1da7e', // ripe
    // How much each soil parameter matters to this crop (weights sum to 1).
    soil: { fertility: 0.3, moisture: 0.2, sunlight: 0.5 },
  },
  potato: {
    id: 'potato',
    label: 'Potato',
    growthTime: 50,
    yield: 7,
    color: '#6fae4e',
    ripeColor: '#c9a86b',
    soil: { fertility: 0.5, moisture: 0.3, sunlight: 0.2 },
  },
  bean: {
    id: 'bean',
    label: 'Bean',
    growthTime: 20,
    yield: 2,
    color: '#7cc653',
    ripeColor: '#b6e07a',
    soil: { fertility: 0.34, moisture: 0.33, sunlight: 0.33 },
  },
};

// Display / iteration order.
export const CROP_IDS = ['wheat', 'potato', 'bean'];

export function getCrop(id) {
  return CROP_TYPES[id];
}

/** A plant is ripe when it is a (non-withered) crop whose growth reached 1. */
export function isRipe(plant) {
  return !!plant && plant.kind === 'crop' && !plant.withered && plant.growth >= 1;
}

/**
 * How well a tile's soil suits a crop, 0..1 — a weighted blend of the
 * tile's fertility, moisture and sunlight.
 */
export function cropSuitability(crop, tile) {
  const w = crop.soil;
  return clamp01(
    w.fertility * tile.fertility + w.moisture * tile.moisture + w.sunlight * tile.sunlight,
  );
}

/**
 * Chance (0..1) that a freshly sown crop survives to ripeness.
 * Initial crop strains are weak — even ideal soil only carries about half
 * to harvest. Tilled soil adds a bonus. Later versions (quality/genetics)
 * will improve the base odds.
 * @param {number} suitability  0..1 soil match
 * @param {number} [bonus]      extra survival (e.g. from tilled soil)
 */
export function survivalChance(suitability, bonus = 0) {
  return clamp01(0.15 + suitability * 0.42 + bonus);
}
