// Recipes (alpha 24). The cook task picks one of these whose ingredients
// the colony has on hand and converts the raw items into a finished dish.
//
// α31 overhaul:
//   1. Each recipe carries a `station` field naming the building it runs
//      at. Two stations exist: 'hearth' (the original cooking spot) and
//      'workshop' (the new α31 processing building shared by every
//      non-hearth station — mill / brewery / pickle shop / drying yard
//      / oil press / juice press / mochi shop / malt house / jam
//      workshop). The cookOne path filters recipes by the colonist's
//      current station so a workshop only runs workshop-recipes and a
//      hearth only runs hearth-recipes.
//   2. Each recipe ALSO carries a `kind` tag (e.g. 'mill', 'brewery',
//      'pickle', 'dry', 'oil', 'juice', 'mochi', 'malt', 'jam') used
//      only for the activity-log / UI naming ("X ground at the mill",
//      "Y aged at the brewery"). Functionally every workshop kind
//      shares one building, so the player only ever has to plan
//      around two structure types.
//   3. Recipe `nutrients` is no longer hard-coded. cookOne now computes
//      the output dish's nutrient profile by blending the *actual*
//      ingredient profiles weighted by quantity, then applies the
//      recipe's `processBias` (multiplicative and additive deltas per
//      nutrient — e.g. milling drops vitamin, fermentation pumps
//      protein, drying concentrates everything). The output also picks
//      up the input quality average (this part predates α31).
//
// Tier scheme:
//   - Tier 1 hearth (the original 25 cooked dishes)
//   - Tier 1 workshop (the new α31 processing recipes — both
//     intermediates like flour / malt and stand-alone finals like
//     jam / dried meat / pickles)
//   - Tier 2 hearth (5 banquet dishes — composite of Tier 1 dishes)
//
// All dish ids must be unique (no collision with crop ids).

const C = (carb, protein, fat, vitamin) => ({ carb, protein, fat, vitamin });
const noBias = { mul: { carb: 1, protein: 1, fat: 1, vitamin: 1 }, add: { carb: 0, protein: 0, fat: 0, vitamin: 0 } };

// Helper to build a process bias compactly. Defaults are identity.
function bias(opts = {}) {
  const mul = { carb: 1, protein: 1, fat: 1, vitamin: 1, ...(opts.mul || {}) };
  const add = { carb: 0, protein: 0, fat: 0, vitamin: 0, ...(opts.add || {}) };
  return { mul, add };
}

