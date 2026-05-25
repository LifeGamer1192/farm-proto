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
  HUT_RANGE,
  HUT_MOOD_BONUS,
  PEST_INTERVAL,
  PEST_BITE,
  WILD_WOOD_YIELD,
  WOOD_BURN_RATE,
  HEARTH_RANGE,
  COLD_THRESHOLD,
  COLD_DAMAGE,
  COLD_MOOD_DROP,
  COOK_BATCH,
  MEAL_MOOD_BONUS,
  AUTO_HUNT_RANGE,
  HUNT_FOOD_PER_HEAD,
  MEAL_TARGET,
  SEED_START_COUNT,
  SEEDS_PER_HARVEST,
  STOCKPILE_CAP,
  ON_HAND_CAP,
  ON_HAND_LOW,
  HAUL_BATCH,
  AUTO_SEARCH_RANGE,
  FENCE_TRIGGER_RANGE,
  FENCE_AUTO_CAP,
  FENCE_PLAN_LENGTH,
  FENCE_REPLAN_COOLDOWN,
} from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { TileType } from './map/tile.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Colonist } from './entities/colonist.js';
import { Animal } from './entities/animal.js';
import { TaskType, WORK_TYPES, createTask } from './tasks.js';
import { scatterPlants, PlantKind } from './world.js';
import { getCrop, cropSuitability, survivalChance, isRipe, CROP_IDS } from './crops.js';
import {
  freshGenome,
  crossGenomes,
  qualityRank,
  genomeQuality,
  survivalGeneBonus,
  yieldMult,
  vigorMult,
  coldGrowthFactor,
} from './genetics.js';
import {
  clockInfo,
  temperatureAt,
  daylightAt,
  tempGrowthFactor,
  sunGrowthFactor,
  SEASON_TINT,
} from './season.js';
import { t } from './i18n.js';

// Raw food — what pests can spoil and what a cook task turns into meals.
// 'forage' is the catch-all for wild gatherings; every crop becomes its own
// food entry; 'meat' comes from hunting.
const FOOD_TYPES = ['forage', ...CROP_IDS, 'meat'];
// Everything a stockpile can hold: raw food plus cooked meals.
export const STOCKPILE_ITEMS = [...FOOD_TYPES, 'meal'];

