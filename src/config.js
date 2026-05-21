// Global tuning constants for the alpha-1 prototype.

// Map dimensions in tiles. The alpha-1 milestone targets 20–30 per side.
export const GRID_COLS = 30;
export const GRID_ROWS = 30;

// Pixel size of a single tile when drawn on the canvas.
export const TILE_SIZE = 20;

// Elevation at or below this threshold becomes water.
export const WATER_LEVEL = 0.4;

// Guarantee at least this fraction of the map is water ("水辺あり").
// If WATER_LEVEL alone would yield less, the threshold is raised.
export const MIN_WATER_FRACTION = 0.08;

// How far (in tiles) a water tile raises the moisture of nearby land.
export const MOISTURE_RANGE = 6;
