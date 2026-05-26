// Food system: storage, nutrition, feeding, stockpiles, dish quality
// and pest-spoilage helpers. Extracted from game.js so the food economy
// can be tuned and re-balanced in one place without churning the rest
// of the engine.
//
// Alpha 24 added quality tracking + multi-nutrient profiles + dishes.
// Functions take the `game` instance as first arg; engine keeps the old
// method names on Game as thin shims (autonomy.js and tests rely on them).

import { STARTING_WOOD, EAT_RETRY, MEAL_MOOD_BONUS } from '../config.js';
import { CROP_IDS, getCrop } from '../crops.js';
import { DISH_IDS, getRecipe, isDish, pickBestAffordable, averageInputQuality } from '../recipes.js';
import { t } from '../i18n.js';

// Raw food categories — what pests can spoil and what a cook task uses.
// 'forage' is the catch-all for wild gatherings; every crop becomes its
// own food entry; 'meat' comes from hunting. Dishes are kept separately
// in the items map (DISH_IDS) so a stockpile can carry both raw and
// cooked items side by side.
export const FOOD_TYPES = ['forage', ...CROP_IDS, 'meat'];
// Everything a stockpile can hold: raw food + the legacy 'meal' bucket
// (used pre-α24 as a catch-all cooked entry, still kept for back-compat)
// + every Tier-1/Tier-2 dish defined in recipes.js.
export const STOCKPILE_ITEMS = [...FOOD_TYPES, 'meal', ...DISH_IDS];

// Built-in base nutrition for non-crop / non-dish items. Crops fall back
// to their own `nutrition` field; dishes look it up via getRecipe(id).
const NUTRITION = { forage: 0.2, meat: 0.20 /* raw meat is barely edible */, meal: 0.6 };

// Multi-nutrient profile per simple item. Dishes carry their own; raw
// crops + non-dish items get a coarse default by category.
const DEFAULT_NUTRIENTS = {
  forage: { carb: 0.2, protein: 0.05, fat: 0.0, vitamin: 0.75 },
  meat:   { carb: 0.0, protein: 0.85, fat: 0.15, vitamin: 0.0 },
  meal:   { carb: 0.45, protein: 0.2, fat: 0.1, vitamin: 0.25 },
};
const CATEGORY_NUTRIENTS = {
  grain:    { carb: 0.85, protein: 0.05, fat: 0.05, vitamin: 0.05 },
  legume:   { carb: 0.30, protein: 0.55, fat: 0.10, vitamin: 0.05 },
  root:     { carb: 0.55, protein: 0.05, fat: 0.00, vitamin: 0.40 },
  tuber:    { carb: 0.75, protein: 0.05, fat: 0.00, vitamin: 0.20 },
  bulb:     { carb: 0.20, protein: 0.05, fat: 0.00, vitamin: 0.75 },
  leaf:     { carb: 0.10, protein: 0.05, fat: 0.00, vitamin: 0.85 },
  stem:     { carb: 0.10, protein: 0.05, fat: 0.00, vitamin: 0.85 },
  flower:   { carb: 0.15, protein: 0.15, fat: 0.05, vitamin: 0.65 },
  fruitVeg: { carb: 0.20, protein: 0.05, fat: 0.05, vitamin: 0.70 },
  fruit:    { carb: 0.35, protein: 0.02, fat: 0.05, vitamin: 0.58 },
  nut:      { carb: 0.20, protein: 0.20, fat: 0.55, vitamin: 0.05 },
};
const NUTRIENT_KEYS = ['carb', 'protein', 'fat', 'vitamin'];
const EMPTY_NUTRIENTS = { carb: 0, protein: 0, fat: 0, vitamin: 0 };

export function nutritionOf(foodId) {
  const recipe = getRecipe(foodId);
  if (recipe) return recipe.nutrition;
  if (NUTRITION[foodId] !== undefined) return NUTRITION[foodId];
  const crop = getCrop(foodId);
  return crop ? crop.nutrition : 0.3;
}

/** Multi-nutrient profile for an item (always returns the 4 keys). */
export function nutrientsOf(foodId) {
  const recipe = getRecipe(foodId);
  if (recipe) return { ...EMPTY_NUTRIENTS, ...recipe.nutrients };
  if (DEFAULT_NUTRIENTS[foodId]) return { ...EMPTY_NUTRIENTS, ...DEFAULT_NUTRIENTS[foodId] };
  const crop = getCrop(foodId);
  if (crop) {
    const base = CATEGORY_NUTRIENTS[crop.category];
    if (base) return { ...EMPTY_NUTRIENTS, ...base };
  }
  return { ...EMPTY_NUTRIENTS };
}

/** True if a colonist can eat the food raw (alpha 24). */
export function isEdibleRaw(foodId) {
  if (foodId === 'meal' || isDish(foodId)) return true;
  if (foodId === 'forage') return true;
  if (foodId === 'meat') return false; // raw meat is inedible
  const crop = getCrop(foodId);
  return crop ? crop.edibleRaw !== false : true;
}

