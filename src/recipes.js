// Recipes (alpha 24). The cook task picks one of these whose ingredients
// the colony has on hand and converts the raw items into a finished dish.
//
// Two tiers:
//   - Tier 1 (25 recipes): 2-3 raw food items → one prepared dish.
//   - Tier 2  (5 recipes): 2-3 Tier 1 dishes → one banquet-tier dish.
//
// Each recipe records the input ingredients, an output count, a baseline
// nutrition value (0..1 — used by feed() for the mood bonus), and a
// nutrient profile across four food groups (carb / protein / fat /
// vitamin, each 0..1). The colony's actual output quality multiplies
// the baseline numbers by the average quality of the inputs.
//
// All dish ids must be unique (no collision with crop ids).

const C = (carb, protein, fat, vitamin) => ({ carb, protein, fat, vitamin });

export const RECIPES = [
  // --- Tier 1 (25) ----------------------------------------------------------
  // Grain bowls
  { id: 'porridge',     tier: 1, ingredients: { wheat: 2, oats: 1 },     out: 3, nutrition: 0.55, nutrients: C(0.8, 0.1, 0.05, 0.05) },
  { id: 'riceBowl',     tier: 1, ingredients: { rice: 2, carrot: 1 },    out: 3, nutrition: 0.55, nutrients: C(0.75, 0.05, 0.0, 0.2) },
  { id: 'cornCake',     tier: 1, ingredients: { maize: 2, soybean: 1 },  out: 2, nutrition: 0.60, nutrients: C(0.65, 0.25, 0.05, 0.05) },
  { id: 'oatmeal',      tier: 1, ingredients: { oats: 2, melon: 1 },     out: 3, nutrition: 0.55, nutrients: C(0.7, 0.1, 0.05, 0.15) },
  { id: 'barleyStew',   tier: 1, ingredients: { barley: 2, leek: 1 },    out: 2, nutrition: 0.60, nutrients: C(0.65, 0.1, 0.05, 0.2) },
  // Legume soups & breads
  { id: 'beanSoup',     tier: 1, ingredients: { bean: 2, onion: 1 },     out: 2, nutrition: 0.55, nutrients: C(0.4, 0.4, 0.1, 0.1) },
  { id: 'peaSoup',      tier: 1, ingredients: { pea: 2, garlic: 1 },     out: 2, nutrition: 0.55, nutrients: C(0.4, 0.4, 0.05, 0.15) },
  { id: 'lentilCurry',  tier: 1, ingredients: { lentil: 2, tomato: 1 },  out: 2, nutrition: 0.65, nutrients: C(0.3, 0.4, 0.1, 0.2) },
  { id: 'hummus',       tier: 1, ingredients: { chickpea: 2, garlic: 1 },out: 2, nutrition: 0.65, nutrients: C(0.3, 0.4, 0.2, 0.1) },
  { id: 'tofu',         tier: 1, ingredients: { soybean: 3 },            out: 2, nutrition: 0.65, nutrients: C(0.1, 0.6, 0.2, 0.1) },
  // Roots & tubers
  { id: 'roastRoot',    tier: 1, ingredients: { carrot: 1, parsnip: 1, turnip: 1 }, out: 3, nutrition: 0.55, nutrients: C(0.5, 0.05, 0.05, 0.4) },
  { id: 'mashedPotato', tier: 1, ingredients: { potato: 2 },             out: 2, nutrition: 0.55, nutrients: C(0.7, 0.1, 0.05, 0.15) },
  { id: 'sweetPotPie',  tier: 1, ingredients: { sweetPotato: 2, wheat: 1 }, out: 2, nutrition: 0.65, nutrients: C(0.55, 0.1, 0.1, 0.25) },
  { id: 'taroStew',     tier: 1, ingredients: { taro: 2, onion: 1 },     out: 2, nutrition: 0.55, nutrients: C(0.5, 0.1, 0.05, 0.35) },
  { id: 'yamRoast',     tier: 1, ingredients: { yam: 2, garlic: 1 },     out: 2, nutrition: 0.60, nutrients: C(0.55, 0.1, 0.05, 0.3) },
  // Vegetable plates
  { id: 'cabbageRoll',  tier: 1, ingredients: { cabbage: 1, bean: 1 },   out: 2, nutrition: 0.55, nutrients: C(0.25, 0.3, 0.05, 0.4) },
  { id: 'gardenSalad',  tier: 1, ingredients: { lettuce: 1, tomato: 1, cucumber: 1 }, out: 3, nutrition: 0.40, nutrients: C(0.1, 0.05, 0.0, 0.85) },
  { id: 'spinachPie',   tier: 1, ingredients: { spinach: 2, wheat: 1 },  out: 2, nutrition: 0.55, nutrients: C(0.45, 0.1, 0.1, 0.35) },
  { id: 'broccoliBake', tier: 1, ingredients: { broccoli: 2, cabbage: 1 }, out: 2, nutrition: 0.55, nutrients: C(0.15, 0.15, 0.05, 0.65) },
  { id: 'cauliMash',    tier: 1, ingredients: { cauliflower: 2, garlic: 1 }, out: 2, nutrition: 0.55, nutrients: C(0.2, 0.15, 0.05, 0.6) },
  { id: 'celerySoup',   tier: 1, ingredients: { celery: 2, onion: 1 },   out: 2, nutrition: 0.45, nutrients: C(0.1, 0.05, 0.0, 0.85) },
  // Meat dishes
  { id: 'meatStew',     tier: 1, ingredients: { meat: 2, carrot: 1 },    out: 2, nutrition: 0.75, nutrients: C(0.2, 0.6, 0.15, 0.05) },
  { id: 'roastMeat',    tier: 1, ingredients: { meat: 2, onion: 1 },     out: 2, nutrition: 0.75, nutrients: C(0.05, 0.7, 0.2, 0.05) },
  { id: 'meatPie',      tier: 1, ingredients: { meat: 1, wheat: 1, onion: 1 }, out: 2, nutrition: 0.70, nutrients: C(0.4, 0.4, 0.15, 0.05) },
  // Fruit & nut
  { id: 'almondCake',   tier: 1, ingredients: { almond: 2, wheat: 1 },   out: 2, nutrition: 0.75, nutrients: C(0.45, 0.2, 0.3, 0.05) },

  // --- Tier 2 (5 banquet dishes) --------------------------------------------
  // Composite recipes — combine multiple Tier 1 dishes for the best food.
  { id: 'banquet',      tier: 2, ingredients: { roastMeat: 1, mashedPotato: 1, gardenSalad: 1 }, out: 3, nutrition: 0.90, nutrients: C(0.3, 0.35, 0.15, 0.2) },
  { id: 'harvestFeast', tier: 2, ingredients: { porridge: 1, lentilCurry: 1, roastRoot: 1 }, out: 3, nutrition: 0.85, nutrients: C(0.45, 0.25, 0.05, 0.25) },
  { id: 'soupCombo',    tier: 2, ingredients: { beanSoup: 1, celerySoup: 1, sweetPotPie: 1 }, out: 3, nutrition: 0.80, nutrients: C(0.4, 0.2, 0.05, 0.35) },
  { id: 'meatBanquet',  tier: 2, ingredients: { meatStew: 1, meatPie: 1, broccoliBake: 1 }, out: 3, nutrition: 0.90, nutrients: C(0.3, 0.4, 0.1, 0.2) },
  { id: 'dessertPlate', tier: 2, ingredients: { almondCake: 1, oatmeal: 1, hummus: 1 }, out: 3, nutrition: 0.80, nutrients: C(0.45, 0.25, 0.2, 0.1) },
];

