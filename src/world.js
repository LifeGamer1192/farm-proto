// World contents that sit on top of the terrain — for alpha 3, plants.

import { TileType } from './map/tile.js';
import { mulberry32 } from './core/rng.js';
import { WILD_PLANT_CHANCE } from './config.js';

export const PlantKind = {
  WILD: 'wild', // grew on its own; harvestable
  CROP: 'crop', // planted by the colonist; harvestable
};

/**
 * Scatter wild plants across the map's land tiles. Deterministic for a given
 * map seed, so the same seed always yields the same plants.
 * @param {{cols:number, rows:number, seed:number, tiles:object[][]}} map
 * @returns {number} how many wild plants were placed
 */
export function scatterPlants(map) {
  const rand = mulberry32((map.seed ^ 0x9e3779b9) >>> 0);
  let count = 0;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const tile = map.tiles[y][x];
      tile.plant = null;
      if (tile.type === TileType.LAND && rand() < WILD_PLANT_CHANCE) {
        tile.plant = { kind: PlantKind.WILD };
        count++;
      }
    }
  }
  return count;
}
