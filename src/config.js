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
export const WILD_PLANT_CHANCE = 0.07;

// How many recent events the activity log keeps.
export const TASK_LOG_SIZE = 7;

// --- farming -------------------------------------------------------------

// Seconds between a colonist's meals (hunger as a stat arrives later).
export const EAT_INTERVAL = 15;

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
