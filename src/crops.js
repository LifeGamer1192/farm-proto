// Crop types. Alpha 4 introduced three crops (wheat / potato / bean);
// alpha 17 grows the catalogue to about thirty‑five crops across eleven
// categories (grains, legumes, root vegetables, tubers, bulbs, leaf
// greens, stem vegetables, flower vegetables, fruit vegetables, fruits
// and nuts). Each crop carries its own growth time, yield, soil
// preferences and a nutrition value (0..1).
//
// A sown crop grows over time (growth 0 → 1). Once growth reaches 1 it
// is ripe and can be harvested for `yield` units of food. But the initial
// crop strains are weak: a sown crop may wither before it ripens, and
// how likely it is to survive depends on how well the tile's soil suits
// it (and from alpha 11 onward on the seed's quality rank too).

// α29: genome builders live in genetics.js (which does NOT import this
// module, so importing it here is not circular). Used to give each crop
// its own starting-quality fingerprint (D6) and to keep wild ancestors
// feeble (D5).
import { biasedGenome, wildGenome } from './genetics.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// The eleven plant categories. Visuals and a few balance touches branch on
// the category — root vegetables hide their root underground, grains grow
// as stalks with a seed head, etc.
export const CATEGORIES = [
  'grain',
  'legume',
  'root',
  'tuber',
  'bulb',
  'leaf',
  'stem',
  'flower',
  'fruitVeg',
  'fruit',
  'nut',
];

