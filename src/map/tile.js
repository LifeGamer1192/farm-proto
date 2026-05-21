// A map tile and its terrain parameters.
//
// "Fertility" is intentionally NOT a single number. Several independent
// parameters describe the ground; later versions decide whether a given
// crop thrives on a tile by comparing the crop's needs against these.

export const TileType = {
  LAND: 'land',
  WATER: 'water',
};

/**
 * @typedef {object} Tile
 * @property {number} x          column index
 * @property {number} y          row index
 * @property {string} type       TileType.LAND | TileType.WATER
 * @property {number} elevation  0..1 terrain height
 * @property {number} fertility  0..1 soil richness (0 on water)
 * @property {number} moisture   0..1 ground moisture
 * @property {number} sunlight   0..1 light exposure
 * @property {?object} plant     a plant on the tile, or null
 */

/**
 * @param {Tile} p
 * @returns {Tile}
 */
export function createTile({ x, y, type, elevation, fertility, moisture, sunlight }) {
  return { x, y, type, elevation, fertility, moisture, sunlight, plant: null };
}
