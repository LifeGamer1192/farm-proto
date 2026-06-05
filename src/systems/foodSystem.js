// Food system: storage, nutrition, feeding, stockpiles, dish quality
// and pest-spoilage helpers. Extracted from game.js so the food economy
// can be tuned and re-balanced in one place without churning the rest
// of the engine.
//
// Alpha 24 added quality tracking + multi-nutrient profiles + dishes.
// Functions take the `game` instance as first arg; engine keeps the old
// method names on Game as thin shims (autonomy.js and tests rely on them).

import { STARTING_WOOD, EAT_RETRY, MEAL_MOOD_BONUS, SEEDS_AFTER_EATING_CHANCE, MEAL_NUTRIENT_CREDIT } from '../config.js';
import { CROP_IDS, getCrop, seedGenome } from '../crops.js';
import { DISH_IDS, getRecipe, isDish, pickBestAffordable, averageInputQuality, computeRecipeNutrients, isIntermediate } from '../recipes.js';
import { freshGenome } from '../genetics.js';
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
// α30 followup: meat / meal fat values bumped ×1.5 (0.15→0.225,
// 0.10→0.15) so the two most readily-available animal-derived items
// keep the fat bucket above the missing-threshold without requiring a
// nut harvest from day one. Nut crops are still the decisive fat
// source (0.55), so the strategic value of planting almond / walnut
// / chestnut is preserved.
const DEFAULT_NUTRIENTS = {
  forage: { carb: 0.2, protein: 0.05, fat: 0.0, vitamin: 0.75 },
  meat:   { carb: 0.0, protein: 0.85, fat: 0.225, vitamin: 0.0 },
  meal:   { carb: 0.45, protein: 0.2, fat: 0.15, vitamin: 0.25 },
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

/**
 * α27: roll a seed drop for crops flagged `seedsAfterEating` (the fruit-
 * veg / fruit / legume cluster, plus their wild ancestors). Cooked dishes
 * and non-crop items are skipped. The seed lands in the eater's own
 * group via `game._addSeed`, mirroring the foraging seed loop.
 */
function maybeDropSeedAfterEating(game, foodId, groupId) {
  const crop = getCrop(foodId);
  if (!crop || !crop.seedsAfterEating) return;
  if (Math.random() >= SEEDS_AFTER_EATING_CHANCE) return;
  game._addSeed(foodId, seedGenome(foodId), groupId);
}

/**
 * α30: credit one eaten unit of `foodId` to the colonist's nutrient
 * buckets. The food's profile is added (clamped to 1) so a single meal
 * of grain refills the carb bucket fully, while a vitamin-rich salad
 * tops up vitamin. Called from every "successful eat" branch in _feed.
 */
export function feedNutrients(colonist, foodId, grp = null) {
  if (!colonist || !colonist.nutrients) return;
  const n = nutrientsOf(foodId, grp);
  for (const k of NUTRIENT_KEYS) {
    const add = (n[k] || 0) * MEAL_NUTRIENT_CREDIT;
    colonist.nutrients[k] = Math.min(1, (colonist.nutrients[k] || 0) + add);
  }
}

/**
 * Multi-nutrient profile for an item (always returns the 4 keys).
 * α30 followup: when `grp` is passed AND the item is the generic 'meal',
 * the group's running meal-nutrient average is used so eating a meal
 * picks up the actual ingredients cooked into that group's stock.
 * α31: same idea extended to every recipe-based dish — the per-group
 * dishNutrients map (updated each cook) carries the actual ingredient-
 * blended profile; we fall back to a recipe-archetype default only
 * when this group has never cooked the dish.
 */
export function nutrientsOf(foodId, grp = null) {
  if (foodId === 'meal' && grp?.storage?.mealNutrients) {
    return { ...EMPTY_NUTRIENTS, ...grp.storage.mealNutrients };
  }
  if (grp?.storage?.dishNutrients?.[foodId]) {
    return { ...EMPTY_NUTRIENTS, ...grp.storage.dishNutrients[foodId] };
  }
  const recipe = getRecipe(foodId);
  if (recipe) {
    // α31: recipes no longer carry a baked-in `nutrients` field; if a
    // group has never cooked this dish, derive a default by running
    // the ingredient blend through the recipe's processBias against
    // each ingredient's STATIC archetypal profile. Keeps eating dishes
    // sane even before the group has any cook history.
    return computeRecipeNutrients(recipe, (id) => {
      if (DEFAULT_NUTRIENTS[id]) return DEFAULT_NUTRIENTS[id];
      const crop = getCrop(id);
      if (crop) return CATEGORY_NUTRIENTS[crop.category] || EMPTY_NUTRIENTS;
      // Ingredient is itself a dish (Tier 2) — recurse on its static
      // profile. Avoid infinite recursion by passing no grp.
      const sub = getRecipe(id);
      if (sub) return computeRecipeNutrients(sub, (k) => {
        if (DEFAULT_NUTRIENTS[k]) return DEFAULT_NUTRIENTS[k];
        const c2 = getCrop(k);
        return c2 ? (CATEGORY_NUTRIENTS[c2.category] || EMPTY_NUTRIENTS) : EMPTY_NUTRIENTS;
      });
      return EMPTY_NUTRIENTS;
    });
  }
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
  // α30 followup: running per-group nutrient profile for the generic
  // "meal" item (the legacy raw→meal fallback path; recipe-based dishes
  // carry their own nutrients via getRecipe). Each new meal blends the
  // source ingredient's profile in (with a ±5% per-nutrient variance)
  // so a colony that cooks mostly wheat ends up with carb-heavy meals
  // while a nut-heavy cook history shifts toward fat. Starts at the
  // legacy DEFAULT_NUTRIENTS.meal baseline.
  s.mealNutrients = { ...DEFAULT_NUTRIENTS.meal };
  // α31: per-dish running nutrient profile, keyed by recipe id. Each
  // time a workshop or hearth runs a recipe, the freshly-computed
  // output nutrients (computeRecipeNutrients — blends ingredient
  // profiles weighted by quantity, then applies the recipe's
  // processBias) get blended into the running average here. When a
  // colonist eats that dish, nutrientsOf() reads from this map first
  // so each group's cooking history shows up in what they eat.
  s.dishNutrients = {};
  return s;
}

/**
 * α30 followup: blend `ingredientId`'s nutrient profile into the
 * group's running meal-nutrient average, with a small ±5% per-nutrient
 * variance so two batches of "the same wheat meal" don't both end up
 * with identical values. Called from the legacy raw→meal fallback path
 * each time one raw item is turned into one meal.
 */
export function blendMealNutrients(grp, ingredientId, rand = Math.random) {
  if (!grp?.storage) return;
  const prevAvg = grp.storage.mealNutrients || { ...DEFAULT_NUTRIENTS.meal };
  const prevCount = grp.storage.meal || 0;
  const newCount = prevCount + 1;
  const ingredientN = nutrientsOf(ingredientId);
  const out = {};
  for (const k of NUTRIENT_KEYS) {
    const variance = 1 + (rand() - 0.5) * 0.1; // ±5%
    const sampled = (ingredientN[k] || 0) * variance;
    out[k] = (prevAvg[k] * prevCount + sampled) / newCount;
  }
  grp.storage.mealNutrients = out;
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

/**
 * Counterpart to storageAdd — decrement from the actual owner's
 * per-group store and the colony aggregate in lock-step. M1: the old
 * version always tried to deduct from `groupId`, which clamps at 0
 * when that group doesn't actually own the food (e.g. Colony B eating
 * a meal Colony A made). Colony aggregate dropped, sum-of-groups did
 * not, and "Food stored" drifted away from the truth over time.
 *
 * The new version:
 *   1. picks `groupId` as the deductee if that group has enough,
 *   2. else picks the largest holder,
 *   3. else falls back to colony-aggregate only (last resort).
 * Either way, sum(groups[key]) === game.storage[key] stays an
 * invariant for the whole run.
 */
export function storageSub(game, groupId, key, n) {
  if (!Number.isFinite(n) || n === 0) return;
  let remaining = n;
  const groups = game.groups || [];
  // 1. Try the suggested group first when it has stock.
  const suggested = groupId != null ? groups[groupId] : null;
  const takeFrom = (g, take) => {
    const have = g.storage?.[key] || 0;
    const amt = Math.min(have, take);
    if (amt <= 0) return 0;
    g.storage[key] = have - amt;
    return amt;
  };
  if (suggested?.storage) remaining -= takeFrom(suggested, remaining);
  // 2. Otherwise iterate other groups by largest holder.
  while (remaining > 0) {
    let best = null; let bestN = 0;
    for (const g of groups) {
      if (g === suggested) continue;
      const have = g.storage?.[key] || 0;
      if (have > bestN) { bestN = have; best = g; }
    }
    if (!best) break;
    remaining -= takeFrom(best, remaining);
  }
  // 3. Always decrement the colony aggregate by what was actually
  //    requested — if no group had stock, this only drops the aggregate
  //    (and the invariant is preserved because sum-of-groups was 0 too).
  game.storage[key] = Math.max(0, (game.storage[key] || 0) - n);
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
 * Strict own-group stockpile pick (H3 / N4). Returns null when no
 * stockpile this colonist is allowed to use matches — same-group piles
 * always qualify, foreign piles only qualify when this group's
 * canUseFrom flag for the foreign owner is set. With every flag off
 * (default), only own-group piles are considered. The autonomy then
 * falls through to wantsWarehouse to build a fresh own-colony pile.
 */
export function nearestOwnStockpile(game, colonist, pred) {
  const gid = colonist.groupId;
  const allowed = (sp) => game._canUseFrom?.(gid, sp.ownerId) ?? (sp.ownerId === gid);
  return nearestStockpile(game, colonist, (sp) => allowed(sp) && pred(sp));
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

// α29 (D11): how much hunger one unit of `item` clears. A cooked dish is
// absorbed far better than a raw ingredient, so a single cooked meal
// roughly fills a colonist (満腹〜8分目), while raw food clears only a
// fraction — a colonist must eat 2-3 raw items to get full. Driven by the
// item's own nutrition value so a rich crop satisfies more than a thin one.
function satietyOf(item, cooked) {
  const nut = nutritionOf(item);
  if (cooked) return Math.max(0.85, Math.min(1.2, 0.85 + nut * 0.5));
  return Math.max(0.25, Math.min(0.6, 0.20 + nut * 0.48));
}

/**
 * Feed a colonist (called when an EAT task ends). α29: a colonist now
 * eats repeatedly within one sitting until full (hunger ≤ 0) or food
 * runs out, capped at MAX_MEAL_ITEMS. Cooked food clears hunger fast
 * (≈1 item), raw ingredients clear only a fraction (≈2-3 items). Each
 * unit is sourced in priority order:
 *   1. cooked meal / dish on hand (own group first)
 *   2. raw edible food on hand
 *   3. anything edible from a nearby stockpile (own group's first)
 * Inedible-raw items (raw meat / legumes / almond / grains) are skipped.
 * Food is deducted from whichever allowed group actually owns it (L2).
 */
const MAX_MEAL_ITEMS = 4;
export function feed(game, colonist) {
  colonist.eatCooldown = EAT_RETRY;
  const name = colonist.name;
  const groupId = colonist.groupId;
  const grp = game.groups?.[groupId];
  // N4: only groups the eater may take food from (own group always; a
  // foreign group only when its canUseFrom flag is on).
  const allowedGroups = (game.groups || []).filter((g) => game._canUseFrom?.(groupId, g.id) ?? (g.id === groupId));
  const allowedHas = (id) => allowedGroups.some((g) => (g.storage?.[id] || 0) > 0);

  // Take ONE best-available edible unit; returns {item, cooked, quality}
  // or null when nothing edible is in reach.
  const takeOne = () => {
    // 1. cooked meal / dish on hand — own group's stock first, then best quality.
    // α31: workshop intermediates (flour / malt / corn-meal etc., flagged
    // `intermediate: true` in recipes.js) are NOT eaten — they're inputs
    // to further recipes. Colonists previously ate malt directly because
    // it lives in DISH_IDS; the brewer's hops would then end up consumed
    // without any beer to show for it.
    const cookedIds = ['meal', ...DISH_IDS].filter((id) => !isIntermediate(id) && allowedHas(id));
    if (cookedIds.length > 0) {
      const ownStore = grp?.storage;
      cookedIds.sort((a, b) => {
        const own = (ownStore?.[b] || 0) - (ownStore?.[a] || 0);
        if (own !== 0) return own;
        return (game.storage.quality?.[b] || 0.5) - (game.storage.quality?.[a] || 0.5);
      });
      const pick = cookedIds[0];
      const quality = game.storage.quality?.[pick] || 0.5;
      storageSub(game, groupId, pick, 1);
      return { item: pick, cooked: true, quality };
    }
    // 2. raw edible on hand.
    const allowedRawStore = {};
    for (const id of FOOD_TYPES) {
      let n = 0;
      for (const g of allowedGroups) n += g.storage?.[id] || 0;
      allowedRawStore[id] = n;
    }
    const onHand = largestEdibleRaw(allowedRawStore, FOOD_TYPES);
    if (onHand) {
      const quality = game.storage.quality?.[onHand] || 0.5;
      storageSub(game, groupId, onHand, 1);
      maybeDropSeedAfterEating(game, onHand, groupId);
      return { item: onHand, cooked: false, quality };
    }
    // 3. stockpiles — own-group piles first.
    const allowedPiles = game.stockpiles.filter((sp) => game._canUseFrom?.(groupId, sp.ownerId) ?? (sp.ownerId === groupId));
    allowedPiles.sort((a, b) => (a.ownerId === groupId ? -1 : 0) - (b.ownerId === groupId ? -1 : 0));
    for (const sp of allowedPiles) {
      let pick = null;
      let cooked = false;
      for (const id of ['meal', ...DISH_IDS]) {
        if (isIntermediate(id)) continue;
        if ((sp.items[id] || 0) > 0) { pick = id; cooked = true; break; }
      }
      if (!pick) pick = largestEdibleRaw(sp.items, STOCKPILE_ITEMS);
      if (pick) {
        sp.items[pick] -= 1;
        maybeDropSeedAfterEating(game, pick, groupId);
        return { item: pick, cooked: cooked || pick === 'meal' || isDish(pick), quality: 0.5 };
      }
    }
    return null;
  };

  let ate = 0;
  let anyCooked = false;
  // α30 followup: collect what was actually eaten so the activity log's
  // detail-mode line can name the items ("食事した (2個 (トマト・パン))").
  // The simple-mode line stays just the count via the `text` field; the
  // detail string lives on `detail` so the renderer can opt in.
  const eatenIds = [];
  for (let i = 0; i < MAX_MEAL_ITEMS && colonist.hunger > 0.001; i++) {
    const got = takeOne();
    if (!got) break;
    ate += 1;
    eatenIds.push(got.item);
    if (got.cooked) anyCooked = true;
    colonist.hunger = Math.max(0, colonist.hunger - satietyOf(got.item, got.cooked));
    // Mood: cooked food lifts more; raw is a smaller bump. Applied per
    // item so a hearty multi-item meal cheers a colonist up a little more.
    colonist.mood = Math.min(1, colonist.mood + moodFromEating(got.item, got.quality) * (got.cooked ? 1 : 0.55));
    // α30: credit the eater's nutrient buckets so the malnutrition stage
    // tracks what they've actually eaten, not just total calories.
    // α30 followup: pass the eater's group so a 'meal' eaten draws on
    // the group's actual cooked-ingredient profile rather than a static
    // average.
    feedNutrients(colonist, got.item, grp);
  }

  if (ate > 0) {
    game.meals.eaten += 1;
    if (grp) grp.meals.eaten += 1;
    // α30 followup: reset the eater's miss streak on every success.
    colonist.missCount = 0;
    // α30 followup: detail-mode log line names what was eaten. The
    // renderer (main.js logEntryHtml) shows `text + detail` only in
    // detail mode, so simple-mode lines stay compact.
    const itemLabelInline = (id) => {
      if (id === 'forage') return t('stat.forage');
      if (id === 'meat') return t('stat.meat');
      if (id === 'meal') return t('stat.cooked');
      return t('crop.' + id);
    };
    const itemsDetail = eatenIds.length > 0
      ? ` (${eatenIds.map(itemLabelInline).join('・')})`
      : '';
    game._pushLog({
      icon: anyCooked ? 'meal' : 'fork',
      text: t(ate > 1 ? 'log.ateMulti' : 'log.ate', { name, n: ate }),
      detail: itemsDetail,
      cls: 'log-meal',
      groupId,
      kind: 'eat',
    });
    return;
  }
  game.meals.missed += 1;
  if (grp) grp.meals.missed += 1;
  // α30 followup: per-colonist consecutive-miss counter used by the
  // death snapshot in the summary log.
  colonist.missCount = (colonist.missCount || 0) + 1;
  // α30 followup: classify WHY the eat failed. Walk the allowed
  // groups' storage + every allowed stockpile and count each food
  // bucket against the three categories. Categories are mutually
  // exclusive, taking precedence in this order:
  //   noFood         — every allowed source is empty
  //   rawInedibleOnly — only inedible-raw items remain (grain / legume
  //                     / raw meat etc.) so cooking is the only path
  //                     and it hasn't happened
  //   other           — anything else (a fallback bucket — usually a
  //                     transient race where a peer took the last unit
  //                     between the EAT task being scheduled and _feed
  //                     running; "unreachable" would land here too if
  //                     we ever wire pathfinder checks into _feed)
  let cookedOnHand = 0;
  let edibleRawOnHand = 0;
  let inedibleRawOnHand = 0;
  const tally = (store) => {
    for (const id of Object.keys(store || {})) {
      if (id === 'wood' || id === 'quality' || id === 'mealNutrients' || id === 'dishNutrients') continue;
      const n = store[id] || 0;
      if (n <= 0) continue;
      // α31: intermediates (flour / malt / corn-meal / soy-oil) sit in
      // dish slots but aren't eatable — count them as "inedible raw"
      // for the miss-reason classifier so the bug pattern is reported
      // correctly when a colony only has intermediates left.
      if ((id === 'meal' || isDish(id)) && !isIntermediate(id)) cookedOnHand += n;
      else if (isIntermediate(id)) inedibleRawOnHand += n;
      else if (isEdibleRaw(id)) edibleRawOnHand += n;
      else inedibleRawOnHand += n;
    }
  };
  for (const g of allowedGroups) tally(g.storage);
  const allowedPiles = game.stockpiles.filter((sp) => game._canUseFrom?.(groupId, sp.ownerId) ?? (sp.ownerId === groupId));
  for (const sp of allowedPiles) tally(sp.items);
  let reason;
  if (cookedOnHand === 0 && edibleRawOnHand === 0 && inedibleRawOnHand === 0) reason = 'noFood';
  else if (cookedOnHand === 0 && edibleRawOnHand === 0 && inedibleRawOnHand > 0) reason = 'rawInedibleOnly';
  else reason = 'other';
  if (game.stats?.eatMissReasonsByGroup) {
    const bag = game.stats.eatMissReasonsByGroup[groupId] ||= { noFood: 0, rawInedibleOnly: 0, unreachable: 0, other: 0 };
    bag[reason] = (bag[reason] || 0) + 1;
  }
  // Per-season miss-reason bucket.
  if (game.stats?.seasonByGroup && game.environment) {
    const env = game.environment;
    const sk = `Y${env.year}_${env.season}`;
    const byG = game.stats.seasonByGroup[groupId] ||= {};
    const bucket = byG[sk] ||= { woodStart: 0, woodEnd: 0, litSamples: [], cooks: 0, eatMissReasons: {} };
    bucket.eatMissReasons[reason] = (bucket.eatMissReasons[reason] || 0) + 1;
  }
  game._pushLog({ icon: 'warn', text: t('log.hungry', { name }), cls: 'log-warn', groupId });
}

/**
 * Run a single recipe-based cook step: pick the best affordable
 * recipe, consume its ingredients (averaging their qualities into the
 * dish's quality), and add the output to game.storage. Returns the
 * recipe used, or null when nothing can be cooked. When `groupId` is
 * provided, ingredient consumption and dish output are mirrored into
 * that group's per-group store (B2).
 */
export function cookOne(game, groupId, station = 'hearth') {
  // H2: when a cooker's group is known, only consider ingredients the
  // cook's own colony actually owns — otherwise B's cook would happily
  // eat through A's pantry just because the colony aggregate has it.
  const ownStore = groupId != null ? game.groups?.[groupId]?.storage : game.storage;
  if (!ownStore) return null;
  // α31: ingredient inventory check looks at on-hand storage AND every
  // own-group stockpile combined. Workshop recipes in particular often
  // need an ingredient the colonist already STOREd into a pile (e.g.
  // hop harvests get hauled into the warehouse before the workshop
  // ever has a chance to run beer), so a storage-only check would
  // never match. The store / pile inventories are summed via getQty.
  const ownPiles = groupId != null
    ? (game.stockpiles || []).filter((sp) => sp.ownerId === groupId)
    : [];
  const getQty = (k) => {
    let n = ownStore[k] || 0;
    for (const sp of ownPiles) n += sp.items[k] || 0;
    return n;
  };
  const recipe = pickBestAffordable(ownStore, getQty, station);
  if (!recipe) return null;
  const grp = groupId != null ? game.groups?.[groupId] : null;
  const q = averageInputQuality(recipe, game.storage.quality);
  // Consume ingredients: drain storage first, then dip into own
  // stockpiles for any shortfall. Mirrors how an actual cook would
  // grab what's on the table before walking to the pantry.
  for (const [ing, n] of Object.entries(recipe.ingredients)) {
    let need = n;
    const fromStore = Math.min(ownStore[ing] || 0, need);
    if (fromStore > 0) {
      storageSub(game, groupId, ing, fromStore);
      need -= fromStore;
    }
    for (const sp of ownPiles) {
      if (need <= 0) break;
      const have = sp.items[ing] || 0;
      if (have <= 0) continue;
      const take = Math.min(have, need);
      sp.items[ing] = have - take;
      // Keep the colony-aggregate ledger in step.
      game.storage[ing] = Math.max(0, (game.storage[ing] || 0) - take);
      need -= take;
    }
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
  // α31: blend the recipe's computed nutrient profile into this group's
  // running dishNutrients so eating the dish later picks up the
  // ingredients this colony actually used (not a static archetype).
  // Ingredient lookup uses nutrientsOf with `grp` so that a recipe
  // taking 'meal' or a workshop intermediate as input draws on its
  // dynamic profile — chains carry their nutrient history forward.
  if (grp) {
    if (!grp.storage.dishNutrients) grp.storage.dishNutrients = {};
    const fresh = computeRecipeNutrients(recipe, (id) => nutrientsOf(id, grp));
    const prev = grp.storage.dishNutrients[recipe.id];
    if (!prev) {
      grp.storage.dishNutrients[recipe.id] = fresh;
    } else {
      const blended = {};
      for (const k of NUTRIENT_KEYS) {
        blended[k] = (prev[k] * prevCount + fresh[k] * recipe.out) / Math.max(1, newCount);
      }
      grp.storage.dishNutrients[recipe.id] = blended;
    }
  }
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
