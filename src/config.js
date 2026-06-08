// Global tuning constants.

// Current alpha version label. KEEP IN SYNC with the most recent
// "alpha N..." commit on main. The summary-log exporter and any other
// UI surface that prints the version should read this constant rather
// than hard-coding the string — bumping one place propagates everywhere.
// α32 begins the post-prototype "α-version era". Versions alpha 4 through
// alpha 31 (the prototype era) are preserved under /versions/ and remain
// playable via the link in the header.
export const ALPHA_VERSION = 'alpha 36';

// α33: seafood (fish / clams) on water tiles. Fraction of water tiles
// that start with a fishable catch on them; regrows over time so the
// shoreline isn't fished out permanently after a few seasons.
export const SEAFOOD_SPAWN_CHANCE = 0.06;
// Sim-seconds for a fished tile to repopulate. Slower than tree regrowth
// because seafood is supposed to be a richer-but-scarcer food source.
export const SEAFOOD_REGROW_TIME = 400;
// α34: per-species baseYield + seasonal multipliers live in seafood.js
// (SEAFOOD_TYPES). Yield is computed by seafoodYield(id, season).

// Full map size in tiles. Alpha 2+ uses a 100×100 grid.
export const GRID_COLS = 100;
export const GRID_ROWS = 100;

// Fixed canvas pixel size. Map zoom changes the tile size (and thus how
// many tiles are visible), not the canvas itself.
export const CANVAS_W = 600;
export const CANVAS_H = 600;

// Map zoom levels — the on-screen size of one tile, in pixels.
// Smaller tiles show more of the map; larger tiles show less. Default: medium.
// α28 followup Z4: two extra tiers below the original Small (15 px)
// so the player can fit a much larger area on the screen — XXS at 7 px
// per tile shows the full 100×100 map in one frame. Default stays on
// Medium (now index 3 after the two prepended levels).
// α36: Large doubled from 30 → 60 to give players a near-zoom for
// inspecting individual tiles + colonist detail. Other levels unchanged.
export const ZOOM_LEVELS = [
  { label: 'XXS', tile: 7 },
  { label: 'XS', tile: 11 },
  { label: 'Small', tile: 15 },
  { label: 'Medium', tile: 20 },
  { label: 'Large', tile: 60 },
];
export const DEFAULT_ZOOM = 3;

// Game-speed multipliers applied to the simulation (not to camera panning).
// Default is the second-slowest — normal, 1×.
export const SPEED_LEVELS = [0.5, 1, 2, 4, 8];
export const DEFAULT_SPEED = 1;

// Terrain generation.
export const WATER_LEVEL = 0.4;
export const MIN_WATER_FRACTION = 0.08;
export const MOISTURE_RANGE = 6;

// Camera panning speed in tiles per second while a key / arrow is held.
export const CAMERA_SPEED = 22;

// Tiles the camera jumps on a single click/tap of an on-screen scroll arrow.
export const SCROLL_STEP = 4;

// Colonist walking speed in tiles per second.
export const COLONIST_SPEED = 4.5;

// Seconds the colonist stays idle before it wanders off on its own.
export const COLONIST_IDLE_WANDER = 1.6;

// Pointer travel (in CSS pixels) beyond which a press counts as a drag
// (pan the map) rather than a tap (queue a task).
export const DRAG_THRESHOLD = 6;

// --- tasks ---------------------------------------------------------------

// Seconds the colonist spends working a harvest or sow task on its tile.
export const WORK_DURATION = 0.7;

