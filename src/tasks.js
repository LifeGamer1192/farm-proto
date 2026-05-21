// Colony tasks: the unit of work the colonist carries out.
//
// A task is plain data. The colonist (entities/colonist.js) executes it and
// the game (game.js) queues tasks and applies their effects.

export const TaskType = {
  MOVE: 'move', // walk to a tile
  HARVEST: 'harvest', // walk to a plant and gather it
  PLANT: 'plant', // walk to an empty tile and plant a crop
};

export const TASK_LABELS = {
  move: 'Move',
  harvest: 'Harvest',
  plant: 'Plant',
};

let nextId = 1;

/**
 * @param {string} type  a TaskType value
 * @param {number} x     target tile column
 * @param {number} y     target tile row
 */
export function createTask(type, x, y) {
  return {
    id: nextId++,
    type,
    x,
    y,
    status: 'queued', // 'queued' | 'active' | 'done' | 'failed'
    outcome: '', // short human-readable result or failure note
  };
}
