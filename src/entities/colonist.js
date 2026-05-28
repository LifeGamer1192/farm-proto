// A colonist: a worker that walks the map and carries out tasks, and now
// has survival stats — hunger, health and mood.
//
// The game assigns one task at a time (work from the queue, or a personal
// task — eat / rest / leisure / sleep — chosen by its priority AI). The
// colonist walks to the task's tile, spends the task's work phase there,
// and marks it done (or failed). Each update it also ages its stats:
// hunger climbs, starvation eats health, and health recovers when fed.

import { findPath, findPathStaged } from '../core/pathfinder.js';
import { TileType } from '../map/tile.js';
import { TaskType } from '../tasks.js';
import { isRipe } from '../crops.js';
import {
  COLONIST_SPEED,
  WORK_DURATION,
  EAT_DURATION,
  REST_DURATION,
  SLEEP_DURATION,
  HUNT_DURATION,
  BUILD_DURATION,
  COOK_DURATION,
  HAUL_DURATION,
  HUNGER_RATE,
  STARVE_RATE,
  HEALTH_REGEN,
  HEALTH_REGEN_HUNGER,
  MOOD_ADAPT,
  MAX_SKILL_MULT,
  SKILL_TIME_TO_MASTER,
  SKILL_START_RANGE,
  SLEEP_DRAIN_RATE,
  SLEEP_RECOVER_RATE,
  SLEEP_DEFICIT_THRESHOLD,
  SLEEP_WORK_PENALTY,
  SLEEP_MOOD_PENALTY,
} from '../config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// How long an unreachable-tile memo stays valid (sim-seconds). After
// this the cache forgets and the colonist may retry — covers the case
// where a fence got knocked down or new land was tilled.
// T6 (α27 followup): bumped 30 → 120 so a colonist who can't reach a
// pocket of land doesn't keep retrying every 30 s with the same answer.
// Two in-game minutes is long enough that "I tried that, it's blocked"
// stays remembered through a build / chop cycle, short enough that a
// real geographic change still re-opens the area.
const UNREACHABLE_TTL = 120;
// L1: when a tile fails as unreachable, also cache the Chebyshev-distance
// ≤ this many tiles around it. A boar on the far side of a river makes
// every nearby till spot equally unreachable; one failure should disable
// the whole pocket instead of having the autonomy reprobe each tile.
// T6: bumped 3 → 5 so a failed till-spot kills off a wider patch of
// candidates and the autonomy stops cycling through near-identical
// targets behind the same barrier.
const UNREACHABLE_RADIUS = 5;

// Seconds of "work" each task type spends once the colonist has arrived.
const WORK_PHASE = {
  [TaskType.MOVE]: 0,
  [TaskType.LEISURE]: 0,
  [TaskType.SOW]: WORK_DURATION,
  [TaskType.HARVEST]: WORK_DURATION,
  [TaskType.TILL]: WORK_DURATION,
  [TaskType.WATER]: WORK_DURATION,
  [TaskType.WEED]: WORK_DURATION,
  [TaskType.HUNT]: HUNT_DURATION,
  [TaskType.BUILD]: BUILD_DURATION,
  [TaskType.COOK]: COOK_DURATION,
  [TaskType.STORE]: HAUL_DURATION,
  [TaskType.FETCH]: HAUL_DURATION,
  [TaskType.EAT]: EAT_DURATION,
  [TaskType.REST]: REST_DURATION,
  [TaskType.SLEEP]: SLEEP_DURATION,
};

// Which skill earns experience for each work type.
const TASK_SKILL = {
  [TaskType.SOW]: 'farming',
  [TaskType.HARVEST]: 'farming',
  [TaskType.TILL]: 'farming',
  [TaskType.WATER]: 'farming',
  [TaskType.WEED]: 'farming',
  [TaskType.COOK]: 'farming',
  [TaskType.HUNT]: 'strength',
  [TaskType.BUILD]: 'building',
};

// A random starting value in the [lo, hi] range.
const startSkill = () => {
  const [lo, hi] = SKILL_START_RANGE;
  return lo + Math.random() * (hi - lo);
};

// Display state shown while a colonist works a task.
const WORK_STATE = {
  [TaskType.SOW]: 'working',
  [TaskType.HARVEST]: 'working',
  [TaskType.TILL]: 'working',
  [TaskType.WATER]: 'working',
  [TaskType.WEED]: 'weeding',
  [TaskType.HUNT]: 'hunting',
  [TaskType.BUILD]: 'building',
  [TaskType.COOK]: 'cooking',
  [TaskType.STORE]: 'hauling',
  [TaskType.FETCH]: 'hauling',
  [TaskType.EAT]: 'eating',
  [TaskType.REST]: 'resting',
  [TaskType.SLEEP]: 'sleeping',
};

