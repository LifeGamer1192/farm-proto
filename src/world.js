// World contents that sit on top of the terrain — plants and, since
// alpha 18, trees and stumps.

import { TileType } from './map/tile.js';
import { mulberry32 } from './core/rng.js';
import { WILD_PLANT_CHANCE, TREE_CHANCE, SEAFOOD_SPAWN_CHANCE } from './config.js';
import { WILD_CROP_IDS } from './crops.js';
import { pickSeafoodFor } from './seafood.js';

export const PlantKind = {
  WILD: 'wild', // small bush; harvested for a bite of forage
  CROP: 'crop', // planted by a colonist
  TREE: 'tree', // a tree — chopped for wood, leaves a stump
  STUMP: 'stump', // freshly chopped tree; regrows after a while
  // α33: a water tile carrying a fishable resource. `seafoodId` names the
  // species (saltFish / riverFish / lakeFish / clam).
  SEAFOOD: 'seafood',
};

/**
 * Scatter wild plants and trees across the map's land tiles. Deterministic
 * for a given map seed, so the same seed always yields the same world.
 *
 * Alpha 22 lets a biome override the tree / wild-plant chances so an arid
 * map ends up almost treeless and a wetland map is overgrown.
 *
 * @param {{cols:number, rows:number, seed:number, tiles:object[][]}} map
 * @param {?object} [biome] optional biome record from src/biomes.js
 * @returns {{wild:number, trees:number}} how many of each were placed
 */
export function scatterPlants(map, biome = null) {
  const rand = mulberry32((map.seed ^ 0x9e3779b9) >>> 0);
  const treeChance = biome?.treeChance ?? TREE_CHANCE;
  const wildChance = biome?.wildPlantChance ?? WILD_PLANT_CHANCE;
  let wild = 0;
  let trees = 0;
  let seafood = 0;
  // α33: seafood spawn chance. A small fraction of water tiles get a
  // catch waiting on them at map start (regrows over time, see
  // updateSeafood in eventSystem). Skipped for land tiles.
  const seafoodChance = SEAFOOD_SPAWN_CHANCE;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const tile = map.tiles[y][x];
      tile.plant = null;
      if (tile.type === TileType.WATER) {
        // α33: water tiles can carry a seafood marker. Adjacent-from-land
        // harvesting drops fish / clams into colony storage.
        if (rand() < seafoodChance) {
          const seafoodId = pickSeafoodFor(tile.waterKind, rand);
          if (seafoodId) {
            tile.plant = { kind: PlantKind.SEAFOOD, seafoodId };
            seafood++;
          }
        }
        continue;
      }
      if (tile.type !== TileType.LAND) continue;
      const roll = rand();
      if (roll < treeChance) {
        tile.plant = { kind: PlantKind.TREE, growth: 1 };
        trees++;
      } else if (roll < treeChance + wildChance) {
        // α27: each wild plant is one of five ancestor species. Picked
        // deterministically off the same RNG so the same seed always
        // grows the same patchwork. Foraging the tile drops a seed of
        // this species (game.js HARVEST branch).
        const wildId = WILD_CROP_IDS[Math.floor(rand() * WILD_CROP_IDS.length)];
        tile.plant = { kind: PlantKind.WILD, wildId };
        wild++;
      }
    }
  }
  return { wild, trees, seafood };
}
