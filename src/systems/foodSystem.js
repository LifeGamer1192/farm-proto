// Food system: storage, nutrition, feeding, stockpiles and pest-spoilage
// helpers. Extracted from game.js so the food economy can be tuned and
// re-balanced in one place without churning the rest of the engine.
//
// Functions here take the `game` instance as the first argument and read
// (or mutate) its state. They are not bound to any class — the engine
// keeps a thin shim on Game for back-compat (autonomy.js and tests use
// the older method names).

import { STARTING_WOOD, EAT_RETRY, MEAL_MOOD_BONUS } from '../config.js';
import { CROP_IDS, getCrop } from '../crops.js';
import { t } from '../i18n.js';

// Raw food categories — what pests can spoil and what a cook task uses.
// 'forage' is the catch-all for wild gatherings; every crop becomes its
// own food entry; 'meat' comes from hunting.
export const FOOD_TYPES = ['forage', ...CROP_IDS, 'meat'];
// Everything a stockpile can hold: raw food plus cooked meals.
export const STOCKPILE_ITEMS = [...FOOD_TYPES, 'meal'];

// Built-in nutrition for non-crop foods; crops fall back to their own.
const NUTRITION = { forage: 0.2, meat: 0.55, meal: 0.6 };

export function nutritionOf(foodId) {
  if (NUTRITION[foodId] !== undefined) return NUTRITION[foodId];
  const crop = getCrop(foodId);
  return crop ? crop.nutrition : 0.3;
}

/** A fresh, empty store — every crop slot, plus catch-all food + meals. */
export function freshStorage() {
  const s = { wood: STARTING_WOOD, meal: 0 };
  for (const id of FOOD_TYPES) s[id] = 0;
  return s;
}

/** A fresh stockpile's items map with every storable item at 0. */
export function freshStockpileItems() {
  const items = {};
  for (const it of STOCKPILE_ITEMS) items[it] = 0;
  return items;
}

/** The store/item slot with the largest count, or null. */
export function largestFood(store, items) {
  let pick = null;
  for (const it of items) {
    if (store[it] > 0 && (pick === null || store[it] > store[pick])) pick = it;
  }
  return pick;
}

/** Raw, uncooked food on hand — what pests can spoil and what a cook uses. */
export function rawFood(game) {
  return FOOD_TYPES.reduce((sum, ft) => sum + game.storage[ft], 0);
}

/** All food the colony holds on hand (raw + cooked). */
export function onHandFood(game) {
  return rawFood(game) + game.storage.meal;
}

/** Every food unit the colony owns — on hand + tucked into stockpiles. */
export function totalFood(game) {
  let n = onHandFood(game);
  for (const sp of game.stockpiles) n += stockpileFood(sp);
  return n;
}

/** Food units held in one stockpile. */
export function stockpileFood(sp) {
  let n = 0;
  for (const it of STOCKPILE_ITEMS) n += sp.items[it];
  return n;
}

/** Total of an item the colony owns — on hand plus every stockpile. */
export function totalItem(game, it) {
  let n = game.storage[it] || 0;
  for (const sp of game.stockpiles) n += sp.items[it] || 0;
  return n;
}

/** The stockpile built on a tile, or null. */
export function stockpileAt(game, x, y) {
  return game.stockpiles.find((sp) => sp.x === x && sp.y === y) || null;
}

/** Stockpile nearest a colonist satisfying `pred`, or null. */
export function nearestStockpile(game, colonist, pred) {
  let best = null;
  let bestD = Infinity;
  for (const sp of game.stockpiles) {
    if (!pred(sp)) continue;
    const d = Math.hypot(sp.x - colonist.tileX, sp.y - colonist.tileY);
    if (d < bestD) {
      bestD = d;
      best = sp;
    }
  }
  return best;
}

/**
 * Feed a colonist (called when an EAT task ends). Priority:
 *  1. cooked meal on hand (big mood lift)
 *  2. raw food on hand (mood lift scales with the food's nutrition)
 *  3. anything from a nearby stockpile
 *  4. nothing — colonist goes hungry, missed-meal counter ticks
 */
export function feed(game, colonist) {
  colonist.eatCooldown = EAT_RETRY;
  const name = colonist.name;
  if (game.storage.meal > 0) {
    game.storage.meal -= 1;
    colonist.hunger = 0;
    colonist.mood = Math.min(1, colonist.mood + MEAL_MOOD_BONUS);
    game.meals.eaten += 1;
    game._pushLog({ icon: '🍲', text: t('log.ate', { name }), cls: 'log-meal' });
    return;
  }
  const onHand = largestFood(game.storage, FOOD_TYPES);
  if (onHand) {
    game.storage[onHand] -= 1;
    colonist.hunger = 0;
    colonist.mood = Math.min(1, colonist.mood + nutritionOf(onHand) * 0.04);
    game.meals.eaten += 1;
    game._pushLog({ icon: '🍴', text: t('log.ate', { name }), cls: 'log-meal' });
    return;
  }
  const sp = game.stockpiles.find((s) => stockpileFood(s) > 0);
  if (sp) {
    const it = sp.items.meal > 0 ? 'meal' : largestFood(sp.items, STOCKPILE_ITEMS);
    sp.items[it] -= 1;
    colonist.hunger = 0;
    if (it === 'meal') colonist.mood = Math.min(1, colonist.mood + MEAL_MOOD_BONUS);
    else colonist.mood = Math.min(1, colonist.mood + nutritionOf(it) * 0.04);
    game.meals.eaten += 1;
    game._pushLog({
      icon: it === 'meal' ? '🍲' : '🍴',
      text: t('log.ate', { name }),
      cls: 'log-meal',
    });
    return;
  }
  game.meals.missed += 1;
  game._pushLog({ icon: '⚠', text: t('log.hungry', { name }), cls: 'log-warn' });
}
