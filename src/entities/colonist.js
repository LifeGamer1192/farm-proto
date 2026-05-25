// A colonist: a worker that walks the map and carries out tasks, and now
// has survival stats — hunger, health and mood.
//
// The game assigns one task at a time (work from the queue, or a personal
// task — eat / rest / leisure / sleep — chosen by its priority AI). The
// colonist walks to the task's tile, spends the task's work phase there,
// and marks it done (or failed). Each update it also ages its stats:
// hunger climbs, starvation eats health, and health recovers when fed.

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
} from '../config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

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
  constructor(x, y, name) {
    this.x = x;
    this.y = y;
    this.name = name;
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
      const p = tile.plant;
      if (!p || p.kind !== 'crop' || !p.withered) return this._fail(task, 'noWeed');
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
    const path = findPath(map, anchor, { x: task.x, y: task.y });
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
    const moodTarget = clamp01(
      1 - this.hunger * 0.6 - (1 - this.health) * 0.5 - sleepDeficit * 0.8,
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
    const sleepDrag = 1 - sleepDeficit * 0.6;
    const rate = skillMul * Math.max(0.3, sleepDrag);
    this.state = WORK_STATE[task.type] || 'working';
    this.workTimer += dt * rate;
    if (skill) this.gainSkill(skill, dt);
    if (this.workTimer >= baseDur) task.status = 'done';
  }
}