/** Look up a recipe by id (null if unknown). */
const _byId = new Map(RECIPES.map((r) => [r.id, r]));
export function getRecipe(id) {
  return _byId.get(id) || null;
}

/** True if the given id is a dish (rather than a raw crop / forage). */
export function isDish(id) {
  return _byId.has(id);
}

/** All dish ids in display order. */
export const DISH_IDS = RECIPES.map((r) => r.id);

/**
 * Pick the best recipe the colony can cook right now from one source
 * (e.g. game.storage or a stockpile's items). Strategy:
 *   1. Prefer Tier 2 over Tier 1 (better dish).
 *   2. Within a tier, prefer recipes with more ingredients available.
 * Returns the recipe object, or null if nothing matches.
 */
export function pickBestAffordable(source, getQty = (k) => source[k] || 0) {
  let best = null;
  for (const r of RECIPES) {
    let ok = true;
    for (const [ing, n] of Object.entries(r.ingredients)) {
      if (getQty(ing) < n) { ok = false; break; }
    }
    if (!ok) continue;
    if (!best) { best = r; continue; }
    if (r.tier > best.tier) best = r;
    else if (r.tier === best.tier) {
      const a = Object.keys(r.ingredients).length;
      const b = Object.keys(best.ingredients).length;
      if (a > b) best = r;
    }
  }
  return best;
}

/**
 * Average the quality of a recipe's inputs from the supplied quality
 * map (id → 0..1). Missing entries fall back to 0.5 (a "fresh" default).
 * Clamps result to [0, 1].
 */
export function averageInputQuality(recipe, qualityMap) {
  let total = 0;
  let weight = 0;
  for (const [ing, n] of Object.entries(recipe.ingredients)) {
    const q = qualityMap?.[ing];
    const qv = Number.isFinite(q) ? q : 0.5;
    total += qv * n;
    weight += n;
  }
  if (weight === 0) return 0.5;
  const v = total / weight;
  return Math.max(0, Math.min(1, v));
}
