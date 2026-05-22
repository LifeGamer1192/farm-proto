// The game: owns the map, camera, colonist, task queue, crops and food
// store, and runs the frame loop. It hands the colonist one task at a
// time, applies the effect of each finished task, grows sown crops, and
// feeds the colonist at a fixed interval.
//
// Game speed scales the simulation only (not camera panning). Map zoom
// changes the tile size, and thus how many tiles fit on the fixed canvas.

import {
  GRID_COLS,
  GRID_ROWS,
  CANVAS_W,
  CANVAS_H,
  ZOOM_LEVELS,
  DEFAULT_ZOOM,
  SPEED_LEVELS,
  DEFAULT_SPEED,
  CAMERA_SPEED,
  TASK_LOG_SIZE,
  EAT_INTERVAL,
} from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { TileType } from './map/tile.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Colonist } from './entities/colonist.js';
import { TaskType, TASK_LABELS, createTask } from './tasks.js';
import { scatterPlants, PlantKind } from './world.js';
import { getCrop, cropSuitability, survivalChance } from './crops.js';
import {
  clockInfo,
  temperatureAt,
  daylightAt,
  tempGrowthFactor,
  sunGrowthFactor,
  SEASON_TINT,
} from './season.js';

const FOOD_TYPES = ['forage', 'wheat', 'potato', 'bean'];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.renderer = new Renderer(canvas);

    this.viewMode = 'terrain';
    this.panDir = { x: 0, y: 0 }; // from on-screen arrows
    this.keys = new Set(); // held WASD keys
    this.hover = null;

    this.zoomIndex = DEFAULT_ZOOM;
    this.tileSize = ZOOM_LEVELS[DEFAULT_ZOOM].tile;
    this.speedIndex = DEFAULT_SPEED;

    this.map = null;
    this.camera = null;
    this.colonist = null;
    this.stats = null;

    this.taskQueue = [];
    this.crops = []; // sown crops still growing or ripe
    this.storage = { forage: 0, wheat: 0, potato: 0, bean: 0 };
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0; // crops that withered before harvest
    this.eatTimer = 0;
    this.log = []; // recent events, newest first
    this.lastAssignReason = '';

    this.clock = 0; // elapsed sim-seconds — drives the seasons
    this.environment = null; // {year, season, day, temperature, daylight, ...}
    this._seasonEvent = null; // a season name when the season just changed

    this._loop = this._loop.bind(this);
    this._lastTime = 0;
  }

  get seed() {
    return this.map.seed;
  }

  get speed() {
    return SPEED_LEVELS[this.speedIndex];
  }

  get totalFood() {
    return FOOD_TYPES.reduce((sum, t) => sum + this.storage[t], 0);
  }

  get nextMealIn() {
    return Math.max(0, EAT_INTERVAL - this.eatTimer);
  }

  // How many tiles fit across / down the canvas at the current zoom.
  _viewCols() {
    return Math.round(CANVAS_W / this.tileSize);
  }
  _viewRows() {
    return Math.round(CANVAS_H / this.tileSize);
  }

  /** Generate a fresh map, scatter plants, and place the colonist. */
  newMap(seed) {
    this.map = generateMap(GRID_COLS, GRID_ROWS, seed);
    scatterPlants(this.map);
    this.stats = mapStats(this.map);
    this.camera = new Camera(this._viewCols(), this._viewRows(), GRID_COLS, GRID_ROWS);
    const spawn = this._findSpawn();
    this.colonist = new Colonist(spawn.x, spawn.y);
    this.camera.centerOn(spawn.x + 0.5, spawn.y + 0.5);

    this.taskQueue = [];
    this.crops = [];
    this.storage = { forage: 0, wheat: 0, potato: 0, bean: 0 };
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0; // crops that withered before harvest
    this.eatTimer = 0;
    this.log = [];
    this.lastAssignReason = 'No tasks queued yet.';
    this.hover = null;
    this.clock = 0;
    this._seasonEvent = null;
    this._updateEnvironment();
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

  /** Set the game-speed level (index into SPEED_LEVELS). */
  setSpeed(index) {
    this.speedIndex = Math.max(0, Math.min(SPEED_LEVELS.length - 1, index));
  }

  /** Set the map-zoom level (index into ZOOM_LEVELS). */
  setZoom(index) {
    this.zoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
    this.tileSize = ZOOM_LEVELS[this.zoomIndex].tile;
    this.camera.resize(this._viewCols(), this._viewRows());
  }

  /**
   * Queue a task at a tile, if it makes sense there.
   * @returns {boolean} true if a task was queued.
   */
  enqueueTask(type, x, y, cropId = null) {
    const row = this.map.tiles[y];
    const tile = row && row[x];
    if (!tile) return false;
    if (type === TaskType.MOVE && tile.type === TileType.WATER) return false;
    if (type === TaskType.HARVEST && !tile.plant) return false;
    if (type === TaskType.SOW && (tile.type === TileType.WATER || tile.plant)) {
      return false;
    }
    this.taskQueue.push(createTask(type, x, y, cropId));
    return true;
  }

  clearTasks() {
    this.taskQueue = [];
    this.lastAssignReason = 'Task queue cleared.';
  }

  centerOnColonist() {
    this.camera.centerOn(this.colonist.x + 0.5, this.colonist.y + 0.5);
  }

  // Recompute the calendar and weather from the clock.
  _updateEnvironment() {
    const info = clockInfo(this.clock);
    info.temperature = temperatureAt(info.yearProgress);
    info.daylight = daylightAt(info.yearProgress);
    this.environment = info;
  }

  /** Return the season name if it changed since the last call, else null. */
  consumeSeasonChange() {
    const s = this._seasonEvent;
    this._seasonEvent = null;
    return s;
  }

  _pushLog(entry) {
    this.log.unshift(entry);
    if (this.log.length > TASK_LOG_SIZE) this.log.pop();
  }

  _logTask(task) {
    const where = `${TASK_LABELS[task.type]} (${task.x}, ${task.y})`;
    if (task.status === 'done') {
      this._pushLog({ icon: '✓', text: `${where} — ${task.outcome}`, cls: 'log-ok' });
    } else {
      this._pushLog({ icon: '✗', text: `${where} — ${task.outcome}`, cls: 'log-fail' });
    }
  }

  // Apply the world effect of a task the colonist has completed.
  _applyTaskEffect(task) {
    const tile = this.map.tiles[task.y][task.x];
    if (task.type === TaskType.HARVEST) {
      const plant = tile.plant;
      if (plant && plant.kind === PlantKind.CROP) {
        if (plant.withered) {
          task.outcome = 'cleared dead crop';
        } else {
          const crop = getCrop(plant.cropId);
          this.storage[plant.cropId] += crop.yield;
          task.outcome = `${crop.label} +${crop.yield}`;
        }
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
      } else if (plant) {
        this.storage.forage += 1;
        task.outcome = 'foraged +1';
      }
      tile.plant = null;
    } else if (task.type === TaskType.SOW) {
      // Initial crops are weak: roll once whether this one survives, from
      // how well the tile suits it. A doomed crop withers partway to ripe.
      const cropDef = getCrop(task.cropId);
      const suitability = cropSuitability(cropDef, tile);
      const doomed = Math.random() >= survivalChance(suitability);
      const crop = {
        kind: PlantKind.CROP,
        cropId: task.cropId,
        growth: 0,
        x: task.x,
        y: task.y,
        suitability,
        doomed,
        witherAt: doomed ? 0.3 + Math.random() * 0.5 : 1,
        withered: false,
      };
      tile.plant = crop;
      this.crops.push(crop);
      task.outcome = `sowed ${cropDef.label}`;
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

  // Advance every growing crop; doomed ones wither before they ripen.
  // Growth speed depends on temperature and on each tile's sunlight.
  _growCrops(dt) {
    const env = this.environment;
    const tempFactor = tempGrowthFactor(env.temperature);
    for (let i = this.crops.length - 1; i >= 0; i--) {
      const crop = this.crops[i];
      const tile = this.map.tiles[crop.y][crop.x];
      const rate = tempFactor * sunGrowthFactor(tile.sunlight, env.daylight);
      crop.growth = Math.min(
        1,
        crop.growth + (dt / getCrop(crop.cropId).growthTime) * rate,
      );
      if (crop.doomed && crop.growth >= crop.witherAt) {
        // A weak crop has failed — it stays as a husk to be cleared.
        crop.withered = true;
        this.crops.splice(i, 1);
        this.cropsLost += 1;
        this._pushLog({
          icon: '✗',
          text: `${getCrop(crop.cropId).label} (${crop.x}, ${crop.y}) withered`,
          cls: 'log-fail',
        });
      }
    }
  }

  // Feed the colonist on a fixed timer (hunger as a stat arrives later).
  _updateEating(dt) {
    this.eatTimer += dt;
    if (this.eatTimer < EAT_INTERVAL) return;
    this.eatTimer -= EAT_INTERVAL;

    let pick = null;
    for (const t of FOOD_TYPES) {
      if (this.storage[t] > 0 && (pick === null || this.storage[t] > this.storage[pick])) {
        pick = t;
      }
    }
    if (pick) {
      this.storage[pick] -= 1;
      this.meals.eaten += 1;
      this._pushLog({ icon: '🍴', text: `Colonist ate ${pick}`, cls: 'log-meal' });
    } else {
      this.meals.missed += 1;
      this._pushLog({ icon: '⚠', text: 'No food — colonist went hungry', cls: 'log-warn' });
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

  update(realDt) {
    // Camera panning uses real time — it must not speed up with the game.
    const { dx, dy } = this._panVector();
    if (dx !== 0 || dy !== 0) {
      this.camera.pan(dx * CAMERA_SPEED * realDt, dy * CAMERA_SPEED * realDt);
    }
    // The simulation runs at the chosen game speed.
    const simDt = realDt * this.speed;
    this.clock += simDt;
    const prevSeason = this.environment.seasonIndex;
    this._updateEnvironment();
    if (this.environment.seasonIndex !== prevSeason) {
      this._seasonEvent = this.environment.season;
    }
    this._updateTasks();
    this.colonist.update(simDt, this.map);
    this._growCrops(simDt);
    this._updateEating(simDt);
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
      tileSize: this.tileSize,
      seasonTint: SEASON_TINT[this.environment.season],
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