/** A fresh, empty store — every crop slot + dish slot + catch-all. */
export function freshStorage() {
  const s = { wood: STARTING_WOOD, meal: 0 };
  for (const id of FOOD_TYPES) s[id] = 0;
  for (const id of DISH_IDS) s[id] = 0;
  // Quality (0..1) tracked per food/dish id, separate from item count.
  // 0.5 is the "fresh-default" — items show up at this baseline until a
  // cook task averages in better numbers from higher-quality inputs.
  s.quality = {};
  for (const id of FOOD_TYPES) s.quality[id] = 0.5;
  for (const id of DISH_IDS) s.quality[id] = 0.5;
  s.quality.meal = 0.5;
  return s;
}

/**
 * α25 follow-up (B2 / B3): write `n` units of `key` into the colony's
 * on-hand store AND mirror the same change onto the producer group's
 * per-group store so the per-group panels stay in sync. When `groupId`
 * is null the change is colony-wide only (legacy paths).
 */
export function storageAdd(game, groupId, key, n) {
  if (!Number.isFinite(n) || n === 0) return;
  game.storage[key] = (game.storage[key] || 0) + n;
  if (groupId == null) return;
  const g = game.groups?.[groupId];
  if (g && g.storage) g.storage[key] = (g.storage[key] || 0) + n;
}

/** Counterpart to storageAdd — decrement from colony + group store. */
export function storageSub(game, groupId, key, n) {
  if (!Number.isFinite(n) || n === 0) return;
  game.storage[key] = Math.max(0, (game.storage[key] || 0) - n);
  if (groupId == null) return;
  const g = game.groups?.[groupId];
  if (g && g.storage) g.storage[key] = Math.max(0, (g.storage[key] || 0) - n);
}

/**
 * Pick the group with the largest balance of `key` (used to deduct shared
 * costs like hearth fuel / pest spoilage / unattributed consumption). Falls
 * back to null when no group holds any of the resource.
 */
export function largestGroupHolder(game, key) {
  if (!game.groups || game.groups.length === 0) return null;
  let best = null;
  let bestN = 0;
  for (const g of game.groups) {
    const n = g.storage?.[key] || 0;
    if (n > bestN) { bestN = n; best = g; }
  }
  return best;
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

/**
 * Largest EDIBLE-RAW item — used by the eat path so a colonist doesn't
 * try to chew raw beans.
 */
export function largestEdibleRaw(store, items) {
  let pick = null;
  for (const it of items) {
    if (store[it] > 0 && isEdibleRaw(it) && (pick === null || store[it] > store[pick])) pick = it;
  }
  return pick;
}

/** Raw, uncooked food on hand — what pests can spoil and what a cook uses. */
export function rawFood(game) {
  return FOOD_TYPES.reduce((sum, ft) => sum + game.storage[ft], 0);
}

/** Cooked food on hand — meals + every dish bucket. */
export function cookedFood(game) {
  let n = game.storage.meal || 0;
  for (const id of DISH_IDS) n += game.storage[id] || 0;
  return n;
}

/** All food the colony holds on hand (raw + cooked). */
export function onHandFood(game) {
  return rawFood(game) + cookedFood(game);
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
  for (const it of STOCKPILE_ITEMS) n += sp.items[it] || 0;
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
    // E2: skip stockpiles this colonist has recently failed to reach.
    if (colonist.isUnreachable?.(sp.x, sp.y, game.clock)) continue;
    const d = Math.hypot(sp.x - colonist.tileX, sp.y - colonist.tileY);
    if (d < bestD) {
      bestD = d;
      best = sp;
    }
  }
  return best;
}

/**
 * α25 follow-up (B2): prefer a stockpile owned by the colonist's group;
 * if none satisfy `pred`, fall back to any matching stockpile. Used by
 * the autonomy decision tree so colonists hauling food head to their
 * own warehouses first.
 */
export function nearestOwnStockpile(game, colonist, pred) {
  const gid = colonist.groupId;
  const own = nearestStockpile(game, colonist, (sp) => sp.ownerId === gid && pred(sp));
  if (own) return own;
  return nearestStockpile(game, colonist, pred);
}

/**
 * Mood lift from eating one unit of an item. Combines the item's base
 * nutrition with a quality multiplier (0.5..1.5 over the 0..1 quality
 * range). A high-quality Tier-2 dish therefore lifts mood meaningfully
 * more than a plain bowl of porridge.
 */
function moodFromEating(itemId, quality) {
  const baseNut = nutritionOf(itemId);
  const q = Number.isFinite(quality) ? quality : 0.5;
  const qMul = 0.5 + q;
  if (itemId === 'meal' || isDish(itemId)) return MEAL_MOOD_BONUS * qMul * (baseNut / 0.6);
  return baseNut * 0.04 * qMul;
}

/**
 * Feed a colonist (called when an EAT task ends). Priority:
 *  1. cooked meal / dish on hand (big mood lift, quality scales it)
 *  2. raw edible food on hand
 *  3. anything edible from a nearby stockpile
 *  4. nothing — colonist goes hungry, missed-meal counter ticks
 *
 * Inedible-raw items (raw meat, raw legumes, raw almond, raw grains)
 * are skipped at every step; the colonist will starve sooner rather
 * than chew uncooked beans.
 */
