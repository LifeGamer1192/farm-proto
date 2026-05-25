// Autonomous-work rules: the decision tree an idle colonist runs to find
// useful work without being given an explicit order.
//
// This file is the script-level surface for "how the colony behaves on
// its own". Extracted out of game.js so future versions can:
//   - swap in a different rule set (mod / faction / behaviour preset),
//   - keep the engine (state mutations, animation, build effects) stable
//     while iterating on the policy on top of it.
//
// `pickAutonomousTask` is a pure function over the game state — it reads
// from `game` but never mutates it, and returns either a freshly created
// task or `null`. The class method `Game._autonomousTask` is a thin shim
// that delegates here, so existing call sites and tests still work.

import { TaskType, createTask } from './tasks.js';
import { isRipe } from './crops.js';
import {
  ON_HAND_LOW,
  ON_HAND_CAP,
  MEAL_TARGET,
  HUNT_FOOD_PER_HEAD,
  AUTO_HUNT_RANGE,
  AUTO_SEARCH_RANGE,
  FENCE_AUTO_CAP,
  STOCKPILE_CAP,
  WOOD_LOW,
} from './config.js';

/**
 * Pick the next bit of self-directed work for `colonist`, or `null` if
 * there is nothing useful to do (the caller falls back to idling).
 *
 * Priority order (top wins):
 *   1. harvest ripe crops
 *   2. fetch food back from a stockpile when on-hand is low
 *   3. water crops that have run dry
 *   4. clear withered crops
 *   5. extend the auto-fence plan against a nearby boar
 *   6. cook raw food on a lit hearth
 *   7. hunt when colony stores are short of food
 *   8. chop a tree when wood is low
 *   9. build infrastructure (hut → hearth → warehouse)
 *  10. till new ground and sow the most-stocked crop
 *  11. haul surplus on-hand food into a stockpile
 *
 * @param {object} game  the Game instance
 * @param {object} colonist
 * @returns {?object} a task created via createTask, or null
 */