export const CROP_TYPES = {
  // ----- Grains (穀類) -----
  wheat:       { id:'wheat',       label:'Wheat',        category:'grain',    growthTime:35, yield:4, color:'#caa63f', ripeColor:'#f1da7e', soil:{fertility:0.30,moisture:0.20,sunlight:0.50}, nutrition:0.45 },
  rice:        { id:'rice',        label:'Rice',         category:'grain',    growthTime:40, yield:5, color:'#bccd64', ripeColor:'#ead889', soil:{fertility:0.25,moisture:0.55,sunlight:0.20}, nutrition:0.50 },
  maize:       { id:'maize',       label:'Maize',        category:'grain',    growthTime:45, yield:6, color:'#bcaa42', ripeColor:'#f5d249', soil:{fertility:0.40,moisture:0.20,sunlight:0.40}, nutrition:0.50 },
  oats:        { id:'oats',        label:'Oats',         category:'grain',    growthTime:32, yield:4, color:'#caaa6a', ripeColor:'#e9d29a', soil:{fertility:0.30,moisture:0.25,sunlight:0.45}, nutrition:0.45 },
  barley:      { id:'barley',      label:'Barley',       category:'grain',    growthTime:30, yield:4, color:'#c7a64f', ripeColor:'#e9d273', soil:{fertility:0.25,moisture:0.20,sunlight:0.55}, nutrition:0.45 },

  // ----- Legumes (豆類) -----
  bean:        { id:'bean',        label:'Bean',         category:'legume',   growthTime:20, yield:2, color:'#7cc653', ripeColor:'#b6e07a', soil:{fertility:0.34,moisture:0.33,sunlight:0.33}, nutrition:0.40 },
  soybean:     { id:'soybean',     label:'Soybean',      category:'legume',   growthTime:25, yield:3, color:'#8ec25a', ripeColor:'#c4d680', soil:{fertility:0.30,moisture:0.40,sunlight:0.30}, nutrition:0.55 },
  pea:         { id:'pea',         label:'Pea',          category:'legume',   growthTime:22, yield:3, color:'#9ec264', ripeColor:'#bce292', soil:{fertility:0.25,moisture:0.45,sunlight:0.30}, nutrition:0.45 },
  lentil:      { id:'lentil',      label:'Lentil',       category:'legume',   growthTime:28, yield:4, color:'#9aa256', ripeColor:'#c4a45a', soil:{fertility:0.30,moisture:0.30,sunlight:0.40}, nutrition:0.50 },
  chickpea:    { id:'chickpea',    label:'Chickpea',     category:'legume',   growthTime:35, yield:4, color:'#a8a866', ripeColor:'#d4b878', soil:{fertility:0.25,moisture:0.30,sunlight:0.45}, nutrition:0.50 },

  // ----- Root vegetables (根菜類) -----
  carrot:      { id:'carrot',      label:'Carrot',       category:'root',     growthTime:28, yield:5, color:'#6fae4e', ripeColor:'#e08a3a', soil:{fertility:0.40,moisture:0.35,sunlight:0.25}, nutrition:0.45 },
  radish:      { id:'radish',      label:'Radish',       category:'root',     growthTime:18, yield:3, color:'#7cc05a', ripeColor:'#d54f6c', soil:{fertility:0.35,moisture:0.35,sunlight:0.30}, nutrition:0.35 },
  turnip:      { id:'turnip',      label:'Turnip',       category:'root',     growthTime:25, yield:4, color:'#80b558', ripeColor:'#dcc8a8', soil:{fertility:0.40,moisture:0.30,sunlight:0.30}, nutrition:0.40 },
  parsnip:     { id:'parsnip',     label:'Parsnip',      category:'root',     growthTime:30, yield:5, color:'#7eb45a', ripeColor:'#e8d8a8', soil:{fertility:0.45,moisture:0.30,sunlight:0.25}, nutrition:0.50 },

  // ----- Tubers (塊茎類) -----
  potato:      { id:'potato',      label:'Potato',       category:'tuber',    growthTime:50, yield:7, color:'#6fae4e', ripeColor:'#c9a86b', soil:{fertility:0.50,moisture:0.30,sunlight:0.20}, nutrition:0.50 },
  sweetPotato: { id:'sweetPotato', label:'Sweet potato', category:'tuber',    growthTime:55, yield:8, color:'#76b258', ripeColor:'#c87a3e', soil:{fertility:0.45,moisture:0.35,sunlight:0.20}, nutrition:0.55 },
  taro:        { id:'taro',        label:'Taro',         category:'tuber',    growthTime:60, yield:7, color:'#65a052', ripeColor:'#a98a6a', soil:{fertility:0.40,moisture:0.50,sunlight:0.10}, nutrition:0.50 },
  yam:         { id:'yam',         label:'Yam',          category:'tuber',    growthTime:65, yield:9, color:'#6db050', ripeColor:'#b08a5a', soil:{fertility:0.50,moisture:0.35,sunlight:0.15}, nutrition:0.55 },

  // ----- Bulbs (鱗茎類) -----
  onion:       { id:'onion',       label:'Onion',        category:'bulb',     growthTime:30, yield:4, color:'#88c060', ripeColor:'#d3c483', soil:{fertility:0.35,moisture:0.30,sunlight:0.35}, nutrition:0.40 },
  garlic:      { id:'garlic',      label:'Garlic',       category:'bulb',     growthTime:35, yield:3, color:'#8ac064', ripeColor:'#ece2c0', soil:{fertility:0.35,moisture:0.25,sunlight:0.40}, nutrition:0.50 },
  leek:        { id:'leek',        label:'Leek',         category:'bulb',     growthTime:28, yield:3, color:'#7eb85a', ripeColor:'#cad58c', soil:{fertility:0.40,moisture:0.35,sunlight:0.25}, nutrition:0.40 },

  // ----- Leaf greens (葉菜類) -----
  cabbage:     { id:'cabbage',     label:'Cabbage',      category:'leaf',     growthTime:20, yield:4, color:'#7ac058', ripeColor:'#abcc6a', soil:{fertility:0.40,moisture:0.40,sunlight:0.20}, nutrition:0.40 },
  lettuce:     { id:'lettuce',     label:'Lettuce',      category:'leaf',     growthTime:14, yield:3, color:'#9fcd5e', ripeColor:'#c4dc7c', soil:{fertility:0.35,moisture:0.45,sunlight:0.20}, nutrition:0.30 },
  spinach:     { id:'spinach',     label:'Spinach',      category:'leaf',     growthTime:16, yield:3, color:'#5ea64a', ripeColor:'#7cc46a', soil:{fertility:0.45,moisture:0.40,sunlight:0.15}, nutrition:0.50 },

  // ----- Stem vegetables (茎菜類) -----
  celery:      { id:'celery',      label:'Celery',       category:'stem',     growthTime:22, yield:3, color:'#8fc066', ripeColor:'#c0dc8a', soil:{fertility:0.40,moisture:0.45,sunlight:0.15}, nutrition:0.30 },
  asparagus:   { id:'asparagus',   label:'Asparagus',    category:'stem',     growthTime:30, yield:4, color:'#7eb45a', ripeColor:'#aacc78', soil:{fertility:0.40,moisture:0.35,sunlight:0.25}, nutrition:0.50 },

  // ----- Flower vegetables (花菜類) -----
  broccoli:    { id:'broccoli',    label:'Broccoli',     category:'flower',   growthTime:28, yield:5, color:'#5ea642', ripeColor:'#6caf52', soil:{fertility:0.45,moisture:0.35,sunlight:0.20}, nutrition:0.55 },
  cauliflower: { id:'cauliflower', label:'Cauliflower',  category:'flower',   growthTime:32, yield:5, color:'#7eb858', ripeColor:'#ece6cc', soil:{fertility:0.45,moisture:0.35,sunlight:0.20}, nutrition:0.50 },
  // α31: brewing ingredient. Inedible raw (pellets are bitter, used only
  // as a beer flavouring). Flower-category so the renderer treats it
  // like the existing flower vegetables.
  hop:         { id:'hop',         label:'Hop',          category:'flower',   growthTime:40, yield:3, color:'#6fa852', ripeColor:'#a8c668', soil:{fertility:0.35,moisture:0.40,sunlight:0.40}, nutrition:0.10 },

  // ----- Fruit vegetables (果菜類) -----
  tomato:      { id:'tomato',      label:'Tomato',       category:'fruitVeg', growthTime:30, yield:6, color:'#7ac054', ripeColor:'#e25a3a', soil:{fertility:0.35,moisture:0.30,sunlight:0.35}, nutrition:0.50 },
  eggplant:    { id:'eggplant',    label:'Eggplant',     category:'fruitVeg', growthTime:35, yield:5, color:'#82b65c', ripeColor:'#704690', soil:{fertility:0.35,moisture:0.30,sunlight:0.35}, nutrition:0.40 },
  cucumber:    { id:'cucumber',    label:'Cucumber',     category:'fruitVeg', growthTime:25, yield:5, color:'#7cc25e', ripeColor:'#6aa84a', soil:{fertility:0.35,moisture:0.40,sunlight:0.25}, nutrition:0.35 },
  pepper:      { id:'pepper',      label:'Pepper',       category:'fruitVeg', growthTime:28, yield:4, color:'#7eb858', ripeColor:'#e23a3a', soil:{fertility:0.35,moisture:0.30,sunlight:0.35}, nutrition:0.45 },

  // ----- Fruits (果実類) -----
  strawberry:  { id:'strawberry',  label:'Strawberry',   category:'fruit',    growthTime:22, yield:4, color:'#8acc66', ripeColor:'#e24a55', soil:{fertility:0.40,moisture:0.35,sunlight:0.25}, nutrition:0.50 },
  melon:       { id:'melon',       label:'Melon',        category:'fruit',    growthTime:45, yield:8, color:'#88c466', ripeColor:'#dcd476', soil:{fertility:0.35,moisture:0.30,sunlight:0.35}, nutrition:0.55 },

  // ----- Nuts (堅果類) -----
  almond:      { id:'almond',      label:'Almond',       category:'nut',      growthTime:60, yield:6, color:'#9aa66a', ripeColor:'#c8a47a', soil:{fertility:0.25,moisture:0.20,sunlight:0.55}, nutrition:0.70 },
  walnut:      { id:'walnut',      label:'Walnut',       category:'nut',      growthTime:70, yield:5, color:'#6f8a48', ripeColor:'#7a5d36', soil:{fertility:0.35,moisture:0.30,sunlight:0.35}, nutrition:0.65 },
  chestnut:    { id:'chestnut',    label:'Chestnut',     category:'nut',      growthTime:65, yield:7, color:'#7ea34b', ripeColor:'#864b22', soil:{fertility:0.40,moisture:0.30,sunlight:0.30}, nutrition:0.60 },

  // ----- Wild ancestors (alpha 20 / alpha 27) — sown from a seed
  //       gathered while foraging a wild plant. Very weak: tiny yield,
  //       almost no nutrition, slow to grow. Selective breeding (cross-
  //       pollinate on harvest, codex tracks the best variety) is the
  //       only way to bring them up to a useful crop, and α27 widens
  //       the catalogue from one wild leaf to five wild ancestors so
  //       every food category can be discovered through foraging.
  wildgreens:  { id:'wildgreens',  label:'Wild greens',  category:'leaf',     growthTime:50, yield:1, color:'#6b8d4a', ripeColor:'#8aa756', soil:{fertility:0.20,moisture:0.30,sunlight:0.30}, nutrition:0.10 },
  wildgrain:   { id:'wildgrain',   label:'Wild grain',   category:'grain',    growthTime:70, yield:1, color:'#a0a05a', ripeColor:'#c4b070', soil:{fertility:0.20,moisture:0.20,sunlight:0.35}, nutrition:0.10 },
  wildlegume:  { id:'wildlegume',  label:'Wild legume',  category:'legume',   growthTime:60, yield:1, color:'#7ba858', ripeColor:'#a4b878', soil:{fertility:0.20,moisture:0.25,sunlight:0.30}, nutrition:0.12 },
  wildroot:    { id:'wildroot',    label:'Wild root',    category:'root',     growthTime:65, yield:1, color:'#5e8a4a', ripeColor:'#a08458', soil:{fertility:0.20,moisture:0.30,sunlight:0.25}, nutrition:0.12 },
  wildberry:   { id:'wildberry',   label:'Wild berry',   category:'fruit',    growthTime:55, yield:1, color:'#6b9450', ripeColor:'#c43048', soil:{fertility:0.20,moisture:0.30,sunlight:0.30}, nutrition:0.12 },
};