export class Colonist {
  constructor(x, y, name, groupId = 0) {
    this.x = x;
    this.y = y;
    this.name = name;
    this.groupId = groupId; // colony group ownership (alpha 23)
    this.path = [];
    this.state = 'idle';
    this.currentTask = null;
    this.workTimer = 0;

    // Survival stats (0..1).
    this.hunger = 0; // 0 full, 1 starving
    this.health = 1; // 1 healthy, 0 dead
    this.mood = 0.8; // 1 content, 0 miserable
    this.sleep = 1;  // 1 well-rested, 0 exhausted (alpha 21)
    this.eatCooldown = 0; // delay before seeking food again
    this.cold = false; // suffering from the cold (set by the game each tick)
    this.dead = false;

    // Skills (alpha 21) — each 0..1 of experience. Multiplier scales
    // linearly from 1× at 0 up to MAX_SKILL_MULT× at 1. Starting values
    // are randomised so the four colonists feel distinct.
    this.skills = {
      farming:  startSkill(),
      agility:  startSkill(),
      strength: startSkill(),
      building: startSkill(),
    };

    // α26 followup (E2): a short-term memo of tiles this colonist failed
    // to path to. Autonomy and target-picking helpers skip cached tiles
    // so a single unreachable target (e.g. the other colony's farm cut
    // off by water) can't trap the colonist in an idle loop. Entries
    // expire after UNREACHABLE_TTL sim-seconds, so a fence removal or
    // a fresh tree won't stay blocked forever.
    this._unreachable = new Map();
  }

  /**
   * Mark (x, y) — and a small surrounding cluster — as unreachable for
   * this colonist as of `clock`. L1: a single till-spot failure usually
   * means the whole patch beyond a water / mountain barrier is out of
   * reach, so caching just the one tile leaves the autonomy retrying
   * each neighbour next frame ("unreachable" log spam). Filling the
   * Chebyshev-distance ≤ UNREACHABLE_RADIUS box around the failure cuts
   * the spam to a single entry per genuine pocket.
   */
  markUnreachable(x, y, clock) {
    for (let dy = -UNREACHABLE_RADIUS; dy <= UNREACHABLE_RADIUS; dy++) {
      for (let dx = -UNREACHABLE_RADIUS; dx <= UNREACHABLE_RADIUS; dx++) {
        this._unreachable.set(`${x + dx},${y + dy}`, clock);
      }
    }
  }

  /** True if (x, y) was marked unreachable within the last TTL window. */
  isUnreachable(x, y, clock) {
    const t = this._unreachable.get(`${x},${y}`);
    if (t == null) return false;
    if (clock - t > UNREACHABLE_TTL) {
      this._unreachable.delete(`${x},${y}`);
      return false;
    }
    return true;
  }

  /** Multiplier for a given skill: 1× at xp=0, MAX_SKILL_MULT× at xp=1. */
  skillMult(name) {
    const xp = this.skills?.[name] || 0;
    return 1 + (MAX_SKILL_MULT - 1) * xp;
  }

