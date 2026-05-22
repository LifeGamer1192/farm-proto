// Colony tasks: the unit of work a colonist carries out.
//
// A task is plain data. Colonists (entities/colonist.js) execute tasks and
// the game (game.js) queues work tasks, assigns them, and applies effects.
//
// Work tasks are placed by the player with the tools. Personal tasks
// (eat/rest/leisure/sleep) are chosen by a colonist's own priority AI.

export const TaskType = {
  MOVE: 'move',
  HARVEST: 'harvest',
  SOW: 'sow',
  TILL: 'till',
  WATER: 'water',
  HUNT: 'hunt',
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
];

let nextId = 1;

/**
 * @param {string} type      a TaskType value
 * @param {number} x         target tile column
 * @param {number} y         target tile row
 * @param {?string} cropId   crop to sow (SOW tasks only)
 * @param {?number} animalId animal to hunt (HUNT tasks only)
 */
export function createTask(type, x, y, cropId = null, animalId = null) {
  return {
    id: nextId++,
    type,
    x,
    y,
    cropId,
    animalId,
    status: 'queued', // 'queued' | 'active' | 'done' | 'failed'
    outcome: '', // an i18n outcome key ('out.*'), set when the task resolves
    outcomeData: null, // params for the outcome string (crop / animal / n)
  };
}
