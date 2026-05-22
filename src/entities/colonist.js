// A colonist: a worker that walks the map and carries out tasks.
//
// The game assigns one task at a time (work from the queue, or a personal
// task — eat / rest / leisure / sleep — chosen by its priority AI). The
// colonist walks to the task's tile, spends the task's work phase there,
// and marks it done (or failed).

import { findPath } from '../core/pathfinder.js';
import { TileType } from '../map/tile.js';
import { TaskType } from '../tasks.js';
import { isRipe } from '../crops.js';
import {
  COLONIST_SPEED,
  WORK_DURATION,
  EAT_DURATION,
  REST_DURATION,
  SLEEP_DURATION,
} from '../config.js';

// Seconds of "work" each task type spends once the colonist has arrived.
const WORK_PHASE = {
  [TaskType.MOVE]: 0,
  [TaskType.LEISURE]: 0,
  [TaskType.SOW]: WORK_DURATION,
  [TaskType.HARVEST]: WORK_DURATION,
  [TaskType.TILL]: WORK_DURATION,
  [TaskType.WATER]: WORK_DURATION,
  [TaskType.EAT]: EAT_DURATION,
  [TaskType.REST]: REST_DURATION,
  [TaskType.SLEEP]: SLEEP_DURATION,
};

// Display state shown while a colonist works a task.
const WORK_STATE = {
  [TaskType.SOW]: 'working',
  [TaskType.HARVEST]: 'working',
  [TaskType.TILL]: 'working',
  [TaskType.WATER]: 'working',
  [TaskType.EAT]: 'eating',
  [TaskType.REST]: 'resting',
  [TaskType.SLEEP]: 'sleeping',
};

export class Colonist {
  constructor(x, y, name) {
    this.x = x; // continuous tile coordinate
    this.y = y;
    this.name = name;
    this.path = []; // remaining waypoints {x, y}
    this.state = 'idle';
    this.currentTask = null;
    this.workTimer = 0;
    this.eatTimer = 0; // counts up; reset when an eat task completes
  }

  get tileX() {
    return Math.round(this.x);
  }
  get tileY() {
    return Math.round(this.y);
  }
  get workProgress() {
    const task = this.currentTask;
    if (!task) return 0;
    const dur = WORK_PHASE[task.type] || 0;
    return dur > 0 ? Math.min(1, this.workTimer / dur) : 0;
  }

  // A tile to re-route from: the one being walked toward, or the current one.
  _anchor() {
    return this.path.length > 0
      ? { x: this.path[0].x, y: this.path[0].y }
      : { x: this.tileX, y: this.tileY };
  }

  _fail(task, outcomeKey) {
    task.status = 'failed';
    task.outcome = outcomeKey;
  }

  /** Take on a task: validate it, then route to its target tile. */
  assignTask(task, map) {
    this.currentTask = task;
    this.workTimer = 0;
    task.status = 'active';

    const tile = map.tiles[task.y] && map.tiles[task.y][task.x];
    if (!tile) return this._fail(task, 'offMap');

    if (task.type === TaskType.HARVEST) {
      if (!tile.plant) return this._fail(task, 'noPlant');
      const p = tile.plant;
      if (p.kind === 'crop' && !p.withered && !isRipe(p)) {
        return this._fail(task, 'notRipe');
      }
    } else if (task.type === TaskType.SOW) {
      if (tile.type === TileType.WATER) return this._fail(task, 'onWater');
      if (tile.plant) return this._fail(task, 'occupied');
    } else if (task.type === TaskType.TILL) {
      if (tile.type === TileType.WATER) return this._fail(task, 'onWater');
    } else if (task.type === TaskType.WATER) {
      const p = tile.plant;
      if (!p || p.kind !== 'crop' || p.withered) return this._fail(task, 'noCrop');
    } else if (task.type === TaskType.MOVE) {
      if (tile.type === TileType.WATER) return this._fail(task, 'onWater');
    }

    const anchor = this._anchor();
    const path = findPath(map, anchor, { x: task.x, y: task.y });
    if (!path) return this._fail(task, 'unreachable');
    this.path = [anchor, ...path];
    this.state = 'walking';
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
  update(dt) {
    this.eatTimer += dt;
    const task = this.currentTask;
    if (!task) {
      this.state = 'idle';
      return;
    }
    if (task.status === 'done' || task.status === 'failed') return;

    if (this.path.length > 0) {
      this.state = task.type === TaskType.LEISURE ? 'strolling' : 'walking';
      this._walk(dt);
      return;
    }
    // Arrived — spend the task's work phase, if it has one.
    const dur = WORK_PHASE[task.type] || 0;
    if (dur <= 0) {
      task.status = 'done';
      return;
    }
    this.state = WORK_STATE[task.type] || 'working';
    this.workTimer += dt;
    if (this.workTimer >= dur) task.status = 'done';
  }
}