// Fraction of land tiles that start with a wild (harvestable) plant.
// α28 followup Z3: bumped 0.012 → 0.05 so a scout / forager colony has
// real wild food to draw on instead of starving as soon as the local
// boar herd wanders off.
export const WILD_PLANT_CHANCE = 0.05;
// Fraction of land tiles that start with a tree (chopped for wood, alpha 18).
export const TREE_CHANCE = 0.08;
// Chance a forage harvest also drops a wild-greens seed (alpha 20).
// α27: every wild ancestor uses the same drop rate, with the species
// taken from the foraged tile's `wildId`.
export const WILDGREENS_SEED_CHANCE = 0.2;
// Chance a raw crop drops a fresh seed when eaten (α27). Only crops
// flagged `seedsAfterEating` in crops.js (fruit-veg / fruit / legume)
// roll against this — others always return 0 seeds.
export const SEEDS_AFTER_EATING_CHANCE = 0.25;

// --- skills, sleep & celebrations (alpha 21) -----------------------------

// Each skill stores experience 0..1 (1 = mastered). The speed/damage
// multiplier scales linearly from 1× at xp=0 up to MAX_SKILL_MULT× at xp=1.
export const MAX_SKILL_MULT = 3;
// Sim-seconds of "doing the right work" needed to fully master a skill.
// Tuned so a focused colonist reaches roughly half-mastery in one year.
export const SKILL_TIME_TO_MASTER = 1200;
// Random skill spread at character creation — keeps the four starting
// colonists feeling distinct without making any of them helpless.
export const SKILL_START_RANGE = [0.0, 0.35];

// Sleep stat (1 = well-rested, 0 = exhausted). Drains over time during
// activity; sleeping fully restores it.
// T3 (α27 followup): drain rate doubled so colonists need to actually
// come back to a hut on a daily cycle, not weekly. Penalty multipliers
// in colonist.update() are tightened separately to make sleep deficit
// a meaningful drag rather than a soft nudge.
export const SLEEP_DRAIN_RATE = 1 / (60 * 3); // ~3 sim-minutes from full to empty (was 6)
export const SLEEP_RECOVER_RATE = 1 / 4;      // ~4 sim-seconds of SLEEP refills it
// Below this the colonist is considered sleep-deprived (icon + mood hit).
export const SLEEP_DEFICIT_THRESHOLD = 0.3;
// T3: how much the work-rate and mood penalties are scaled by sleep
// deficit. 1.0 means linear, larger = harsher. Was effectively 0.6/0.8
// inline; lifted to 1.2 for work, 1.6 for mood so a sleep-deprived
// colonist is noticeably slower and unhappier.
export const SLEEP_WORK_PENALTY = 1.2;
export const SLEEP_MOOD_PENALTY = 1.6;
// Below this the colonist is considered injured (icon + prefer REST).
export const INJURY_THRESHOLD = 0.5;

// Years to survive before the celebration overlay fires. Alpha 21 lifts
// the goal from "one year" to "three years".
export const VICTORY_YEAR = 4; // environment.year value, year-1 was the previous goal
// Seconds the celebration overlay shows before auto-closing back to play.
export const VICTORY_AUTOCLOSE = 10;

// How many recent events the activity log keeps (the panel scrolls back).
export const TASK_LOG_SIZE = 1000;

// --- colonists -----------------------------------------------------------

export const COLONIST_COUNT = 4;
export const COLONIST_NAMES = ['Ada', 'Bo', 'Cy', 'Dot'];

// Work-phase durations (sim-seconds) for personal tasks.
export const EAT_DURATION = 1.2;
export const REST_DURATION = 3;
export const SLEEP_DURATION = 7;

// --- till & water --------------------------------------------------------

// Bonus added to a crop's survival chance when sown on tilled soil.
export const TILL_SURVIVAL_BONUS = 0.15;

// Sim-seconds a watered crop keeps its boost, and the growth multiplier.
export const WATER_DURATION = 45;
export const WATER_GROWTH_BONUS = 1.5;

// --- survival stats (alpha 7) --------------------------------------------

