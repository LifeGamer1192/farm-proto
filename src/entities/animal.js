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
 * multiplies the global ANIMAL_SPEED.
 */
export const SPECIES = {
  boar: { hostile: true, meat: 4, wander: 1.0, speedMul: 1.0 },
  wolf: { hostile: true, meat: 5, wander: 0.7, speedMul: 1.4 },
  deer: { hostile: false, meat: 6, wander: 0.9, speedMul: 1.2 },
  rabbit: { hostile: false, meat: 2, wander: 0.6, speedMul: 1.6 },
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
      const path = findPath(map, { x: this.tileX, y: this.tileY }, { x: tx, y: ty }, true);
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
