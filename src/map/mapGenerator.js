// Random map generation for alpha 1.
//
// A single biome. Terrain is built from seeded value-noise:
//   - elevation : low areas become water (water is always present)
//   - moisture  : higher near water (multi-source BFS distance)
//   - fertility : noise, nudged upward by moisture
//   - sunlight  : gentle noise, mostly bright

import { mulberry32 } from '../core/rng.js';
import { TileType, WaterKind, createTile } from './tile.js';
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

/**
 * α33: classify each water tile as ocean / river / lake.
 *
 * 1. Flood-fill all water tiles into connected bodies.
 * 2. For each body, compute: tile count, touches map edge, bounding box.
 * 3. Apply rules:
 *    - touches edge AND size ≥ minOceanSize → ocean
 *    - aspect ratio (longer axis / shorter axis) ≥ 3 → river
 *    - otherwise → lake (default)
 * Writes `tile.waterKind` for every water tile.
 */
function classifyWaterBodies(tiles, cols, rows, minOceanSize = 60) {
  const bodyId = new Array(rows);
  for (let y = 0; y < rows; y++) bodyId[y] = new Int32Array(cols).fill(-1);
  const bodies = [];
  const dirs = [1, 0, -1, 0, 0, 1, 0, -1];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (tiles[y][x].type !== TileType.WATER) continue;
      if (bodyId[y][x] !== -1) continue;
      const id = bodies.length;
      const body = {
        id, size: 0, touchesEdge: false,
        minX: x, maxX: x, minY: y, maxY: y,
        elevSum: 0,
      };
      const queue = [x, y];
      bodyId[y][x] = id;
      let head = 0;
      while (head < queue.length) {
        const cx = queue[head++];
        const cy = queue[head++];
        body.size++;
        body.elevSum += tiles[cy][cx].elevation || 0;
        if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) body.touchesEdge = true;
        if (cx < body.minX) body.minX = cx;
        if (cx > body.maxX) body.maxX = cx;
        if (cy < body.minY) body.minY = cy;
        if (cy > body.maxY) body.maxY = cy;
        for (let i = 0; i < 8; i += 2) {
          const nx = cx + dirs[i];
          const ny = cy + dirs[i + 1];
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (tiles[ny][nx].type !== TileType.WATER) continue;
          if (bodyId[ny][nx] !== -1) continue;
          bodyId[ny][nx] = id;
          queue.push(nx, ny);
        }
      }
      body.avgElev = body.elevSum / body.size;
      bodies.push(body);
    }
  }
  // Classify each body.
  for (const b of bodies) {
    const w = b.maxX - b.minX + 1;
    const h = b.maxY - b.minY + 1;
    const longAxis = Math.max(w, h);
    const shortAxis = Math.max(1, Math.min(w, h));
    const aspect = longAxis / shortAxis;
    if (b.touchesEdge && b.size >= minOceanSize) b.kind = WaterKind.OCEAN;
    else if (aspect >= 3 || b.size <= 10) b.kind = WaterKind.RIVER;
    else b.kind = WaterKind.LAKE;
  }
  // Write the kind onto each water tile. α36 followup: ocean and lake
  // tiles in the same body get flattened to that body's average
  // elevation so the iso renderer no longer shows a single sea surface
  // bumping up and down across its own area. Rivers keep their raw
  // per-tile elevation so they can still flow downhill.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (tiles[y][x].type !== TileType.WATER) continue;
      const body = bodies[bodyId[y][x]];
      tiles[y][x].waterKind = body.kind;
      if (body.kind === WaterKind.OCEAN || body.kind === WaterKind.LAKE) {
        tiles[y][x].elevation = body.avgElev;
      }
    }
  }
  return bodies;
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
export function generateMap(cols, rows, seed, biome = null) {
  const rand = mulberry32(seed >>> 0);
  // Biome dials the terrain knobs — water plenty, soil moisture range,
  // and a global fertility bias. Falls back to the global defaults if
  // no biome is provided so existing tests keep working unchanged.
  const waterLevel = biome?.waterLevel ?? WATER_LEVEL;
  const minWaterFrac = biome?.minWaterFraction ?? MIN_WATER_FRACTION;
  const moistureRange = biome?.moistureRange ?? MOISTURE_RANGE;
  const fertilityBonus = biome?.fertilityBonus ?? 0;
  // Distinct noise fields drawn from one stream — still fully deterministic.
  const elevationNoise = makeFractalNoise(rand, 4, 3);
  const fertilityNoise = makeFractalNoise(rand, 3, 4);
  const sunlightNoise = makeFractalNoise(rand, 2, 2);
  // α36: a sparse, higher-frequency noise field used to seed rare high
  // peaks. Eight octaves at a tighter base = tight clusters where the
  // sample is high, mostly mid elsewhere. Combined with a hard threshold
  // below it produces "real" mountains spread thinly across the map
  // rather than the all-rolling-hills look from a single fractal.
  const peakNoise = makeFractalNoise(rand, 3, 5);

  // First pass: elevation.
  // α36: each tile's final elevation = curve(base) + peak boost.
  //   - default curve: 1 − (1 − base)^2.2 (concave ridge filter; high
  //     places climb higher, low places nearly unchanged).
  //   - α36 followup: `flatPlainsCurve` biomes (temperate) use a
  //     PERCENTILE-based piecewise curve: bottom 10% of the actual
  //     noise distribution → water, next 70% → plains, top 20% →
  //     hills + mountains. Percentile cutoffs guarantee the desired
  //     ratios even though Perlin output isn't uniformly distributed.
  //   - peak boost (sparse second fractal) always applies for the
  //     occasional commanding summit.
  const flatPlains = biome?.flatPlainsCurve === true;
  // For flatPlains we need to sample every tile's base noise first to
  // compute percentile cutoffs; for the default curve we can do it
  // inline. Two near-identical loops, kept separate so the default
  // path doesn't pay for the extra sample array.
  const tiles = new Array(rows);
  const elevations = new Float64Array(cols * rows);
  let p10 = 0.10, p80 = 0.80; // cutoffs (only used when flatPlains)
  let baseValues = null;
  if (flatPlains) {
    baseValues = new Float64Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const fx = cols > 1 ? x / (cols - 1) : 0;
        const fy = rows > 1 ? y / (rows - 1) : 0;
        baseValues[y * cols + x] = elevationNoise(fx, fy);
      }
    }
    p10 = percentile(baseValues, 0.10);
    p80 = percentile(baseValues, 0.80);
  }
  for (let y = 0; y < rows; y++) {
    tiles[y] = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const fx = cols > 1 ? x / (cols - 1) : 0;
      const fy = rows > 1 ? y / (rows - 1) : 0;
      const base = flatPlains ? baseValues[y * cols + x] : elevationNoise(fx, fy);
      let curved;
      if (flatPlains) {
        if (base < p10) {
          // Bottom 10% → water region (kept low so waterLevel = 0.05 catches it).
          curved = (base / p10) * 0.05;
        } else if (base < p80) {
          // Middle 70% → plains. Capped at curved 0.18 so the visual
          // lift stays under ~15 px at Medium zoom → reads as flat.
          curved = 0.05 + ((base - p10) / (p80 - p10)) * 0.13;
        } else {
          // Top 20% → hills + mountains. Concave ramp puts the top
          // sliver (the headline mountains) at elev 0.7+.
          curved = 0.20 + Math.pow((base - p80) / (1 - p80), 1.5) * 0.80;
        }
      } else {
        curved = 1 - Math.pow(1 - base, 2.2);
      }
      const peakSample = peakNoise(fx, fy);
      const peakBoost = Math.max(0, peakSample - 0.78) * 1.6;
      const elevation = Math.max(0, Math.min(1, curved + peakBoost));
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

  // Choose a water threshold that guarantees at least minWaterFrac of
  // the map is water, so a shoreline is always present. The biome's
  // overrides flow through here so arid maps stay dry and wetland maps
  // pool generously.
  const waterThreshold = Math.max(waterLevel, percentile(elevations, minWaterFrac));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (tiles[y][x].elevation <= waterThreshold) {
        tiles[y][x].type = TileType.WATER;
      }
    }
  }
  // α33: tag each water tile as ocean / river / lake (flood-fill bodies).
  classifyWaterBodies(tiles, cols, rows);

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
      const nearWater = d < 0 ? 0 : Math.max(0, 1 - d / moistureRange);
      tile.moisture = clamp01(0.15 + nearWater * 0.85);

      const soil = fertilityNoise(fx, fy);
      tile.fertility = clamp01(soil * 0.7 + tile.moisture * 0.3 + fertilityBonus);
    }
  }

  return {
    cols,
    rows,
    seed: seed >>> 0,
    waterThreshold,
    tiles,
    biome: biome ? biome.id : null,
  };
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
