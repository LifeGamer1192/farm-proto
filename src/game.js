// The game: owns the map, camera, colonists, animals, task queue, crops
// and food store, and runs the frame loop.
//
// Several colonists share one work queue. Each runs a small priority AI:
// eat when hungry, else take queued work (a miserable colonist may slack),
// else do a personal task. Wild animals stroll the map and harry the
// colonists; colonists can hunt them. If every colonist falls, the colony
// is lost.

// Constants directly used by game.js (the rest live in their system modules).
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
  ANIMAL_COUNT,
  HUNT_RANGE,
  MEAT_YIELD,
  WILDGREENS_SEED_CHANCE,
  HUT_RANGE,
  HUT_MOOD_BONUS,
  WILD_WOOD_YIELD,
  HEARTH_RANGE,
  COLD_THRESHOLD,
  COLD_DAMAGE,
  COLD_MOOD_DROP,
  COOK_BATCH,
  HUNT_FOOD_PER_HEAD,
  STOCKPILE_CAP,
  ON_HAND_CAP,
  HAUL_BATCH,
  BUILD_COSTS,
  TREE_WOOD_YIELD,
  STUMP_REGROW_TIME,
  INJURY_THRESHOLD,
  SLEEP_DEFICIT_THRESHOLD,
} from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { TileType } from './map/tile.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Colonist } from './entities/colonist.js';
import { TaskType, WORK_TYPES, createTask } from './tasks.js';
import { scatterPlants, PlantKind } from './world.js';
import { PathCache } from './core/pathfinder.js';
import { getBiome, DEFAULT_BIOME } from './biomes.js';
import {
  createGroup,
  getScript,
  GROUP_COLORS,
  aggregateSeeds,
  aggregateCodex,
  aggregateStartingCrops,
} from './groups.js';
import { getCrop, cropSuitability, survivalChance, isRipe } from './crops.js';
import {
  freshGenome,
  qualityRank,
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
import { pickAutonomousTask } from './autonomy.js';

// --- System modules (refactor split out of this file) --------------------
//
// game.js owns the simulation skeleton — frame loop, task queue, entity
// arrays, the assign / apply loop — but the policy and economy logic of
// each subsystem lives in its own module under src/systems/. The class
// methods here are thin shims so existing callers (autonomy.js, tests,
// main.js) keep working unchanged.
import {
  FOOD_TYPES,
  STOCKPILE_ITEMS as _STOCKPILE_ITEMS,
  nutritionOf,
  freshStorage,
  freshStockpileItems,
  largestFood,
  rawFood as fsRawFood,
  onHandFood as fsOnHandFood,
  totalFood as fsTotalFood,
  totalItem as fsTotalItem,
  stockpileFood as fsStockpileFood,
  stockpileAt as fsStockpileAt,
  nearestStockpile as fsNearestStockpile,
  feed as fsFeed,
  cookOne as csCookOne,
} from './systems/foodSystem.js';
import {
  freshSeeds as csFreshSeeds,
  freshCodex as csFreshCodex,
  recordCodex as csRecordCodex,
  seedCount as csSeedCount,
  bestSeed as csBestSeed,
  bestSeedRank as csBestSeedRank,
  pendingSows as csPendingSows,
  canSow as csCanSow,
  takeSeed as csTakeSeed,
  addSeed as csAddSeed,
  gatherSeeds as csGatherSeeds,
  mostStockedCrop as csMostStockedCrop,
  pickAutoSowSpot as csPickAutoSowSpot,
  pickTillSpot as csPickTillSpot,
  touchesTilled as csTouchesTilled,
} from './systems/cropSystem.js';
import {
  onSeasonChange as esOnSeasonChange,
  updatePests as esUpdatePests,
  pestStrike as esPestStrike,
  updateFuel as esUpdateFuel,
  updateForest as esUpdateForest,
  checkVictory as esCheckVictory,
} from './systems/eventSystem.js';
import {
  isFreeLand as bsIsFreeLand,
  tileClaimed as bsTileClaimed,
  findFreeLandNear as bsFindFreeLandNear,
  pendingBuilds as bsPendingBuilds,
  totalFences as bsTotalFences,
  reservedBuildWood as bsReservedBuildWood,
  canAffordBuild as bsCanAffordBuild,
  wantsAutoWarehouse as bsWantsAutoWarehouse,
  warehousesCritical as bsWarehousesCritical,
  warehouseUtilization as bsWarehouseUtilization,
  nextFenceTile as bsNextFenceTile,
  planFenceLine as bsPlanFenceLine,
} from './systems/buildingSystem.js';
import {
  spawnAnimals as asSpawnAnimals,
  animalNear as asAnimalNear,
  nearestAnimalToColony as asNearestAnimalToColony,
  nearestTree as asNearestTree,
  updateAnimals as asUpdateAnimals,
} from './systems/animalSystem.js';

// Re-exported so main.js (and any other UI consumer) keeps a stable
// import path even though the data now lives in foodSystem.
export const STOCKPILE_ITEMS = _STOCKPILE_ITEMS;

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
    // Colony groups (alpha 23). `this.groups` holds the per-group
    // identity records (name / color / script / starter contribution);
    // each colonist has a `groupId` pointing back. For this alpha,
    // resources (storage, seeds, codex) remain colony-wide — the
    // group identity drives autonomy script + colonist rendering +
    // starter seed selection. Per-group warehouses + ownership flow
    // are α24-scoped.
    this.groups = [];
    // Saved setup for re-rolls (Regenerate keeps the same group count
    // and per-group scripts unless the user picks again).
    this.groupSetup = null;
    this.colonists = [];
    this.animals = [];
    this.hearths = [];
    this.stockpiles = [];
    this.huts = [];
    this.fences = [];
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
    // Population + trader event state (alpha 19). Each "consume*" reader
    // clears its flag so the UI shows the event banner exactly once.
    this._birthEvent = null; // name of a newborn, or null
    this._traderEvent = null; // gift summary, or null
    this._traderYear = 0; // the last year the winter trader visited
    this._birthCounter = 0; // index into BIRTH_NAMES for the next newborn

    this._loop = this._loop.bind(this);
    this._lastTime = 0;
  }

  get seed() {
    return this.map.seed;
  }
  get speed() {
    return SPEED_LEVELS[this.speedIndex];
  }
  // --- Food / stockpile delegates (foodSystem) ---------------------------
  get rawFood()    { return fsRawFood(this); }
  get onHandFood() { return fsOnHandFood(this); }
  get totalFood()  { return fsTotalFood(this); }
  _freshStorage()  { return freshStorage(); }
  _freshStockpileItems() { return freshStockpileItems(); }
  _largestFood(store, items) { return largestFood(store, items); }
  totalItem(it)            { return fsTotalItem(this, it); }
  stockpileAt(x, y)        { return fsStockpileAt(this, x, y); }
  stockpileFood(sp)        { return fsStockpileFood(sp); }
  _nearestStockpile(c, p)  { return fsNearestStockpile(this, c, p); }
  _feed(colonist)          { return fsFeed(this, colonist); }

  // --- Seed / codex / sow delegates (cropSystem) -------------------------
  _freshSeeds()                  { return csFreshSeeds(this); }
  _freshCodex()                  { return csFreshCodex(this); }
  _recordCodex(cropId, genome)   { return csRecordCodex(this, cropId, genome); }
  seedCount(cropId)              { return csSeedCount(this, cropId); }
  bestSeed(cropId)               { return csBestSeed(this, cropId); }
  bestSeedRank(cropId)           { return csBestSeedRank(this, cropId); }
  _pendingSows(cropId)           { return csPendingSows(this, cropId); }
  canSow(cropId)                 { return csCanSow(this, cropId); }
  _takeSeed(cropId)              { return csTakeSeed(this, cropId); }
  _addSeed(cropId, genome)       { return csAddSeed(this, cropId, genome); }
  _gatherSeeds(plant)            { return csGatherSeeds(this, plant); }
  _mostStockedCrop()             { return csMostStockedCrop(this); }
  _pickAutoSowSpot(colonist)     { return csPickAutoSowSpot(this, colonist); }
  _pickTillSpot(colonist, crop)  { return csPickTillSpot(this, colonist, crop); }
  _touchesTilled(x, y)           { return csTouchesTilled(this, x, y); }
  // A hearth warms and cooks only while the colony has wood to burn.
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

  /**
   * Generate a fresh map, scatter plants, and place colonists and animals.
   * @param {number} seed
   * @param {?string} [biomeId] one of the BIOME_IDS (alpha 22).
   * @param {?object[]} [groupSetup] alpha 23 — array of per-group
   *   setup records: `[{ scriptId, colonistCount, name }]`. Length 1-8.
   *   Omitted → keep the previous setup (or single default group).
   */
  newMap(seed, biomeId, groupSetup) {
    if (biomeId) this.biome = getBiome(biomeId);
    if (!this.biome) this.biome = getBiome(DEFAULT_BIOME);
    if (groupSetup) this.groupSetup = groupSetup;
    if (!this.groupSetup) {
      this.groupSetup = [{ scriptId: 'balanced', colonistCount: COLONIST_COUNT }];
    }
    this.map = generateMap(GRID_COLS, GRID_ROWS, seed, this.biome);
    // Attach a per-frame path cache to the map — colonist.assignTask
    // looks for `map.pathCache` and reuses its results across colonists
    // heading to the same tile in the same tick.
    this.map.pathCache = new PathCache();
    scatterPlants(this.map, this.biome);
    this.stats = mapStats(this.map);
    this.camera = new Camera(this._viewCols(), this._viewRows(), GRID_COLS, GRID_ROWS);

    // Build per-group records (identity / color / script). For α23 the
    // resources stay colony-wide (see legacy storage/seeds/codex below).
    this.groups = this.groupSetup.map((setup, id) => createGroup(id, setup));

    // Spread groups around the map centre — each group gets its own
    // cluster of spawn tiles. With one group the cluster sits on the
    // map centre exactly (back-compat).
    this.colonists = [];
    const clusters = this._pickGroupClusters(this.groups.length);
    for (let gid = 0; gid < this.groups.length; gid++) {
      const group = this.groups[gid];
      const center = clusters[gid];
      const want = group.colonistCount;
      const spawns = this._findSpawnsNear(center.x, center.y, want);
      // Names: first group uses the hand-picked roster (Ada/Bo/Cy/Dot)
      // for back-compat; later groups always use a unique per-group
      // letter prefix so names never collide across groups (the second
      // colonist of group 2 is "C2-2", not the same "C2" as group 1).
      const letter = String.fromCharCode(65 + gid);
      for (let i = 0; i < spawns.length; i++) {
        const s = spawns[i];
        const fallback = gid === 0 ? `A${i + 1}` : `${letter}${i + 1}`;
        const name = gid === 0
          ? (COLONIST_NAMES[i] || fallback)
          : fallback;
        const c = new Colonist(s.x, s.y, name, gid);
        this.colonists.push(c);
        group.colonists.push(c);
      }
    }
    // Spawn the wild-animal mix on random land tiles (see animalSystem).
    this.animals = asSpawnAnimals(this, this._randomLandTiles(ANIMAL_COUNT));
    const camAnchor = clusters[0];
    this.camera.centerOn(camAnchor.x + 0.5, camAnchor.y + 0.5);

    this.taskQueue = [];
    this.crops = [];
    this.hearths = [];
    this.stockpiles = [];
    this.huts = [];
    this.fences = [];
    this.fencePlan = null;
    this.fencePlanAt = -Infinity;
    this.storage = this._freshStorage();
    // Seed / codex / starting crops are pooled from every group (alpha 23).
    this.seeds = aggregateSeeds(this.groups);
    this.codex = aggregateCodex(this.groups);
    this.startingCrops = aggregateStartingCrops(this.groups);
    // Colony wood = sum of every group's startingWood. Resources stay
    // pooled in this alpha; per-group wood ledgers come with α24.
    let totalWood = 0;
    for (const grp of this.groups) totalWood += grp.startingWood || 0;
    this.storage.wood = totalWood;
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0;
    this.pestsLost = 0;
    this.pestTimer = 0;
    this._pestEvent = false;
    this._coldEvent = false;
    this._coldActive = false;
    this._birthEvent = null;
    this._traderEvent = null;
    this._traderYear = 0;
    this._birthCounter = 0;
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

  /**
   * Pick N spawn cluster centres so groups land on different patches
   * of the map. The first cluster sits on the map centre (back-compat
   * for the single-group case); subsequent clusters are placed on a
   * ring around it. Each centre is snapped to the nearest land tile.
   */
  _pickGroupClusters(n) {
    const cx = (this.map.cols / 2) | 0;
    const cy = (this.map.rows / 2) | 0;
    if (n <= 1) return [{ x: cx, y: cy }];
    const out = [];
    const radius = Math.min(this.map.cols, this.map.rows) * 0.28;
    for (let i = 0; i < n; i++) {
      // First slot still at the centre; the rest fan around it.
      if (i === 0) {
        out.push(this._snapToLand(cx, cy));
        continue;
      }
      const t = ((i - 1) / Math.max(1, n - 1)) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(t) * radius);
      const y = Math.round(cy + Math.sin(t) * radius);
      out.push(this._snapToLand(x, y));
    }
    return out;
  }

  // Walk a small spiral until we hit a land tile — used to snap a
  // requested spawn anchor away from water.
  _snapToLand(x, y) {
    for (let r = 0; r <= 12; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= this.map.cols || py >= this.map.rows) continue;
          if (this.map.tiles[py][px].type === TileType.LAND) return { x: px, y: py };
        }
      }
    }
    return { x, y };
  }

  // n land tiles closest to (cx, cy), spiralling outward.
  _findSpawnsNear(cx, cy, n) {
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
    const tOffset = this.biome?.tempOffset || 0;
    const dOffset = this.biome?.daylightOffset || 0;
    info.temperature = temperatureAt(info.yearProgress) + tOffset;
    info.daylight = Math.max(0, Math.min(1, daylightAt(info.yearProgress) + dOffset));
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

  // The name of a colonist born this frame, or null. One-shot toast.
  consumeBirthEvent() {
    const e = this._birthEvent;
    this._birthEvent = null;
    return e;
  }

  // The winter trader's gift summary, or null. One-shot toast.
  consumeTraderEvent() {
    const e = this._traderEvent;
    this._traderEvent = null;
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

  // --- Animal delegates (animalSystem) -----------------------------------
  _animalNear(x, y, range)        { return asAnimalNear(this, x, y, range); }
  _nearestAnimalToColony(range)   { return asNearestAnimalToColony(this, range); }
  _nearestTree(colonist, range)   { return asNearestTree(this, colonist, range); }

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
    if (type === TaskType.WEED) {
      // Explicit player weed: any crop is OK (withered or still growing).
      const p = tile.plant;
      if (!p || p.kind !== PlantKind.CROP) return 'err.noCrop';
    }
    if (type === TaskType.COOK && tile.structure !== 'hearth') return 'err.noHearth';
    if (type === TaskType.BUILD) {
      if (tile.type === TileType.WATER) return 'err.onWater';
      if (tile.plant || tile.structure) return 'err.occupied';
      const structure = opts.structure || 'fence';
      // Wood already reserved by queued / in-flight builds is unavailable;
      // an order that would put the colony into wood debt is refused now.
      if (!this._canAffordBuild(structure)) return 'err.noWood';
      this.taskQueue.push(
        createTask(TaskType.BUILD, x, y, { structure, assignee }),
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
          const prevCount = this.storage[plant.cropId] || 0;
          this.storage[plant.cropId] = prevCount + n;
          // Alpha 24: blend the harvested batch's quality (from the seed's
          // ★ rank, mapped 0..1) into whatever stock was already on hand.
          // Higher-quality seeds bring better cook outputs downstream.
          const q = Math.max(0, Math.min(1, qualityRank(plant.genome) / 4));
          if (!this.storage.quality) this.storage.quality = {};
          const prevQ = this.storage.quality[plant.cropId] ?? 0.5;
          const newCount = prevCount + n;
          this.storage.quality[plant.cropId] =
            (prevQ * prevCount + q * n) / Math.max(1, newCount);
          this._recordCodex(plant.cropId, plant.genome);
          const seeds = this._gatherSeeds(plant);
          task.outcome = 'harvested';
          task.outcomeData = { crop: plant.cropId, n, seeds };
        }
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
      } else if (plant && plant.kind === PlantKind.TREE) {
        // Chopping a tree yields wood and leaves a fresh stump behind.
        const wood = Math.max(1, Math.round(TREE_WOOD_YIELD * (plant.growth || 1)));
        this.storage.wood += wood;
        tile.plant = { kind: PlantKind.STUMP, regrowAt: this.clock + STUMP_REGROW_TIME };
        task.outcome = 'chopped';
        task.outcomeData = { n: wood };
        return;
      } else if (plant && plant.kind === PlantKind.STUMP) {
        // A stump has no harvest to give — wait for the regrow.
        task.outcome = 'stump';
        return;
      } else if (plant) {
        this.storage.forage += 1;
        this.storage.wood += WILD_WOOD_YIELD;
        // Low chance to gather a wild-greens seed from the foraged plant.
        // Wild seed is weak — barely any yield or nutrition — but it can
        // be sown like a regular crop, planting the seed of a future
        // "real" variety once the colony starts breeding it.
        let seeds = 0;
        if (Math.random() < WILDGREENS_SEED_CHANCE) {
          const list = this.seeds.wildgreens || (this.seeds.wildgreens = []);
          const seed = { genome: freshGenome() };
          list.push(seed);
          if (!this.codex.wildgreens) {
            this.codex.wildgreens = { origin: seed.genome, best: seed.genome };
          }
          seeds = 1;
        }
        if (seeds > 0) {
          task.outcome = 'foragedSeed';
          task.outcomeData = { n: 1, seeds };
        } else {
          task.outcome = 'foraged';
        }
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
        const meat = a.traits ? a.traits.meat : MEAT_YIELD;
        const species = a.species || 'boar';
        this.animals.splice(idx, 1);
        this.storage.meat += meat;
        task.outcome = 'hunted';
        task.outcomeData = { animal: species, n: meat };
      } else {
        task.outcome = 'gotAway';
      }
    } else if (task.type === TaskType.BUILD) {
      if (tile.type !== TileType.WATER && !tile.plant && !tile.structure) {
        const cost = BUILD_COSTS[task.structure] || 0;
        if (this.storage.wood < cost) {
          // Wood vanished between assignment and apply (a peer used it up);
          // fail the task so the colonist can replan instead of building
          // for free or going into wood debt.
          task.outcome = 'noWood';
          task.outcomeData = { structure: task.structure, need: cost };
        } else {
          this.storage.wood -= cost;
          tile.structure = task.structure;
          if (task.structure === 'hearth') this.hearths.push({ x: task.x, y: task.y });
          if (task.structure === 'stockpile') {
            this.stockpiles.push({ x: task.x, y: task.y, items: this._freshStockpileItems() });
          }
          if (task.structure === 'hut') this.huts.push({ x: task.x, y: task.y });
          if (task.structure === 'fence') this.fences.push({ x: task.x, y: task.y });
          task.outcome = 'built';
          task.outcomeData = { structure: task.structure, wood: cost };
        }
      } else {
        task.outcome = 'occupied';
      }
    } else if (task.type === TaskType.COOK) {
      if (tile.structure !== 'hearth') {
        task.outcome = 'noHearth';
      } else if (!this.hearthsLit) {
        task.outcome = 'noFuel';
      } else {
        // Alpha 24: recipe-based cooking. Each pass picks the best
        // recipe whose ingredients are on hand (Tier 2 > Tier 1) and
        // produces that dish, blending input quality into the dish's
        // own quality stack. Falls back to the legacy "shuffle raw →
        // meal" path when no recipe matches so cooking is never a
        // total dead-end during the early game.
        let cooked = 0;
        const dishesMade = {};
        while (cooked < COOK_BATCH) {
          const recipe = csCookOne(this);
          if (!recipe) break;
          dishesMade[recipe.id] = (dishesMade[recipe.id] || 0) + recipe.out;
          cooked += recipe.out;
        }
        // Legacy fallback: convert one raw item into a generic meal so
        // the colony never starves just because no full recipe matched.
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
          task.outcomeData = { n: cooked, dishes: Object.keys(dishesMade) };
        }
      }
    } else if (task.type === TaskType.WEED) {
      // Pull any crop off the tile — withered (cleanup) or still-living
      // (explicit player scrap). A live crop is counted as a loss so the
      // Crops-lost stat reflects the deliberate cull.
      const plant = tile.plant;
      if (plant && plant.kind === PlantKind.CROP) {
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
        tile.plant = null;
        if (plant.withered) {
          task.outcome = 'weeded';
        } else {
          this.cropsLost += 1;
          task.outcome = 'culled';
          task.outcomeData = { crop: plant.cropId };
        }
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
    // Injured colonists head home to rest instead of taking new work
    // (alpha 21). Heavily sleep-deprived colonists prefer SLEEP.
    if (colonist.health < INJURY_THRESHOLD) {
      return createTask(TaskType.REST, colonist.tileX, colonist.tileY);
    }
    if (colonist.sleep !== undefined && colonist.sleep < SLEEP_DEFICIT_THRESHOLD * 0.6) {
      return createTask(TaskType.SLEEP, colonist.tileX, colonist.tileY);
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

  // Work an idle colonist takes up on its own. The actual decision tree
  // lives in src/autonomy.js so future versions can swap it out without
  // touching the rest of the engine. This shim keeps the call site stable.
  _autonomousTask(colonist) {
    // Dispatch by the colonist's group's autonomy script (alpha 23).
    // Falls back to the legacy balanced script for ungrouped colonists.
    const g = this.groups[colonist.groupId];
    const fn = g ? getScript(g.scriptId) : pickAutonomousTask;
    return fn(this, colonist);
  }

  // --- Auto-work helpers ---------------------------------------------------

  // Count BUILD tasks of `structure` already queued or in colonists' hands.
  // --- Building delegates (buildingSystem) -------------------------------
  _pendingBuilds(structure)  { return bsPendingBuilds(this, structure); }
  _isFreeLand(x, y)          { return bsIsFreeLand(this, x, y); }
  _findFreeLandNear(c)       { return bsFindFreeLandNear(this, c); }
  _totalFences()             { return bsTotalFences(this); }
  _reservedBuildWood()       { return bsReservedBuildWood(this); }
  _canAffordBuild(structure) { return bsCanAffordBuild(this, structure); }
  _wantsAutoWarehouse()      { return bsWantsAutoWarehouse(this); }
  _warehousesCritical()      { return bsWarehousesCritical(this); }
  _warehouseUtilization()    { return bsWarehouseUtilization(this); }
  _nextFenceTile(c)          { return bsNextFenceTile(this, c); }
  _planFenceLine()           { return bsPlanFenceLine(this); }

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
      // Mirror the cull into each group's roster so per-group counts
      // (births / panels) stay consistent.
      for (const grp of this.groups) {
        grp.colonists = grp.colonists.filter((c) => !c.dead);
      }
      if (this.colonists.length === 0) this.over = true;
    }
    if (this.taskQueue.length === 0 && this.busyColonists === 0) {
      this.lastAssignReason = t('reason.idle');
    }
  }

  _updateAnimals(dt) { return asUpdateAnimals(this, dt); }

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

  // --- Event delegates (eventSystem) -------------------------------------
  _updatePests(dt)        { return esUpdatePests(this, dt); }
  _pestStrike()           { return esPestStrike(this); }
  _updateFuel(dt)         { return esUpdateFuel(this, dt); }
  _updateForest(dt)       { return esUpdateForest(this, dt); }
  _onSeasonChange(season) { return esOnSeasonChange(this, season); }

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
    // Fresh frame — drop last tick's cached pathfinder results so a
    // fence built last frame invalidates routes through it.
    if (this.map.pathCache) this.map.pathCache.nextFrame();
    const prevSeason = this.environment.seasonIndex;
    this._updateEnvironment();
    if (this.environment.seasonIndex !== prevSeason) {
      this._seasonEvent = this.environment.season;
      this._onSeasonChange(this.environment.season);
    }
    this._updateFuel(simDt);
    this._updateForest(simDt);
    this._updateColonists(simDt);
    this._updateAnimals(simDt);
    this._growCrops(simDt);
    this._updatePests(simDt);
    // Surviving the three-year goal lights the celebration overlay once.
    esCheckVictory(this);
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
      biomeTint: this.biome?.mapTint || null,
      groupColors: this.groups.map((g) => g.color),
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