export function pickAutonomousTask(game, colonist) {
  // On-hand is full. Anything that would *add* to it (harvest a ripe crop,
  // fetch food, hunt, forage by chopping a wild plant) is skipped this
  // turn — colonists prefer to STORE first instead. This stops auto mode
  // from running on-hand way past its cap while the storage queue is
  // perpetually crowded out by farm work.
  const onHandFull = game.onHandFood >= ON_HAND_CAP;
  if (onHandFull) {
    const sp = game._nearestStockpile(colonist, (s) => game.stockpileFood(s) < STOCKPILE_CAP);
    if (sp && !game._tileClaimed(sp.x, sp.y)) {
      return createTask(TaskType.STORE, sp.x, sp.y);
    }
    // No stockpile has room either — fall through to non-additive work
    // (watering, weeding, cooking, building, sowing, tilling).
  }
  // 1. Gather ripe crops — skipped when on-hand is full so colonists do
  //    not pile food up faster than they can store it.
  if (!onHandFull) {
    for (const crop of game.crops) {
      if (isRipe(crop) && !crop.withered && !game._tileClaimed(crop.x, crop.y)) {
        return createTask(TaskType.HARVEST, crop.x, crop.y);
      }
    }
  }
  // 2. Fetch food back from a stockpile when the on-hand store runs low.
  if (game.onHandFood < ON_HAND_LOW) {
    const sp = game._nearestStockpile(colonist, (s) => game.stockpileFood(s) > 0);
    if (sp && !game._tileClaimed(sp.x, sp.y)) {
      return createTask(TaskType.FETCH, sp.x, sp.y);
    }
  }
  // 3. Tend crops that have run dry.
  for (const crop of game.crops) {
    if (
      !crop.withered &&
      !isRipe(crop) &&
      game.clock >= crop.wateredUntil &&
      !game._tileClaimed(crop.x, crop.y)
    ) {
      return createTask(TaskType.WATER, crop.x, crop.y);
    }
  }
  // 4. Clear away withered, dead crops.
  for (const crop of game.crops) {
    if (crop.withered && !game._tileClaimed(crop.x, crop.y)) {
      return createTask(TaskType.WEED, crop.x, crop.y);
    }
  }
  // 5. Throw up a fence between the colony and a nearby boar — colony-
  // wide plan, see Game#_nextFenceTile.
  if (
    game.autoMode &&
    game._totalFences() < FENCE_AUTO_CAP &&
    game._canAffordBuild('fence')
  ) {
    const spot = game._nextFenceTile(colonist);
    if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'fence' });
  }
  // 6. Cook raw food into meals while a hearth is lit.
  if (game.hearthsLit && game.rawFood > 0 && game.storage.meal < MEAL_TARGET) {
    for (const h of game.hearths) {
      if (!game._tileClaimed(h.x, h.y)) {
        return createTask(TaskType.COOK, h.x, h.y);
      }
    }
  }
  // 7. Hunt first when colony stores run low — done before infra and farm
  // work so colonists do not build themselves into starvation. Hunting
  // adds to on-hand, so it is skipped while on-hand is already at cap.
  if (
    game.autoHunt &&
    !onHandFull &&
    game.totalFood < game.colonists.length * HUNT_FOOD_PER_HEAD
  ) {
    const a = game._animalNear(colonist.tileX, colonist.tileY, AUTO_HUNT_RANGE);
    if (a && !game._tileClaimed(a.tileX, a.tileY)) {
      return createTask(TaskType.HUNT, a.tileX, a.tileY, { animalId: a.id });
    }
  }
  // 8. Chop the nearest tree when wood reserve has fallen below the
  // threshold, so building does not grind to a halt.
  if (game.autoMode && game.storage.wood - game._reservedBuildWood() < WOOD_LOW) {
    const tree = game._nearestTree(colonist, AUTO_SEARCH_RANGE);
    if (tree) return createTask(TaskType.HARVEST, tree.x, tree.y);
  }
  // 9. Stand up infrastructure before opening more farmland. Each branch
  // also checks wood — a hut that cannot be afforded should not jump the
  // queue ahead of useful work like sowing.
  if (game.autoMode) {
    if (
      game.huts.length + game._pendingBuilds('hut') < game.colonists.length &&
      game._canAffordBuild('hut')
    ) {
      const spot = game._findFreeLandNear(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hut' });
    }
    if (
      game.hearths.length + game._pendingBuilds('hearth') < game.huts.length &&
      game._canAffordBuild('hearth')
    ) {
      const spot = game._findFreeLandNear(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'hearth' });
    }
    if (game._wantsAutoWarehouse() && game._canAffordBuild('stockpile')) {
      const spot = game._findFreeLandNear(colonist);
      if (spot) return createTask(TaskType.BUILD, spot.x, spot.y, { structure: 'stockpile' });
    }
    // 10. Till new ground and sow the most-stocked crop.
    const sowCrop = game._mostStockedCrop();
    if (sowCrop) {
      const sowSpot = game._pickAutoSowSpot(colonist);
      if (sowSpot) {
        return createTask(TaskType.SOW, sowSpot.x, sowSpot.y, { cropId: sowCrop });
      }
      const tillSpot = game._pickTillSpot(colonist, sowCrop);
      if (tillSpot) return createTask(TaskType.TILL, tillSpot.x, tillSpot.y);
    }
  }
  // 11. Haul surplus on-hand food into a stockpile, safe from the pests.
  if (game.onHandFood > ON_HAND_CAP) {
    const sp = game._nearestStockpile(colonist, (s) => game.stockpileFood(s) < STOCKPILE_CAP);
    if (sp && !game._tileClaimed(sp.x, sp.y)) {
      return createTask(TaskType.STORE, sp.x, sp.y);
    }
  }
  return null;
}