export const HUNGER_RATE = 1 / 70; // hunger climbs 0 → 1 over 70 sim-seconds
export const EAT_THRESHOLD = 0.55; // hunger at which a colonist seeks food
export const EAT_RETRY = 5; // sim-seconds before a fed-up colonist retries eating
export const STARVE_RATE = 1 / 40; // health lost per second while starving
export const HEALTH_REGEN = 1 / 80; // health regained per second when well-fed
export const HEALTH_REGEN_HUNGER = 0.4; // hunger must be below this to recover
export const MOOD_ADAPT = 0.15; // how fast mood drifts toward its target

// --- wild animals (alpha 7) ----------------------------------------------

// α27 raised this from 8 to 11 when bear / sheep / fowl joined the
// roster, so every species still has a comfortable presence on the map.
// α28 followup Z3: roughly doubled to 22 — a scout colony was starving
// the moment the nearby boar wandered off; a thicker animal population
// gives them a fair shot at survival without obscuring the map.
export const ANIMAL_COUNT = 22;
// Mix of wild-animal species spawned at map start (alpha 20 / 27 / 28).
// Totals should match ANIMAL_COUNT — first matches use up the budget
// in order; spawnAnimals falls back to 'boar' for any shortfall.
export const ANIMAL_SPAWN_MIX = [
  { species: 'boar',   n: 2 },
  { species: 'wolf',   n: 2 },
  { species: 'bear',   n: 2 },
  { species: 'deer',   n: 4 },
  { species: 'rabbit', n: 4 },
  { species: 'sheep',  n: 4 },
  { species: 'fowl',   n: 4 },
];
// α28 followup Z3: wild-animal restock once a year (at season change).
// When the population drops below `ANIMAL_RESTOCK_THRESHOLD * ANIMAL_COUNT`
// the event system seeds `ANIMAL_RESTOCK_AMOUNT` fresh animals using the
// same spawn mix. Keeps long-running scout colonies from running the map
// dry through hunting.
export const ANIMAL_RESTOCK_THRESHOLD = 0.7;
export const ANIMAL_RESTOCK_AMOUNT = 6;
export const ANIMAL_SPEED = 1.6; // tiles per second (slow)
export const ANIMAL_DAMAGE = 0.07; // colonist health lost per attack
export const ANIMAL_ATTACK_INTERVAL = 9; // sim-seconds between an animal's attacks
export const ANIMAL_ATTACK_RANGE = 1.6; // tiles
export const HUNT_DURATION = 1.5; // work phase to bring an animal down
export const HUNT_RANGE = 2.5; // the animal must be this close when the hunt lands
export const MEAT_YIELD = 5; // food gained from a hunted animal

// --- building & storage (alpha 8) ----------------------------------------

export const BUILD_DURATION = 1.6; // work phase (sim-seconds) to raise a structure
export const HUT_RANGE = 4; // tiles within which a hut comforts a resting colonist
export const HUT_MOOD_BONUS = 0.06; // mood per sim-second gained resting near a hut

// --- pests (alpha 8) -----------------------------------------------------

export const PEST_INTERVAL = 40; // sim-seconds between pest infestations
export const PEST_BITE = 0.15; // fraction of on-hand food a pest strike spoils

// --- cooking, fuel & cold (alpha 9) --------------------------------------

export const WILD_WOOD_YIELD = 2; // wood gained from harvesting a wild plant
export const WOOD_BURN_RATE = 1 / 24; // wood a lit hearth burns per sim-second
export const HEARTH_RANGE = 5; // tiles a lit hearth keeps warm
export const COLD_THRESHOLD = 4; // °C at or below which the unsheltered suffer
export const COLD_DAMAGE = 1 / 130; // health lost per sim-second while cold
export const COLD_MOOD_DROP = 1 / 50; // mood lost per sim-second while cold
export const COOK_DURATION = 2; // work phase (sim-seconds) to cook a batch
export const COOK_BATCH = 4; // raw food units turned into meals per cook task
export const MEAL_MOOD_BONUS = 0.12; // mood lift from eating a cooked meal