// Wild ancestor crops — discovered through foraging, never in the
// starter pool. Used by cropSystem.freshSeeds, groups.js seed pick,
// main.js picker filters, and world.js scatter (one wild plant tile
// represents one of these ancestors).
export const WILD_CROP_IDS = ['wildgreens', 'wildgrain', 'wildlegume', 'wildroot', 'wildberry'];

// Crops you cannot eat raw — must be cooked first (alpha 24).
//
// α30 followup: the list was over-inclusive — several items on it are
// routinely eaten raw in the real world and were unfairly forcing the
// cooking pipeline. Trimmed five entries:
//   - oats   : raw rolled / steel-cut oats are the basis of overnight
//              oats, granola, muesli — fully edible raw, just slightly
//              lower mineral bioavailability from the phytic acid load
//   - maize  : sweet-corn varieties are eaten raw routinely (salads,
//              kids' snacks). Only dent / field corn would need cooking.
//   - pea    : snap peas, snow peas, young garden peas are standard raw
//              salad fare. Dried peas would still need cooking.
//   - almond : "raw almonds" is the supermarket default. Sweet-almond
//              cultivars only — bitter almonds (a separate species)
//              would not qualify, but bitter almonds aren't a CROP_TYPE
//              entry, so this trim is safe.
//   - walnut : nearly all retail walnuts are uncooked. "Raw" is the
//              standard state.
// What remains inedible-raw: wheat / rice / barley (hard grains that
// genuinely need cooking), bean / soybean / lentil / chickpea (dried
// legumes — raw kidney beans in particular carry phytohemagglutinin),
// chestnut (genuinely needs roasting / boiling for the starch).
//
// Wild ancestors (wildgreens / wildgrain / ... — see WILD_CROP_IDS)
// stay edible raw via the default unless explicitly added here. A
// hypothetical future `wildalmond` would belong on this list — its
// cultivar trims are sweet-almond specific.
const _INEDIBLE_RAW = new Set([
  'wheat', 'rice', 'barley',
  'bean', 'soybean', 'lentil', 'chickpea',
  'chestnut',
  // α31: hop pellets are bitter — used only for brewing.
  'hop',
  // Reserved: bitter / wild forms of the trimmed cultivars stay raw-
  // hostile. None of these ids exist yet but they're listed in advance
  // so the trim above is the single source of truth for the cultivars.
  'wildalmond',
]);
for (const id of Object.keys(CROP_TYPES)) {
  CROP_TYPES[id].edibleRaw = !_INEDIBLE_RAW.has(id);
}

