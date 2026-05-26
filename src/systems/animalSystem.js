// Animal system: spawning the random mix at map start, the per-tick
// wander/attack loop, hostile-threat queries used by the fence planner,
// the auto-chop tree picker (technically a forest helper but cohesive
// with hunting), and the find-nearest-animal queries.

import {
  ANIMAL_COUNT,
  ANIMAL_SPAWN_MIX,
  ANIMAL_DAMAGE,
  ANIMAL_ATTACK_INTERVAL,
  ANIMAL_ATTACK_RANGE,
} from '../config.js';
import { Animal } from '../entities/animal.js';
import { PlantKind } from '../world.js';
import { t } from '../i18n.js';

/**
 * Spawn animals at game start. Builds a species list from
 * ANIMAL_SPAWN_MIX, falls back to boar if the mix under-fills, then
 * scatters them on random land tiles.
 */
export function spawnAnimals(game, landTiles) {
  const specList = [];
  for (const { species, n } of ANIMAL_SPAWN_MIX) {
    for (let i = 0; i < n; i++) specList.push(species);
  }
  while (specList.length < ANIMAL_COUNT) specList.push('boar');
  specList.length = ANIMAL_COUNT;
  return landTiles.map((s, i) => new Animal(s.x, s.y, i + 1, specList[i]));
}

/** The animal nearest to a tile, within `range` tiles (or null). */
export function animalNear(game, x, y, range) {
  let best = range;
  let found = null;
  for (const a of game.animals) {
    const d = Math.hypot(a.x - x, a.y - y);
    if (d <= best) {
      best = d;
      found = a;
    }
  }
  return found;
}

/**
 * The nearest HOSTILE animal within `range` of any colonist. Used by the
 * fence planner — a grazing deer shouldn't make the colony build walls.
 */
export function nearestAnimalToColony(game, range) {
  let best = null;
  let bestD = range;
  for (const c of game.colonists) {
    for (const a of game.animals) {
      if (!a.hostile) continue;
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
  }
  return best;
}

/**
 * The nearest fully-grown tree within `range` of a colonist that no one
 * is already chopping. Used by the wood-low auto-chop branch.
 */
export function nearestTree(game, colonist, range) {
  const cx = colonist.tileX;
  const cy = colonist.tileY;
  let best = null;
  let bestD = range;
  const r = Math.ceil(range);
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      const row = game.map.tiles[y];
      const tl = row && row[x];
      if (!tl || !tl.plant) continue;
      if (tl.plant.kind !== PlantKind.TREE) continue;
      if (tl.plant.growth < 0.5) continue; // saplings aren't worth chopping
      if (game._tileClaimed(x, y)) continue;
      const d = Math.hypot(dx, dy);
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

/**
 * Animals stroll; hostile ones (boar, wolf) harry a nearby colonist on
 * a cooldown. Peaceful species (deer, rabbit) just wander.
 */
export function updateAnimals(game, dt) {
  for (const a of game.animals) {
    a.update(dt, game.map);
    if (!a.hostile) continue;
    if (a.attackCooldown > 0) continue;
    let victim = null;
    let best = ANIMAL_ATTACK_RANGE;
    for (const c of game.colonists) {
      const d = Math.hypot(c.x - a.x, c.y - a.y);
      if (d < best) {
        best = d;
        victim = c;
      }
    }
    if (victim) {
      victim.hurt(ANIMAL_DAMAGE);
      a.attackCooldown = ANIMAL_ATTACK_INTERVAL;
      game._pushLog({
        icon: '⚔',
        text: t('log.attacked', { animal: t('animal.' + a.species), name: victim.name }),
        cls: 'log-warn',
      });
    }
  }
}
