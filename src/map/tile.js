// A map tile and its terrain parameters.
//
// "Fertility" is intentionally NOT a single number. Several independent
// parameters describe the ground; later versions decide whether a given
// crop thrives on a tile by comparing the crop's needs against these.

export const TileType = {
  LAND: 'land',
  WATER: 'water',
};

// α33: water tiles get a sub-kind set during map generation. Used by the
// seafood spawn step + the renderer (different tints) + autonomy (which
// fish species each body yields).
export const WaterKind = {
  OCEAN: 'ocean',   // large + touches map edge — yields saltwater fish + clams
  RIVER: 'river',   // long / narrow body — yields river fish
  LAKE:  'lake',    // enclosed / round body — yields lake fish + clams
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
 * @property {boolean} tilled    whether the soil has been tilled
 * @property {?string} structure a built structure ('fence'|'hut'|'stockpile'), or null
 */

/**
 * @param {Tile} p
 * @returns {Tile}
 */
export function createTile({ x, y, type, elevation, fertility, moisture, sunlight }) {
  return {
    x,
    y,
    type,
    elevation,
    fertility,
    moisture,
    sunlight,
    plant: null,
    tilled: false,
    structure: null,
    // α33: water-tile subtype (ocean / river / lake). null for land tiles.
    // Set by classifyWaterBodies() during map generation.
    waterKind: null,
  };
}