// Crops that drop a seed when eaten raw (alpha 27). Modelled on real-
// world plants whose edible part contains the seeds — fruit-veg, fruit
// and legumes qualify. Cooked items and root/leaf/grain/nut crops do
// not (grains/nuts you'd already have separated the seed by cooking
// or shelling). foodSystem.feed() rolls SEEDS_AFTER_EATING_CHANCE
// against this flag.
const _SEEDS_AFTER_EATING = new Set([
  // Fruit-veg
  'tomato', 'eggplant', 'cucumber', 'pepper',
  // Fruit (incl. wild ancestor)
  'strawberry', 'melon', 'wildberry',
  // Legumes (incl. wild ancestor)
  'bean', 'pea', 'soybean', 'lentil', 'chickpea', 'wildlegume',
]);
for (const id of Object.keys(CROP_TYPES)) {
  CROP_TYPES[id].seedsAfterEating = _SEEDS_AFTER_EATING.has(id);
}

// Display / iteration order.
export const CROP_IDS = Object.keys(CROP_TYPES);

export function getCrop(id) {
  return CROP_TYPES[id];
}

// Small deterministic hash so two crops with near-identical stats still
// get a slightly different quality fingerprint.
function _cropHash(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * α29 (D6): per-crop starting-quality centres for the four quality genes,
 * derived from the crop's real characteristics:
 *   - yield  ← the crop's yield stat (a high-yield crop carries the trait)
 *   - hardiness ← low soil demand = hardier
 *   - vigor  ← faster growth = more vigorous
 *   - cold   ← sun-hungry crops are less cold-tolerant
 * A tiny per-crop hash jitter keeps even similar crops distinct.
 */
export function cropQualityBias(cropId) {
  const c = CROP_TYPES[cropId];
  if (!c) return { hardiness: 0.45, yield: 0.45, vigor: 0.45, cold: 0.45 };
  const soil = c.soil || {};
  const req = ((soil.fertility || 0) + (soil.moisture || 0) + (soil.sunlight || 0)) / 3;
  const yieldC = clamp01(0.30 + (c.yield - 1) * 0.05);   // yield 1..9 → ~0.30..0.70
  const hardC = clamp01(0.62 - req * 0.7);                // light soil need → hardy
  const vigorC = clamp01(0.66 - (c.growthTime - 14) / 110); // quick crops → vigorous
  const coldC = clamp01(0.60 - (soil.sunlight || 0.3) * 0.6); // sun-lovers dislike cold
  const h = _cropHash(cropId);
  const jig = (shift) => (((h >>> shift) & 7) / 7) * 0.08 - 0.04; // ±0.04
  return {
    hardiness: clamp01(hardC + jig(0)),
    yield: clamp01(yieldC + jig(3)),
    vigor: clamp01(vigorC + jig(6)),
    cold: clamp01(coldC + jig(9)),
  };
}

/**
 * α29 (D5/D6): the genome a fresh seed of `cropId` should carry. Wild
 * ancestors get the feeble wild genome; cultivated crops get a genome
 * biased toward their per-crop quality fingerprint.
 */
export function seedGenome(cropId, rand = Math.random) {
  if (WILD_CROP_IDS.includes(cropId)) return wildGenome(rand);
  return biasedGenome(cropQualityBias(cropId), 0.16, rand);
}

/** Every crop id whose category matches `cat`. */
export function cropsOfCategory(cat) {
  return CROP_IDS.filter((id) => CROP_TYPES[id].category === cat);
}

/** A plant is ripe when it is a (non-withered) crop whose growth reached 1. */
export function isRipe(plant) {
  return !!plant && plant.kind === 'crop' && !plant.withered && plant.growth >= 1;
}

/**
 * How well a tile's soil suits a crop, 0..1 — a weighted blend of the
 * tile's fertility, moisture and sunlight.
 */
export function cropSuitability(crop, tile) {
  const w = crop.soil;
  return clamp01(
    w.fertility * tile.fertility + w.moisture * tile.moisture + w.sunlight * tile.sunlight,
  );
}

/**
 * Chance (0..1) that a freshly sown crop survives to ripeness.
 * Initial crop strains are weak — even ideal soil only carries about half
 * to harvest. Tilled soil and higher-quality seed add to `bonus`.
 * @param {number} suitability  0..1 soil match
 * @param {number} [bonus]      extra survival (tilled soil, seed quality)
 */
export function survivalChance(suitability, bonus = 0) {
  return clamp01(0.15 + suitability * 0.42 + bonus);
}