export function feed(game, colonist) {
  colonist.eatCooldown = EAT_RETRY;
  const name = colonist.name;
  const groupId = colonist.groupId;
  // Per-group meal counters (α25) live alongside the colony-wide totals
  // so the panel can show either depending on the selected tab.
  const grp = game.groups?.[groupId];
  const bumpEaten = () => {
    game.meals.eaten += 1;
    if (grp) grp.meals.eaten += 1;
  };
  const bumpMissed = () => {
    game.meals.missed += 1;
    if (grp) grp.meals.missed += 1;
  };
  // B2: when picking on-hand food, prefer items the colonist's own group
  // produced. If their group has none of `id`, fall back to the colony
  // aggregate; the deduction still uses the eater's group so the per-
  // group panel reflects who actually ate.
  const ownStore = grp?.storage;
  // Cooked meal / dish on hand — prefer the highest-quality option.
  const cookedIds = ['meal', ...DISH_IDS].filter((id) => game.storage[id] > 0);
  if (cookedIds.length > 0) {
    // Order by own-group availability first, then by quality.
    cookedIds.sort((a, b) => {
      const own = (ownStore?.[b] || 0) - (ownStore?.[a] || 0);
      if (own !== 0) return own;
      return (game.storage.quality?.[b] || 0.5) - (game.storage.quality?.[a] || 0.5);
    });
    const pick = cookedIds[0];
    const quality = game.storage.quality?.[pick] || 0.5;
    storageSub(game, groupId, pick, 1);
    colonist.hunger = 0;
    colonist.mood = Math.min(1, colonist.mood + moodFromEating(pick, quality));
    bumpEaten();
    game._pushLog({ icon: '🍲', text: t('log.ate', { name }), cls: 'log-meal', groupId });
    return;
  }
  const onHand = largestEdibleRaw(game.storage, FOOD_TYPES);
  if (onHand) {
    const quality = game.storage.quality?.[onHand] || 0.5;
    storageSub(game, groupId, onHand, 1);
    colonist.hunger = 0;
    colonist.mood = Math.min(1, colonist.mood + moodFromEating(onHand, quality));
    bumpEaten();
    game._pushLog({ icon: '🍴', text: t('log.ate', { name }), cls: 'log-meal', groupId });
    return;
  }
  // Fall back to stockpiles — prefer cooked, then any raw edible.
  for (const sp of game.stockpiles) {
    let pick = null;
    for (const id of ['meal', ...DISH_IDS]) {
      if (sp.items[id] > 0) { pick = id; break; }
    }
    if (!pick) {
      pick = largestEdibleRaw(sp.items, STOCKPILE_ITEMS);
    }
    if (pick) {
      sp.items[pick] -= 1;
      colonist.hunger = 0;
      colonist.mood = Math.min(1, colonist.mood + moodFromEating(pick, 0.5));
      bumpEaten();
      game._pushLog({
        icon: pick === 'meal' || isDish(pick) ? '🍲' : '🍴',
        text: t('log.ate', { name }),
        cls: 'log-meal',
        groupId,
      });
      return;
    }
  }
  bumpMissed();
  game._pushLog({ icon: '⚠', text: t('log.hungry', { name }), cls: 'log-warn', groupId });
}

/**
 * Run a single recipe-based cook step: pick the best affordable
 * recipe, consume its ingredients (averaging their qualities into the
 * dish's quality), and add the output to game.storage. Returns the
 * recipe used, or null when nothing can be cooked. When `groupId` is
 * provided, ingredient consumption and dish output are mirrored into
 * that group's per-group store (B2).
 */
export function cookOne(game, groupId) {
  const recipe = pickBestAffordable(game.storage);
  if (!recipe) return null;
  const q = averageInputQuality(recipe, game.storage.quality);
  for (const [ing, n] of Object.entries(recipe.ingredients)) {
    storageSub(game, groupId, ing, n);
  }
  // Output count + quality update: blend new quality with whatever was
  // already in the bucket so a fresh batch can lift a stale stack.
  const prevCount = game.storage[recipe.id] || 0;
  const prevQ = game.storage.quality?.[recipe.id] ?? 0.5;
  const newCount = prevCount + recipe.out;
  const newQ = (prevQ * prevCount + q * recipe.out) / Math.max(1, newCount);
  storageAdd(game, groupId, recipe.id, recipe.out);
  if (!game.storage.quality) game.storage.quality = {};
  game.storage.quality[recipe.id] = newQ;
  return recipe;
}

/** Sum the per-nutrient value of every cooked + raw item on hand. */
export function nutrientBreakdown(game) {
  const total = { ...EMPTY_NUTRIENTS };
  const add = (id, count) => {
    if (count <= 0) return;
    const n = nutrientsOf(id);
    for (const k of NUTRIENT_KEYS) total[k] += (n[k] || 0) * count;
  };
  for (const id of STOCKPILE_ITEMS) add(id, game.storage[id] || 0);
  for (const sp of game.stockpiles) for (const id of STOCKPILE_ITEMS) add(id, sp.items[id] || 0);
  return total;
}

export { NUTRIENT_KEYS };