// --- autonomy & the year goal (alpha 10) ---------------------------------

export const AUTO_HUNT_RANGE = 9; // tiles — an idle colonist auto-hunts boar this close
export const HUNT_FOOD_PER_HEAD = 3; // auto-hunt starts below this much food per colonist
export const MEAL_TARGET = 6; // colonists auto-cook until this many meals are stocked

// --- seeds, crop quality & genetics (alpha 11–12) ------------------------

export const SEED_START_COUNT = 24; // seeds per crop the colony begins with (α30: doubled)
export const SEEDS_PER_HARVEST = 2; // seeds bred from one ripe crop
// C9: when a colony holds fewer than this many distinct seed varieties,
// idle colonists go forage wild plants for new seed stock even if the
// pantry is full — variety matters more than another bushel of food.
export const SEED_VARIETY_TARGET = 4;

// --- stockpiles & hauling (alpha 11) -------------------------------------

export const STOCKPILE_CAP = 25; // food units one stockpile tile can hold
export const ON_HAND_CAP = 4; // above this, colonists haul on-hand food to a stockpile
export const ON_HAND_LOW = 2; // below this, colonists fetch food back from a stockpile (must stay under ON_HAND_CAP)
export const HAUL_BATCH = 8; // food units moved per store / fetch task
export const HAUL_DURATION = 1.2; // work phase (sim-seconds) to store or fetch

// --- autonomous mode (alpha 16) ------------------------------------------

export const AUTO_SEARCH_RANGE = 12; // tile radius an idle colonist scans for auto work
export const FENCE_TRIGGER_RANGE = 10; // build a fence when a wild animal is this close to any colonist
export const FENCE_AUTO_CAP = 20; // never auto-place more fence tiles than this colony-wide
// α29 followup: builder script earns a higher cap so its signature
// "infra-heavy" character extends to perimeter defence too.
export const FENCE_AUTO_CAP_BUILDER = 32;
export const FENCE_PLAN_LENGTH = 10; // tiles in one auto-planned wall row
export const FENCE_REPLAN_COOLDOWN = 25; // seconds before the colony can plan another wall

// --- wood / trees (alpha 18) ---------------------------------------------

// Wood costs every structure type pays once at build time. α26 adds
// upgraded tiers: a medium warehouse costs 3× the base for 4× storage,
// a large warehouse 6× for 12×. Huts gain a medium (4-bed, 3× cost) and
// large (8-bed, 5× cost) variant.
export const BUILD_COSTS = {
  fence: 1,
  hut: 5,
  hut_med: 15,
  hut_large: 25,
  hearth: 3,
  stockpile: 4,
  stockpile_med: 12,
  stockpile_large: 24,
  // α31: processing workshop — host structure for all non-hearth food
  // processing recipes (mill / brewery / pickle / drying / oil press /
  // juice press / mochi / malt house / jam workshop). One building
  // type, many recipe "stations" — each recipe carries a `station`
  // tag that determines which display name is used at output time.
  workshop: 4,
};
// Per-stockpile food capacity by structure type. Anything not listed
// here falls back to the base STOCKPILE_CAP (kept for legacy callers
// that still pass the constant directly).
export const STOCKPILE_CAP_BY_TYPE = {
  stockpile: 25,
  stockpile_med: 100,
  stockpile_large: 300,
};
// Resident slots a hut covers. Auto-build keeps adding huts until the
// colony has enough slots for every colonist.
export const HUT_CAPACITY_BY_TYPE = {
  hut: 1,
  hut_med: 4,
  hut_large: 8,
};
// Wood the colony starts with — enough for a hut per colonist, a hearth,
// a stockpile and a short fence right out of the gate.
export const STARTING_WOOD = 30;
// Wood from chopping a fully-grown tree.
export const TREE_WOOD_YIELD = 4;
// Seconds for a fresh stump to regrow into a young tree.
export const STUMP_REGROW_TIME = 60;
// Seconds for a young tree to grow back to full size.
export const TREE_GROW_TIME = 90;
// Auto-chop kicks in when the colony's wood reserve falls below this.
export const WOOD_LOW = 6;

