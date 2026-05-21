// Colony tasks: the unit of work the colonist carries out.
//
// A task is plain data. The colonist (entities/colonist.js) executes it and
// the game (game.js) queues tasks and applies their effects.

export const TaskType = {
  MOVE: 'move', // walk to a tile
  HARVEST: 'harvest', // walk to a plant/ripe crop and gather it
  SOW: 'sow', // walk to an empty tile and sow a crop
};

export const TASK_LABELS = {
  move: 'Move',
  harvest: 'Harvest',
  sow: 'Sow',
};

let nextId = 1;

/**
 * @param {string} type    a TaskType value
 * @param {number} x       target tile column
 * @param {number} y       target tile row
 * @param {?string} cropId crop to sow (SOW tasks only)
 */
export function createTask(type, x, y, cropId = null) {
  return {
    id: nextId++,
    type,
    x,
    y,
    cropId,
    status: 'queued', // 'queued' | 'active' | 'done' | 'failed'
    outcome: '', // short human-readable result or failure note
  };
}