  /** Award `sec` sim-seconds of practice to a skill (saturates at 1). */
  gainSkill(name, sec) {
    if (!this.skills || !(name in this.skills)) return;
    this.skills[name] = Math.min(1, this.skills[name] + sec / SKILL_TIME_TO_MASTER);
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

  _anchor() {
    return this.path.length > 0
      ? { x: this.path[0].x, y: this.path[0].y }
      : { x: this.tileX, y: this.tileY };
  }

  _fail(task, outcomeKey) {
    task.status = 'failed';
    task.outcome = outcomeKey;
  }

  /** Take damage from an animal attack. Strength skill cushions it. */
  hurt(amount) {
    const cushion = amount / this.skillMult('strength');
    this.health = Math.max(0, this.health - cushion);
    this.mood = Math.max(0, this.mood - 0.12);
    if (this.health <= 0) this.dead = true;
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
    } else if (task.type === TaskType.WEED) {
      // Weeding now accepts ANY crop — withered (auto-cleanup) or
      // still-living (player explicitly chose to scrap it).
      const p = tile.plant;
      if (!p || p.kind !== 'crop') return this._fail(task, 'noWeed');
    } else if (task.type === TaskType.STORE || task.type === TaskType.FETCH) {
      if (tile.structure !== 'stockpile') return this._fail(task, 'noStockpile');
    } else if (task.type === TaskType.BUILD) {
      if (tile.type === TileType.WATER) return this._fail(task, 'onWater');
      if (tile.plant || tile.structure) return this._fail(task, 'occupied');
    } else if (task.type === TaskType.COOK) {
      if (tile.structure !== 'hearth') return this._fail(task, 'noHearth');
    } else if (task.type === TaskType.MOVE) {
      if (tile.type === TileType.WATER) return this._fail(task, 'onWater');
    }

    const anchor = this._anchor();
    const goal = { x: task.x, y: task.y };
    // Path search uses the colony's per-frame cache when available so
    // four colonists heading to the same hearth or stockpile in the
    // same tick share one A* result. Long routes are split through a
    // midpoint checkpoint; the goal-unreachable case still returns
    // null (the task fails) — falling back to "nearest" would leave
    // the colonist walking toward a tile they can never reach.
    const cache = map.pathCache;
    let path = cache ? cache.findCached(map, anchor, goal, false) : findPathStaged(map, anchor, goal);
    if (!path) return this._fail(task, 'unreachable');
    this.path = [anchor, ...path];
    this.state = 'walking';
  }

  _walk(dt) {
    let budget = COLONIST_SPEED * this.skillMult('agility') * dt;
    // Walking practises agility a little.
    this.gainSkill('agility', dt);
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

  /** Advance survival stats and the current task by dt seconds. */
  update(dt) {
    // Hunger / starvation. Strength cushions starvation damage too.
    this.hunger = Math.min(1, this.hunger + HUNGER_RATE * dt);
    if (this.hunger >= 1) {
      this.health = Math.max(0, this.health - (STARVE_RATE * dt) / this.skillMult('strength'));
    } else if (this.hunger < HEALTH_REGEN_HUNGER && this.health < 1) {
      this.health = Math.min(1, this.health + HEALTH_REGEN * dt);
    }
    // Sleep — sleeping refills, anything else drains. SLEEP task is
    // handled by the work branch below; here we just drain in the
    // background so even an active colonist tires across a day.
    const task = this.currentTask;
    const isSleeping = task && task.type === TaskType.SLEEP && this.path.length === 0;
    if (isSleeping) {
      this.sleep = Math.min(1, this.sleep + SLEEP_RECOVER_RATE * dt);
    } else {
      this.sleep = Math.max(0, this.sleep - SLEEP_DRAIN_RATE * dt);
    }
    const sleepDeficit = this.sleep < SLEEP_DEFICIT_THRESHOLD ? (SLEEP_DEFICIT_THRESHOLD - this.sleep) : 0;
    // T3: heavier mood penalty for sleep deficit (was 0.8, now scaled
    // by SLEEP_MOOD_PENALTY ≈ 1.6). Combined with the 2× faster drain
    // this makes "go home and sleep" a real loop in the daily cycle.
    const moodTarget = clamp01(
      1 - this.hunger * 0.6 - (1 - this.health) * 0.5 - sleepDeficit * SLEEP_MOOD_PENALTY,
    );
    this.mood = clamp01(this.mood + (moodTarget - this.mood) * MOOD_ADAPT * dt);
    if (this.eatCooldown > 0) this.eatCooldown -= dt;
    if (this.health <= 0) {
      this.dead = true;
      return;
    }

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
    const baseDur = WORK_PHASE[task.type] || 0;
    if (baseDur <= 0) {
      task.status = 'done';
      return;
    }
    // Skill scales the EFFECTIVE work rate: a farmer with high farming
    // finishes a SOW in ~1/3 the time. Sleep deficit drags work back.
    const skill = TASK_SKILL[task.type];
    const skillMul = skill ? this.skillMult(skill) : 1;
    // T3: bigger sleep-deficit drag on work rate (multiplier was 0.6,
    // now SLEEP_WORK_PENALTY ≈ 1.2). The clamp at 0.3× keeps work from
    // grinding to a halt entirely.
    const sleepDrag = 1 - sleepDeficit * SLEEP_WORK_PENALTY;
    const rate = skillMul * Math.max(0.3, sleepDrag);
    this.state = WORK_STATE[task.type] || 'working';
    this.workTimer += dt * rate;
    if (skill) this.gainSkill(skill, dt);
    if (this.workTimer >= baseDur) task.status = 'done';
  }
}
