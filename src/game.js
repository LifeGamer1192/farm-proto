// The game: owns the map, camera, colonists, animals, task queue, crops
// and food store, and runs the frame loop.
//
// Several colonists share one work queue. Each runs a small priority AI:
// eat when hungry, else take queued work (a miserable colonist may slack),
// else do a personal task. Wild animals stroll the map and harry the
// colonists; colonists can hunt them. If every colonist falls, the colony
// is lost.

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
  COLONIST_COUNT,
  COLONIST_NAMES,
  TILL_SURVIVAL_BONUS,
  WATER_DURATION,
  WATER_GROWTH_BONUS,
  EAT_THRESHOLD,
  EAT_RETRY,
  ANIMAL_COUNT,
  ANIMAL_DAMAGE,
  ANIMAL_ATTACK_INTERVAL,
  ANIMAL_ATTACK_RANGE,
  HUNT_RANGE,
  MEAT_YIELD,
} from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { TileType } from './map/tile.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Colonist } from './entities/colonist.js';
import { Animal } from './entities/animal.js';
import { TaskType, WORK_TYPES, createTask } from './tasks.js';
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
import { t } from './i18n.js';

const FOOD_TYPES = ['forage', 'wheat', 'potato', 'bean', 'meat'];

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;
    this.renderer = new Renderer(canvas);

    this.viewMode = 'terrain';
    this.panDir = { x: 0, y: 0 };
    this.keys = new Set();
    this.hover = null;

    this.zoomIndex = DEFAULT_ZOOM;
    this.tileSize = ZOOM_LEVELS[DEFAULT_ZOOM].tile;
    this.speedIndex = DEFAULT_SPEED;

    this.map = null;
    this.camera = null;
    this.colonists = [];
    this.animals = [];
    this.stats = null;
    this.over = false;

    this.taskQueue = [];
    this.crops = [];
    this.storage = { forage: 0, wheat: 0, potato: 0, bean: 0, meat: 0 };
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0;
    this.log = [];
    this.lastAssignReason = '';

    this.clock = 0;
    this.environment = null;
    this._seasonEvent = null;

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
    return FOOD_TYPES.reduce((sum, ft) => sum + this.storage[ft], 0);
  }
  // Colonists currently on a player work task.
  get busyColonists() {
    return this.colonists.filter(
      (c) => c.currentTask && WORK_TYPES.includes(c.currentTask.type),
    ).length;
  }

  _viewCols() {
    return Math.round(CANVAS_W / this.tileSize);
  }
  _viewRows() {
    return Math.round(CANVAS_H / this.tileSize);
  }

  /** Generate a fresh map, scatter plants, and place colonists and animals. */
  newMap(seed) {
    this.map = generateMap(GRID_COLS, GRID_ROWS, seed);
    scatterPlants(this.map);
    this.stats = mapStats(this.map);
    this.camera = new Camera(this._viewCols(), this._viewRows(), GRID_COLS, GRID_ROWS);

    const spawns = this._findSpawns(COLONIST_COUNT);
    this.colonists = spawns.map(
      (s, i) => new Colonist(s.x, s.y, COLONIST_NAMES[i] || `C${i + 1}`),
    );
    this.animals = this._randomLandTiles(ANIMAL_COUNT).map(
      (s, i) => new Animal(s.x, s.y, i + 1),
    );
    this.camera.centerOn(spawns[0].x + 0.5, spawns[0].y + 0.5);

    this.taskQueue = [];
    this.crops = [];
    this.storage = { forage: 0, wheat: 0, potato: 0, bean: 0, meat: 0 };
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0;
    this.over = false;
    this.log = [];
    this.lastAssignReason = t('reason.start');
    this.hover = null;
    this.clock = 0;
    this._seasonEvent = null;
    this._updateEnvironment();
  }

  // The n nearest land tiles to the map center.
  _findSpawns(n) {
    const cx = (this.map.cols / 2) | 0;
    const cy = (this.map.rows / 2) | 0;
    const spawns = [];
    const maxR = Math.max(this.map.cols, this.map.rows);
    for (let r = 0; r <= maxR && spawns.length < n; r++) {
      for (let dy = -r; dy <= r && spawns.length < n; dy++) {
        for (let dx = -r; dx <= r && spawns.length < n; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) continue;
          if (this.map.tiles[y][x].type === TileType.LAND) spawns.push({ x, y });
        }
      }
    }
    while (spawns.length < n) spawns.push({ x: cx, y: cy });
    return spawns;
  }

  // n random land tiles anywhere on the map (for scattering animals).
  _randomLandTiles(n) {
    const tiles = [];
    let guard = 0;
    while (tiles.length < n && guard++ < 4000) {
      const x = (Math.random() * this.map.cols) | 0;
      const y = (Math.random() * this.map.rows) | 0;
      if (this.map.tiles[y][x].type === TileType.LAND) tiles.push({ x, y });
    }
    return tiles;
  }

  setSpeed(index) {
    this.speedIndex = Math.max(0, Math.min(SPEED_LEVELS.length - 1, index));
  }

  setZoom(index) {
    this.zoomIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index));
    this.tileSize = ZOOM_LEVELS[this.zoomIndex].tile;
    this.camera.resize(this._viewCols(), this._viewRows());
  }

  centerOnColonist() {
    const c = this.colonists[0];
    if (c) this.camera.centerOn(c.x + 0.5, c.y + 0.5);
  }

  _updateEnvironment() {
    const info = clockInfo(this.clock);
    info.temperature = temperatureAt(info.yearProgress);
    info.daylight = daylightAt(info.yearProgress);
    this.environment = info;
  }

  consumeSeasonChange() {
    const s = this._seasonEvent;
    this._seasonEvent = null;
    return s;
  }

  // The animal nearest to a tile, within `range` tiles (or null).
  _animalNear(x, y, range) {
    let best = range;
    let found = null;
    for (const a of this.animals) {
      const d = Math.hypot(a.x - x, a.y - y);
      if (d <= best) {
        best = d;
        found = a;
      }
    }
    return found;
  }

  /** Queue a work task at a tile, if it makes sense there. */
  enqueueTask(type, x, y, cropId = null) {
    const tile = this.map.tiles[y] && this.map.tiles[y][x];
    if (!tile) return false;
    if (type === TaskType.MOVE && tile.type === TileType.WATER) return false;
    if (type === TaskType.HARVEST && !tile.plant) return false;
    if (type === TaskType.SOW && (tile.type === TileType.WATER || tile.plant)) return false;
    if (type === TaskType.TILL && tile.type === TileType.WATER) return false;
    if (type === TaskType.WATER) {
      const p = tile.plant;
      if (!p || p.kind !== PlantKind.CROP || p.withered) return false;
    }
    if (type === TaskType.HUNT) {
      const animal = this._animalNear(x, y, 1.6);
      if (!animal) return false;
      this.taskQueue.push(
        createTask(TaskType.HUNT, animal.tileX, animal.tileY, null, animal.id),
      );
      return true;
    }
    this.taskQueue.push(createTask(type, x, y, cropId));
    return true;
  }

  clearTasks() {
    this.taskQueue = [];
    this.lastAssignReason = t('reason.cleared');
  }

  _pushLog(entry) {
    this.log.unshift(entry);
    if (this.log.length > TASK_LOG_SIZE) this.log.pop();
  }

  _outcomeText(task) {
    const params = {};
    const d = task.outcomeData;
    if (d) {
      if (d.crop) params.crop = t('crop.' + d.crop);
      if (d.animal) params.animal = t('animal.' + d.animal);
      if (d.n !== undefined) params.n = d.n;
    }
    return t('out.' + (task.outcome || 'arrived'), params);
  }

  // Log only the player's work tasks; personal tasks would flood the log.
  _logWorkTask(task) {
    if (!WORK_TYPES.includes(task.type)) return;
    const where = `${t('task.' + task.type)} (${task.x}, ${task.y})`;
    this._pushLog({
      icon: task.status === 'done' ? '✓' : '✗',
      text: `${where} — ${this._outcomeText(task)}`,
      cls: task.status === 'done' ? 'log-ok' : 'log-fail',
    });
  }

  // Feed a colonist from the shared store (called when an eat task ends).
  _feed(colonist) {
    colonist.eatCooldown = EAT_RETRY;
    let pick = null;
    for (const ft of FOOD_TYPES) {
      if (this.storage[ft] > 0 && (pick === null || this.storage[ft] > this.storage[pick])) {
        pick = ft;
      }
    }
    if (pick) {
      this.storage[pick] -= 1;
      colonist.hunger = 0;
      this.meals.eaten += 1;
      this._pushLog({ icon: '🍴', text: t('log.ate', { name: colonist.name }), cls: 'log-meal' });
    } else {
      this.meals.missed += 1;
      this._pushLog({
        icon: '⚠',
        text: t('log.hungry', { name: colonist.name }),
        cls: 'log-warn',
      });
    }
  }

  // Apply the world effect of a completed task.
  _applyTaskEffect(task, colonist) {
    const tile = this.map.tiles[task.y][task.x];
    if (task.type === TaskType.HARVEST) {
      const plant = tile.plant;
      if (plant && plant.kind === PlantKind.CROP) {
        if (plant.withered) {
          task.outcome = 'cleared';
        } else {
          const crop = getCrop(plant.cropId);
          this.storage[plant.cropId] += crop.yield;
          task.outcome = 'harvested';
          task.outcomeData = { crop: plant.cropId, n: crop.yield };
        }
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
      } else if (plant) {
        this.storage.forage += 1;
        task.outcome = 'foraged';
      }
      tile.plant = null;
    } else if (task.type === TaskType.SOW) {
      const cropDef = getCrop(task.cropId);
      const suitability = cropSuitability(cropDef, tile);
      const bonus = tile.tilled ? TILL_SURVIVAL_BONUS : 0;
      const doomed = Math.random() >= survivalChance(suitability, bonus);
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
        wateredUntil: 0,
      };
      tile.plant = crop;
      this.crops.push(crop);
      task.outcome = 'sowed';
      task.outcomeData = { crop: task.cropId };
    } else if (task.type === TaskType.TILL) {
      tile.tilled = true;
      task.outcome = 'tilled';
    } else if (task.type === TaskType.WATER) {
      const p = tile.plant;
      if (p && p.kind === PlantKind.CROP && !p.withered) {
        p.wateredUntil = this.clock + WATER_DURATION;
      }
      task.outcome = 'watered';
    } else if (task.type === TaskType.HUNT) {
      const idx = this.animals.findIndex((a) => a.id === task.animalId);
      const a = idx >= 0 ? this.animals[idx] : null;
      if (a && Math.hypot(a.x - task.x, a.y - task.y) <= HUNT_RANGE) {
        this.animals.splice(idx, 1);
        this.storage.meat += MEAT_YIELD;
        task.outcome = 'hunted';
        task.outcomeData = { animal: 'boar', n: MEAT_YIELD };
      } else {
        task.outcome = 'gotAway';
      }
    } else if (task.type === TaskType.EAT) {
      this._feed(colonist);
    } else {
      task.outcome = 'arrived';
    }
  }

  // Priority AI: decide a colonist's next task.
  _assignColonist(colonist) {
    if (colonist.hunger >= EAT_THRESHOLD && colonist.eatCooldown <= 0) {
      return createTask(TaskType.EAT, colonist.tileX, colonist.tileY);
    }
    // A content colonist works; a miserable one may slack off instead.
    const willWork = colonist.mood >= 0.3 || Math.random() < 0.5;
    if (this.taskQueue.length > 0 && willWork) {
      const task = this.taskQueue.shift();
      this.lastAssignReason = t('reason.queued', {
        task: t('task.' + task.type),
        x: task.x,
        y: task.y,
      });
      return task;
    }
    return this._idleTask(colonist);
  }

  // A personal idle task — rest, sleep, or stroll to a nearby tile.
  _idleTask(colonist) {
    const r = Math.random();
    if (r < 0.12) return createTask(TaskType.SLEEP, colonist.tileX, colonist.tileY);
    if (r < 0.4) return createTask(TaskType.REST, colonist.tileX, colonist.tileY);
    for (let i = 0; i < 14; i++) {
      const tx = colonist.tileX + Math.floor((Math.random() * 2 - 1) * 9);
      const ty = colonist.tileY + Math.floor((Math.random() * 2 - 1) * 9);
      const row = this.map.tiles[ty];
      if (row && row[tx] && row[tx].type === TileType.LAND) {
        return createTask(TaskType.LEISURE, tx, ty);
      }
    }
    return createTask(TaskType.REST, colonist.tileX, colonist.tileY);
  }

  _updateColonists(dt) {
    for (const c of this.colonists) {
      const task = c.currentTask;
      if (task && (task.status === 'done' || task.status === 'failed')) {
        if (task.status === 'done') this._applyTaskEffect(task, c);
        this._logWorkTask(task);
        c.currentTask = null;
      }
      if (!c.currentTask) {
        c.assignTask(this._assignColonist(c), this.map);
        if (c.currentTask && c.currentTask.status === 'failed') {
          this._logWorkTask(c.currentTask);
          c.currentTask = null;
        }
      }
      c.update(dt);
    }
    // Carry off the fallen.
    if (this.colonists.some((c) => c.dead)) {
      for (const c of this.colonists) {
        if (c.dead) {
          this._pushLog({ icon: '☠', text: t('log.died', { name: c.name }), cls: 'log-fail' });
        }
      }
      this.colonists = this.colonists.filter((c) => !c.dead);
      if (this.colonists.length === 0) this.over = true;
    }
    if (this.taskQueue.length === 0 && this.busyColonists === 0) {
      this.lastAssignReason = t('reason.idle');
    }
  }

  // Animals stroll, and on a cooldown harry a nearby colonist.
  _updateAnimals(dt) {
    for (const a of this.animals) {
      a.update(dt, this.map);
      if (a.attackCooldown > 0) continue;
      let victim = null;
      let best = ANIMAL_ATTACK_RANGE;
      for (const c of this.colonists) {
        const d = Math.hypot(c.x - a.x, c.y - a.y);
        if (d < best) {
          best = d;
          victim = c;
        }
      }
      if (victim) {
        victim.hurt(ANIMAL_DAMAGE);
        a.attackCooldown = ANIMAL_ATTACK_INTERVAL;
        this._pushLog({
          icon: '⚔',
          text: t('log.attacked', { animal: t('animal.boar'), name: victim.name }),
          cls: 'log-warn',
        });
      }
    }
  }

  // Advance every growing crop; doomed ones wither before they ripen.
  _growCrops(dt) {
    const env = this.environment;
    const tempFactor = tempGrowthFactor(env.temperature);
    for (let i = this.crops.length - 1; i >= 0; i--) {
      const crop = this.crops[i];
      const tile = this.map.tiles[crop.y][crop.x];
      let rate = tempFactor * sunGrowthFactor(tile.sunlight, env.daylight);
      if (this.clock < crop.wateredUntil) rate *= WATER_GROWTH_BONUS;
      crop.growth = Math.min(
        1,
        crop.growth + (dt / getCrop(crop.cropId).growthTime) * rate,
      );
      if (crop.doomed && crop.growth >= crop.witherAt) {
        crop.withered = true;
        this.crops.splice(i, 1);
        this.cropsLost += 1;
        this._pushLog({
          icon: '✗',
          text: t('log.withered', {
            crop: t('crop.' + crop.cropId),
            x: crop.x,
            y: crop.y,
          }),
          cls: 'log-fail',
        });
      }
    }
  }

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
    const { dx, dy } = this._panVector();
    if (dx !== 0 || dy !== 0) {
      this.camera.pan(dx * CAMERA_SPEED * realDt, dy * CAMERA_SPEED * realDt);
    }
    const simDt = realDt * this.speed;
    this.clock += simDt;
    const prevSeason = this.environment.seasonIndex;
    this._updateEnvironment();
    if (this.environment.seasonIndex !== prevSeason) {
      this._seasonEvent = this.environment.season;
    }
    this._updateColonists(simDt);
    this._updateAnimals(simDt);
    this._growCrops(simDt);
  }

  render() {
    this.renderer.draw({
      map: this.map,
      camera: this.camera,
      mode: this.viewMode,
      colonists: this.colonists,
      animals: this.animals,
      hover: this.hover,
      taskQueue: this.taskQueue,
      tileSize: this.tileSize,
      seasonTint: SEASON_TINT[this.environment.season],
      clock: this.clock,
    });
  }

  _loop(time) {
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
