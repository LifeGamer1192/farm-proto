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
  BUILD: 'build',
  EAT: 'eat',
  REST: 'rest',
  LEISURE: 'leisure',
  SLEEP: 'sleep',
};

// Task types the player places with the on-screen tools.
export const WORK_TYPES = [
  TaskType.MOVE,
  TaskType.HARVEST,
  TaskType.SOW,
  TaskType.TILL,
  TaskType.WATER,
  TaskType.HUNT,
  TaskType.BUILD,
];

// Structures a BUILD task can raise.
export const STRUCTURE_TYPES = ['fence', 'hut', 'stockpile'];

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
