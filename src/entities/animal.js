// A wild animal. It strolls slowly around the map and, when hostile, may
// land a minor attack on a colonist that strays too close. Colonists can
// hunt it down for meat. Animals route around fences, so a ringed farm
// keeps them out.
//
// Alpha 20 added species variety. Each species shares the same wander /
// pathing code but carries its own traits: walking speed, whether it is
// hostile, the meat yielded when hunted, and a colour palette used by
// the renderer.

import { findPath } from '../core/pathfinder.js';
import { TileType } from '../map/tile.js';
import { ANIMAL_SPEED } from '../config.js';

const WANDER_RADIUS = 7;
const PAUSE = 3; // sim-seconds an animal rests between strolls

/**
 * Per-species traits. `hostile` decides whether the animal harries
 * colonists; `meat` is the yield for a successful hunt; `wander` is
 * how often (in sim-seconds) it picks a new wander goal; `speedMul`
 * multiplies the global ANIMAL_SPEED. `domesticable` (α27) marks a
 * species as a future animal-husbandry candidate — currently a hint
 * flag only, with no behavioural effect.
 */
export const SPECIES = {
  // α29 followup: meat yield now spans 1..12, scaled to body size.
  // Bear/deer/boar are the prize hunts; fowl/rabbit are nibbles.
  // α29 followup: meat yield now spans 2..12, scaled to body size.
  // Bear / deer / boar are the prize hunts (~3× a rabbit); fowl and
  // rabbit are tiny nibbles. Total catchable meat per temperate-biome
  // spawn rose 45 → 61, so the food economy keeps pace with the
  // smaller per-kill yield from the new tiny-game lower bound.
  // Note: rabbit / fowl stay at 2 (not 1) — they're the FASTEST species
  // (speedMul 1.6 / 1.3) so they brush against colonists most often
  // and get auto-hunted disproportionately. Halving their yield (2→1)
  // collapsed the food economy in headless tests; 2 keeps the gap with
  // the big game (~×5) without starving balanced colonies.
  boar:   { hostile: true,  meat: 8,  wander: 1.0, speedMul: 1.0 },
  wolf:   { hostile: true,  meat: 5,  wander: 0.7, speedMul: 1.4 },
  bear:   { hostile: true,  meat: 12, wander: 0.5, speedMul: 0.9 },
  deer:   { hostile: false, meat: 10, wander: 0.9, speedMul: 1.2 },
  rabbit: { hostile: false, meat: 2,  wander: 0.6, speedMul: 1.6 },
  sheep:  { hostile: false, meat: 5,  wander: 0.8, speedMul: 1.0, domesticable: true },
  fowl:   { hostile: false, meat: 2,  wander: 0.5, speedMul: 1.3, domesticable: true },
};

export class Animal {
  constructor(x, y, id, species = 'boar') {
    this.x = x;
    this.y = y;
    this.id = id;
    this.species = SPECIES[species] ? species : 'boar';
    this.path = [];
    this.idleTimer = 0;
    this.attackCooldown = 0;
  }

  get traits() {
    return SPECIES[this.species];
  }
  get hostile() {
    return this.traits.hostile;
  }
  get tileX() {
    return Math.round(this.x);
  }
  get tileY() {
    return Math.round(this.y);
  }

  update(dt, map) {
    if (this.attackCooldown > 0) this.attackCooldown -= dt;
    if (this.path.length > 0) {
      this._walk(dt);
    } else {
      this.idleTimer += dt;
      if (this.idleTimer >= PAUSE * this.traits.wander) {
        this.idleTimer = 0;
        this._wander(map);
      }
    }
  }

  _wander(map) {
    for (let i = 0; i < 12; i++) {
      const tx = this.tileX + Math.floor((Math.random() * 2 - 1) * WANDER_RADIUS);
      const ty = this.tileY + Math.floor((Math.random() * 2 - 1) * WANDER_RADIUS);
      const row = map.tiles[ty];
      if (!row || !row[tx] || row[tx].type === TileType.WATER) continue;
      if (row[tx].structure === 'fence') continue;
      // Wander A* is capped so a deer stuck in a fenced-off pocket
      // does not pin the frame searching every reachable tile.
      const path = findPath(
        map,
        { x: this.tileX, y: this.tileY },
        { x: tx, y: ty },
        true,
        { maxIterations: 1500 },
      );
      if (path && path.length > 0) {
        this.path = path;
        return;
      }
    }
  }

  _walk(dt) {
    let budget = ANIMAL_SPEED * this.traits.speedMul * dt;
    while (budget > 0 && this.path.length > 0) {
      const wp = this.path[0];
      const dx = wp.x - this.x;
      const dy = wp.y - this.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= budget) {
        this.x = wp.x;
        this.y = wp.y;
        this.path.shift();
        budget -= dist;
      } else {
        this.x += (dx / dist) * budget;
        this.y += (dy / dist) * budget;
        budget = 0;
      }
    }
  }
}
