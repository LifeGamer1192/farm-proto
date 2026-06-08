// Colony tasks: the unit of work a colonist carries out.
//
// A task is plain data. Colonists (entities/colonist.js) execute tasks and
// the game (game.js) queues work tasks, assigns them, and applies effects.
//
// Work tasks are placed by the player with the tools. Personal tasks
// (eat/rest/leisure/sleep) are chosen by a colonist's own priority AI.
// A work task may be addressed to the whole colony (assignee null) or to
// one named colonist.

export const TaskType = {
  MOVE: 'move',
  HARVEST: 'harvest',
  SOW: 'sow',
  TILL: 'till',
  WATER: 'water',
  HUNT: 'hunt',
  // α33: fish at a water tile adjacent to land. Yields fish / clams.
  FISH: 'fish',
  // α37: ranged combat against a colonist of an enemy group.
  ATTACK: 'attack',
  // α37: march toward a target tile during war — used to move attackers
  // to the enemy residential center, and to send everyone home once
  // combat ends.
  MARCH: 'march',
  BUILD: 'build',
  COOK: 'cook',
  WEED: 'weed', // clear a withered, dead crop (autonomous)
  STORE: 'store', // haul on-hand food into a stockpile (autonomous)
  FETCH: 'fetch', // haul food from a stockpile back on-hand (autonomous)
  EAT: 'eat',
  REST: 'rest',
  LEISURE: 'leisure',
  SLEEP: 'sleep',
};

// Colony work tasks — placed by the player's tools or taken up autonomously.
// (As opposed to personal tasks: eat / rest / leisure / sleep.)
export const WORK_TYPES = [
  TaskType.MOVE,
  TaskType.HARVEST,
  TaskType.SOW,
  TaskType.TILL,
  TaskType.WATER,
  TaskType.HUNT,
  TaskType.FISH,
  TaskType.ATTACK,
  TaskType.MARCH,
  TaskType.BUILD,
  TaskType.COOK,
  TaskType.WEED,
  TaskType.STORE,
  TaskType.FETCH,
];

// Structures a BUILD task can raise.
export const STRUCTURE_TYPES = ['fence', 'hut', 'stockpile', 'hearth'];

let nextId = 1;

/**
 * @param {string} type    a TaskType value
 * @param {number} x       target tile column
 * @param {number} y       target tile row
 * @param {object} [opts]
 * @param {?string} opts.cropId     crop to sow (SOW tasks)
 * @param {?number} opts.animalId   animal to hunt (HUNT tasks)
 * @param {?string} opts.structure  structure to raise (BUILD tasks)
 * @param {?string} opts.assignee   a colonist name, or null for the whole colony
 */
export function createTask(type, x, y, opts = {}) {
  return {
    id: nextId++,
    type,
    x,
    y,
    cropId: opts.cropId ?? null,
    animalId: opts.animalId ?? null,
    structure: opts.structure ?? null,
    assignee: opts.assignee ?? null,
    status: 'queued', // 'queued' | 'active' | 'done' | 'failed'
    outcome: '', // an i18n outcome key ('out.*'), set when the task resolves
    outcomeData: null, // params for the outcome string (crop / animal / n)
  };
}
