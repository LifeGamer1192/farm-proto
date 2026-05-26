// Global tuning constants.

// Full map size in tiles. Alpha 2+ uses a 100×100 grid.
export const GRID_COLS = 100;
export const GRID_ROWS = 100;

// Fixed canvas pixel size. Map zoom changes the tile size (and thus how
// many tiles are visible), not the canvas itself.
export const CANVAS_W = 600;
export const CANVAS_H = 600;

// Map zoom levels — the on-screen size of one tile, in pixels.
// Smaller tiles show more of the map; larger tiles show less. Default: medium.
export const ZOOM_LEVELS = [
  { label: 'Small', tile: 15 },
  { label: 'Medium', tile: 20 },
  { label: 'Large', tile: 30 },
];
export const DEFAULT_ZOOM = 1;

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
// Lowered in alpha 20 (was 0.05) — the colony has to actually hunt and
// farm now rather than living off the easy early-game forage carpet.
export const WILD_PLANT_CHANCE = 0.012;
// Fraction of land tiles that start with a tree (chopped for wood, alpha 18).
export const TREE_CHANCE = 0.08;
// Chance a forage harvest also drops a wild-greens seed (alpha 20).
export const WILDGREENS_SEED_CHANCE = 0.2;

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
export const SLEEP_DRAIN_RATE = 1 / (60 * 6); // ~6 sim-minutes from full to empty
export const SLEEP_RECOVER_RATE = 1 / 4;     // ~4 sim-seconds of SLEEP refills it
// Below this the colonist is considered sleep-deprived (icon + mood hit).
export const SLEEP_DEFICIT_THRESHOLD = 0.3;
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

export const ANIMAL_COUNT = 8;
// Mix of wild-animal species spawned at map start (alpha 20). Totals
// should match ANIMAL_COUNT — first matches use up the budget in order.
export const ANIMAL_SPAWN_MIX = [
  { species: 'boar',   n: 2 },
  { species: 'wolf',   n: 1 },
  { species: 'deer',   n: 3 },
  { species: 'rabbit', n: 2 },
];
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

export const WILD_WOOD_YIELD = 2; // firewood gained from harvesting a wild plant
export const WOOD_BURN_RATE = 1 / 24; // firewood a lit hearth burns per sim-second
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

export const SEED_START_COUNT = 12; // seeds per crop the colony begins with
export const SEEDS_PER_HARVEST = 2; // seeds bred from one ripe crop

// --- stockpiles & hauling (alpha 11) -------------------------------------

export const STOCKPILE_CAP = 25; // food units one stockpile tile can hold
export const ON_HAND_CAP = 30; // above this, colonists haul on-hand food to a stockpile
export const ON_HAND_LOW = 12; // below this, colonists fetch food back from a stockpile
export const HAUL_BATCH = 8; // food units moved per store / fetch task
export const HAUL_DURATION = 1.2; // work phase (sim-seconds) to store or fetch

// --- autonomous mode (alpha 16) ------------------------------------------

export const AUTO_SEARCH_RANGE = 12; // tile radius an idle colonist scans for auto work
export const FENCE_TRIGGER_RANGE = 10; // build a fence when a wild animal is this close to any colonist
export const FENCE_AUTO_CAP = 20; // never auto-place more fence tiles than this colony-wide
export const FENCE_PLAN_LENGTH = 5; // tiles in one auto-planned wall row
export const FENCE_REPLAN_COOLDOWN = 25; // seconds before the colony can plan another wall

// --- wood / trees (alpha 18) ---------------------------------------------

// Wood costs every structure type pays once at build time.
export const BUILD_COSTS = { fence: 1, hut: 5, hearth: 3, stockpile: 4 };
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
// Hard cap on the colony's population (the prototype was built around
// four colonists; the renderer and overlap math keep working past that,
// but this keeps the experience tractable).
export const POPULATION_CAP = 100;

// Winter trader: always arrives once per winter, drops a small gift of
// wood and a few seed packets to help the colony through.
export const TRADER_WOOD_GIFT = 15;
export const TRADER_SEED_PACKETS = 2; // how many distinct crops he brings
export const TRADER_SEED_COUNT = 5; // seeds per crop
