// The game: owns the map, camera, colonist and task queue, and runs the
// frame loop. It hands the colonist one task at a time and applies the
// effect of each finished task.

import {
  GRID_COLS,
  GRID_ROWS,
  VIEW_COLS,
  VIEW_ROWS,
  TILE_SIZE,
  CAMERA_SPEED,
  TASK_LOG_SIZE,
} from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { TileType } from './map/tile.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Colonist } from './entities/colonist.js';
import { TaskType, TASK_LABELS, createTask } from './tasks.js';
import { scatterPlants, PlantKind } from './world.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = VIEW_COLS * TILE_SIZE;
    canvas.height = VIEW_ROWS * TILE_SIZE;
    this.renderer = new Renderer(canvas, TILE_SIZE);

    this.viewMode = 'terrain';
    this.panDir = { x: 0, y: 0 }; // from on-screen arrows
    this.keys = new Set(); // held WASD keys
    this.hover = null;

    this.map = null;
    this.camera = null;
    this.colonist = null;
    this.stats = null;

    this.taskQueue = [];
    this.resources = { harvested: 0, planted: 0 };
    this.taskLog = []; // recent finished tasks, newest first
    this.lastAssignReason = '';

    this._loop = this._loop.bind(this);
    this._lastTime = 0;
  }

  get seed() {
    return this.map.seed;
  }

  /** Generate a fresh map, scatter plants, and place the colonist. */
  newMap(seed) {
    this.map = generateMap(GRID_COLS, GRID_ROWS, seed);
    scatterPlants(this.map);
    this.stats = mapStats(this.map);
    this.camera = new Camera(VIEW_COLS, VIEW_ROWS, GRID_COLS, GRID_ROWS);
    const spawn = this._findSpawn();
    this.colonist = new Colonist(spawn.x, spawn.y);
    this.camera.centerOn(spawn.x + 0.5, spawn.y + 0.5);

    this.taskQueue = [];
    this.resources = { harvested: 0, planted: 0 };
    this.taskLog = [];
    this.lastAssignReason = 'No tasks queued yet.';
    this.hover = null;
  }

  // Nearest land tile to the map center (outward ring search).
  _findSpawn() {
    const cx = (this.map.cols / 2) | 0;
    const cy = (this.map.rows / 2) | 0;
    const maxR = Math.max(this.map.cols, this.map.rows);
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) continue;
          if (this.map.tiles[y][x].type === TileType.LAND) return { x, y };
        }
      }
    }
    return { x: cx, y: cy };
  }

  /**
   * Queue a task of the given tool type at a tile, if it makes sense there.
   * @returns {boolean} true if a task was queued.
   */
  enqueueTask(type, x, y) {
    const row = this.map.tiles[y];
    const tile = row && row[x];
    if (!tile) return false;
    if (type === TaskType.MOVE && tile.type === TileType.WATER) return false;
    if (type === TaskType.HARVEST && !tile.plant) return false;
    if (type === TaskType.PLANT && (tile.type === TileType.WATER || tile.plant)) {
      return false;
    }
    this.taskQueue.push(createTask(type, x, y));
    return true;
  }

  clearTasks() {
    this.taskQueue = [];
    this.lastAssignReason = 'Task queue cleared.';
  }

  centerOnColonist() {
    this.camera.centerOn(this.colonist.x + 0.5, this.colonist.y + 0.5);
  }

  _logTask(task) {
    this.taskLog.unshift(task);
    if (this.taskLog.length > TASK_LOG_SIZE) this.taskLog.pop();
  }

  // Apply the world effect of a task the colonist has completed.
  _applyTaskEffect(task) {
    const tile = this.map.tiles[task.y][task.x];
    if (task.type === TaskType.HARVEST) {
      if (tile.plant) {
        tile.plant = null;
        this.resources.harvested++;
      }
      task.outcome = 'harvested';
    } else if (task.type === TaskType.PLANT) {
      tile.plant = { kind: PlantKind.CROP };
      this.resources.planted++;
      task.outcome = 'planted';
    } else {
      task.outcome = 'arrived';
    }
  }

  // Collect a finished task and hand the colonist the next one.
  _updateTasks() {
    const c = this.colonist;

    if (c.currentTask && (c.currentTask.status === 'done' || c.currentTask.status === 'failed')) {
      if (c.currentTask.status === 'done') this._applyTaskEffect(c.currentTask);
      this._logTask(c.currentTask);
      c.currentTask = null;
    }

    // Assign the next task, skipping any that fail validation outright.
    let guard = 0;
    while (!c.currentTask && this.taskQueue.length > 0 && guard++ < 64) {
      const task = this.taskQueue.shift();
      this.lastAssignReason =
        `Picked ${TASK_LABELS[task.type]} (${task.x}, ${task.y}): ` +
        `first in queue, ${this.taskQueue.length} still waiting (FIFO order).`;
      c.assignTask(task, this.map);
      if (c.currentTask && c.currentTask.status === 'failed') {
        this._logTask(c.currentTask);
        c.currentTask = null;
      }
    }

    if (!c.currentTask && this.taskQueue.length === 0) {
      this.lastAssignReason = 'No tasks queued — the colonist wanders on its own.';
    }
  }

  // Combined pan direction from on-screen arrows and held WASD keys.
  _panVector() {
    let dx = this.panDir.x;
    let dy = this.panDir.y;
    if (this.keys.has('a')) dx -= 1;
    if (this.keys.has('d')) dx += 1;
    if (this.keys.has('w')) dy -= 1;
    if (this.keys.has('s')) dy += 1;
    return { dx, dy };
  }

  update(dt) {
    const { dx, dy } = this._panVector();
    if (dx !== 0 || dy !== 0) {
      this.camera.pan(dx * CAMERA_SPEED * dt, dy * CAMERA_SPEED * dt);
    }
    this._updateTasks();
    this.colonist.update(dt, this.map);
  }

  render() {
    this.renderer.draw({
      map: this.map,
      camera: this.camera,
      mode: this.viewMode,
      colonist: this.colonist,
      hover: this.hover,
      taskQueue: this.taskQueue,
      currentTask: this.colonist.currentTask,
    });
  }

  _loop(time) {
    // Clamp dt so a backgrounded tab doesn't produce a huge jump.
    const dt = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;
    this.update(dt);
    this.render();
    requestAnimationFrame(this._loop);
  }

  start() {
    this._lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }
}
