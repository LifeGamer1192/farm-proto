// The colonist: a single character that walks the map.
//
// Two ways to move:
//   - commandTo()  : the player clicks a tile — a forced move via A*.
//   - wander()     : when idle, the colonist strolls off on its own.

import { findPath } from '../core/pathfinder.js';
import { TileType } from '../map/tile.js';
import { COLONIST_SPEED, COLONIST_IDLE_WANDER } from '../config.js';

const WANDER_RADIUS = 10;

export class Colonist {
  constructor(x, y) {
    this.x = x; // continuous tile coordinate
    this.y = y;
    this.path = []; // remaining waypoints {x, y}
    this.state = 'idle'; // 'idle' | 'moving' | 'wandering'
    this.idleTimer = 0;
  }

  get tileX() {
    return Math.round(this.x);
  }
  get tileY() {
    return Math.round(this.y);
  }

  // A tile the colonist can safely re-route from: the one it is already
  // walking toward, or — when idle — the tile it stands on. Re-routing
  // from here avoids the colonist back-tracking out of a half-walked step.
  _anchor() {
    return this.path.length > 0
      ? { x: this.path[0].x, y: this.path[0].y }
      : { x: this.tileX, y: this.tileY };
  }

  /**
   * Player command — a forced move to (tx, ty).
   * @returns {boolean} true if a path was found.
   */
  commandTo(map, tx, ty) {
    const anchor = this._anchor();
    const path = findPath(map, anchor, { x: tx, y: ty });
    if (!path) return false;
    this.path = [anchor, ...path];
    this.state = 'moving';
    return true;
  }

  /**
   * Autonomous behaviour — stroll to a random reachable tile nearby.
   * @returns {boolean} true if the colonist set off.
   */
  wander(map) {
    const anchor = { x: this.tileX, y: this.tileY };
    for (let attempt = 0; attempt < 14; attempt++) {
      const tx = anchor.x + Math.floor((Math.random() * 2 - 1) * WANDER_RADIUS);
      const ty = anchor.y + Math.floor((Math.random() * 2 - 1) * WANDER_RADIUS);
      if (tx < 0 || ty < 0 || tx >= map.cols || ty >= map.rows) continue;
      if (map.tiles[ty][tx].type === TileType.WATER) continue;
      const path = findPath(map, anchor, { x: tx, y: ty });
      if (path && path.length > 0) {
        this.path = [anchor, ...path];
        this.state = 'wandering';
        return true;
      }
    }
    return false;
  }

  /** Advance by dt seconds. */
  update(dt, map) {
    if (this.path.length > 0) {
      let budget = COLONIST_SPEED * dt;
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
      if (this.path.length === 0) {
        this.state = 'idle';
        this.idleTimer = 0;
      }
    } else {
      this.idleTimer += dt;
      if (this.idleTimer >= COLONIST_IDLE_WANDER) {
        this.idleTimer = 0;
        this.wander(map);
      }
    }
  }
}