// --- population & seasonal events (alpha 19) -----------------------------

// Names a newborn rotates through, after the four hand-picked starters.
export const BIRTH_NAMES = [
  'Eli', 'Fae', 'Gus', 'Hen', 'Ina', 'Jon', 'Kit', 'Lex', 'Mio',
  'Nan', 'Oz', 'Pip', 'Quin', 'Ren', 'Sol', 'Tev', 'Una', 'Vex',
  'Wyn', 'Xio', 'Yui', 'Zev',
];
// Food the colony must have per head (storehouse total) for the birth
// roll to succeed. Plus there must be at least one hut per colonist.
export const BIRTH_FOOD_PER_HEAD = 8;
// Probability of a new colonist joining at a season change when the
// conditions are met.
export const BIRTH_CHANCE = 0.35;
// Population is uncapped (Infinity). The prototype was built around four
// colonists; the renderer and overlap math keep working past that.
export const POPULATION_CAP = Infinity;

// --- nutrition (alpha 30) ------------------------------------------------
//
// Each colonist tracks four nutrient buckets (carb / protein / fat / vitamin),
// each 0..1. Buckets deplete over time and refill when the colonist eats food
// carrying that nutrient. Any bucket below NUTRIENT_MISSING_THRESHOLD counts
// as "missing", and the number of missing nutrients drives a four-stage
// malnutrition state (see stage names in i18n.js, key `mal.*`):
//
//   stage 0: healthy — no penalties
//   stage 1: 軽度  — 1 missing  → −25% work rate
//   stage 2: 中度  — 2 missing  → −50% work rate
//   stage 3: 重度  — 3 missing  → −75% work rate
//   stage 4: 極度  — 4 missing  → −95% work rate (almost cannot work)
//
// Stage ≥1 additionally: speed × 0.5, mood drain, no skill XP gain, no HP
// regen, and the group's birth roll skips colonists in this state.
// α30 followup: bucket drains from full to empty in ~6 sim-min (was 4).
// The original 1/240 paired with grain-heavy starter assortments to
// drop fat to 0 by t≈600 and snowball into total extinction across
// every seed. 1/360 keeps the "manage four nutrients" pressure but
// gives the colony time to establish nut crops / hunt before stage-1
// penalties bite.
export const NUTRIENT_DRAIN_RATE = 1 / 360;
export const MEAL_NUTRIENT_CREDIT = 1.0;    // multiplier on the food's per-nutrient values when eaten
export const NUTRIENT_MISSING_THRESHOLD = 0.3;
export const MALNUTRITION_WORK_PENALTY = [0, 0.25, 0.50, 0.75, 0.95]; // stage → fraction lost
export const MALNUTRITION_SPEED_MULT = 0.5;      // B5: movement speed while malnourished
export const MALNUTRITION_MOOD_DROP = 1 / 120;   // B2: mood lost per sim-second while malnourished
export const MALNUTRITION_SKILL_XP_MULT = 0;     // B3: XP gain multiplier (0 = no growth)
export const MALNUTRITION_HP_REGEN_MULT = 0;     // B4: HP regen multiplier (0 = stopped)
// B1: a group needs at least this many healthy (stage 0) colonists before
// the birth roll fires. Below it, no new colonist joins regardless of food.
export const BIRTH_HEALTHY_REQUIRED = 2;

// Winter trader: always arrives once per winter, drops a small gift of
// wood and a few seed packets to help the colony through.
export const TRADER_WOOD_GIFT = 15;
export const TRADER_SEED_PACKETS = 2; // how many distinct crops he brings
export const TRADER_SEED_COUNT = 5; // seeds per crop
