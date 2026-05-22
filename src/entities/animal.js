// A wild animal. It strolls slowly around the map and, on a cooldown,
// lands a minor attack on any colonist that strays too close. Colonists
// can hunt it down for meat.

import { findPath } from '../core/pathfinder.js';
import { TileType } from '../map/tile.js';
import { ANIMAL_SPEED } from '../config.js';

const WANDER_RADIUS = 7;
const PAUSE = 3; // sim-seconds an animal rests between strolls

export class Animal {
  constructor(x, y, id) {
    this.x = x;
    this.y = y;
    this.id = id;
    this.path = [];
    this.idleTimer = 0;
    this.attackCooldown = 0;
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
      if (this.idleTimer >= PAUSE) {
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
      const path = findPath(map, { x: this.tileX, y: this.tileY }, { x: tx, y: ty });
      if (path && path.length > 0) {
        this.path = path;
        return;
      }
    }
  }

  _walk(dt) {
    let budget = ANIMAL_SPEED * dt;
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
