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
  STOCKPILE_CAP_BY_TYPE,
  HUT_CAPACITY_BY_TYPE,
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
import { pickAutonomousTask, runSelectiveBreedingCulls } from './autonomy.js';

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
  nearestOwnStockpile as fsNearestOwnStockpile,
  feed as fsFeed,
  cookOne as csCookOne,
  storageAdd,
  storageSub,
  largestGroupHolder,
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
  findFreeLandColonyWide as bsFindFreeLandColonyWide,
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
  nearestWildPlant as asNearestWildPlant,
  updateAnimals as asUpdateAnimals,
} from './systems/animalSystem.js';

// Re-exported so main.js (and any other UI consumer) keeps a stable
// import path even though the data now lives in foodSystem.
export const STOCKPILE_ITEMS = _STOCKPILE_ITEMS;

// α27: how often the Run-history sampler captures a snapshot, and how
// many samples it keeps. 10 sim-seconds × 500 samples ≈ 5000 sim-
// seconds of history (~1.4 in-game years at default speed).
const HISTORY_INTERVAL = 10;
const HISTORY_SIZE = 500;

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
    this._mutationEvent = null;
    this.log = [];
    this.logRev = 0;
    this.lastAssignReason = '';
    // α27 run-history sampler — see _sampleHistory.
    this.history = { samples: [], timer: 0 };

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
    // Guard against direct out-of-range assignment (game.speedIndex = 99):
    // the setter clamps, but raw property writes skip it and would produce
    // a NaN simDt that propagates to clock / environment.year.
    const idx = this.speedIndex;
    if (!Number.isInteger(idx) || idx < 0 || idx >= SPEED_LEVELS.length) {
      return SPEED_LEVELS[DEFAULT_SPEED];
    }
    return SPEED_LEVELS[idx];
  }
  // --- Food / stockpile delegates (foodSystem) ---------------------------
  get rawFood()    { return fsRawFood(this); }
  get onHandFood() { return fsOnHandFood(this); }
  get totalFood()  { return fsTotalFood(this); }
  _freshStorage()  { return freshStorage(); }
  _freshStockpileItems() { return freshStockpileItems(); }
  _largestFood(store, items) { return largestFood(store, items); }
  totalItem(it)            { return fsTotalItem(this, it); }
  stockpileAt(x, y)         { return fsStockpileAt(this, x, y); }
  stockpileFood(sp)         { return fsStockpileFood(sp); }
  _nearestStockpile(c, p)   { return fsNearestStockpile(this, c, p); }
  _nearestOwnStockpile(c, p){ return fsNearestOwnStockpile(this, c, p); }
  _feed(colonist)           { return fsFeed(this, colonist); }

  // --- Seed / codex / sow delegates (cropSystem) -------------------------
  _freshSeeds()                                 { return csFreshSeeds(this); }
  _freshCodex()                                 { return csFreshCodex(this); }
  _recordCodex(cropId, genome, groupId)         { return csRecordCodex(this, cropId, genome, groupId); }
  seedCount(cropId, groupId)                    { return csSeedCount(this, cropId, groupId); }
  bestSeed(cropId, groupId)                     { return csBestSeed(this, cropId, groupId); }
  bestSeedRank(cropId, groupId)                 { return csBestSeedRank(this, cropId, groupId); }
  _pendingSows(cropId, groupId)                 { return csPendingSows(this, cropId, groupId); }
  canSow(cropId, groupId)                       { return csCanSow(this, cropId, groupId); }
  _takeSeed(cropId, groupId)                    { return csTakeSeed(this, cropId, groupId); }
  _addSeed(cropId, genome, groupId)             { return csAddSeed(this, cropId, genome, groupId); }
  _gatherSeeds(plant, groupId)                  { return csGatherSeeds(this, plant, groupId); }
  _mostStockedCrop(groupId)                     { return csMostStockedCrop(this, groupId); }
  _pickAutoSowSpot(colonist, cropId) { return csPickAutoSowSpot(this, colonist, cropId); }
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
    // BUG-4 fix: persistent run-history counters that survive past the
    // log's 1000-entry ring buffer. Keyed by group id where relevant so
    // a post-game / debug tool can attribute deaths and births to the
    // group that suffered them.
    this.stats.deathsByGroup = {};
    this.stats.birthsByGroup = {};
    this.stats.mutationsByGroup = {};
    this.stats.traderVisitsByYear = {};
    this.camera = new Camera(this._viewCols(), this._viewRows(), GRID_COLS, GRID_ROWS);

    // Build per-group records (identity / color / script). For α23 the
    // resources stay colony-wide (see legacy storage/seeds/codex below).
    this.groups = this.groupSetup.map((setup, id) => createGroup(id, setup));
    // N1: initialise the share-flag matrix between every pair of groups.
    // Every entry defaults to false — a colony's resources are private
    // unless a flag is later set (no UI exposes this yet; it's wired up
    // for future diplomacy / alliance mechanics).
    for (const g of this.groups) {
      g.canUseFrom = {};
      for (const other of this.groups) {
        if (other.id === g.id) continue;
        g.canUseFrom[other.id] = false;
      }
    }

    // Spread groups around the map centre — each group gets its own
    // cluster of spawn tiles. With one group the cluster sits on the
    // map centre exactly (back-compat).
    this.colonists = [];
    const clusters = this._pickGroupClusters(this.groups.length);
    for (let gid = 0; gid < this.groups.length; gid++) {
      const group = this.groups[gid];
      const center = clusters[gid];
      // α25 follow-up (C1): remember each group's spawn anchor so the
      // breed script lays its rectangular field at a predictable spot
      // instead of wherever the first idle colonist happens to be.
      group.spawnAnchor = { x: center.x, y: center.y };
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
    let totalForage = 0;
    for (const grp of this.groups) {
      totalWood   += grp.startingWood       || 0;
      totalForage += grp.storage?.forage    || 0;
    }
    this.storage.wood = totalWood;
    // Aggregate any starter forage groups carry — e.g. the balanced
    // script's founding-year cushion. Without mirroring this into the
    // colony-wide aggregate, the sum-of-groups invariant in storageSub
    // (foodSystem.js) breaks and the first meal silently does nothing.
    this.storage.forage = totalForage;
    this.meals = { eaten: 0, missed: 0 };
    this.cropsLost = 0;
    this.pestsLost = 0;
    this.pestTimer = 0;
    this._pestEvent = false;
    this._coldEvent = false;
    this._coldActive = false;
    this._mutationEvent = null;
    // α27: fresh map = fresh history.
    this.history = { samples: [], timer: 0 };
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
   * of the map. D2: with two or more groups, every cluster (including
   * group 0) goes onto an outer ring so colonies start as far apart as
   * the map comfortably allows. Single-group games keep the historical
   * map-centre anchor for back-compat. The radius leaves a margin so a
   * dense same-group spawn search has room to spiral.
   */
  _pickGroupClusters(n) {
    const cx = (this.map.cols / 2) | 0;
    const cy = (this.map.rows / 2) | 0;
    if (n <= 1) return [{ x: cx, y: cy }];
    const margin = 6; // tiles to keep clear of the map edge
    const half = Math.min(this.map.cols, this.map.rows) / 2;
    const radius = Math.max(8, half - margin);
    const out = [];
    // For two groups, anchor the first slot at the same y as the centre
    // so the camera doesn't start tilted. For >2, a regular polygon
    // around the centre — equidistant neighbours, maximum spread.
    for (let i = 0; i < n; i++) {
      const angle = (i / n) * Math.PI * 2;
      const x = Math.round(cx + Math.cos(angle) * radius);
      const y = Math.round(cy + Math.sin(angle) * radius);
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

  /**
   * Q2: center the camera on the player-selected colonist when one is
   * picked from the Colonists panel; otherwise fall back to the first
   * colonist alive (legacy behaviour).
   */
  centerOnColonist() {
    let target = null;
    if (this.selectedColonist) {
      target = this.colonists.find((c) => c.name === this.selectedColonist);
    }
    if (!target) target = this.colonists[0];
    if (target) this.camera.centerOn(target.x + 0.5, target.y + 0.5);
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

  // The most recent legendary mutation, or null. One-shot popup.
  consumeMutationEvent() {
    const e = this._mutationEvent;
    this._mutationEvent = null;
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
  _animalNear(x, y, range, c)     { return asAnimalNear(this, x, y, range, c); }
  _nearestAnimalToColony(range)   { return asNearestAnimalToColony(this, range); }
  _nearestTree(colonist, range)   { return asNearestTree(this, colonist, range); }
  _nearestWildPlant(colonist, range) { return asNearestWildPlant(this, colonist, range); }

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
    // N2: every queued task carries the assignee's groupId (null for
    // "all colonists" orders, which any colonist may pick up). The
    // pick-up logic in _assignColonist filters by groupId so the queue
    // effectively partitions per group without us juggling N arrays.
    const push = (task) => {
      const c = assignee ? this.colonists.find((cc) => cc.name === assignee) : null;
      task.groupId = c ? c.groupId : null;
      this.taskQueue.push(task);
    };
    if (type === TaskType.MOVE) {
      if (tile.type === TileType.WATER) return 'err.onWater';
      if (assignee) {
        push(createTask(TaskType.MOVE, x, y, { assignee }));
      } else {
        // "All colonists" + Move: send every colonist to the tile.
        if (this.colonists.length === 0) return 'err.noColonist';
        for (const c of this.colonists) {
          const t = createTask(TaskType.MOVE, x, y, { assignee: c.name });
          t.groupId = c.groupId;
          this.taskQueue.push(t);
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
      push(createTask(TaskType.BUILD, x, y, { structure, assignee }));
      return null;
    }
    if (type === TaskType.HUNT) {
      const animal = this._animalNear(x, y, 1.6);
      if (!animal) return 'err.noAnimal';
      push(createTask(TaskType.HUNT, animal.tileX, animal.tileY, { animalId: animal.id, assignee }));
      return null;
    }
    push(createTask(type, x, y, { cropId: opts.cropId || null, assignee }));
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
  // R1: three-tier groupId fallback so every work log lands in the right
  // per-group tab:
  //   1. assignee's group (player-issued "give Ada this task" orders)
  //   2. task.groupId    (N2 stamp, set on enqueue for "All colonists"
  //                       orders and on the breed-cull WEED queue)
  //   3. colonist.groupId (autonomy tasks built directly by
  //                       _autonomousTask have no assignee or groupId,
  //                       so this final fallback uses the worker who
  //                       just completed the task)
  // Without (3), HARVEST / SOW / TILL / WEED / COOK / etc. produced by
  // autonomy ended up in the "All" tab only.
  _logWorkTask(task, colonist) {
    if (!WORK_TYPES.includes(task.type)) return;
    if (task.type === TaskType.STORE || task.type === TaskType.FETCH) return;
    let where = `${t('task.' + task.type)} (${task.x}, ${task.y})`;
    let groupId;
    if (task.assignee) {
      where += ` · ${task.assignee}`;
      const c = this.colonists.find((x) => x.name === task.assignee);
      if (c) groupId = c.groupId;
    }
    if (groupId == null && task.groupId != null) groupId = task.groupId;
    if (groupId == null && colonist) groupId = colonist.groupId;
    this._pushLog({
      icon: task.status === 'done' ? '✓' : '✗',
      text: `${where} — ${this._outcomeText(task)}`,
      cls: task.status === 'done' ? 'log-ok' : 'log-fail',
      groupId,
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
          // BUG-3 fix: a successful harvest proves this tile can grow this
          // crop, so clear its wither streak. Only the relevant cropId is
          // cleared — bad streaks for *other* crops on the same tile stay.
          if (tile.witherStreak && tile.witherStreak[plant.cropId]) {
            tile.witherStreak[plant.cropId] = 0;
          }
          storageAdd(this, colonist?.groupId, plant.cropId, n);
          // Alpha 24: blend the harvested batch's quality (from the seed's
          // ★ rank, mapped 0..1) into whatever stock was already on hand.
          // Higher-quality seeds bring better cook outputs downstream.
          const q = Math.max(0, Math.min(1, qualityRank(plant.genome) / 4));
          if (!this.storage.quality) this.storage.quality = {};
          const prevQ = this.storage.quality[plant.cropId] ?? 0.5;
          const newCount = prevCount + n;
          this.storage.quality[plant.cropId] =
            (prevQ * prevCount + q * n) / Math.max(1, newCount);
          this._recordCodex(plant.cropId, plant.genome, colonist?.groupId);
          const seeds = this._gatherSeeds(plant, colonist?.groupId);
          task.outcome = 'harvested';
          task.outcomeData = { crop: plant.cropId, n, seeds };
        }
        const i = this.crops.indexOf(plant);
        if (i >= 0) this.crops.splice(i, 1);
      } else if (plant && plant.kind === PlantKind.TREE) {
        // Chopping a tree yields wood and leaves a fresh stump behind.
        const wood = Math.max(1, Math.round(TREE_WOOD_YIELD * (plant.growth || 1)));
        storageAdd(this, colonist?.groupId, 'wood', wood);
        tile.plant = { kind: PlantKind.STUMP, regrowAt: this.clock + STUMP_REGROW_TIME };
        task.outcome = 'chopped';
        task.outcomeData = { n: wood };
        return;
      } else if (plant && plant.kind === PlantKind.STUMP) {
        // A stump has no harvest to give — wait for the regrow.
        task.outcome = 'stump';
        return;
      } else if (plant) {
        storageAdd(this, colonist?.groupId, 'forage', 1);
        storageAdd(this, colonist?.groupId, 'wood', WILD_WOOD_YIELD);
        // Low chance to gather an ancestor seed from the foraged plant.
        // α27: every wild plant carries a `wildId` for one of the five
        // ancestor species; the dropped seed matches that id so foraging
        // discovers whichever ancestor lives on this tile. Old saves
        // without wildId fall back to wildgreens.
        let seeds = 0;
        const wildId = plant.wildId || 'wildgreens';
        if (Math.random() < WILDGREENS_SEED_CHANCE) {
          const genome = freshGenome();
          this._addSeed(wildId, genome, colonist?.groupId);
          seeds = 1;
        }
        if (seeds > 0) {
          task.outcome = 'foragedSeed';
          task.outcomeData = { n: 1, seeds, crop: wildId };
        } else {
          task.outcome = 'foraged';
          task.outcomeData = { crop: wildId };
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
      const seed = this._takeSeed(task.cropId, colonist?.groupId);
      if (!seed) {
        task.outcome = 'noSeed';
        task.outcomeData = { crop: task.cropId };
      } else {
        const cropDef = getCrop(task.cropId);
        const suitability = cropSuitability(cropDef, tile);
        const bonus = (tile.tilled ? TILL_SURVIVAL_BONUS : 0) + survivalGeneBonus(seed.genome);
        const doomed = Math.random() >= survivalChance(suitability, bonus);
        // E3: tag the new crop with the sower's group so other-group
        // colonists don't auto-harvest / water / weed it (which would
        // drag them across the map and into idle loops).
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
          ownerId: colonist?.groupId,
        };
        tile.plant = crop;
        this.crops.push(crop);
        task.outcome = 'sowed';
        task.outcomeData = { crop: task.cropId, rank: qualityRank(seed.genome) };
      }
    } else if (task.type === TaskType.TILL) {
      tile.tilled = true;
      // E3: stamp the tile with the tiller's group so adjacency bonuses
      // and auto-sow only see "their own" farmland.
      tile.tilledBy = colonist?.groupId;
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
        storageAdd(this, colonist?.groupId, 'meat', meat);
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
          // B3 / N4: debit the builder's group ledger first; if their
          // group is short, fall back to the largest *allowed* lender
          // (own group is always allowed; foreign groups only when the
          // share-flag is on). With every flag off, this collapses to
          // own-group only — but the build was gated by
          // _canAffordBuild() on colony aggregate, so a shortage here
          // is a race we tolerate by simply burning the colony pool.
          const builderGid = colonist?.groupId;
          const builderGroup = this.groups?.[builderGid];
          if (builderGroup && (builderGroup.storage?.wood || 0) >= cost) {
            storageSub(this, builderGid, 'wood', cost);
          } else {
            let lender = null;
            let bestWood = 0;
            for (const grp of (this.groups || [])) {
              if (!this._canUseFrom(builderGid, grp.id)) continue;
              const w = grp.storage?.wood || 0;
              if (w > bestWood) { bestWood = w; lender = grp; }
            }
            storageSub(this, lender ? lender.id : builderGid, 'wood', cost);
          }
          tile.structure = task.structure;
          if (task.structure === 'hearth') this.hearths.push({ x: task.x, y: task.y, ownerId: colonist?.groupId });
          if (task.structure === 'stockpile' || task.structure === 'stockpile_med' || task.structure === 'stockpile_large') {
            const cap = STOCKPILE_CAP_BY_TYPE[task.structure] || STOCKPILE_CAP;
            // B2: tag the new stockpile with the builder's group so the
            // per-group panels can later show "your warehouses" and so
            // autonomy can prefer own-group stockpiles for FETCH/STORE.
            this.stockpiles.push({
              x: task.x, y: task.y,
              type: task.structure,
              cap,
              ownerId: colonist?.groupId,
              items: this._freshStockpileItems(),
            });
          }
          if (task.structure === 'hut' || task.structure === 'hut_med' || task.structure === 'hut_large') {
            const cap = HUT_CAPACITY_BY_TYPE[task.structure] || 1;
            this.huts.push({ x: task.x, y: task.y, type: task.structure, cap, ownerId: colonist?.groupId });
          }
          if (task.structure === 'fence') this.fences.push({ x: task.x, y: task.y, ownerId: colonist?.groupId });
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
        // B2: ingredients are consumed from / output filed under the
        // cook's group, so per-group ledgers stay accurate.
        const cookerGid = colonist?.groupId;
        let cooked = 0;
        const dishesMade = {};
        while (cooked < COOK_BATCH) {
          const recipe = csCookOne(this, cookerGid);
          if (!recipe) break;
          dishesMade[recipe.id] = (dishesMade[recipe.id] || 0) + recipe.out;
          cooked += recipe.out;
        }
        // Legacy fallback: convert one raw item into a generic meal so
        // the colony never starves just because no full recipe matched.
        // N4: ingredients are pulled from groups the cooker is allowed
        // to use — own group always, foreign groups only when the
        // share flag is on. With every flag off this means own-group
        // only, and a cooker with no raw food just stops cooking.
        const allowedSrc = {};
        for (const ft of FOOD_TYPES) {
          let n = 0;
          for (const grp of (this.groups || [])) {
            if (!this._canUseFrom(cookerGid, grp.id)) continue;
            n += grp.storage?.[ft] || 0;
          }
          allowedSrc[ft] = n;
        }
        while (cooked < COOK_BATCH) {
          let pick = null;
          for (const ft of FOOD_TYPES) {
            if (allowedSrc[ft] > 0 && (pick === null || allowedSrc[ft] > allowedSrc[pick])) {
              pick = ft;
            }
          }
          if (pick === null) break;
          storageSub(this, cookerGid, pick, 1);
          storageAdd(this, cookerGid, 'meal', 1);
          allowedSrc[pick] -= 1;
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
          // Per-group attribution (α25): the colonist scrapping the
          // crop is the one charged with the loss.
          const grp = this.groups?.[colonist?.groupId];
          if (grp) grp.cropsLost += 1;
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
        // B2: the hauler's group is the one whose on-hand store is
        // decremented. The stockpile's items map is colony-wide; the
        // owning group is tracked on sp.ownerId for future per-group
        // policies but not enforced on hauling yet.
        const haulerGid = colonist?.groupId;
        let space = (sp.cap || STOCKPILE_CAP) - this.stockpileFood(sp);
        // N4: the hauler can only carry what they're allowed to hold —
        // their own on-hand food, or a flagged-on group's. Build a
        // synthetic "allowed source" store the picker can compare
        // against. With flags off (default), this collapses to the
        // hauler's own on-hand store.
        const allowedSrc = {};
        for (const ft of FOOD_TYPES) {
          let n = 0;
          for (const grp of (this.groups || [])) {
            if (!this._canUseFrom(haulerGid, grp.id)) continue;
            n += grp.storage?.[ft] || 0;
          }
          allowedSrc[ft] = n;
        }
        allowedSrc.meal = 0;
        for (const grp of (this.groups || [])) {
          if (!this._canUseFrom(haulerGid, grp.id)) continue;
          allowedSrc.meal += grp.storage?.meal || 0;
        }
        while (moved < HAUL_BATCH && space > 0) {
          const it = this._largestFood(allowedSrc, FOOD_TYPES);
          const food = it || (allowedSrc.meal > 0 ? 'meal' : null);
          if (!food) break;
          storageSub(this, haulerGid, food, 1);
          allowedSrc[food] = (allowedSrc[food] || 0) - 1;
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
        // B2: items leaving a stockpile become on-hand for the fetcher's
        // group (so the per-group panel sees what they brought home).
        const fetcherGid = colonist?.groupId;
        while (moved < HAUL_BATCH) {
          const it = this._largestFood(sp.items, STOCKPILE_ITEMS);
          if (!it) break;
          sp.items[it] -= 1;
          storageAdd(this, fetcherGid, it, 1);
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

  // True if any hut variant stands within HUT_RANGE tiles of (x, y).
  _hutNear(x, y) {
    for (let dy = -HUT_RANGE; dy <= HUT_RANGE; dy++) {
      const row = this.map.tiles[y + dy];
      if (!row) continue;
      for (let dx = -HUT_RANGE; dx <= HUT_RANGE; dx++) {
        const tile = row[x + dx];
        if (!tile) continue;
        if (tile.structure === 'hut' || tile.structure === 'hut_med' || tile.structure === 'hut_large') {
          return true;
        }
      }
    }
    return false;
  }

  /** Total bed-slots across every hut the colony owns (α26 tier-2 huts). */
  _hutCapacity() {
    let n = 0;
    for (const h of this.huts) n += h.cap || 1;
    return n;
  }

  // G1: every colony-wide "do we have enough X" judgement now has a
  // per-group variant. The autonomy uses these so a Colony B colonist
  // builds for Colony B even if the colony as a whole already has the
  // structure (e.g. Colony A's hut). Each helper falls back to its
  // colony-wide counterpart when `gid` is null.

  /** Total bed-slots across this group's huts only. */
  _hutCapacityFor(gid) {
    if (gid == null) return this._hutCapacity();
    let n = 0;
    for (const h of this.huts) if (h.ownerId === gid) n += h.cap || 1;
    return n;
  }

  /** Number of huts this group owns. */
  _hutCountFor(gid) {
    if (gid == null) return this.huts.length;
    let n = 0;
    for (const h of this.huts) if (h.ownerId === gid) n++;
    return n;
  }

  /** Number of hearths this group owns. */
  _hearthCountFor(gid) {
    if (gid == null) return this.hearths.length;
    let n = 0;
    for (const h of this.hearths) if (h.ownerId === gid) n++;
    return n;
  }

  /** Stockpile count owned by this group. */
  _stockpileCountFor(gid) {
    if (gid == null) return this.stockpiles.length;
    let n = 0;
    for (const s of this.stockpiles) if (s.ownerId === gid) n++;
    return n;
  }

  /** Average fill ratio (0..1) of this group's stockpiles. */
  _warehouseUtilizationFor(gid) {
    let used = 0;
    let cap = 0;
    for (const sp of this.stockpiles) {
      if (gid != null && sp.ownerId !== gid) continue;
      used += this.stockpileFood(sp);
      cap += sp.cap || STOCKPILE_CAP;
    }
    return cap > 0 ? used / cap : 0;
  }

  /** This group's warehouses are essentially full — autonomy pivots hard. */
  _warehousesCriticalFor(gid) {
    if (this._stockpileCountFor(gid) === 0) return false;
    return this._warehouseUtilizationFor(gid) >= 0.95;
  }

  /** On-hand + own-stockpile food this group holds, for per-group food/head. */
  _totalFoodFor(gid) {
    if (gid == null) return this.totalFood;
    const g = this.groups?.[gid];
    if (!g) return 0;
    let n = 0;
    for (const id of STOCKPILE_ITEMS) {
      if (id === 'wood') continue;
      n += g.storage[id] || 0;
    }
    for (const sp of this.stockpiles) {
      if (sp.ownerId !== gid) continue;
      n += this.stockpileFood(sp);
    }
    return n;
  }

  /**
   * N1: can `actorGid` consume / use a resource owned by `ownerGid`?
   * Same-group is always yes. Cross-group is gated by the per-group
   * share-flag matrix (all flags default to false). null ownerId is
   * treated as colony-wide (everyone may use it).
   */
  _canUseFrom(actorGid, ownerGid) {
    if (ownerGid == null) return true;
    if (actorGid === ownerGid) return true;
    const g = this.groups?.[actorGid];
    return !!(g && g.canUseFrom && g.canUseFrom[ownerGid]);
  }

  /**
   * H2: per-group raw on-hand food. Used by the auto-cook trigger so
   * Colony B only fires a COOK task when B itself has raw ingredients
   * (otherwise B would walk to Colony A's hearth on Colony A's food).
   */
  _rawFoodFor(gid) {
    if (gid == null) return this.rawFood;
    const g = this.groups?.[gid];
    if (!g) return 0;
    let n = 0;
    for (const ft of FOOD_TYPES) n += g.storage[ft] || 0;
    return n;
  }

  /**
   * H2: per-group "hearths lit". A hearth burns own-group wood; with no
   * own-group hearth or no own-group wood there's nothing to cook on,
   * regardless of what the rest of the colony has.
   */
  _hearthsLitFor(gid) {
    if (gid == null) return this.hearthsLit;
    const g = this.groups?.[gid];
    if (!g) return false;
    const own = this.hearths.some((h) => h.ownerId === gid);
    return own && (g.storage.wood || 0) > 0;
  }

  /**
   * D4 / E2 / G1 / N4: pick the closest hut for `colonist` that they're
   * allowed to use. Own-group huts always qualify; another group's hut
   * only qualifies when this group's canUseFrom flag for that owner is
   * set (all flags default off — future hook for diplomacy / alliance
   * mechanics). Returns null when no usable hut exists; the E1
   * escalation in _assignColonist then BUILDs a fresh own-group hut.
   * Huts the colonist recently failed to reach are skipped via the
   * per-colonist unreachable cache.
   */
  _nearestHut(colonist) {
    if (!this.huts || this.huts.length === 0) return null;
    const gid = colonist.groupId;
    const clock = this.clock;
    let best = null;
    let bestD = Infinity;
    for (const h of this.huts) {
      if (!this._canUseFrom(gid, h.ownerId)) continue;
      if (colonist.isUnreachable?.(h.x, h.y, clock)) continue;
      const d = Math.hypot(h.x - colonist.tileX, h.y - colonist.tileY);
      if (d < bestD) { bestD = d; best = h; }
    }
    return best;
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
    // (alpha 21). Injured colonists prefer a hut when one exists.
    if (colonist.health < INJURY_THRESHOLD) {
      const hut = this._nearestHut(colonist);
      if (hut) return createTask(TaskType.REST, hut.x, hut.y);
      return createTask(TaskType.REST, colonist.tileX, colonist.tileY);
    }
    // D4 / E1: a sleep-deprived colonist walks back to a hut — even a
    // long trek across the map — to actually rest in bed. If every hut
    // is unreachable, escalate: build a new one (own group's land);
    // if the colony can't afford it, chop the nearest tree to gather
    // wood. Only after all three fall through do we sleep on the spot.
    if (colonist.sleep !== undefined && colonist.sleep < SLEEP_DEFICIT_THRESHOLD) {
      const hut = this._nearestHut(colonist);
      if (hut) return createTask(TaskType.SLEEP, hut.x, hut.y);
      // No usable hut — escalate. Try BUILD a hut variant the colony
      // can afford, on land near the colonist's own-group anchor.
      for (const variant of ['hut', 'hut_med', 'hut_large']) {
        if (!this._canAffordBuild(variant)) continue;
        const spot = this._findFreeLandNear(colonist) || this._findFreeLandColonyWide?.(colonist);
        if (spot) {
          return createTask(TaskType.BUILD, spot.x, spot.y, { structure: variant });
        }
      }
      // Can't afford any hut variant — chop a tree to unblock the cost.
      const tree = this._nearestTree(colonist, 12);
      if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
      return createTask(TaskType.SLEEP, colonist.tileX, colonist.tileY);
    }
    // A content colonist works; a miserable one may slack off instead.
    const willWork = colonist.mood >= 0.3 || Math.random() < 0.5;
    if (willWork) {
      // N2: take a queued task that's either addressed to this colonist
      // by name OR addressed to "all colonists" — and from a queue
      // partition this colonist's group may serve. task.groupId is set
      // at enqueue time; null means a colony-wide order (anyone may
      // pick it up).
      const gid = colonist.groupId;
      const idx = this.taskQueue.findIndex((task) => {
        if (task.assignee && task.assignee !== colonist.name) return false;
        if (task.groupId != null && task.groupId !== gid) return false;
        return true;
      });
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
  _findFreeLandColonyWide(c, r) { return bsFindFreeLandColonyWide(this, c, r); }
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
        this._logWorkTask(task, c);
        c.currentTask = null;
      }
      if (!c.currentTask) {
        c.assignTask(this._assignColonist(c), this.map);
        if (c.currentTask && c.currentTask.status === 'failed') {
          // E2: an unreachable target shouldn't be picked again on the
          // very next tick — memoize it on the colonist so the autonomy
          // scan looks past it. Other failure modes (occupied / noPlant
          // / noWood) settle themselves next frame as the world updates.
          if (c.currentTask.outcome === 'unreachable') {
            c.markUnreachable(c.currentTask.x, c.currentTask.y, this.clock);
          }
          this._logWorkTask(c.currentTask, c);
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
          // BUG-4 fix: stats counter survives the 1000-entry log rotation.
          const dbg = this.stats.deathsByGroup;
          if (dbg) dbg[c.groupId] = (dbg[c.groupId] || 0) + 1;
          this._pushLog({
            icon: '☠',
            text: t('log.died', { name: c.name }),
            cls: 'log-fail',
            groupId: c.groupId,
          });
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
        // BUG-3 fix: track wither streak per (tile, cropId). Once a tile
        // racks up 3+ withers for the same crop, the auto-sow / auto-till
        // pickers skip it for that crop — the suitability is clearly too
        // low to be worth a fourth seed. The streak resets when a crop of
        // the same kind is harvested successfully on the tile.
        if (!tile.witherStreak) tile.witherStreak = {};
        tile.witherStreak[crop.cropId] = (tile.witherStreak[crop.cropId] || 0) + 1;
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
  _runSelectiveBreedingCulls() { return runSelectiveBreedingCulls(this); }

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
    // Belt + suspenders: even with the get-speed() guard a caller could
    // hand in a non-finite realDt. Skip the frame instead of poisoning
    // clock / environment with NaN.
    if (!Number.isFinite(simDt) || simDt <= 0) return;
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
    this._sampleHistory(simDt);
    // Surviving the three-year goal lights the celebration overlay once.
    esCheckVictory(this);
  }

  /**
   * α27: sample the colony's headline numbers every HISTORY_INTERVAL
   * sim-seconds into a ring buffer. The Run-history panel walks this
   * buffer to draw sparklines. Sampling is cheap (eight numbers per
   * tick), so we keep up to HISTORY_SIZE entries — about 1.4 game-years
   * at the default 10-second interval.
   */
  _sampleHistory(simDt) {
    if (!this.history) return;
    this.history.timer += simDt;
    if (this.history.timer < HISTORY_INTERVAL) return;
    this.history.timer = 0;
    let seedTotal = 0;
    for (const id of Object.keys(this.seeds)) seedTotal += this.seeds[id]?.length || 0;
    const sample = {
      t: this.clock,
      population: this.colonists.length,
      totalFood: this.totalFood,
      wood: Math.floor(this.storage.wood || 0),
      seedTotal,
      mealsEaten: this.meals.eaten,
      mealsMissed: this.meals.missed,
      cropsLost: this.cropsLost,
      animals: this.animals.length,
    };
    this.history.samples.push(sample);
    if (this.history.samples.length > HISTORY_SIZE) this.history.samples.shift();
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
