// Global tuning constants.

// Full map size in tiles. Alpha 2 supports a 100×100 grid.
export const GRID_COLS = 100;
export const GRID_ROWS = 100;

// Pixels per tile.
export const TILE_SIZE = 20;

// Viewport: how many tiles are visible at once. The canvas shows this much;
// the rest of the map is reached by scrolling the camera.
export const VIEW_COLS = 30;
export const VIEW_ROWS = 30;

// Terrain generation.
export const WATER_LEVEL = 0.4;
export const MIN_WATER_FRACTION = 0.08;
export const MOISTURE_RANGE = 6;

// Camera panning speed in tiles per second (keys / on-screen arrows).
export const CAMERA_SPEED = 22;

// Colonist walking speed in tiles per second.
export const COLONIST_SPEED = 4.5;

// Seconds the colonist stays idle before it wanders off on its own.
export const COLONIST_IDLE_WANDER = 1.6;

// Pointer travel (in CSS pixels) beyond which a press counts as a drag
// (pan the map) rather than a tap (command the colonist).
export const DRAG_THRESHOLD = 6;
