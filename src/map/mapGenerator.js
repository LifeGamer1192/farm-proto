// Random map generation for alpha 1.
//
// A single biome. Terrain is built from seeded value-noise:
//   - elevation : low areas become water (water is always present)
//   - moisture  : higher near water (multi-source BFS distance)
//   - fertility : noise, nudged upward by moisture
//   - sunlight  : gentle noise, mostly bright

import { mulberry32 } from '../core/rng.js';
import { TileType, createTile } from './tile.js';
import { WATER_LEVEL, MIN_WATER_FRACTION, MOISTURE_RANGE } from '../config.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (t) => t * t * (3 - 2 * t);

// A square lattice of random values in [0, 1], (size + 1) points per side.
function buildLattice(rand, size) {
  const grid = new Array(size + 1);
  for (let y = 0; y <= size; y++) {
    const row = new Float64Array(size + 1);
    for (let x = 0; x <= size; x++) row[x] = rand();
    grid[y] = row;
  }
  return grid;
}

// Bilinear, smoothstep-eased sample of a lattice at fx,fy in [0, 1].
function sampleLattice(grid, size, fx, fy) {
  const gx = fx * size;
  const gy = fy * size;
  const x0 = Math.min(Math.floor(gx), size - 1);
  const y0 = Math.min(Math.floor(gy), size - 1);
  const tx = smoothstep(gx - x0);
  const ty = smoothstep(gy - y0);
  const v00 = grid[y0][x0];
  const v10 = grid[y0][x0 + 1];
  const v01 = grid[y0 + 1][x0];
  const v11 = grid[y0 + 1][x0 + 1];
  const a = v00 + (v10 - v00) * tx;
  const b = v01 + (v11 - v01) * tx;
  return a + (b - a) * ty;
}

// Fractal (multi-octave) value noise, normalized to [0, 1].
function makeFractalNoise(rand, octaves, baseSize) {
  const layers = [];
  let size = baseSize;
  for (let o = 0; o < octaves; o++) {
    layers.push({ grid: buildLattice(rand, size), size });
    size *= 2;
  }
  return function noise(fx, fy) {
    let total = 0;
    let amp = 1;
    let ampSum = 0;
    for (const layer of layers) {
      total += sampleLattice(layer.grid, layer.size, fx, fy) * amp;
      ampSum += amp;
      amp *= 0.5;
    }
    return total / ampSum;
  };
}

// Value at the p-th fraction of the sorted list (p in [0, 1]).
function percentile(values, p) {
  const sorted = Float64Array.from(values).sort();
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

// Multi-source BFS: distance (in tiles) from every tile to the nearest
// water tile. Returns -1 for tiles with no water reachable (no water map).
function distanceToWater(tiles, cols, rows) {
  const dist = new Array(rows);
  const queue = [];
  for (let y = 0; y < rows; y++) {
    dist[y] = new Int32Array(cols).fill(-1);
    for (let x = 0; x < cols; x++) {
      if (tiles[y][x].type === TileType.WATER) {
        dist[y][x] = 0;
        queue.push(x, y);
      }
    }
  }
  const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];
    const d = dist[cy][cx];
    for (let i = 0; i < 8; i += 2) {
      const nx = cx + dirs[i];
      const ny = cy + dirs[i + 1];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (dist[ny][nx] === -1) {
        dist[ny][nx] = d + 1;
        queue.push(nx, ny);
      }
    }
  }
  return dist;
}

/**
 * Generate a map.
 * @param {number} cols
 * @param {number} rows
 * @param {number} seed  uint32 seed
 * @returns {{cols:number, rows:number, seed:number, waterThreshold:number, tiles:object[][]}}
 */
export function generateMap(cols, rows, seed) {
  const rand = mulberry32(seed >>> 0);
  // Distinct noise fields drawn from one stream — still fully deterministic.
  const elevationNoise = makeFractalNoise(rand, 4, 3);
  const fertilityNoise = makeFractalNoise(rand, 3, 4);
  const sunlightNoise = makeFractalNoise(rand, 2, 2);

  // First pass: elevation.
  const tiles = new Array(rows);
  const elevations = new Float64Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    tiles[y] = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const fx = cols > 1 ? x / (cols - 1) : 0;
      const fy = rows > 1 ? y / (rows - 1) : 0;
      const elevation = elevationNoise(fx, fy);
      elevations[y * cols + x] = elevation;
      tiles[y][x] = createTile({
        x,
        y,
        type: TileType.LAND,
        elevation,
        fertility: 0,
        moisture: 0,
        sunlight: 0,
      });
    }
  }

  // Choose a water threshold that guarantees at least MIN_WATER_FRACTION
  // of the map is water, so a shoreline is always present.
  const waterThreshold = Math.max(
    WATER_LEVEL,
    percentile(elevations, MIN_WATER_FRACTION),
  );
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (tiles[y][x].elevation <= waterThreshold) {
        tiles[y][x].type = TileType.WATER;
      }
    }
  }

  // Second pass: moisture, fertility, sunlight.
  const dist = distanceToWater(tiles, cols, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const tile = tiles[y][x];
      const fx = cols > 1 ? x / (cols - 1) : 0;
      const fy = rows > 1 ? y / (rows - 1) : 0;

      tile.sunlight = clamp01(0.45 + sunlightNoise(fx, fy) * 0.55);

      if (tile.type === TileType.WATER) {
        tile.moisture = 1;
        tile.fertility = 0;
        continue;
      }

      const d = dist[y][x];
      const nearWater = d < 0 ? 0 : Math.max(0, 1 - d / MOISTURE_RANGE);
      tile.moisture = clamp01(0.15 + nearWater * 0.85);

      const soil = fertilityNoise(fx, fy);
      tile.fertility = clamp01(soil * 0.7 + tile.moisture * 0.3);
    }
  }

  return { cols, rows, seed: seed >>> 0, waterThreshold, tiles };
}

/**
 * Aggregate statistics for the UI and tests.
 * @param {{cols:number, rows:number, tiles:object[][]}} map
 */
export function mapStats(map) {
  let water = 0;
  let land = 0;
  let fertilitySum = 0;
  let moistureSum = 0;
  let sunlightSum = 0;
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const t = map.tiles[y][x];
      sunlightSum += t.sunlight;
      if (t.type === TileType.WATER) {
        water++;
      } else {
        land++;
        fertilitySum += t.fertility;
        moistureSum += t.moisture;
      }
    }
  }
  const total = map.cols * map.rows;
  return {
    total,
    water,
    land,
    waterFraction: water / total,
    avgFertility: land ? fertilitySum / land : 0,
    avgMoisture: land ? moistureSum / land : 0,
    avgSunlight: sunlightSum / total,
  };
}