export const RECIPES = [
  // --- Tier 1 hearth (cooked dishes, the original α24 catalogue) ----------
  // Grain bowls
  { id: 'porridge',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { wheat: 2, oats: 1 },     out: 3, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.7 } }) },
  { id: 'riceBowl',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { rice: 2, carrot: 1 },    out: 3, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'cornCake',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { maize: 2, soybean: 1 },  out: 2, nutrition: 0.60, processBias: bias({ mul: { vitamin: 0.7 } }) },
  { id: 'oatmeal',      tier: 1, station: 'hearth', kind: 'cook', ingredients: { oats: 2, melon: 1 },     out: 3, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'barleyStew',   tier: 1, station: 'hearth', kind: 'cook', ingredients: { barley: 2, leek: 1 },    out: 2, nutrition: 0.60, processBias: bias({ mul: { vitamin: 0.8 } }) },
  // Legume soups & breads
  { id: 'beanSoup',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { bean: 2, onion: 1 },     out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.8 } }) },
  { id: 'peaSoup',      tier: 1, station: 'hearth', kind: 'cook', ingredients: { pea: 2, garlic: 1 },     out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.8 } }) },
  { id: 'lentilCurry',  tier: 1, station: 'hearth', kind: 'cook', ingredients: { lentil: 2, tomato: 1 },  out: 2, nutrition: 0.65, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'hummus',       tier: 1, station: 'hearth', kind: 'cook', ingredients: { chickpea: 2, garlic: 1 },out: 2, nutrition: 0.65, processBias: bias({ mul: { vitamin: 0.8 } }) },
  { id: 'tofu',         tier: 1, station: 'hearth', kind: 'cook', ingredients: { soybean: 3 },            out: 2, nutrition: 0.65, processBias: bias({ mul: { protein: 1.15, carb: 0.6 } }) },
  // Roots & tubers
  { id: 'roastRoot',    tier: 1, station: 'hearth', kind: 'cook', ingredients: { carrot: 1, parsnip: 1, turnip: 1 }, out: 3, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'mashedPotato', tier: 1, station: 'hearth', kind: 'cook', ingredients: { potato: 2 },             out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'sweetPotPie',  tier: 1, station: 'hearth', kind: 'cook', ingredients: { sweetPotato: 2, wheat: 1 }, out: 2, nutrition: 0.65, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'taroStew',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { taro: 2, onion: 1 },     out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'yamRoast',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { yam: 2, garlic: 1 },     out: 2, nutrition: 0.60, processBias: bias({ mul: { vitamin: 0.85 } }) },
  // Vegetable plates
  { id: 'cabbageRoll',  tier: 1, station: 'hearth', kind: 'cook', ingredients: { cabbage: 1, bean: 1 },   out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'gardenSalad',  tier: 1, station: 'hearth', kind: 'cook', ingredients: { lettuce: 1, tomato: 1, cucumber: 1 }, out: 3, nutrition: 0.40, processBias: bias({ mul: { vitamin: 0.95 } }) },
  { id: 'spinachPie',   tier: 1, station: 'hearth', kind: 'cook', ingredients: { spinach: 2, wheat: 1 },  out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.8 } }) },
  { id: 'broccoliBake', tier: 1, station: 'hearth', kind: 'cook', ingredients: { broccoli: 2, cabbage: 1 }, out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'cauliMash',    tier: 1, station: 'hearth', kind: 'cook', ingredients: { cauliflower: 2, garlic: 1 }, out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'celerySoup',   tier: 1, station: 'hearth', kind: 'cook', ingredients: { celery: 2, onion: 1 },   out: 2, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.9 } }) },
  // Meat dishes
  { id: 'meatStew',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { meat: 2, carrot: 1 },    out: 2, nutrition: 0.75, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'roastMeat',    tier: 1, station: 'hearth', kind: 'cook', ingredients: { meat: 2, onion: 1 },     out: 2, nutrition: 0.75, processBias: bias({ mul: { vitamin: 0.8 }, add: { fat: 0.05 } }) },
  { id: 'meatPie',      tier: 1, station: 'hearth', kind: 'cook', ingredients: { meat: 1, wheat: 1, onion: 1 }, out: 2, nutrition: 0.70, processBias: bias({ mul: { vitamin: 0.8 } }) },
  // Fruit & nut
  { id: 'almondCake',   tier: 1, station: 'hearth', kind: 'cook', ingredients: { almond: 2, wheat: 1 },   out: 2, nutrition: 0.75, processBias: bias({ mul: { vitamin: 0.8 } }) },

  // α31 followup: hearth-cooked single-raw dish from the spec.
  { id: 'roastEggplant',tier: 1, station: 'hearth', kind: 'cook', ingredients: { eggplant: 2 },           out: 2, nutrition: 0.50, processBias: bias({ mul: { vitamin: 0.85 } }) },

  // --- Tier 1 workshop intermediates (raw → ingredient, not a meal) -------
  // Mills (粉ひき所): grain / nut → flour. Milling strips vitamin and
  // concentrates carb slightly.
  { id: 'flour',       tier: 1, station: 'workshop', kind: 'mill',  ingredients: { wheat: 2 },     out: 2, nutrition: 0.40, processBias: bias({ mul: { vitamin: 0.4, carb: 1.05 } }), intermediate: true },
  { id: 'oatMeal',     tier: 1, station: 'workshop', kind: 'mill',  ingredients: { oats: 2 },      out: 2, nutrition: 0.40, processBias: bias({ mul: { vitamin: 0.5, carb: 1.05 } }), intermediate: true },
  { id: 'cornMeal',    tier: 1, station: 'workshop', kind: 'mill',  ingredients: { maize: 2 },     out: 2, nutrition: 0.40, processBias: bias({ mul: { vitamin: 0.5, carb: 1.05 } }), intermediate: true },
  { id: 'chickpeaFlour',tier: 1, station: 'workshop', kind: 'mill', ingredients: { chickpea: 2 },  out: 2, nutrition: 0.40, processBias: bias({ mul: { vitamin: 0.5, carb: 1.05 } }), intermediate: true },
  // Malt house (製麦所): barley → malt. Sprouting concentrates carbs &
  // adds a touch of protein from the enzymes.
  { id: 'malt',        tier: 1, station: 'workshop', kind: 'malt',  ingredients: { barley: 2 },    out: 2, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.7, carb: 1.1 }, add: { protein: 0.05 } }), intermediate: true },
  // Mochi shop (餅つき場): rice → mochi. Direct edible final, not
  // an intermediate. Sticky-rice retains the parent profile.
  { id: 'mochi',       tier: 1, station: 'workshop', kind: 'mochi', ingredients: { rice: 3 },      out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.9 }, add: { carb: 0.05 } }) },
  // Oil press (搾油所): soybean → soy oil. Lipid extraction shifts
  // strongly toward fat; everything else loses weight.
  { id: 'soyOil',      tier: 1, station: 'workshop', kind: 'oil',   ingredients: { soybean: 3 },   out: 1, nutrition: 0.50, processBias: bias({ mul: { carb: 0.2, protein: 0.3, vitamin: 0.2, fat: 3.5 } }), intermediate: true },

  // --- Tier 1 workshop finished (no further cook needed) ------------------
  // Jam workshop (ジャム工房). Concentrating fruit boosts carb (sugar)
  // and keeps vitamin reasonable; fat ~0.
  { id: 'strawberryJam',tier: 1, station: 'workshop', kind: 'jam',   ingredients: { strawberry: 3 }, out: 2, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.7, carb: 1.5 }, add: { carb: 0.05 } }) },
  // Brewery (醸造所). Berry wine — fruit fermented into a mild drink.
  { id: 'strawberryWine',tier: 1, station: 'workshop', kind: 'brew', ingredients: { strawberry: 3 }, out: 2, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.5, carb: 0.7 }, add: { carb: 0.10 } }) },
  // Brewery: beer needs malt + hops. Beer keeps mild carbs and gains
  // a bit of protein from the brewer's yeast.
  { id: 'beer',         tier: 1, station: 'workshop', kind: 'brew', ingredients: { malt: 2, hop: 1 }, out: 3, nutrition: 0.50, processBias: bias({ mul: { vitamin: 0.6, carb: 0.7 }, add: { protein: 0.05 } }) },
  // Drying yard (乾燥場). Dehydration concentrates EVERYTHING per unit
  // weight — multipliers ≥1 across the board.
  { id: 'driedMelon',   tier: 1, station: 'workshop', kind: 'dry',  ingredients: { melon: 3 },      out: 2, nutrition: 0.50, processBias: bias({ mul: { vitamin: 1.3, carb: 1.5 } }) },
  { id: 'driedMeat',    tier: 1, station: 'workshop', kind: 'dry',  ingredients: { meat: 2 },       out: 2, nutrition: 0.65, processBias: bias({ mul: { protein: 1.3, fat: 1.2 } }) },
  // Pickle shop (漬物所). Fermentation gains a touch of protein, retains
  // vitamin reasonably, but the brine drops the carb side a bit.
  { id: 'sauerkraut',   tier: 1, station: 'workshop', kind: 'pickle', ingredients: { cabbage: 3 }, out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 1.1, carb: 0.85 }, add: { protein: 0.05 } }) },
  { id: 'napaPickle',   tier: 1, station: 'workshop', kind: 'pickle', ingredients: { lettuce: 3 }, out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 1.1, carb: 0.85 }, add: { protein: 0.05 } }) },
  { id: 'pickles',      tier: 1, station: 'workshop', kind: 'pickle', ingredients: { cucumber: 3 }, out: 3, nutrition: 0.40, processBias: bias({ mul: { vitamin: 1.0, carb: 0.85 }, add: { protein: 0.05 } }) },
  { id: 'curedMeat',    tier: 1, station: 'workshop', kind: 'pickle', ingredients: { meat: 2 },     out: 2, nutrition: 0.65, processBias: bias({ mul: { protein: 1.1, fat: 1.1 } }) },
  // Juice press (搾汁所). Pressing keeps vitamin high and loses very
  // little of the original profile.
  { id: 'tomatoJuice',  tier: 1, station: 'workshop', kind: 'juice', ingredients: { tomato: 3 },   out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 1.0, carb: 0.95 } }) },

  // --- Tier 1 hearth, takes a workshop intermediate as one ingredient ----
  // Hearth recipe consuming the chickpea flour. Falafel rebuilds protein
  // a touch and adds fat from frying.
  { id: 'falafel',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { chickpeaFlour: 2, onion: 1 }, out: 2, nutrition: 0.60, processBias: bias({ mul: { vitamin: 0.7 }, add: { fat: 0.10 } }) },

  // --- Tier 2 banquet (composite of Tier 1 dishes, hearth) ----------------
  { id: 'banquet',      tier: 2, station: 'hearth', kind: 'cook', ingredients: { roastMeat: 1, mashedPotato: 1, gardenSalad: 1 }, out: 3, nutrition: 0.90, processBias: noBias },
  { id: 'harvestFeast', tier: 2, station: 'hearth', kind: 'cook', ingredients: { porridge: 1, lentilCurry: 1, roastRoot: 1 }, out: 3, nutrition: 0.85, processBias: noBias },
  { id: 'soupCombo',    tier: 2, station: 'hearth', kind: 'cook', ingredients: { beanSoup: 1, celerySoup: 1, sweetPotPie: 1 }, out: 3, nutrition: 0.80, processBias: noBias },
  { id: 'meatBanquet',  tier: 2, station: 'hearth', kind: 'cook', ingredients: { meatStew: 1, meatPie: 1, broccoliBake: 1 }, out: 3, nutrition: 0.90, processBias: noBias },
  { id: 'dessertPlate', tier: 2, station: 'hearth', kind: 'cook', ingredients: { almondCake: 1, oatmeal: 1, hummus: 1 }, out: 3, nutrition: 0.80, processBias: noBias },
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

