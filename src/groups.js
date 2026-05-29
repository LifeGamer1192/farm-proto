// Colony groups (alpha 23). The game can host 1-8 groups in parallel.
// Each group has its own colonists, storage, seed stock, codex, owned
// buildings/crops, fence plan and autonomy script. Use of resources is
// open between groups (a colonist from group A can store food in group
// B's warehouse), but ownership is always tracked.
//
// A "group" here is a flat data record — the game module is responsible
// for the lifecycle (creation in newMap, mutation by tasks). Keeping
// groups plain makes the per-group bookkeeping easy to serialise later
// (save / load / mods) without dragging class methods along.

import { STARTING_WOOD } from './config.js';
import { CROP_IDS, WILD_CROP_IDS, CROP_TYPES, getCrop, seedGenome } from './crops.js';

const CROP_TYPES_HAS = (id) => Object.prototype.hasOwnProperty.call(CROP_TYPES, id);
import { freshGenome, genomeQuality } from './genetics.js';

/**
 * Color palette for the eight possible group slots. Each entry is a
 * paired (light fill, dark stroke) used by the colonist sprite and the
 * group's UI accent chip. Picked so the colors stay distinguishable on
 * the grassy / sandy / blue map tints.
 */
export const GROUP_COLORS = [
  { id: 'amber',  fill: '#f0a040', stroke: '#7a4a0c' },
  { id: 'azure',  fill: '#5aa0e8', stroke: '#1e4a7a' },
  { id: 'rose',   fill: '#e070a8', stroke: '#7a1e4a' },
  { id: 'mint',   fill: '#62d49a', stroke: '#1c6b3e' },
  { id: 'violet', fill: '#a070e0', stroke: '#3e1e7a' },
  { id: 'sun',    fill: '#f0d050', stroke: '#7a5a0c' },
  { id: 'coral',  fill: '#ff7a6a', stroke: '#7a2a1e' },
  { id: 'slate',  fill: '#9eb0c4', stroke: '#3a4a5e' },
];

/**
 * Autonomy script catalogue (alpha 23). Each script is a function
 * (game, colonist) → task | null. The default script is the existing
 * decision tree from src/autonomy.js; "farmer" prioritises sowing /
 * tilling over fences and hunting; "scout" prioritises hunting and
 * exploration over infrastructure. Groups pick by id at setup.
 *
 * Game wires the actual functions in via `registerScript(id, fn)` at
 * boot, so this module stays independent of autonomy.js (avoids a
 * circular import). The id list below is the menu the start UI shows.
 */
export const AUTONOMY_SCRIPTS = ['balanced', 'farmer', 'farmer_breed', 'scout', 'temperate', 'builder'];

const _scriptRegistry = new Map();

export function registerScript(id, fn) {
  _scriptRegistry.set(id, fn);
}

export function getScript(id) {
  return _scriptRegistry.get(id) || _scriptRegistry.get('balanced');
}

/**
 * Build the per-group seed stock + codex from a list of starting crops.
 * Returns { seeds, codex, startingCrops } so the caller can assign them
 * onto the group record in one shot.
 */
export function freshSeedsForGroup(startingCrops, seedsPerCrop) {
  const seeds = {};
  for (const id of CROP_IDS) {
    const list = [];
    if (startingCrops.includes(id)) {
      for (let i = 0; i < seedsPerCrop; i++) list.push({ genome: seedGenome(id) });
    }
    seeds[id] = list;
  }
  const codex = {};
  for (const id of CROP_IDS) {
    const list = seeds[id];
    if (!list || list.length === 0) continue;
    let best = list[0].genome;
    for (const s of list) {
      if (genomeQuality(s.genome) > genomeQuality(best)) best = s.genome;
    }
    codex[id] = { origin: list[0].genome, best };
  }
  return { seeds, codex };
}

/**
 * Pick a starting crop assortment. Wildgreens is excluded (foraging
 * discovery only); a grain is guaranteed for the staple slot.
 */
export function pickStartingCropsForGroup(want = 8) {
  const wild = new Set(WILD_CROP_IDS);
  const eligible = CROP_IDS.filter((id) => !wild.has(id));
  const grains = eligible.filter((id) => getCrop(id).category === 'grain');
  const others = eligible.filter((id) => getCrop(id).category !== 'grain');
  const pick = (pool) => pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
  const chosen = [pick([...grains])];
  const pool = [...grains, ...others].filter((id) => !chosen.includes(id));
  while (chosen.length < want && pool.length) chosen.push(pick(pool));
  return chosen;
}

/**
 * Aggregate every group's seed stock into a single colony-wide pool.
 * For alpha 23 the pool is colony-wide (resources are shared); each
 * group still tracks its own starter assortment for identity purposes.
 */
export function aggregateSeeds(groups) {
  const pool = {};
  for (const id of CROP_IDS) pool[id] = [];
  for (const g of groups) {
    for (const id of CROP_IDS) {
      const list = g.seeds[id];
      if (list && list.length) for (const s of list) pool[id].push(s);
    }
  }
  return pool;
}

