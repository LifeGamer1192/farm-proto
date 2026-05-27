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

// Crops you cannot eat raw — must be cooked first (alpha 24). The list
// covers categories that need cooking in real life: grains, legumes
// and the cultivated nuts. Wild ancestors stay edible raw (foraged
// early-game fallback), even when their cultivated descendants do not.
// Everything else defaults to edible.
const _INEDIBLE_RAW = new Set([
  'wheat', 'rice', 'maize', 'oats', 'barley',
  'bean', 'soybean', 'pea', 'lentil', 'chickpea',
  'almond', 'walnut', 'chestnut',
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