/** Intermediate workshop products are dishes too but aren't "meals" —
 *  the player should still be able to cook them further. The cook
 *  fallback path checks this to avoid feeding raw flour to colonists. */
export function isIntermediate(id) {
  return _byId.get(id)?.intermediate === true;
}

/** All dish ids in display order. */
export const DISH_IDS = RECIPES.map((r) => r.id);

/**
 * Pick the best recipe the colony can cook right now from one source
 * (e.g. game.storage or a stockpile's items). Strategy:
 *   1. Filter by `station` if provided so a hearth doesn't run a mill
 *      recipe and a workshop doesn't run a hearth recipe.
 *   2. Prefer Tier 2 over Tier 1 (better dish).
 *   3. Within a tier, prefer recipes with more ingredients available.
 * Returns the recipe object, or null if nothing matches.
 */
export function pickBestAffordable(source, getQty = (k) => source[k] || 0, station = null) {
  let best = null;
  for (const r of RECIPES) {
    if (station && r.station !== station) continue;
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

/**
 * α31: compute the dish's nutrient profile from the actual ingredient
 * profiles, then apply the recipe's `processBias`. Returns a fresh
 * { carb, protein, fat, vitamin } object clamped to [0, 1].
 *
 * `lookup(id)` returns the nutrients for one ingredient id — passed in
 * from the caller (game.js wires it to foodSystem.nutrientsOf with the
 * cook's group so a 'meal' input draws on that group's running average
 * rather than the static default).
 */
export function computeRecipeNutrients(recipe, lookup) {
  const blended = { carb: 0, protein: 0, fat: 0, vitamin: 0 };
  let weight = 0;
  for (const [ing, n] of Object.entries(recipe.ingredients)) {
    const profile = lookup(ing) || { carb: 0, protein: 0, fat: 0, vitamin: 0 };
    blended.carb    += (profile.carb    || 0) * n;
    blended.protein += (profile.protein || 0) * n;
    blended.fat     += (profile.fat     || 0) * n;
    blended.vitamin += (profile.vitamin || 0) * n;
    weight += n;
  }
  if (weight === 0) return blended;
  for (const k of ['carb', 'protein', 'fat', 'vitamin']) blended[k] /= weight;
  // Apply processBias.
  const b = recipe.processBias || noBias;
  const out = {};
  for (const k of ['carb', 'protein', 'fat', 'vitamin']) {
    const v = blended[k] * (b.mul[k] ?? 1) + (b.add[k] ?? 0);
    out[k] = Math.max(0, Math.min(1, v));
  }
  return out;
}
