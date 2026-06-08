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
  //
  // α31 followup: workshop OUTPUT COUNT is now ROUGHLY 1.5×–2× the
  // input count, so processing GAINS food rather than losing it. This
  // models the abstraction that fermentation / drying / pressing
  // produces more SERVINGS per raw unit even when total mass drops
  // (e.g. 1 large melon → 6 dried slices). Each serving still carries
  // the boosted nutrient profile (processBias multipliers and additive
  // bonuses) so workshops both increase total food AND lift nutrient
  // density per item. Headless trials with 3→2-output recipes showed
  // workshops as a survival NET-NEGATIVE; bumping to 3→5 / 2→3 turns
  // them into a clear gain.
  //
  // Mill (粉ひき所): grain / nut → flour. Milling strips vitamin but
  // concentrates carb strongly (refined flour is essentially pure starch).
  // Output 3 (was 2) — 2 input → 3 servings, 1.5× food.
  { id: 'flour',       tier: 1, station: 'workshop', kind: 'mill',  ingredients: { wheat: 2 },     out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.35, carb: 1.6 }, add: { carb: 0.05 } }), intermediate: true },
  { id: 'oatMeal',     tier: 1, station: 'workshop', kind: 'mill',  ingredients: { oats: 2 },      out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.40, carb: 1.6 }, add: { carb: 0.05 } }), intermediate: true },
  { id: 'cornMeal',    tier: 1, station: 'workshop', kind: 'mill',  ingredients: { maize: 2 },     out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.40, carb: 1.6 }, add: { carb: 0.05 } }), intermediate: true },
  { id: 'chickpeaFlour',tier: 1, station: 'workshop', kind: 'mill', ingredients: { chickpea: 2 },  out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 0.40, carb: 1.5 }, add: { protein: 0.10 } }), intermediate: true },
  // Malt house (製麦所). Output 3 (was 2) — 1.5×.
  { id: 'malt',        tier: 1, station: 'workshop', kind: 'malt',  ingredients: { barley: 2 },    out: 3, nutrition: 0.50, processBias: bias({ mul: { vitamin: 0.6, carb: 1.5 }, add: { protein: 0.15 } }), intermediate: true },
  // Mochi shop. Output 5 (was 2) — 3 input → 5, ~1.7×.
  { id: 'mochi',       tier: 1, station: 'workshop', kind: 'mochi', ingredients: { rice: 3 },      out: 5, nutrition: 0.65, processBias: bias({ mul: { vitamin: 0.85, carb: 1.7 }, add: { protein: 0.08 } }) },
  // Oil press — concentrated lipid. Output 2 (was 1) — 3 input → 2 oil
  // (still concentrated, but ratio improved to avoid catastrophic loss).
  { id: 'soyOil',      tier: 1, station: 'workshop', kind: 'oil',   ingredients: { soybean: 3 },   out: 2, nutrition: 0.55, processBias: bias({ mul: { carb: 0.15, protein: 0.25, vitamin: 0.15, fat: 4.5 } }), intermediate: true },

  // --- Tier 1 workshop finished (no further cook needed) ------------------
  // Jam — output 5 (was 2). 3 input → 5 jars, ~1.7×.
  { id: 'strawberryJam',tier: 1, station: 'workshop', kind: 'jam',   ingredients: { strawberry: 3 }, out: 5, nutrition: 0.65, processBias: bias({ mul: { vitamin: 1.0, carb: 2.0 }, add: { carb: 0.10 } }) },
  // Brewery — drinks. Wine output 5 (was 2), beer output 5 (was 3).
  { id: 'strawberryWine',tier: 1, station: 'workshop', kind: 'brew', ingredients: { strawberry: 3 }, out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.6, carb: 1.0 }, add: { carb: 0.15, protein: 0.10 } }) },
  { id: 'beer',         tier: 1, station: 'workshop', kind: 'brew', ingredients: { malt: 2, hop: 1 }, out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.7, carb: 1.0 }, add: { protein: 0.18 } }) },
  // Drying — output 5 (was 2). 3 input → 5 slices, ~1.7×.
  { id: 'driedMelon',   tier: 1, station: 'workshop', kind: 'dry',  ingredients: { melon: 3 },      out: 5, nutrition: 0.65, processBias: bias({ mul: { vitamin: 1.8, carb: 2.0 }, add: { protein: 0.05 } }) },
  // driedMeat — output 3 (was 2). 2 input → 3, 1.5×.
  { id: 'driedMeat',    tier: 1, station: 'workshop', kind: 'dry',  ingredients: { meat: 2 },       out: 3, nutrition: 0.75, processBias: bias({ mul: { protein: 1.8, fat: 1.8 }, add: { fat: 0.10 } }) },
  // Pickle — output 5 (was 3). 3 input → 5 jars, ~1.7×.
  { id: 'sauerkraut',   tier: 1, station: 'workshop', kind: 'pickle', ingredients: { cabbage: 3 }, out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 1.6, carb: 1.2 }, add: { protein: 0.20, carb: 0.08 } }) },
  { id: 'napaPickle',   tier: 1, station: 'workshop', kind: 'pickle', ingredients: { lettuce: 3 }, out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 1.6, carb: 1.2 }, add: { protein: 0.20, carb: 0.08 } }) },
  { id: 'pickles',      tier: 1, station: 'workshop', kind: 'pickle', ingredients: { cucumber: 3 }, out: 5, nutrition: 0.50, processBias: bias({ mul: { vitamin: 1.5, carb: 1.2 }, add: { protein: 0.18, carb: 0.05 } }) },
  // curedMeat — output 3 (was 2). 2 input → 3, 1.5×.
  { id: 'curedMeat',    tier: 1, station: 'workshop', kind: 'pickle', ingredients: { meat: 2 },     out: 3, nutrition: 0.75, processBias: bias({ mul: { protein: 1.5, fat: 1.5 }, add: { protein: 0.08, vitamin: 0.05 } }) },
  // Juice — output 5 (was 3). 3 input → 5 cups, ~1.7×.
  { id: 'tomatoJuice',  tier: 1, station: 'workshop', kind: 'juice', ingredients: { tomato: 3 },   out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 1.6, carb: 1.3 }, add: { protein: 0.05 } }) },

  // --- α31 followup: 2-raw → 1-product workshop recipes ------------------
  // All 3-input → 5-output. 1.7× food gain.
  // Pickle station — mixed pickle styles.
  { id: 'mixedPickles', tier: 1, station: 'workshop', kind: 'pickle', ingredients: { cucumber: 2, onion: 1 }, out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 1.5, carb: 1.2 }, add: { protein: 0.20, carb: 0.08 } }) },
  { id: 'namasu',       tier: 1, station: 'workshop', kind: 'pickle', ingredients: { radish: 2, carrot: 1 },  out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 1.5, carb: 1.2 }, add: { protein: 0.20, carb: 0.08 } }) },
  // Juice station — mixed juices / smoothies.
  { id: 'vegJuice',     tier: 1, station: 'workshop', kind: 'juice',  ingredients: { tomato: 2, carrot: 1 },  out: 5, nutrition: 0.60, processBias: bias({ mul: { vitamin: 1.6, carb: 1.3 }, add: { protein: 0.05 } }) },
  { id: 'fruitSmoothie',tier: 1, station: 'workshop', kind: 'juice',  ingredients: { strawberry: 2, melon: 1 }, out: 5, nutrition: 0.60, processBias: bias({ mul: { vitamin: 1.5, carb: 1.5 }, add: { protein: 0.05 } }) },
  // Mill station — fortified / blended flour. Intermediate. Out 5 (was 2).
  { id: 'mixedFlour',   tier: 1, station: 'workshop', kind: 'mill',   ingredients: { wheat: 2, barley: 1 },   out: 5, nutrition: 0.50, processBias: bias({ mul: { vitamin: 0.40, carb: 1.6 }, add: { carb: 0.08, protein: 0.05 } }), intermediate: true },
  // Drying station — mixed dried fruit.
  { id: 'driedFruit',   tier: 1, station: 'workshop', kind: 'dry',    ingredients: { strawberry: 2, melon: 1 }, out: 5, nutrition: 0.65, processBias: bias({ mul: { vitamin: 1.8, carb: 1.8 }, add: { protein: 0.05 } }) },
  // Brewery station — sake.
  { id: 'sake',         tier: 1, station: 'workshop', kind: 'brew',   ingredients: { rice: 2, malt: 1 },      out: 5, nutrition: 0.55, processBias: bias({ mul: { vitamin: 0.6, carb: 1.0 }, add: { protein: 0.15 } }) },
  // Jam station — mixed-fruit jam.
  { id: 'mixedJam',     tier: 1, station: 'workshop', kind: 'jam',    ingredients: { strawberry: 2, melon: 1 }, out: 5, nutrition: 0.65, processBias: bias({ mul: { vitamin: 1.0, carb: 2.0 }, add: { carb: 0.10 } }) },

  // --- Tier 1 hearth, takes a workshop intermediate as one ingredient ----
  // Hearth recipe consuming the chickpea flour. Falafel rebuilds protein
  // a touch and adds fat from frying.
  { id: 'falafel',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { chickpeaFlour: 2, onion: 1 }, out: 2, nutrition: 0.60, processBias: bias({ mul: { vitamin: 0.7 }, add: { fat: 0.10 } }) },

  // --- α34: seafood hearth dishes -----------------------------------------
  // Single-raw dishes — fast / cheap, fish-only.
  { id: 'grilledFish',  tier: 1, station: 'hearth', kind: 'cook', ingredients: { saltFish: 2 },                 out: 3, nutrition: 0.65, processBias: bias({ mul: { vitamin: 0.85 }, add: { fat: 0.05 } }) },
  // Mixed seafood pairings — protein + vegetable to round nutrient profile.
  { id: 'fishStew',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { saltFish: 1, riverFish: 1, carrot: 1 }, out: 3, nutrition: 0.70, processBias: bias({ mul: { vitamin: 0.85 } }) },
  { id: 'clamChowder',  tier: 1, station: 'hearth', kind: 'cook', ingredients: { clam: 2, potato: 1, onion: 1 }, out: 4, nutrition: 0.70, processBias: bias({ mul: { vitamin: 0.85 }, add: { fat: 0.05 } }) },
  { id: 'shrimpTempura',tier: 1, station: 'hearth', kind: 'cook', ingredients: { shrimp: 2, wheat: 1 },         out: 3, nutrition: 0.65, processBias: bias({ mul: { vitamin: 0.75 }, add: { fat: 0.10 } }) },
  { id: 'crabBoil',     tier: 1, station: 'hearth', kind: 'cook', ingredients: { crab: 2, garlic: 1 },          out: 3, nutrition: 0.75, processBias: bias({ mul: { vitamin: 0.85 } }) },
  // α34 followup: grilled salmon replaces the eel kabayaki — same role
  // (fatty river-fish entrée) with the more globally recognised species.
  { id: 'grilledSalmon',tier: 1, station: 'hearth', kind: 'cook', ingredients: { salmon: 2, onion: 1 },         out: 3, nutrition: 0.80, processBias: bias({ mul: { vitamin: 0.85 }, add: { fat: 0.10 } }) },
  // Seaweed salad — vegetable-dominant; the early coastal "vitamin
  // patch" before fields produce greens.
  { id: 'seaweedSalad', tier: 1, station: 'hearth', kind: 'cook', ingredients: { seaweed: 2, sesame: 1 },       out: 3, nutrition: 0.45, processBias: bias({ mul: { vitamin: 1.10 } }) },
  // Sushi — rice + lake or river fish. Premium dish; high nutrition.
  { id: 'sushi',        tier: 1, station: 'hearth', kind: 'cook', ingredients: { riverFish: 1, lakeFish: 1, rice: 2 }, out: 4, nutrition: 0.75, processBias: bias({ mul: { vitamin: 0.90 } }) },

  // --- α34: seafood workshop preservation (drying / salting) -------------
  // Dried fish — 3 raw → 5 servings. Output > input, model preservation
  // and the long-term storage advantage that lets coastal colonies
  // build a winter buffer when fishing is at its peak.
  { id: 'driedFish',    tier: 1, station: 'workshop', kind: 'dry', ingredients: { saltFish: 3 },                out: 5, nutrition: 0.65, processBias: bias({ mul: { protein: 1.6, fat: 1.6 }, add: { fat: 0.08 } }) },
  // α34 followup: smoked salmon — drying station, 3 → 5 servings. The
  // signature preserved-salmon dish; gives the river-adjacent colony a
  // long-shelf-life protein bank for winter.
  { id: 'smokedSalmon', tier: 1, station: 'workshop', kind: 'dry', ingredients: { salmon: 3 },                  out: 5, nutrition: 0.70, processBias: bias({ mul: { protein: 1.6, fat: 1.8 }, add: { fat: 0.12 } }) },
  { id: 'driedSeaweed', tier: 1, station: 'workshop', kind: 'dry', ingredients: { seaweed: 3 },                 out: 5, nutrition: 0.50, processBias: bias({ mul: { vitamin: 1.8, carb: 1.6 }, add: { vitamin: 0.10 } }) },
  // Salted clams — pickle station. 3 → 5.
  { id: 'saltedClams',  tier: 1, station: 'workshop', kind: 'pickle', ingredients: { clam: 3 },                 out: 5, nutrition: 0.55, processBias: bias({ mul: { protein: 1.4, vitamin: 1.3 }, add: { protein: 0.10 } }) },

  // --- Tier 2 banquet (composite of Tier 1 dishes, hearth) ----------------
  { id: 'banquet',      tier: 2, station: 'hearth', kind: 'cook', ingredients: { roastMeat: 1, mashedPotato: 1, gardenSalad: 1 }, out: 3, nutrition: 0.90, processBias: noBias },
  { id: 'harvestFeast', tier: 2, station: 'hearth', kind: 'cook', ingredients: { porridge: 1, lentilCurry: 1, roastRoot: 1 }, out: 3, nutrition: 0.85, processBias: noBias },
  { id: 'soupCombo',    tier: 2, station: 'hearth', kind: 'cook', ingredients: { beanSoup: 1, celerySoup: 1, sweetPotPie: 1 }, out: 3, nutrition: 0.80, processBias: noBias },
  { id: 'meatBanquet',  tier: 2, station: 'hearth', kind: 'cook', ingredients: { meatStew: 1, meatPie: 1, broccoliBake: 1 }, out: 3, nutrition: 0.90, processBias: noBias },
  { id: 'dessertPlate', tier: 2, station: 'hearth', kind: 'cook', ingredients: { almondCake: 1, oatmeal: 1, hummus: 1 }, out: 3, nutrition: 0.80, processBias: noBias },
  // α34: seafood banquet — combines three seafood Tier 1 dishes for the
  // coastal end-game spread. Same scheme as the other Tier 2 plates:
  // 1+1+1 → 3 servings at high nutrition.
  { id: 'seafoodFeast', tier: 2, station: 'hearth', kind: 'cook', ingredients: { sushi: 1, clamChowder: 1, seaweedSalad: 1 }, out: 3, nutrition: 0.90, processBias: noBias },
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

/**
 * α31: ids that ONLY appear as workshop-recipe inputs (never in a
 * hearth recipe). The hearth raw→meal legacy fallback skips these so
 * that workshop-exclusive ingredients (most notably hop, which has
 * no hearth use at all) stay available for their intended workshop
 * recipe instead of being shovelled into the survival-cooking meal
 * stack the instant a hearth is up.
 */
const _hearthInputs = new Set();
for (const r of RECIPES) {
  if (r.station !== 'hearth') continue;
  for (const ing of Object.keys(r.ingredients)) _hearthInputs.add(ing);
}
const _workshopInputs = new Set();
for (const r of RECIPES) {
  if (r.station !== 'workshop') continue;
  for (const ing of Object.keys(r.ingredients)) _workshopInputs.add(ing);
}
const _workshopOnlyInputs = new Set();
for (const id of _workshopInputs) {
  if (!_hearthInputs.has(id)) _workshopOnlyInputs.add(id);
}
export function isWorkshopOnlyInput(id) {
  return _workshopOnlyInputs.has(id);
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
