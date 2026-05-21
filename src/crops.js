// Crop types for the alpha-4 farming loop.
//
// A sown crop grows over time (growth 0 → 1). Once growth reaches 1 it is
// ripe and can be harvested for `yield` units of food.

export const CROP_TYPES = {
  wheat: {
    id: 'wheat',
    label: 'Wheat',
    growthTime: 35, // seconds from sown to ripe
    yield: 4, // food units when harvested ripe
    color: '#caa63f', // young/growing
    ripeColor: '#f1da7e', // ripe
  },
  potato: {
    id: 'potato',
    label: 'Potato',
    growthTime: 50,
    yield: 7,
    color: '#6fae4e',
    ripeColor: '#c9a86b',
  },
  bean: {
    id: 'bean',
    label: 'Bean',
    growthTime: 20,
    yield: 2,
    color: '#7cc653',
    ripeColor: '#b6e07a',
  },
};

// Display / iteration order.
export const CROP_IDS = ['wheat', 'potato', 'bean'];

export function getCrop(id) {
  return CROP_TYPES[id];
}

/** A plant is ripe when it is a crop whose growth has reached 1. */
export function isRipe(plant) {
  return !!plant && plant.kind === 'crop' && plant.growth >= 1;
}