/** Build a colony-wide codex from groups' codexes (best variety wins). */
export function aggregateCodex(groups) {
  const codex = {};
  for (const g of groups) {
    for (const [id, entry] of Object.entries(g.codex)) {
      if (!codex[id]) {
        codex[id] = { origin: entry.origin, best: entry.best };
      } else if (genomeQuality(entry.best) > genomeQuality(codex[id].best)) {
        codex[id].best = entry.best;
      }
    }
  }
  return codex;
}

/** Union of starting crops across all groups (dedup). */
export function aggregateStartingCrops(groups) {
  const seen = new Set();
  for (const g of groups) for (const id of g.startingCrops) seen.add(id);
  return [...seen];
}

/**
 * Make a fresh group record. `setup` overrides the defaults (script,
 * colonist count, seeds per crop). The caller is responsible for
 * populating `colonists` (they're spawned at the cluster centre).
 */
export function createGroup(id, setup = {}) {
  const color = GROUP_COLORS[id % GROUP_COLORS.length];
  const scriptId = AUTONOMY_SCRIPTS.includes(setup.scriptId) ? setup.scriptId : 'balanced';

  // Alpha 25: if the setup carries an explicit `initialSeeds` array
  // (the start-screen seed picker emits this) honour it verbatim —
  // each entry is `{ id, count }` and only the listed crops are
  // seeded. B1: an EMPTY array is honoured too (the player chose
  // "None" for every slot → start with zero seeds); only a missing
  // array falls back to the random α23 starter assortment.
  let seeds;
  let codex;
  let startingCrops;
  if (Array.isArray(setup.initialSeeds)) {
    seeds = {};
    codex = {};
    startingCrops = [];
    for (const id of CROP_IDS) seeds[id] = [];
    for (const slot of setup.initialSeeds) {
      const cropId = slot.id;
      if (!CROP_TYPES_HAS(cropId)) continue;
      startingCrops.push(cropId);
      const list = seeds[cropId];
      for (let i = 0; i < (slot.count | 0); i++) list.push({ genome: seedGenome(cropId) });
      if (list.length > 0) {
        let best = list[0].genome;
        for (const s of list) {
          if (genomeQuality(s.genome) > genomeQuality(best)) best = s.genome;
        }
        codex[cropId] = { origin: list[0].genome, best };
      }
    }
  } else {
    startingCrops = setup.startingCrops || pickStartingCropsForGroup(setup.seedTypes || 8);
    const seedsPerCrop = setup.seedsPerCrop ?? 12;
    ({ seeds, codex } = freshSeedsForGroup(startingCrops, seedsPerCrop));
  }

  // Per-group starting wood — defaults to STARTING_WOOD if not set.
  // The colony's shared pool is the sum across every group, so a setup
  // with 4 groups × 30 wood begins with 120 wood total.
  const startingWood = Number.isFinite(setup.startingWood)
    ? Math.max(0, setup.startingWood | 0)
    : STARTING_WOOD;
  const storage = { wood: startingWood, meal: 0 };
  for (const cid of CROP_IDS) storage[cid] = 0;
  // α26 follow-up: a balanced colony gets a small starter forage so it
  // can ride out the founding-year sow→grow gap without starving. Other
  // scripts get nothing — farmer/farmer_breed start sowing immediately
  // and don't need the cushion, while the scout script is intentionally
  // left disadvantaged so the player feels the cost of hunting alone.
  const colonistCount = setup.colonistCount ?? 4;
  const BALANCED_STARTER_FORAGE_PER_HEAD = 6;
  storage.forage = (scriptId === 'balanced')
    ? colonistCount * BALANCED_STARTER_FORAGE_PER_HEAD
    : 0;
  storage.meat = 0;

  return {
    id,
    name: setup.name || `Colony ${String.fromCharCode(65 + id)}`,
    color,
    scriptId,
    colonistCount: setup.colonistCount ?? 4,
    startingWood,
    startingCrops,
    seeds,
    codex,
    storage,
    colonists: [],
    meals: { eaten: 0, missed: 0 },
    cropsLost: 0,
    pestsLost: 0,
    pestTimer: 0,
    fencePlan: null,
    fencePlanAt: -Infinity,
    birthCounter: 0,
    traderYear: 0,
    // α26: per-group selective-breeding state. fieldPlan is the
    // rectangular field the breed script tills/sows row-by-row; null
    // until the script first runs. lastCullSeason gates the quarterly
    // cull so we don't run it twice on the same season boundary.
    fieldPlan: null,
    lastCullSeason: null,
    // N1: per-group share-flag matrix. canUseFrom[otherGid] = true means
    // this group is allowed to consume buildings / crops / food / seeds
    // owned by `otherGid`. Same-group access is always allowed (no flag
    // needed). Default: every flag off — colonies are strictly siloed
    // until the player (or a future diplomacy event) toggles a flag on.
    canUseFrom: {},
    // N1: per-group task queue. Tasks created with this group's
    // ownership go here; _assignColonist scans the colonist's own queue
    // first (plus colony-wide tasks without a groupId). The combined
    // task count is mirrored into game.taskQueue for UI / pendingSows
    // accounting.
    taskQueue: [],
  };
}