// Built-in nutrition for the non-crop foods.
const NUTRITION = { forage: 0.2, meat: 0.55, meal: 0.6 };
function nutritionOf(foodId) {
  if (NUTRITION[foodId] !== undefined) return NUTRITION[foodId];
  const crop = getCrop(foodId);
  return crop ? crop.nutrition : 0.3;
}

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
    this.hearths = []; // built hearth positions {x, y}
    this.stockpiles = []; // built stockpiles: {x, y, items}
    this.huts = []; // built hut positions {x, y}
    this.fences = []; // built fence positions {x, y}
    // One colony-wide wall plan at a time. Every idle colonist serves the
    // same list of tiles, so the wall ends up a coherent row instead of a
    // scatter of one-tile detours that follow the animal step by step.
    this.fencePlan = null;
    this.fencePlanAt = -Infinity; // clock time of the last plan (for cooldown)
    this.stats = null;
    this.over = false;
    this.won = false; // the colony has survived its first full year
    this._winEvent = false;
    this.paused = false;
    this.autoHunt = true; // idle colonists hunt boar when food runs low
    this.autoMode = true; // idle colonists till, sow and build on their own
    // The colonist new work is addressed to, or null for the whole colony.
    this.selectedColonist = null;

    this.taskQueue = [];
    this.crops = [];
    // The colony's on-hand store — freshly gathered goods. Pests gnaw at it;
    // colonists haul surplus food into stockpiles, the safe vaults.
    this.storage = this._freshStorage();
    // Seed stock per crop — a list of seed objects, each carrying a genome.
    this.seeds = this._freshSeeds();
    // Codex: the origin strain and the best variety bred so far, per crop.
    this.codex = this._freshCodex();
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0;
    this.pestsLost = 0;
    this.pestTimer = 0;
    this._pestEvent = false;
    this._coldEvent = false;
    this._coldActive = false;
    this.log = [];
    this.logRev = 0;
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
  // Raw, uncooked food on hand — what pests can spoil, what a cook task uses.
  get rawFood() {
    return FOOD_TYPES.reduce((sum, ft) => sum + this.storage[ft], 0);
  }
  // All food the colony holds on hand (raw plus cooked meals).
  get onHandFood() {
    return this.rawFood + this.storage.meal;
  }
  // Every food unit the colony owns — on hand and tucked away in stockpiles.
  get totalFood() {
    let n = this.onHandFood;
    for (const sp of this.stockpiles) n += this.stockpileFood(sp);
    return n;
  }

  // A fresh, empty store: every crop, plus the catch-all foods and meals.
  _freshStorage() {
    const s = { wood: 0, meal: 0 };
    for (const id of FOOD_TYPES) s[id] = 0;
    return s;
  }

  // Pick the colony's starting seed assortment — eight random crops, with
  // at least one grain so there is always a staple to plant.
  _pickStartingCrops() {
    const want = 8;
    const grains = CROP_IDS.filter((id) => getCrop(id).category === 'grain');
    const others = CROP_IDS.filter((id) => getCrop(id).category !== 'grain');
    const pick = (pool) => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
    const chosen = [pick([...grains])];
    const pool = [...grains, ...others].filter((id) => !chosen.includes(id));
    while (chosen.length < want && pool.length) chosen.push(pick(pool));
    return chosen;
  }

  // A fresh seed stock: SEED_START_COUNT seeds for each of the (random)
  // starting crops; every other crop starts empty.
  _freshSeeds() {
    const stock = {};
    this.startingCrops = this._pickStartingCrops();
    for (const id of CROP_IDS) {
      const list = [];
      if (this.startingCrops.includes(id)) {
        for (let i = 0; i < SEED_START_COUNT; i++) list.push({ genome: freshGenome() });
      }
      stock[id] = list;
    }
    return stock;
  }

  // A fresh codex: per crop the origin strain (a starting seed) and the best
  // variety bred so far (begins as the best of the starting seeds). Crops
  // not in the starting assortment have no codex entry yet.
  _freshCodex() {
    const codex = {};
    for (const id of CROP_IDS) {
      const list = this.seeds[id];
      if (!list || list.length === 0) continue;
      let best = list[0].genome;
      for (const s of list) {
        if (genomeQuality(s.genome) > genomeQuality(best)) best = s.genome;
      }
      codex[id] = { origin: list[0].genome, best };
    }
    return codex;
  }

  // Note in the codex if this genome is the best variety of its crop yet.
  _recordCodex(cropId, genome) {
    const c = this.codex[cropId];
    if (c && genomeQuality(genome) > genomeQuality(c.best)) c.best = genome;
  }

  _freshStockpileItems() {
    const items = {};
    for (const it of STOCKPILE_ITEMS) items[it] = 0;
    return items;
  }

  /** Number of seeds of a crop in stock. */
  seedCount(cropId) {
    const s = this.seeds[cropId];
    return s ? s.length : 0;
  }

  // The best (highest-quality) seed of a crop in stock, or null.
  bestSeed(cropId) {
    const s = this.seeds[cropId];
    if (!s || s.length === 0) return null;
    let best = s[0];
    for (const seed of s) {
      if (genomeQuality(seed.genome) > genomeQuality(best.genome)) best = seed;
    }
    return best;
  }

  /** Quality rank ★ of the best seed of a crop, or 0 if there are none. */
  bestSeedRank(cropId) {
    const seed = this.bestSeed(cropId);
    return seed ? qualityRank(seed.genome) : 0;
  }

  // Sow tasks for a crop already lined up — queued plus in colonists' hands.
  _pendingSows(cropId) {
    let n = 0;
    for (const task of this.taskQueue) {
      if (task.type === TaskType.SOW && task.cropId === cropId) n++;
    }
    for (const c of this.colonists) {
      const ct = c.currentTask;
      if (ct && ct.type === TaskType.SOW && ct.cropId === cropId) n++;
    }
    return n;
  }

  /** True if a seed of this crop can still be spared for another sow order. */
  canSow(cropId) {
    return this.seedCount(cropId) > this._pendingSows(cropId);
  }

  // Remove and return the best-quality seed of a crop (null if there are none).
  _takeSeed(cropId) {
    const seed = this.bestSeed(cropId);
    if (!seed) return null;
    const list = this.seeds[cropId];
    list.splice(list.indexOf(seed), 1);
    return seed;
  }

  // Add a bred seed to a crop's stock and record it in the codex.
  _addSeed(cropId, genome) {
    const s = this.seeds[cropId];
    if (s) {
      s.push({ genome });
      this._recordCodex(cropId, genome);
    }
  }

  // The same-crop plant pollinating `plant` from an adjacent tile, if any —
  // the second parent for the seeds a harvest breeds.
  _pollenSource(plant) {
    const mates = [];
    for (let dy = -1; dy <= 1; dy++) {
      const row = this.map.tiles[plant.y + dy];
      if (!row) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const p = row[plant.x + dx] && row[plant.x + dx].plant;
        if (p && p.kind === PlantKind.CROP && !p.withered && p.cropId === plant.cropId) {
          mates.push(p);
        }
      }
    }
    return mates.length ? mates[(Math.random() * mates.length) | 0] : null;
  }

  // Breed SEEDS_PER_HARVEST seeds from a harvested crop, crossing it with an
  // adjacent same-crop plant (or self-pollinating). Returns the seed count.
  _gatherSeeds(plant) {
    const mate = this._pollenSource(plant);
    const otherGenome = mate ? mate.genome : plant.genome;
    for (let i = 0; i < SEEDS_PER_HARVEST; i++) {
      const child = crossGenomes(plant.genome, otherGenome);
      this._addSeed(plant.cropId, child.genome);
      if (child.legendary) {
        this._pushLog({
          icon: '✨',
          text: t('log.mutation', { crop: t('crop.' + plant.cropId) }),
          cls: 'log-meal',
        });
      }
    }
    return SEEDS_PER_HARVEST;
  }

  /** The stockpile built on a tile, or null. */
  stockpileAt(x, y) {
    return this.stockpiles.find((sp) => sp.x === x && sp.y === y) || null;
  }

  /** Food units held in one stockpile. */
  stockpileFood(sp) {
    let n = 0;
    for (const it of STOCKPILE_ITEMS) n += sp.items[it];
    return n;
  }

  // The stockpile nearest a colonist that satisfies `pred`, or null.
  _nearestStockpile(colonist, pred) {
    let best = null;
    let bestD = Infinity;
    for (const sp of this.stockpiles) {
      if (!pred(sp)) continue;
      const d = Math.hypot(sp.x - colonist.tileX, sp.y - colonist.tileY);
      if (d < bestD) {
        bestD = d;
        best = sp;
      }
    }
    return best;
  }

  // The on-hand / stockpile food item with the largest count (or null).
  _largestFood(store, items) {
    let pick = null;
    for (const it of items) {
      if (store[it] > 0 && (pick === null || store[it] > store[pick])) pick = it;
    }
    return pick;
  }

  /** Total of an item the colony owns — on hand plus every stockpile. */
  totalItem(it) {
    let n = this.storage[it] || 0;
    for (const sp of this.stockpiles) n += sp.items[it] || 0;
    return n;
  }
  // A hearth warms and cooks only while the colony has firewood to burn.
  get hearthsLit() {
    return this.hearths.length > 0 && this.storage.wood > 0;
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
    this.hearths = [];
    this.stockpiles = [];
    this.huts = [];
    this.fences = [];
    this.fencePlan = null;
    this.fencePlanAt = -Infinity;
    this.storage = this._freshStorage();
    this.seeds = this._freshSeeds();
    this.codex = this._freshCodex();
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0;
    this.pestsLost = 0;
    this.pestTimer = 0;
    this._pestEvent = false;
    this._coldEvent = false;
    this._coldActive = false;
    this.over = false;
    this.won = false;
    this._winEvent = false;
    this.selectedColonist = null;
    this.log = [];
    this.logRev += 1;
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

  // True once after a pest strike — drives a one-shot UI toast.
  consumePestEvent() {
    const e = this._pestEvent;
    this._pestEvent = false;
    return e;
  }

  // True once when a cold snap first bites — drives a one-shot UI toast.
  consumeColdEvent() {
    const e = this._coldEvent;
    this._coldEvent = false;
    return e;
  }

  // True once when the colony first survives a full year — drives the
  // victory screen. The game keeps running afterwards.
  consumeWinEvent() {
    const e = this._winEvent;
    this._winEvent = false;
    return e;
  }

  /** Freeze or resume the simulation. Returns the new paused state. */
  togglePause() {
    this.paused = !this.paused;
    return this.paused;
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

  /**
   * Queue a work task at a tile, if it makes sense there.
   * @param {object} [opts] cropId (SOW), structure (BUILD), assignee (a
   *   colonist name, or null to address the whole colony).
   * @returns {?string} null on success, or an 'err.*' i18n key explaining
   *   why the order could not be placed.
   */
  enqueueTask(type, x, y, opts = {}) {
    const tile = this.map.tiles[y] && this.map.tiles[y][x];
    if (!tile) return 'err.offMap';
    const assignee = opts.assignee || null;
    if (type === TaskType.MOVE) {
      if (tile.type === TileType.WATER) return 'err.onWater';
      if (assignee) {
        this.taskQueue.push(createTask(TaskType.MOVE, x, y, { assignee }));
      } else {
        // "All colonists" + Move: send every colonist to the tile.
        if (this.colonists.length === 0) return 'err.noColonist';
        for (const c of this.colonists) {
          this.taskQueue.push(createTask(TaskType.MOVE, x, y, { assignee: c.name }));
        }
      }
      return null;
    }
    if (type === TaskType.HARVEST && !tile.plant) return 'err.noPlant';
    if (type === TaskType.SOW) {
      if (tile.type === TileType.WATER) return 'err.onWater';
      if (tile.plant) return 'err.occupied';
      // Each sow spends one seed — refuse the order if none can be spared.
      if (!this.canSow(opts.cropId)) return 'err.noSeed';
    }
    if (type === TaskType.TILL && tile.type === TileType.WATER) return 'err.onWater';
    if (type === TaskType.WATER) {
      const p = tile.plant;
      if (!p || p.kind !== PlantKind.CROP || p.withered) return 'err.noCrop';
    }
    if (type === TaskType.COOK && tile.structure !== 'hearth') return 'err.noHearth';
    if (type === TaskType.BUILD) {
      if (tile.type === TileType.WATER) return 'err.onWater';
      if (tile.plant || tile.structure) return 'err.occupied';
      this.taskQueue.push(
        createTask(TaskType.BUILD, x, y, { structure: opts.structure || 'fence', assignee }),
      );
      return null;
    }
    if (type === TaskType.HUNT) {
      const animal = this._animalNear(x, y, 1.6);
      if (!animal) return 'err.noAnimal';
      this.taskQueue.push(
        createTask(TaskType.HUNT, animal.tileX, animal.tileY, { animalId: animal.id, assignee }),
      );
      return null;
    }
    this.taskQueue.push(createTask(type, x, y, { cropId: opts.cropId || null, assignee }));
    return null;
  }

  clearTasks() {
    this.taskQueue = [];
    this.lastAssignReason = t('reason.cleared');
  }

  // Drop every queued (not yet started) task on a tile — the Cancel tool.
  // Returns how many planned tasks were removed.
  cancelTasksAt(x, y) {
    const before = this.taskQueue.length;
    this.taskQueue = this.taskQueue.filter((task) => task.x !== x || task.y !== y);
    return before - this.taskQueue.length;
  }

  _pushLog(entry) {
    this.log.unshift(entry);
    if (this.log.length > TASK_LOG_SIZE) this.log.pop();
    this.logRev += 1;
  }

  _outcomeText(task) {
    const params = {};
    const d = task.outcomeData;
    if (d) {
      if (d.crop) params.crop = t('crop.' + d.crop);
      if (d.animal) params.animal = t('animal.' + d.animal);
      if (d.structure) params.structure = t('structure.' + d.structure);
      if (d.n !== undefined) params.n = d.n;
      if (d.seeds !== undefined) params.seeds = d.seeds;
      if (d.rank !== undefined) params.rank = '★'.repeat(d.rank);
    }
    return t('out.' + (task.outcome || 'arrived'), params);
  }

  // Log colony work tasks; personal tasks and routine hauling would flood it.
  _logWorkTask(task) {
    if (!WORK_TYPES.includes(task.type)) return;
    if (task.type === TaskType.STORE || task.type === TaskType.FETCH) return;
    let where = `${t('task.' + task.type)} (${task.x}, ${task.y})`;
    if (task.assignee) where += ` · ${task.assignee}`;
    this._pushLog({
      icon: task.status === 'done' ? '✓' : '✗',
      text: `${where} — ${this._outcomeText(task)}`,
      cls: task.status === 'done' ? 'log-ok' : 'log-fail',
    });
  }

  // Feed a colonist (called when an eat task ends). A cooked meal is eaten
  // first and lifts the mood; raw food just fills. On-hand food goes first,
  // but a hungry colonist will also help itself straight from a stockpile.
  _feed(colonist) {
    colonist.eatCooldown = EAT_RETRY;
    const name = colonist.name;
    if (this.storage.meal > 0) {
      this.storage.meal -= 1;
      colonist.hunger = 0;
      colonist.mood = Math.min(1, colonist.mood + MEAL_MOOD_BONUS);
      this.meals.eaten += 1;
      this._pushLog({ icon: '🍲', text: t('log.ate', { name }), cls: 'log-meal' });
      return;
    }
    const onHand = this._largestFood(this.storage, FOOD_TYPES);
    if (onHand) {
      this.storage[onHand] -= 1;
      colonist.hunger = 0;
      // A more nutritious raw food lifts the mood a little; a bland one
      // barely budges it. Cooked meals still use the bigger MEAL bonus.
      colonist.mood = Math.min(1, colonist.mood + nutritionOf(onHand) * 0.04);
      this.meals.eaten += 1;
      this._pushLog({ icon: '🍴', text: t('log.ate', { name }), cls: 'log-meal' });
      return;
    }
    const sp = this.stockpiles.find((s) => this.stockpileFood(s) > 0);
    if (sp) {
      const it = sp.items.meal > 0 ? 'meal' : this._largestFood(sp.items, STOCKPILE_ITEMS);
      sp.items[it] -= 1;
      colonist.hunger = 0;
      if (it === 'meal') colonist.mood = Math.min(1, colonist.mood + MEAL_MOOD_BONUS);
      else colonist.mood = Math.min(1, colonist.mood + nutritionOf(it) * 0.04);
      this.meals.eaten += 1;
      this._pushLog({
        icon: it === 'meal' ? '🍲' : '🍴',
        text: t('log.ate', { name }),
        cls: 'log-meal',
      });
      return;
    }
    this.meals.missed += 1;
    this._pushLog({ icon: '⚠', text: t('log.hungry', { name }), cls: 'log-warn' });
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
          const n = Math.max(1, Math.round(crop.yield * yieldMult(plant.genome)));
          this.storage[plant.cropId] += n;
          this._recordCodex(plant.cropId, plant.genome);
          const seeds = this._gatherSeeds(plant);
          task.outcome = 'harvested';
          task.outcomeData = { crop: plant.cropId, n, seeds };
        }
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
      } else if (plant) {
        this.storage.forage += 1;
        this.storage.wood += WILD_WOOD_YIELD;
        task.outcome = 'foraged';
      }
      tile.plant = null;
    } else if (task.type === TaskType.SOW) {
      if (tile.plant) {
        // Another sow won this tile between assignment and now — bail
        // without consuming a seed so we do not orphan the earlier crop.
        task.outcome = 'occupied';
        task.outcomeData = { crop: task.cropId };
        return;
      }
      const seed = this._takeSeed(task.cropId);
      if (!seed) {
        task.outcome = 'noSeed';
        task.outcomeData = { crop: task.cropId };
      } else {
        const cropDef = getCrop(task.cropId);
        const suitability = cropSuitability(cropDef, tile);
        const bonus = (tile.tilled ? TILL_SURVIVAL_BONUS : 0) + survivalGeneBonus(seed.genome);
        const doomed = Math.random() >= survivalChance(suitability, bonus);
        const crop = {
          kind: PlantKind.CROP,
          cropId: task.cropId,
          growth: 0,
          x: task.x,
          y: task.y,
          suitability,
          genome: seed.genome,
          doomed,
          witherAt: doomed ? 0.3 + Math.random() * 0.5 : 1,
          withered: false,
          wateredUntil: 0,
        };
        tile.plant = crop;
        this.crops.push(crop);
        task.outcome = 'sowed';
        task.outcomeData = { crop: task.cropId, rank: qualityRank(seed.genome) };
      }
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
    } else if (task.type === TaskType.BUILD) {
      if (tile.type !== TileType.WATER && !tile.plant && !tile.structure) {
        tile.structure = task.structure;
        if (task.structure === 'hearth') this.hearths.push({ x: task.x, y: task.y });
        if (task.structure === 'stockpile') {
          this.stockpiles.push({ x: task.x, y: task.y, items: this._freshStockpileItems() });
        }
        if (task.structure === 'hut') this.huts.push({ x: task.x, y: task.y });
        if (task.structure === 'fence') this.fences.push({ x: task.x, y: task.y });
        task.outcome = 'built';
        task.outcomeData = { structure: task.structure };
      } else {
        task.outcome = 'occupied';
      }
    } else if (task.type === TaskType.COOK) {
      if (tile.structure !== 'hearth') {
        task.outcome = 'noHearth';
      } else if (!this.hearthsLit) {
        task.outcome = 'noFuel';
      } else {
        let cooked = 0;
        // Turn raw food into cooked meals, drawing from the largest store.
        while (cooked < COOK_BATCH) {
          let pick = null;
          for (const ft of FOOD_TYPES) {
            if (this.storage[ft] > 0 && (pick === null || this.storage[ft] > this.storage[pick])) {
              pick = ft;
            }
          }
          if (pick === null) break;
          this.storage[pick] -= 1;
          this.storage.meal += 1;
          cooked += 1;
        }
        if (cooked === 0) {
          task.outcome = 'noFood';
        } else {
          task.outcome = 'cooked';
          task.outcomeData = { n: cooked };
        }
      }
    } else if (task.type === TaskType.WEED) {
      const plant = tile.plant;
      if (plant && plant.kind === PlantKind.CROP && plant.withered) {
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
        tile.plant = null;
        task.outcome = 'weeded';
      } else {
        task.outcome = 'noWeed';
      }
    } else if (task.type === TaskType.STORE) {
      const sp = this.stockpileAt(task.x, task.y);
      let moved = 0;
      if (sp) {
        let space = STOCKPILE_CAP - this.stockpileFood(sp);
        while (moved < HAUL_BATCH && space > 0) {
          const it = this._largestFood(this.storage, FOOD_TYPES);
          const food = it || (this.storage.meal > 0 ? 'meal' : null);
          if (!food) break;
          this.storage[food] -= 1;
          sp.items[food] += 1;
          moved++;
          space--;
        }
      }
      task.outcome = moved > 0 ? 'stored' : 'storeFail';
      task.outcomeData = { n: moved };
    } else if (task.type === TaskType.FETCH) {
      const sp = this.stockpileAt(task.x, task.y);
      let moved = 0;
      if (sp) {
        while (moved < HAUL_BATCH) {
          const it = this._largestFood(sp.items, STOCKPILE_ITEMS);
          if (!it) break;
          sp.items[it] -= 1;
          this.storage[it] += 1;
          moved++;
        }
      }
      task.outcome = moved > 0 ? 'fetched' : 'fetchFail';
      task.outcomeData = { n: moved };
    } else if (task.type === TaskType.EAT) {
      this._feed(colonist);
    } else {
      task.outcome = 'arrived';
    }
  }

  // True if a hut stands within HUT_RANGE tiles of (x, y).
  _hutNear(x, y) {
    for (let dy = -HUT_RANGE; dy <= HUT_RANGE; dy++) {
      const row = this.map.tiles[y + dy];
      if (!row) continue;
      for (let dx = -HUT_RANGE; dx <= HUT_RANGE; dx++) {
        const tile = row[x + dx];
        if (tile && tile.structure === 'hut') return true;
      }
    }
    return false;
  }

  // True if a lit hearth stands within HEARTH_RANGE tiles of (x, y).
  _hearthWarm(x, y) {
    if (!this.hearthsLit) return false;
    for (const h of this.hearths) {
      if (Math.abs(h.x - x) <= HEARTH_RANGE && Math.abs(h.y - y) <= HEARTH_RANGE) {
        return true;
      }
    }
    return false;
  }

  // Priority AI: decide a colonist's next task.
  _assignColonist(colonist) {
    if (colonist.hunger >= EAT_THRESHOLD && colonist.eatCooldown <= 0) {
      return createTask(TaskType.EAT, colonist.tileX, colonist.tileY);
    }
    // A content colonist works; a miserable one may slack off instead.
    const willWork = colonist.mood >= 0.3 || Math.random() < 0.5;
    if (willWork) {
      // Take the first queued task addressed to this colonist or to all.
      const idx = this.taskQueue.findIndex(
        (task) => !task.assignee || task.assignee === colonist.name,
      );
      if (idx >= 0) {
        const task = this.taskQueue.splice(idx, 1)[0];
        this.lastAssignReason = t('reason.queued', {
          task: t('task.' + task.type),
          x: task.x,
          y: task.y,
        });
        return task;
      }
      // No orders queued — find useful work to do unprompted.
      const auto = this._autonomousTask(colonist);
      if (auto) {
        this.lastAssignReason = t('reason.auto', { task: t('task.' + auto.type) });
        return auto;
      }
    }
    return this._idleTask(colonist);
  }

  // Work an idle colonist takes up on its own. Existing chores (harvest,
  // fetch, water, weed, cook, store, hunt) run regardless of any toggle.
  // Till, sow and the new auto-builds are gated by the Auto-work toggle.
  _autonomousTask(colonist) {
    // Gather ripe crops.
    for (const crop of this.crops) {
      if (isRipe(crop) && !crop.withered && !this._tileClaimed(crop.x, crop.y)) {
        return createTask(TaskType.HARVEST, crop.x, crop.y);
      }
    }
    // Fetch food back from a stockpile when the on-hand store runs low.
    if (this.onHandFood < ON_HAND_LOW) {
      const sp = this._nearestStockpile(colonist, (s) => this.stockpileFood(s) > 0);
      if (sp && !this._tileClaimed(sp.x, sp.y)) {
        return createTask(TaskType.FETCH, sp.x, sp.y);
      }
    }
    // Tend crops that have run dry.
    for (const crop of this.crops) {
      if (
        !crop.withered &&
        !isRipe(crop) &&
        this.clock >= crop.wateredUntil &&
        !this._tileClaimed(crop.x, crop.y)
      ) {
        return createTask(TaskType.WATER, crop.x, crop.y);
      }
    }
    // Clear away withered, dead crops.
    for (const crop of this.crops) {
      if (crop.withered && !this._tileClaimed(crop.x, crop.y)) {
        return createTask(TaskType.WEED, crop.x, crop.y);
      }
    }
    // Auto-work: throw up a fence between the colony and a nearby boar.
    // Every colonist serves the same colony-wide plan — see _nextFenceTile.
    if (this.autoMode && this._totalFences() < FENCE_AUTO_CAP) {
      const spot = this._nextFenceTile(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'fence' });
    }
    // Cook raw food into meals while a hearth is lit.
    if (this.hearthsLit && this.rawFood > 0 && this.storage.meal < MEAL_TARGET) {
      for (const h of this.hearths) {
        if (!this._tileClaimed(h.x, h.y)) {
          return createTask(TaskType.COOK, h.x, h.y);
        }
      }
    }
    // Hunt for food first when colony stores run low — done before infra
    // and farm work so colonists do not build themselves into starvation.
    if (this.autoHunt && this.totalFood < this.colonists.length * HUNT_FOOD_PER_HEAD) {
      const a = this._animalNear(colonist.tileX, colonist.tileY, AUTO_HUNT_RANGE);
      if (a && !this._tileClaimed(a.tileX, a.tileY)) {
        return createTask(TaskType.HUNT, a.tileX, a.tileY, { animalId: a.id });
      }
    }
    // Auto-work: stand up infrastructure before opening more farmland, so
    // huts, hearths and a warehouse appear early; once they are up, the
    // colonists turn to tilling and sowing.
    if (this.autoMode) {
      if (this.huts.length + this._pendingBuilds('hut') < this.colonists.length) {
        const spot = this._findFreeLandNear(colonist);
        if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hut' });
      }
      if (this.hearths.length + this._pendingBuilds('hearth') < this.huts.length) {
        const spot = this._findFreeLandNear(colonist);
        if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hearth' });
      }
      if (this._wantsAutoWarehouse()) {
        const spot = this._findFreeLandNear(colonist);
        if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'stockpile' });
      }
      const sowCrop = this._mostStockedCrop();
      if (sowCrop) {
        const sowSpot = this._pickAutoSowSpot(colonist);
        if (sowSpot) {
          return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
        }
        // No tilled tile to sow on — till more ground, clustered together.
        const tillSpot = this._pickTillSpot(colonist, sowCrop);
        if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
      }
    }
    // Haul surplus on-hand food into a stockpile, safe from the pests.
    if (this.onHandFood > ON_HAND_CAP) {
      const sp = this._nearestStockpile(colonist, (s) => this.stockpileFood(s) < STOCKPILE_CAP);
      if (sp && !this._tileClaimed(sp.x, sp.y)) {
        return createTask(TaskType.STORE, sp.x, sp.y);
      }
    }
    return null;
  }

  // --- Auto-work helpers ---------------------------------------------------

  // Count BUILD tasks of `structure` already queued or in colonists' hands.
  _pendingBuilds(structure) {
    let n = 0;
    for (const t of this.taskQueue) {
      if (t.type === TaskType.BUILD && t.structure === structure) n++;
    }
    for (const c of this.colonists) {
      const ct = c.currentTask;
      if (ct && ct.type === TaskType.BUILD && ct.structure === structure) n++;
    }
    return n;
  }

  // The crop with the largest seed stock (used to choose what to auto-sow).
  _mostStockedCrop() {
    let best = null;
    let bestN = 0;
    for (const id of CROP_IDS) {
      const n = this.seedCount(id);
      if (n > bestN) {
        bestN = n;
        best = id;
      }
    }
    return best;
  }

  // True if (x, y) is plain land — buildable, plantable, free of anything.
  _isFreeLand(x, y) {
    const row = this.map.tiles[y];
    const t = row && row[x];
    if (!t) return false;
    return t.type === TileType.LAND && !t.tilled && !t.plant && !t.structure;
  }

  // Spiral out from a colonist looking for an unclaimed plain land tile —
  // a spot for auto-built huts and hearths.
  _findFreeLandNear(colonist) {
    const cx = colonist.tileX;
    const cy = colonist.tileY;
    for (let r = 1; r <= AUTO_SEARCH_RANGE; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (!this._isFreeLand(x, y)) continue;
          if (this._tileClaimed(x, y)) continue;
          return { x, y };
        }
      }
    }
    return null;
  }

  // The closest empty tilled tile within range, ready to be sown.
  _pickAutoSowSpot(colonist) {
    const cx = colonist.tileX;
    const cy = colonist.tileY;
    let best = null;
    let bestD = Infinity;
    for (let dy = -AUTO_SEARCH_RANGE; dy <= AUTO_SEARCH_RANGE; dy++) {
      const y = cy + dy;
      const row = this.map.tiles[y];
      if (!row) continue;
      for (let dx = -AUTO_SEARCH_RANGE; dx <= AUTO_SEARCH_RANGE; dx++) {
        const x = cx + dx;
        const t = row[x];
        if (!t || !t.tilled || t.plant || t.structure) continue;
        if (this._tileClaimed(x, y)) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    return best;
  }

  // A spot to till next. Scores tiles by crop suitability and favours ones
  // adjacent to existing tilled tiles, so the farm grows as a cluster.
  _pickTillSpot(colonist, cropId) {
    const cropDef = getCrop(cropId);
    const cx = colonist.tileX;
    const cy = colonist.tileY;
    let best = null;
    let bestScore = -1;
    for (let dy = -AUTO_SEARCH_RANGE; dy <= AUTO_SEARCH_RANGE; dy++) {
      const y = cy + dy;
      const row = this.map.tiles[y];
      if (!row) continue;
      for (let dx = -AUTO_SEARCH_RANGE; dx <= AUTO_SEARCH_RANGE; dx++) {
        const x = cx + dx;
        const t = row[x];
        if (!t || t.type !== TileType.LAND) continue;
        if (t.tilled || t.plant || t.structure) continue;
        if (this._tileClaimed(x, y)) continue;
        let score = cropSuitability(cropDef, t);
        if (this._touchesTilled(x, y)) score += 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    return best;
  }

  _touchesTilled(x, y) {
    for (const [ax, ay] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const row = this.map.tiles[y + ay];
      const nb = row && row[x + ax];
      if (nb && nb.tilled) return true;
    }
    return false;
  }

  // Total fence tiles the colony has, built plus pending.
  _totalFences() {
    return this.fences.length + this._pendingBuilds('fence');
  }

  // Whether to auto-build another warehouse. Always wants at least one;
  // builds more if the existing ones are nearly full, up to a hard cap.
  _wantsAutoWarehouse() {
    const AUTO_WAREHOUSE_CAP = 4;
    const total = this.stockpiles.length + this._pendingBuilds('stockpile');
    if (total >= AUTO_WAREHOUSE_CAP) return false;
    if (this.stockpiles.length === 0) return true;
    let used = 0;
    for (const sp of this.stockpiles) used += this.stockpileFood(sp);
    const cap = this.stockpiles.length * STOCKPILE_CAP;
    return used / cap > 0.85;
  }

  // The nearest animal within `range` of any colonist, or null.
  _nearestAnimalToColony(range) {
    let best = null;
    let bestD = range;
    for (const c of this.colonists) {
      for (const a of this.animals) {
        const d = Math.hypot(a.x - c.x, a.y - c.y);
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
    }
    return best;
  }

  // The colony picks ONE wall row, then every colonist serves that plan
  // until it is built (or its tiles become invalid). Without a shared plan
  // each colonist would chase the moving animal independently, scattering
  // single fence tiles across several rows.
  _nextFenceTile(colonist) {
    // Drop plan tiles that have already been built or are no longer free.
    if (this.fencePlan) {
      this.fencePlan = this.fencePlan.filter((p) => this._isFreeLand(p.x, p.y));
      if (this.fencePlan.length === 0) this.fencePlan = null;
    }
    // An active plan exists — return its closest unclaimed tile so the
    // nearest colonist takes the next piece of the wall.
    if (this.fencePlan) {
      let best = null;
      let bestD = Infinity;
      for (const p of this.fencePlan) {
        if (this._tileClaimed(p.x, p.y)) continue;
        const d = Math.hypot(p.x - colonist.tileX, p.y - colonist.tileY);
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      return best;
    }
    // No active plan — hold off on planning a new one until the cooldown
    // has elapsed, so a boar wandering one tile per second does not goad
    // the colony into ratcheting up a fresh wall every step.
    if (this.clock - this.fencePlanAt < FENCE_REPLAN_COOLDOWN) return null;
    if (this._totalFences() >= FENCE_AUTO_CAP) return null;
    this._planFenceLine();
    return this.fencePlan ? this._nextFenceTile(colonist) : null;
  }

  // Lay out one wall row of up to FENCE_PLAN_LENGTH tiles, sitting between
  // the colony's centroid and the nearest animal and running perpendicular
  // to the threat direction. Stores the plan on `this.fencePlan` and
  // stamps `fencePlanAt` so the cooldown starts even if no plan was made.
  _planFenceLine() {
    const animal = this._nearestAnimalToColony(FENCE_TRIGGER_RANGE);
    this.fencePlanAt = this.clock;
    if (!animal) return;
    // Use huts if any are up; otherwise the colonists themselves.
    const anchors = this.huts.length > 0
      ? this.huts
      : this.colonists.map((c) => ({ x: c.tileX, y: c.tileY }));
    if (anchors.length === 0) return;
    let cx = 0;
    let cy = 0;
    for (const a of anchors) {
      cx += a.x;
      cy += a.y;
    }
    cx /= anchors.length;
    cy /= anchors.length;
    let dx = animal.x - cx;
    let dy = animal.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    // Wall sits a few tiles from the colony, not on top of it and not on
    // the animal — somewhere in between, closer to the colony's side.
    const distFromColony = Math.min(Math.max(len * 0.55, 2), len - 1);
    const midX = cx + dx * distFromColony;
    const midY = cy + dy * distFromColony;
    // Perpendicular vector for the wall direction.
    const px = -dy;
    const py = dx;
    const budget = Math.min(FENCE_PLAN_LENGTH, FENCE_AUTO_CAP - this._totalFences());
    if (budget < 2) return;
    const plan = [];
    const half = (budget - 1) / 2;
    const lo = -Math.floor(half);
    const hi = Math.ceil(half);
    for (let i = lo; i <= hi; i++) {
      const x = Math.round(midX + px * i);
      const y = Math.round(midY + py * i);
      if (!this._isFreeLand(x, y)) continue;
      if (plan.some((p) => p.x === x && p.y === y)) continue;
      plan.push({ x, y });
    }
    if (plan.length >= 2) this.fencePlan = plan;
  }

  // True if a colonist is already working a tile, or a task is queued for it.
  // A 'done' task still counts as claimed until its effect has been applied
  // (which happens at the top of the next colonist's turn) — otherwise a
  // peer can pick the same tile in the same frame and double-up the work.
  _tileClaimed(x, y) {
    for (const c of this.colonists) {
      const task = c.currentTask;
      if (task && task.x === x && task.y === y && task.status !== 'failed') {
        return true;
      }
    }
    for (const task of this.taskQueue) {
      if (task.x === x && task.y === y) return true;
    }
    return false;
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
    const coldWeather = this.environment.temperature <= COLD_THRESHOLD;
    let anyCold = false;
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
      // Resting beside a hut lifts the spirits.
      if (
        (c.state === 'resting' || c.state === 'sleeping') &&
        this._hutNear(c.tileX, c.tileY)
      ) {
        c.mood = Math.min(1, c.mood + HUT_MOOD_BONUS * dt);
      }
      // Cold weather bites colonists who are not by a lit hearth.
      c.cold = coldWeather && !this._hearthWarm(c.tileX, c.tileY);
      if (c.cold) {
        anyCold = true;
        c.health = Math.max(0, c.health - COLD_DAMAGE * dt);
        c.mood = Math.max(0, c.mood - COLD_MOOD_DROP * dt);
        if (c.health <= 0) c.dead = true;
      }
    }
    // Announce a cold snap once, on the edge it starts to bite.
    if (anyCold && !this._coldActive) {
      this._coldEvent = true;
      this._pushLog({ icon: '🥶', text: t('log.cold'), cls: 'log-warn' });
    }
    this._coldActive = anyCold;
    // Carry off the fallen.
    if (this.colonists.some((c) => c.dead)) {
      for (const c of this.colonists) {
        if (c.dead) {
          this._pushLog({ icon: '☠', text: t('log.died', { name: c.name }), cls: 'log-fail' });
          // Hand this colonist's queued work back to the whole colony.
          for (const task of this.taskQueue) {
            if (task.assignee === c.name) task.assignee = null;
          }
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

  // Advance every growing crop; doomed ones wither before they ripen. A
  // withered crop stays on its tile (as dead growth) until a colonist
  // weeds it or it is harvested clear.
  _growCrops(dt) {
    const env = this.environment;
    const tempFactor = tempGrowthFactor(env.temperature);
    for (const crop of this.crops) {
      if (crop.withered) continue;
      const tile = this.map.tiles[crop.y][crop.x];
      // The cold gene keeps a crop growing in poor weather; vigor sets pace.
      const tf = coldGrowthFactor(crop.genome, tempFactor);
      let rate = tf * sunGrowthFactor(tile.sunlight, env.daylight) * vigorMult(crop.genome);
      if (this.clock < crop.wateredUntil) rate *= WATER_GROWTH_BONUS;
      crop.growth = Math.min(1, crop.growth + (dt / getCrop(crop.cropId).growthTime) * rate);
      if (crop.doomed && crop.growth >= crop.witherAt) {
        crop.withered = true;
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

  // Pests gnaw at the food store on a timer; stockpile tiles soften the loss.
  _updatePests(dt) {
    this.pestTimer += dt;
    if (this.pestTimer < PEST_INTERVAL) return;
    this.pestTimer -= PEST_INTERVAL;
    this._pestStrike();
  }

  _pestStrike() {
    // Pests gnaw on-hand raw food only — cooked meals, and anything tucked
    // away in a stockpile, are kept safe.
    if (this.rawFood <= 0) return;
    const loss = Math.ceil(this.rawFood * PEST_BITE);
    let spoiled = 0;
    // Spoil one unit at a time, always from the largest store.
    while (spoiled < loss) {
      const pick = this._largestFood(this.storage, FOOD_TYPES);
      if (pick === null) break;
      this.storage[pick] -= 1;
      spoiled += 1;
    }
    if (spoiled === 0) return;
    this.pestsLost += spoiled;
    this._pestEvent = true;
    this._pushLog({ icon: '🐛', text: t('log.pests', { n: spoiled }), cls: 'log-fail' });
  }

  // Lit hearths burn through the colony's firewood over time.
  _updateFuel(dt) {
    if (this.hearths.length === 0 || this.storage.wood <= 0) return;
    this.storage.wood = Math.max(0, this.storage.wood - this.hearths.length * WOOD_BURN_RATE * dt);
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
    // The camera still pans while paused; the simulation does not advance.
    const { dx, dy } = this._panVector();
    if (dx !== 0 || dy !== 0) {
      this.camera.pan(dx * CAMERA_SPEED * realDt, dy * CAMERA_SPEED * realDt);
    }
    if (this.paused) return;
    const simDt = realDt * this.speed;
    this.clock += simDt;
    const prevSeason = this.environment.seasonIndex;
    this._updateEnvironment();
    if (this.environment.seasonIndex !== prevSeason) {
      this._seasonEvent = this.environment.season;
    }
    this._updateFuel(simDt);
    this._updateColonists(simDt);
    this._updateAnimals(simDt);
    this._growCrops(simDt);
    this._updatePests(simDt);
    // Surviving a full year is the colony's first goal — but play goes on.
    if (!this.won && !this.over && this.environment.year >= 2 && this.colonists.length > 0) {
      this.won = true;
      this._winEvent = true;
    }
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
      selectedColonist: this.selectedColonist,
      hearthsLit: this.hearthsLit,
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
