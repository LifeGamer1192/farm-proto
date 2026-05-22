// The colonist: a single character that carries out tasks.
//
// The game assigns one task at a time. The colonist walks to the task's
// tile, does the work, and marks the task done (or failed). When it has no
// task it wanders on its own.

import { findPath } from '../core/pathfinder.js';
import { TileType } from '../map/tile.js';
import { TaskType } from '../tasks.js';
import { isRipe } from '../crops.js';
import { COLONIST_SPEED, COLONIST_IDLE_WANDER, WORK_DURATION } from '../config.js';

const WANDER_RADIUS = 10;

export class Colonist {
  constructor(x, y) {
    this.x = x; // continuous tile coordinate
    this.y = y;
    this.path = []; // remaining waypoints {x, y}
    this.state = 'idle'; // 'idle' | 'moving' | 'working' | 'wandering'
    this.idleTimer = 0;
    this.currentTask = null;
    this.workTimer = 0;
  }

  get tileX() {
    return Math.round(this.x);
  }
  get tileY() {
    return Math.round(this.y);
  }
  get workProgress() {
    return this.currentTask ? Math.min(1, this.workTimer / WORK_DURATION) : 0;
  }

  // A tile the colonist can safely re-route from: the one it is already
  // walking toward, or — when stationary — the tile it stands on.
  _anchor() {
    return this.path.length > 0
      ? { x: this.path[0].x, y: this.path[0].y }
      : { x: this.tileX, y: this.tileY };
  }

  /**
   * Take on a task: validate it, then route to its target tile.
   * On failure the task is marked failed with an outcome note.
   */
  assignTask(task, map) {
    this.currentTask = task;
    this.workTimer = 0;
    task.status = 'active';

    const tile = map.tiles[task.y] && map.tiles[task.y][task.x];
    if (!tile) return this._failTask(task, 'off the map');

    if (task.type === TaskType.HARVEST) {
      if (!tile.plant) return this._failTask(task, 'nothing to harvest');
      const p = tile.plant;
      // A withered crop can still be harvested — that just clears the husk.
      if (p.kind === 'crop' && !p.withered && !isRipe(p)) {
        return this._failTask(task, 'crop not ripe yet');
      }
    }
    if (task.type === TaskType.SOW) {
      if (tile.type === TileType.WATER) return this._failTask(task, 'cannot sow on water');
      if (tile.plant) return this._failTask(task, 'tile already occupied');
    }
    if (task.type === TaskType.MOVE && tile.type === TileType.WATER) {
      return this._failTask(task, 'cannot stand on water');
    }

    const anchor = this._anchor();
    const path = findPath(map, anchor, { x: task.x, y: task.y });
    if (!path) return this._failTask(task, 'unreachable');
    this.path = [anchor, ...path];
    this.state = 'moving';
  }

  _failTask(task, why) {
    task.status = 'failed';
    task.outcome = why;
  }

  /** Autonomous behaviour — stroll to a random reachable tile nearby. */
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

  // Advance along the current path by dt seconds.
  _walk(dt) {
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
  }

  /** Advance by dt seconds. */
  update(dt, map) {
    const task = this.currentTask;
    if (task) {
      // Finished tasks wait here until the game collects them.
      if (task.status === 'done' || task.status === 'failed') return;

      if (this.path.length > 0) {
        this.state = 'moving';
        this._walk(dt);
      } else if (task.type === TaskType.MOVE) {
        this.state = 'idle';
        task.status = 'done';
      } else {
        // Arrived: spend WORK_DURATION working the tile.
        this.state = 'working';
        this.workTimer += dt;
        if (this.workTimer >= WORK_DURATION) {
          task.status = 'done';
        }
      }
      return;
    }

    // No task: stroll around while idle.
    if (this.path.length > 0) {
      this.state = 'wandering';
      this._walk(dt);
      if (this.path.length === 0) {
        this.state = 'idle';
        this.idleTimer = 0;
      }
    } else {
      this.state = 'idle';
      this.idleTimer += dt;
      if (this.idleTimer >= COLONIST_IDLE_WANDER) {
        this.idleTimer = 0;
        this.wander(map);
      }
    }
  }
}
