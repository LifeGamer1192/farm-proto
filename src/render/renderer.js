// Canvas 2D rendering: the visible slice of the map, tilled soil, plants
// and crops, queued tasks, and the colonists with their paths.

import { TileType } from '../map/tile.js';
import { PlantKind } from '../world.js';
import { TaskType, WORK_TYPES } from '../tasks.js';
import { getCrop } from '../crops.js';
import { phenotype, partIndex } from '../genetics.js';
import {
  worldToScreen,
  screenToWorld,
  ISO_TILE_W_RATIO,
  ISO_TILE_H_RATIO,
  ISO_ELEV_RATIO,
  elevationLift,
} from './camera.js';

const lerp = (a, b, t) => a + (b - a) * t;

// Deterministic 0..1 pseudo-noise for a tile — stable across frames, so
// terrain texture does not shimmer.
function tileHash(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h >>> 0) % 1000) / 1000;
}

// Re-tint a hex colour: rotate its hue by `hueDeg` degrees and scale its
// saturation by `satMul`. Drives a crop's genetic fruit colour.
function tintColor(hex, hueDeg, satMul) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = ((h + hueDeg) % 360 + 360) % 360;
  s = Math.max(0, Math.min(1, s * satMul));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (h < 60) [rr, gg, bb] = [c, x, 0];
  else if (h < 120) [rr, gg, bb] = [x, c, 0];
  else if (h < 180) [rr, gg, bb] = [0, c, x];
  else if (h < 240) [rr, gg, bb] = [0, x, c];
  else if (h < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  const to = (v) => Math.round((v + m) * 255);
  return `rgb(${to(rr)},${to(gg)},${to(bb)})`;
}

// α29: scale an `rgb(r,g,b)` string toward lighter (mul>1) or darker
// (mul<1) — used to build crop fruit gradients for a rounder, more
// realistic look.
function shadeRGB(str, mul) {
  const m = String(str).match(/\d+/g);
  if (!m || m.length < 3) return str;
  const c = m.slice(0, 3).map((n) => Math.max(0, Math.min(255, Math.round(+n * mul))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// α36 perf: parse-once / multiply / format hot path for the per-tile
// slope shade. Caches by (color, shade-bucket) so a 100×100 map's
// per-tile fill stops reparsing the same "rgb(120,140,80)" 10,000
// times a frame.
const _shadeCache = new Map();
function fastShade(color, mul) {
  // Bucket shade to 0.02 steps so we share cache entries between tiles
  // with near-identical slopes.
  const mulBucket = Math.round(mul * 50) / 50;
  const key = color + '|' + mulBucket;
  let v = _shadeCache.get(key);
  if (v !== undefined) return v;
  // Parse "rgb(r,g,b)" once.
  const open = color.indexOf('(');
  const close = color.indexOf(')');
  if (open < 0 || close < 0) { _shadeCache.set(key, color); return color; }
  const parts = color.slice(open + 1, close).split(',');
  const r = Math.max(0, Math.min(255, (parseInt(parts[0], 10) * mulBucket) | 0));
  const g = Math.max(0, Math.min(255, (parseInt(parts[1], 10) * mulBucket) | 0));
  const b = Math.max(0, Math.min(255, (parseInt(parts[2], 10) * mulBucket) | 0));
  v = `rgb(${r},${g},${b})`;
  // Stop the cache from growing forever on long sessions / many seeds.
  if (_shadeCache.size > 4096) _shadeCache.clear();
  _shadeCache.set(key, v);
  return v;
}

function mix(c1, c2, t) {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r},${g},${b})`;
}

// α33: per water-kind tint. Ocean stays the deep blue of the original;
// lakes are a slightly greener teal; rivers lean toward grey-blue.
const WATER_TINT = {
  ocean: { shallow: [92, 152, 200], deep: [28, 66, 122] },
  lake:  { shallow: [110, 168, 178], deep: [40, 90, 110] },
  river: { shallow: [120, 156, 180], deep: [50, 80, 110] },
};
function waterColor(tile) {
  const kind = tile.waterKind || 'ocean';
  const tint = WATER_TINT[kind] || WATER_TINT.ocean;
  return mix(tint.shallow, tint.deep, 1 - tile.elevation);
}

const VIEW_MODES = {
  terrain(tile) {
    if (tile.type === TileType.WATER) {
      return waterColor(tile);
    }
    return mix([196, 184, 132], [70, 130, 55], tile.fertility);
  },
  fertility(tile) {
    if (tile.type === TileType.WATER) return 'rgb(45,52,64)';
    return mix([60, 50, 40], [120, 230, 110], tile.fertility);
  },
  moisture(tile) {
    return mix([200, 170, 120], [40, 110, 200], tile.moisture);
  },
  sunlight(tile) {
    return mix([25, 30, 45], [255, 225, 120], tile.sunlight);
  },
};

const TASK_COLORS = {
  [TaskType.MOVE]: '#b9c4d4',
  [TaskType.HARVEST]: '#e8a23c',
  [TaskType.SOW]: '#6fc46f',
  [TaskType.TILL]: '#b98a52',
  [TaskType.WATER]: '#5ba8d8',
  [TaskType.HUNT]: '#d2603a',
  [TaskType.BUILD]: '#c8a06a',
  [TaskType.COOK]: '#e0843c',
  [TaskType.WEED]: '#9aa84a',
  [TaskType.STORE]: '#86b8d0',
  [TaskType.FETCH]: '#d0a886',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ts = 20;
  }

  draw(scene) {
    const { map, camera, mode, colonists, animals, hover, taskQueue } = scene;
    const selectedColonist = scene.selectedColonist || null;
    const hearthsLit = scene.hearthsLit || false;
    this.ts = scene.tileSize;
    const ctx = this.ctx;
    const ts = this.ts;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const colorOf = VIEW_MODES[mode] || VIEW_MODES.terrain;
    const detailed = mode === 'terrain' && ts >= 14;

    ctx.clearRect(0, 0, cw, ch);

    // α35: scalar sx/sy helpers were direction-decoupled in the orthogonal
    // projection (sx only depends on wx, sy only on wy). The isometric
    // projection couples them, so we use a `proj(wx, wy)` that returns
    // both axes together. Most call sites moved from `sx(...), sy(...)`
    // pairs to one `proj(...)` call destructured into `{ x, y }`.
    const proj = (wx, wy, elev = 0) => worldToScreen(wx, wy, camera, ts, cw, ch, elev);
    // Diamond tile dimensions used for vertex offsets.
    const TW = ts * ISO_TILE_W_RATIO;
    const TH = ts * ISO_TILE_H_RATIO;
    this._proj = proj;
    this._tileW = TW;
    this._tileH = TH;

    // α35: visible-tile bounding box. The canvas-visible area is a
    // parallelogram in world coordinates; we conservatively enclose it
    // in a rectangle by unprojecting the four canvas corners. Pad by 1
    // tile to cover anything peeking in from the edge.
    const corners = [
      screenToWorld(0, 0, camera, ts, cw, ch),
      screenToWorld(cw, 0, camera, ts, cw, ch),
      screenToWorld(0, ch, camera, ts, cw, ch),
      screenToWorld(cw, ch, camera, ts, cw, ch),
    ];
    const minX = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.x))) - 1);
    const maxX = Math.min(map.cols - 1, Math.ceil(Math.max(...corners.map((c) => c.x))) + 1);
    const minY = Math.max(0, Math.floor(Math.min(...corners.map((c) => c.y))) - 1);
    const maxY = Math.min(map.rows - 1, Math.ceil(Math.max(...corners.map((c) => c.y))) + 1);
    this._visMinX = minX;
    this._visMaxX = maxX;
    this._visMinY = minY;
    this._visMaxY = maxY;

    // α36 perf: pre-compute corner projection + slope shade ONCE for the
    // visible region into typed arrays, then loop without re-doing any
    // of that work. Killed the redundant second pass for grid lines
    // (they were a barely-visible rgba(0,0,0,0.10) overlay anyway), and
    // collapsed shadeRGB (regex-based!) to direct integer math.
    //
    // The corner grid is one wider/taller than the tile grid so every
    // tile can index its four corners directly.
    const cxN = maxX - minX + 2; // corners per row
    const ryN = maxY - minY + 2; // corner rows
    const cornerX = new Float32Array(cxN * ryN);
    const cornerY = new Float32Array(cxN * ryN);
    const camCx = camera.x + camera.viewCols / 2;
    const camCy = camera.y + camera.viewRows / 2;
    const projTW2 = ts * ISO_TILE_W_RATIO * 0.5;
    const projTH2 = ts * ISO_TILE_H_RATIO * 0.5;
    const elevPx = ts * ISO_ELEV_RATIO;
    const halfW = cw * 0.5;
    const halfH = ch * 0.5;
    // Corner elevation: average of the 4 tiles meeting at (wx, wy).
    const tilesArr = map.tiles;
    const mapCols = map.cols;
    const mapRows = map.rows;
    for (let cy = 0; cy < ryN; cy++) {
      const wy = minY + cy;
      for (let cx = 0; cx < cxN; cx++) {
        const wx = minX + cx;
        let sum = 0, n = 0;
        // 4 tiles sharing corner (wx, wy): (wx-1,wy-1), (wx,wy-1), (wx-1,wy), (wx,wy)
        if (wx - 1 >= 0 && wy - 1 >= 0 && wx - 1 < mapCols && wy - 1 < mapRows) {
          sum += tilesArr[wy - 1][wx - 1].elevation || 0; n++;
        }
        if (wx >= 0 && wy - 1 >= 0 && wx < mapCols && wy - 1 < mapRows) {
          sum += tilesArr[wy - 1][wx].elevation || 0; n++;
        }
        if (wx - 1 >= 0 && wy >= 0 && wx - 1 < mapCols && wy < mapRows) {
          sum += tilesArr[wy][wx - 1].elevation || 0; n++;
        }
        if (wx >= 0 && wy >= 0 && wx < mapCols && wy < mapRows) {
          sum += tilesArr[wy][wx].elevation || 0; n++;
        }
        const elev = n > 0 ? sum / n : 0;
        // Inlined worldToScreen.
        const dx = wx - camCx;
        const dy = wy - camCy;
        const idx = cy * cxN + cx;
        cornerX[idx] = (dx - dy) * projTW2 + halfW;
        cornerY[idx] = (dx + dy) * projTH2 + halfH - elevationLift(elev) * elevPx;
      }
    }
    // α36: slope shading runs at every zoom level — bucketed fills keep
    // it cheap even at XXS (10k tiles collapse to ~50-200 unique
    // fillStyles). Without shading, small-zoom maps look flat and the
    // new mountain layer is unreadable.
    const xSpan = maxX - minX + 1;
    const tileN = xSpan * (maxY - minY + 1);
    const shadeArr = new Float32Array(tileN);
    for (let ty = minY; ty <= maxY; ty++) {
      for (let tx = minX; tx <= maxX; tx++) {
        const here = tilesArr[ty][tx].elevation || 0;
        const eW = tx - 1 >= 0      ? (tilesArr[ty][tx - 1].elevation || 0) : here;
        const eE = tx + 1 < mapCols ? (tilesArr[ty][tx + 1].elevation || 0) : here;
        const eN = ty - 1 >= 0      ? (tilesArr[ty - 1][tx].elevation || 0) : here;
        const eS = ty + 1 < mapRows ? (tilesArr[ty + 1][tx].elevation || 0) : here;
        const slope = (-(eE - eW) - (eS - eN)) * 1.5;
        // α36 followup: widened shade range (0.55..1.30) and stronger
        // multiplier (0.9) so slopes pop visually now that the vertical
        // lift is 3× — without the extra contrast the relief reads as
        // a uniform green at distance.
        const shade = Math.max(0.55, Math.min(1.30, 1.0 + slope * 0.9));
        shadeArr[(ty - minY) * xSpan + (tx - minX)] = shade;
      }
    }
    // α36 perf: tile fills batched by fillStyle into Path2D buckets.
    // The old loop did 10 000 individual ctx.fill() calls at XXS zoom;
    // most of them shared the same colour (and at small zoom they all
    // share the unshaded base colour). Bucketing collapses the work
    // into O(unique-fillStyle) fill calls, ~25-200× fewer state flushes.
    const fillBuckets = new Map(); // fillStyle → Path2D
    const tilled = []; // {topX, topY, rgtX, rgtY, botX, botY, lftX, lftY}
    for (let mapY = minY; mapY <= maxY; mapY++) {
      const cyTop = mapY - minY;
      const cyBot = cyTop + 1;
      for (let mapX = minX; mapX <= maxX; mapX++) {
        const tile = tilesArr[mapY][mapX];
        const cxL = mapX - minX;
        const cxR = cxL + 1;
        const iTop    = cyTop * cxN + cxL;
        const iRight  = cyTop * cxN + cxR;
        const iBottom = cyBot * cxN + cxR;
        const iLeft   = cyBot * cxN + cxL;
        const topX = cornerX[iTop],    topY = cornerY[iTop];
        const rgtX = cornerX[iRight],  rgtY = cornerY[iRight];
        const botX = cornerX[iBottom], botY = cornerY[iBottom];
        const lftX = cornerX[iLeft],   lftY = cornerY[iLeft];
        const baseColor = colorOf(tile);
        const shade = shadeArr[(mapY - minY) * xSpan + (mapX - minX)];
        const fillStyle = shade === 1.0 ? baseColor : fastShade(baseColor, shade);
        let path = fillBuckets.get(fillStyle);
        if (!path) { path = new Path2D(); fillBuckets.set(fillStyle, path); }
        path.moveTo(topX, topY);
        path.lineTo(rgtX, rgtY);
        path.lineTo(botX, botY);
        path.lineTo(lftX, lftY);
        path.closePath();
        if (detailed) {
          const ccx = (topX + rgtX + botX + lftX) * 0.25;
          const ccy = (topY + rgtY + botY + lftY) * 0.25;
          this._terrainDetail(tile, map, mapX, mapY, ccx - ts / 2, ccy - ts / 2);
        }
        if (detailed && tile.tilled && tile.type === TileType.LAND) {
          tilled.push(topX, topY, rgtX, rgtY, botX, botY, lftX, lftY);
        }
      }
    }
    // Flush the bucketed tile fills (1 fill() per unique colour).
    for (const [fillStyle, path] of fillBuckets) {
      ctx.fillStyle = fillStyle;
      ctx.fill(path);
    }
    // Tilled-soil furrows — drawn in one stroke pass after fills.
    if (tilled.length > 0) {
      ctx.strokeStyle = 'rgba(60,40,20,0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < tilled.length; i += 8) {
        const topX = tilled[i],     topY = tilled[i + 1];
        const rgtX = tilled[i + 2], rgtY = tilled[i + 3];
        const botX = tilled[i + 4], botY = tilled[i + 5];
        const lftX = tilled[i + 6], lftY = tilled[i + 7];
        for (let f = 1; f <= 3; f++) {
          const t = f * 0.25;
          ctx.moveTo(lftX + (topX - lftX) * t, lftY + (topY - lftY) * t);
          ctx.lineTo(botX + (rgtX - botX) * t, botY + (rgtY - botY) * t);
        }
      }
      ctx.stroke();
    }
    // α36 perf: grid-line pass dropped entirely. The diamond fills
    // already define their boundaries cleanly because adjacent tiles
    // share their corner positions exactly; the old rgba(0,0,0,0.10)
    // overlay was barely visible and cost a whole second iteration.

    // --- seasonal + biome tint (alpha 22) ---
    if (scene.seasonTint) {
      ctx.fillStyle = scene.seasonTint;
      ctx.fillRect(0, 0, cw, ch);
    }
    if (scene.biomeTint) {
      ctx.fillStyle = scene.biomeTint;
      ctx.fillRect(0, 0, cw, ch);
    }

    // α35 Phase 2: helper — read a tile's elevation safely (off-map = 0).
    const tileElev = (mx, my) => {
      if (mx < 0 || my < 0 || mx >= map.cols || my >= map.rows) return 0;
      return map.tiles[my][mx].elevation || 0;
    };
    // Sub-tile interpolated elevation for an entity at fractional (wx, wy).
    // Bilinear blend so a colonist walking up a slope rises smoothly.
    const elevAt = (wx, wy) => {
      const ix = Math.floor(wx);
      const iy = Math.floor(wy);
      const fx = wx - ix;
      const fy = wy - iy;
      const e00 = tileElev(ix,     iy);
      const e10 = tileElev(ix + 1, iy);
      const e01 = tileElev(ix,     iy + 1);
      const e11 = tileElev(ix + 1, iy + 1);
      return lerp(lerp(e00, e10, fx), lerp(e01, e11, fx), fy);
    };

    // --- structures (fences, huts, warehouses, hearths) ---
    // α36: structure draws now receive the tile's iso ground centre
    // directly. Each draw method paints a quarter-view building (visible
    // front-left + front-right walls + hipped roof) anchored to that
    // ground point. No more "fake square top-left" trick.
    for (let mapY = minY; mapY <= maxY; mapY++) {
      for (let mapX = minX; mapX <= maxX; mapX++) {
        const tile = map.tiles[mapY][mapX];
        const structure = tile.structure;
        if (structure) {
          const c = proj(mapX + 0.5, mapY + 0.5, tile.elevation || 0);
          this._drawStructure(structure, c.x, c.y, hearthsLit);
        }
      }
    }

    // --- plants & crops ---
    for (let mapY = minY; mapY <= maxY; mapY++) {
      for (let mapX = minX; mapX <= maxX; mapX++) {
        const tile = map.tiles[mapY][mapX];
        const plant = tile.plant;
        if (plant) {
          const c = proj(mapX + 0.5, mapY + 0.5, tile.elevation || 0);
          const watered = plant.kind === PlantKind.CROP && scene.clock < plant.wateredUntil;
          this._drawPlant(plant, c.x, c.y, watered);
        }
      }
    }

    // --- task markers: queued tasks, then each colonist's active work ---
    // α35: same square-anchor trick as structures — virtual ts×ts square
    // centred on the tile's iso centre so existing _drawTaskMarker code
    // (px/py top-left) keeps working.
    for (let i = 0; i < taskQueue.length; i++) {
      const task = taskQueue[i];
      const p = proj(task.x + 0.5, task.y + 0.5, tileElev(task.x, task.y));
      this._drawTaskMarker(task, p.x - ts / 2, p.y - ts / 2, false, i + 1);
    }
    for (const c of colonists) {
      const task = c.currentTask;
      if (task && WORK_TYPES.includes(task.type)) {
        const p = proj(task.x + 0.5, task.y + 0.5, tileElev(task.x, task.y));
        this._drawTaskMarker(task, p.x - ts / 2, p.y - ts / 2, true, 0);
      }
    }

    // --- colonist paths ---
    // α26: a path uses the owning colony's accent color (the same hue as
    // the colonist body) so several groups working in the same area stay
    // legible. The strolling dash stays in the muted "off-duty" tone.
    const pathColors = scene.groupColors || [];
    for (const c of colonists) {
      if (c.path.length === 0) continue;
      const strolling = c.state === 'strolling';
      let stroke;
      if (strolling) {
        stroke = 'rgba(206,214,228,0.5)';
      } else {
        const gc = pathColors[c.groupId || 0];
        stroke = gc ? `${gc.fill}e6` : 'rgba(232,162,60,0.9)';
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strolling ? 2 : 3;
      ctx.setLineDash(strolling ? [5, 5] : []);
      ctx.beginPath();
      const start = proj(c.x + 0.5, c.y + 0.5, elevAt(c.x + 0.5, c.y + 0.5));
      ctx.moveTo(start.x, start.y);
      for (const wp of c.path) {
        const p = proj(wp.x + 0.5, wp.y + 0.5, elevAt(wp.x + 0.5, wp.y + 0.5));
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- hovered tile (diamond outline, honouring corner elevations) ---
    // α36: cornerElev is now precomputed into cornerX/Y above, but the
    // hover tile is only known per-frame in main and may be outside
    // the precomputed visible region after a fast pan, so we do the
    // four corner averages inline here too — cheap, four neighbours
    // each, and only ever runs once per frame.
    if (hover) {
      const _ce = (cx2, cy2) => {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 0; dy++) {
          for (let dx = -1; dx <= 0; dx++) {
            const nx = cx2 + dx, ny = cy2 + dy;
            if (nx >= 0 && nx < map.cols && ny >= 0 && ny < map.rows) {
              sum += map.tiles[ny][nx].elevation || 0; n++;
            }
          }
        }
        return n > 0 ? sum / n : 0;
      };
      const top    = proj(hover.x,     hover.y,     _ce(hover.x,     hover.y));
      const right  = proj(hover.x + 1, hover.y,     _ce(hover.x + 1, hover.y));
      const bottom = proj(hover.x + 1, hover.y + 1, _ce(hover.x + 1, hover.y + 1));
      const left   = proj(hover.x,     hover.y + 1, _ce(hover.x,     hover.y + 1));
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(right.x, right.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.lineTo(left.x, left.y);
      ctx.closePath();
      ctx.stroke();
    }

    // --- wild animals ---
    if (animals) {
      for (const a of animals) {
        const p = proj(a.x + 0.5, a.y + 0.5, elevAt(a.x + 0.5, a.y + 0.5));
        this._drawAnimal(p.x, p.y, a.species || 'boar');
      }
    }

    // --- colonists ---
    const groupColors = scene.groupColors || [];
    for (const c of colonists) {
      const color = groupColors[c.groupId || 0] || null;
      const p = proj(c.x + 0.5, c.y + 0.5, elevAt(c.x + 0.5, c.y + 0.5));
      this._drawColonist(c, p.x, p.y, c.name === selectedColonist, color);
    }
  }

  // Texture overlaid on a terrain tile: grass speckles and sandy shores on
  // land, glinting ripples on water.
  _terrainDetail(tile, map, mx, my, px, py) {
    const ctx = this.ctx;
    const ts = this.ts;
    if (tile.type === TileType.WATER) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      const n = tileHash(mx, my);
      ctx.fillRect(px + ts * 0.16, py + ts * (0.28 + n * 0.4), ts * 0.34, 1.5);
      ctx.fillRect(px + ts * 0.52, py + ts * (0.5 + n * 0.3), ts * 0.24, 1.5);
      return;
    }
    // Grass speckles — two dark, one light, at stable positions.
    const dot = Math.max(1.6, ts * 0.1);
    for (let i = 0; i < 3; i++) {
      const sxp = px + ts * (0.14 + tileHash(mx * 3 + i, my * 5 + 1) * 0.7);
      const syp = py + ts * (0.14 + tileHash(mx + 2, my * 2 + i * 7) * 0.7);
      ctx.fillStyle = i === 2 ? 'rgba(250,250,205,0.16)' : 'rgba(38,30,14,0.16)';
      ctx.fillRect(sxp, syp, dot, dot);
    }
    // Sandy band where land meets water.
    const rows = map.tiles;
    ctx.fillStyle = 'rgba(228,212,152,0.5)';
    const w = Math.max(1.6, ts * 0.13);
    if (rows[my - 1] && rows[my - 1][mx] && rows[my - 1][mx].type === TileType.WATER) {
      ctx.fillRect(px, py, ts, w);
    }
    if (rows[my + 1] && rows[my + 1][mx] && rows[my + 1][mx].type === TileType.WATER) {
      ctx.fillRect(px, py + ts - w, ts, w);
    }
    if (rows[my][mx - 1] && rows[my][mx - 1].type === TileType.WATER) {
      ctx.fillRect(px, py, w, ts);
    }
    if (rows[my][mx + 1] && rows[my][mx + 1].type === TileType.WATER) {
      ctx.fillRect(px + ts - w, py, w, ts);
    }
  }

  // α36 perf flag: at Small zoom (ts < 20) the building outline strokes
  // disappear into the fill anyway; setting strokeStyle to a no-op
  // function would still touch state, so we just keep a getter for
  // whether outlining is worthwhile.
  get _strokeStructures() { return this.ts >= 20; }

  // α36 helper: an iso quarter-view building shell with hipped roof.
  // (cx, cy) is the iso ground centre. `w`/`d` are footprint in tile
  // units (1.0 = a full tile diamond). `wallPx`/`roofPx` are screen
  // pixels for the lift of the wall top and roof apex respectively.
  // Returns the 9 key points (4 ground corners, 4 wall-top corners,
  // and the roof apex) so callers can paint doors/windows on top.
  _isoBox(cx, cy, w, d, wallPx, roofPx, palette) {
    const ctx = this.ctx;
    const ts = this.ts;
    const hx = ts * w * 0.5;   // horizontal half-extent on screen
    const hy = ts * d * 0.25;  // vertical half-extent (iso 2:1 → /4)
    const back  = { x: cx,      y: cy - hy };
    const right = { x: cx + hx, y: cy };
    const front = { x: cx,      y: cy + hy };
    const left  = { x: cx - hx, y: cy };
    const tback  = { x: back.x,  y: back.y  - wallPx };
    const tright = { x: right.x, y: right.y - wallPx };
    const tfront = { x: front.x, y: front.y - wallPx };
    const tleft  = { x: left.x,  y: left.y  - wallPx };
    const apex   = { x: cx,      y: cy - wallPx - roofPx };

    // Ground shadow (offset down-right per upper-left light source).
    if (palette.shadow !== null) {
      ctx.fillStyle = palette.shadow || 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(cx + ts * 0.04, cy + ts * 0.04, hx * 1.0, hy * 1.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const doStroke = this._strokeStructures;
    if (doStroke) {
      ctx.strokeStyle = palette.outline;
      ctx.lineWidth = 1.1;
    }
    // SW wall (front-left, lit).
    ctx.fillStyle = palette.wallLit;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(front.x, front.y);
    ctx.lineTo(tfront.x, tfront.y);
    ctx.lineTo(tleft.x, tleft.y);
    ctx.closePath();
    ctx.fill();
    if (doStroke) ctx.stroke();
    // SE wall (front-right, shaded).
    ctx.fillStyle = palette.wallShaded;
    ctx.beginPath();
    ctx.moveTo(front.x, front.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(tright.x, tright.y);
    ctx.lineTo(tfront.x, tfront.y);
    ctx.closePath();
    ctx.fill();
    if (doStroke) ctx.stroke();
    // SW roof (lit triangle).
    ctx.fillStyle = palette.roofLit;
    ctx.beginPath();
    ctx.moveTo(tleft.x, tleft.y);
    ctx.lineTo(tfront.x, tfront.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.closePath();
    ctx.fill();
    if (doStroke) ctx.stroke();
    // SE roof (shaded triangle).
    ctx.fillStyle = palette.roofShaded;
    ctx.beginPath();
    ctx.moveTo(tfront.x, tfront.y);
    ctx.lineTo(tright.x, tright.y);
    ctx.lineTo(apex.x, apex.y);
    ctx.closePath();
    ctx.fill();
    if (doStroke) ctx.stroke();

    return { back, right, front, left, tback, tright, tfront, tleft, apex };
  }

  // α36: a built structure, drawn around (cx, cy) — the tile's iso
  // ground centre. Each branch paints a quarter-view shell with visible
  // walls and roof.
  _drawStructure(structure, cx, cy, hearthsLit) {
    const ctx = this.ctx;
    const ts = this.ts;

    // α36 perf: at small zooms a hut / warehouse is only 5-12 px on
    // screen — the dozens of beginPath / fill / stroke calls per
    // building add up but the player can't read the detail anyway.
    // Drop to a single coloured blob silhouette so we still see
    // structures dotting the landscape but stop paying for their
    // detail. Threshold matches the "detailed" terrain cutoff.
    if (ts < 14) {
      const isHut    = structure === 'hut' || structure === 'hut_med' || structure === 'hut_large';
      const isStock  = structure === 'stockpile' || structure === 'stockpile_med' || structure === 'stockpile_large';
      const isHearth = structure === 'hearth';
      const isShop   = structure === 'workshop';
      const isFence  = structure === 'fence';
      ctx.fillStyle = isHut    ? '#a07a48'
                    : isStock  ? '#b07840'
                    : isHearth ? (hearthsLit ? '#e8590f' : '#3a2a1c')
                    : isShop   ? '#6a4a20'
                    : isFence  ? '#7a5530'
                    : '#888';
      const w = ts * 0.45;
      const h = ts * 0.28;
      ctx.beginPath();
      ctx.ellipse(cx, cy, w, h, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (structure === 'hearth') {
      // Iso hearth: an elliptical ring of stones on the ground, a small
      // inner ash pit, crossed logs in the centre, and rising flames
      // when lit. The whole thing sits flat on the tile's ground plane.
      const mx = cx;
      const my = cy + ts * 0.04;
      const ringRx = ts * 0.30; // half-width  on screen (iso x)
      const ringRy = ts * 0.16; // half-height on screen (iso y)
      if (hearthsLit) {
        const glow = ctx.createRadialGradient(mx, my, ts * 0.08, mx, my, ts * 0.6);
        glow.addColorStop(0, 'rgba(255,170,60,0.45)');
        glow.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(mx - ts * 0.6, my - ts * 0.6, ts * 1.2, ts * 1.2);
      }
      // Ring of individual stones, positioned on the iso ellipse.
      ctx.strokeStyle = '#3a3a3a';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? '#909090' : '#6f6f6f';
        ctx.beginPath();
        ctx.ellipse(
          mx + Math.cos(ang) * ringRx,
          my + Math.sin(ang) * ringRy,
          ts * 0.10, ts * 0.06, 0, 0, Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
      // Ash pit (centre, dark ellipse).
      ctx.fillStyle = '#221c18';
      ctx.beginPath();
      ctx.ellipse(mx, my, ts * 0.18, ts * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();
      // Crossed logs (drawn at iso angles).
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(mx - ts * 0.16, my + ts * 0.06);
      ctx.lineTo(mx + ts * 0.16, my - ts * 0.06);
      ctx.moveTo(mx - ts * 0.16, my - ts * 0.06);
      ctx.lineTo(mx + ts * 0.16, my + ts * 0.06);
      ctx.stroke();
      if (hearthsLit) {
        for (const [w, h, col] of [
          [0.18, 0.46, '#e8590f'],
          [0.12, 0.34, '#f59a1e'],
          [0.06, 0.20, '#ffd751'],
        ]) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(mx, my - ts * h);
          ctx.quadraticCurveTo(mx + ts * w, my - ts * h * 0.3, mx, my + ts * 0.02);
          ctx.quadraticCurveTo(mx - ts * w, my - ts * h * 0.3, mx, my - ts * h);
          ctx.fill();
        }
      }
      return;
    }

    if (structure === 'workshop') {
      // α36 iso workshop: open quarter-view canopy on 4 visible posts
      // with a workbench + small barrel underneath. The canopy reads as
      // a roof without walls so it doesn't look like a hut at a glance.
      const wallPx = ts * 0.05;  // very low "walls" (just header beam)
      const roofPx = ts * 0.20;
      const w = 0.9, d = 0.9;
      // Skeleton: ground shadow + roof only (no wall fills, so we draw
      // the box with shadow + roof, then add posts and bench by hand).
      const ground = this._isoBox(cx, cy, w, d, wallPx, roofPx, {
        wallLit:    'rgba(0,0,0,0)',  // transparent: no wall fill
        wallShaded: 'rgba(0,0,0,0)',
        outline:    'rgba(0,0,0,0)',  // skip wall stroke
        roofLit:    '#7d5424',
        roofShaded: '#5b3f1c',
        shadow:     'rgba(0,0,0,0.25)',
      });
      // Four corner posts (vertical strokes from ground to roof corner).
      ctx.strokeStyle = '#5b3f1c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ground.left.x,  ground.left.y);  ctx.lineTo(ground.tleft.x,  ground.tleft.y);
      ctx.moveTo(ground.front.x, ground.front.y); ctx.lineTo(ground.tfront.x, ground.tfront.y);
      ctx.moveTo(ground.right.x, ground.right.y); ctx.lineTo(ground.tright.x, ground.tright.y);
      ctx.stroke();
      // Workbench: rectangle in iso, sitting low and centred.
      const bx = cx, by = cy + ts * 0.08;
      ctx.fillStyle = '#8c6234';
      ctx.beginPath();
      ctx.ellipse(bx, by, ts * 0.22, ts * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3f2a12';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Barrel on the bench.
      ctx.fillStyle = '#9a6a35';
      ctx.beginPath();
      ctx.ellipse(bx, by - ts * 0.06, ts * 0.10, ts * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Hoops on the barrel.
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(bx, by - ts * 0.10, ts * 0.10, ts * 0.03, 0, 0, Math.PI * 2);
      ctx.ellipse(bx, by - ts * 0.02, ts * 0.10, ts * 0.03, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    if (structure === 'stockpile' || structure === 'stockpile_med' || structure === 'stockpile_large') {
      // α36 iso warehouse: tall plank-walled box, hipped roof, wide
      // double door on the front-left face. Larger tiers raise the
      // walls + roof and add a pennant on the apex.
      const sizeMul = structure === 'stockpile_large' ? 1.18
                    : structure === 'stockpile_med'   ? 1.08
                    : 1.0;
      const wallPx = ts * 0.42 * sizeMul;
      const roofPx = ts * 0.20 * sizeMul;
      const pts = this._isoBox(cx, cy, 0.95, 0.95, wallPx, roofPx, {
        wallLit:    '#c8985a',
        wallShaded: '#9c7340',
        outline:    '#3f2a12',
        roofLit:    '#9a6230',
        roofShaded: '#6c4218',
      });
      // Plank lines on the SW (lit) wall — horizontal in world = follow
      // the wall's bottom→top axis on screen.
      ctx.strokeStyle = 'rgba(60,38,14,0.45)';
      ctx.lineWidth = 1;
      for (const t of [0.33, 0.66]) {
        const aL = { x: lerp(pts.left.x,  pts.tleft.x,  t), y: lerp(pts.left.y,  pts.tleft.y,  t) };
        const aR = { x: lerp(pts.front.x, pts.tfront.x, t), y: lerp(pts.front.y, pts.tfront.y, t) };
        ctx.beginPath();
        ctx.moveTo(aL.x, aL.y);
        ctx.lineTo(aR.x, aR.y);
        ctx.stroke();
      }
      // α36 followup: double door on the SW (front-left) wall, drawn as
      // a parallelogram that lies flat on the wall plane. The earlier
      // version used hard-coded (±0.6, ∓0.3) offsets that pointed the
      // door away from the wall — visually it looked rotated wrong.
      // The fix uses the wall's actual unit vector (left → front).
      const doorH = wallPx * 0.7;
      const doorBaseX = lerp(pts.left.x, pts.front.x, 0.55);
      const doorBaseY = lerp(pts.left.y, pts.front.y, 0.55);
      const doorHalfW = ts * 0.15 * sizeMul;
      const wDx = pts.front.x - pts.left.x;
      const wDy = pts.front.y - pts.left.y;
      const wLen = Math.sqrt(wDx * wDx + wDy * wDy);
      const wuX = wDx / wLen;
      const wuY = wDy / wLen;
      const dx0 = -doorHalfW * wuX, dy0 = -doorHalfW * wuY;
      const dx1 = +doorHalfW * wuX, dy1 = +doorHalfW * wuY;
      ctx.fillStyle = '#5d3a14';
      ctx.beginPath();
      ctx.moveTo(doorBaseX + dx0, doorBaseY + dy0);
      ctx.lineTo(doorBaseX + dx1, doorBaseY + dy1);
      ctx.lineTo(doorBaseX + dx1, doorBaseY + dy1 - doorH);
      ctx.lineTo(doorBaseX + dx0, doorBaseY + dy0 - doorH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3f2a12';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Vertical centre split (parallel to the door's height axis).
      ctx.beginPath();
      ctx.moveTo(doorBaseX, doorBaseY);
      ctx.lineTo(doorBaseX, doorBaseY - doorH);
      ctx.stroke();
      // Pennant on the apex for med / large.
      if (structure !== 'stockpile') {
        const poleTop = { x: pts.apex.x, y: pts.apex.y - ts * 0.16 };
        ctx.strokeStyle = '#3f2a12';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pts.apex.x, pts.apex.y);
        ctx.lineTo(poleTop.x, poleTop.y);
        ctx.stroke();
        ctx.fillStyle = structure === 'stockpile_large' ? '#cc3a2a' : '#e8c34a';
        ctx.beginPath();
        ctx.moveTo(poleTop.x, poleTop.y);
        ctx.lineTo(poleTop.x + ts * 0.18, poleTop.y + ts * 0.04);
        ctx.lineTo(poleTop.x, poleTop.y + ts * 0.10);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      return;
    }

    if (structure === 'hut' || structure === 'hut_med' || structure === 'hut_large') {
      // α36 iso hut: small wooden home with hipped roof, lit windows
      // tucked under the eave on the visible SW wall. Larger tiers
      // grow up + out + paint additional windows.
      const sizeMul = structure === 'hut_large' ? 1.18
                    : structure === 'hut_med'   ? 1.08
                    : 1.0;
      const wallPx = ts * 0.30 * sizeMul;
      const roofPx = ts * 0.22 * sizeMul;
      const pts = this._isoBox(cx, cy, 0.78, 0.78, wallPx, roofPx, {
        wallLit:    '#caa06a',
        wallShaded: '#9c7a48',
        outline:    '#5a3a1e',
        roofLit:    '#a05a30',
        roofShaded: '#7a4220',
      });
      // α36 followup: door on the SW wall, drawn as a parallelogram in
      // the wall plane. Uses the wall's unit vector (left → front)
      // instead of hard-coded offsets so it lies flat against the wall.
      const doorH = wallPx * 0.7;
      const doorBaseX = lerp(pts.left.x, pts.front.x, 0.55);
      const doorBaseY = lerp(pts.left.y, pts.front.y, 0.55);
      const doorHalfW = ts * 0.07 * sizeMul;
      const swDx = pts.front.x - pts.left.x;
      const swDy = pts.front.y - pts.left.y;
      const swLen = Math.sqrt(swDx * swDx + swDy * swDy);
      const swUx = swDx / swLen, swUy = swDy / swLen;
      ctx.fillStyle = '#4a3018';
      ctx.beginPath();
      ctx.moveTo(doorBaseX - doorHalfW * swUx,         doorBaseY - doorHalfW * swUy);
      ctx.lineTo(doorBaseX + doorHalfW * swUx,         doorBaseY + doorHalfW * swUy);
      ctx.lineTo(doorBaseX + doorHalfW * swUx,         doorBaseY + doorHalfW * swUy - doorH);
      ctx.lineTo(doorBaseX - doorHalfW * swUx,         doorBaseY - doorHalfW * swUy - doorH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#2a1808';
      ctx.lineWidth = 1;
      ctx.stroke();
      // Lit window on the SE (front-right) wall, similarly anchored to
      // that wall's plane using the (front → right) unit vector.
      const seDx = pts.right.x - pts.front.x;
      const seDy = pts.right.y - pts.front.y;
      const seLen = Math.sqrt(seDx * seDx + seDy * seDy);
      const seUx = seDx / seLen, seUy = seDy / seLen;
      const winBaseX = lerp(pts.front.x, pts.right.x, 0.5);
      const winBaseY = lerp(pts.front.y, pts.right.y, 0.5);
      const winHalf = ts * 0.06 * sizeMul;
      const winH = wallPx * 0.5;
      ctx.fillStyle = '#e8c873';
      ctx.beginPath();
      ctx.moveTo(winBaseX - winHalf * seUx, winBaseY - winHalf * seUy - winH * 0.2);
      ctx.lineTo(winBaseX + winHalf * seUx, winBaseY + winHalf * seUy - winH * 0.2);
      ctx.lineTo(winBaseX + winHalf * seUx, winBaseY + winHalf * seUy - winH);
      ctx.lineTo(winBaseX - winHalf * seUx, winBaseY - winHalf * seUy - winH);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#5a3a1e';
      ctx.stroke();
      // Extra windows along the SW wall eave for med / large variants.
      if (structure !== 'hut') {
        const dots = structure === 'hut_large' ? 3 : 2;
        const wH = wallPx * 0.35;
        const wHalf = ts * 0.045 * sizeMul;
        for (let i = 0; i < dots; i++) {
          const t = (i + 1) / (dots + 1);
          const wBaseX = lerp(pts.left.x, pts.front.x, t);
          const wBaseY = lerp(pts.left.y, pts.front.y, t);
          const eaveOffsetY = wallPx * 0.15; // tuck under the eave
          ctx.fillStyle = '#e8c873';
          ctx.beginPath();
          ctx.moveTo(wBaseX - wHalf * swUx, wBaseY - wHalf * swUy - eaveOffsetY - wH);
          ctx.lineTo(wBaseX + wHalf * swUx, wBaseY + wHalf * swUy - eaveOffsetY - wH);
          ctx.lineTo(wBaseX + wHalf * swUx, wBaseY + wHalf * swUy - eaveOffsetY);
          ctx.lineTo(wBaseX - wHalf * swUx, wBaseY - wHalf * swUy - eaveOffsetY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      return;
    }

    // α36 iso fence — four posts at the diamond corners with crossed
    // rails running along the diamond edges. The posts rise above
    // ground; the rails connect their top mid-points.
    const postH = ts * 0.22;
    const hx = ts * 0.40;
    const hy = ts * 0.20;
    const corners = [
      { x: cx,      y: cy - hy },  // back
      { x: cx + hx, y: cy },        // right
      { x: cx,      y: cy + hy },   // front
      { x: cx - hx, y: cy },        // left
    ];
    const tops = corners.map((c) => ({ x: c.x, y: c.y - postH }));
    // Rails along the SW and SE edges only (visible faces).
    ctx.strokeStyle = '#9a7042';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(tops[2].x, tops[2].y); ctx.lineTo(tops[3].x, tops[3].y);
    ctx.moveTo(tops[2].x, tops[2].y); ctx.lineTo(tops[1].x, tops[1].y);
    ctx.moveTo(corners[2].x, corners[2].y - postH * 0.5); ctx.lineTo(corners[3].x, corners[3].y - postH * 0.5);
    ctx.moveTo(corners[2].x, corners[2].y - postH * 0.5); ctx.lineTo(corners[1].x, corners[1].y - postH * 0.5);
    ctx.stroke();
    // Posts (small rectangles).
    ctx.fillStyle = '#6e4a26';
    ctx.strokeStyle = '#3f2a12';
    ctx.lineWidth = 1;
    for (const c of corners) {
      const w = ts * 0.05;
      ctx.fillRect(c.x - w, c.y - postH, w * 2, postH);
      ctx.strokeRect(c.x - w, c.y - postH, w * 2, postH);
    }
  }

  _drawPlant(plant, cx, cy, watered) {
    if (plant.kind === PlantKind.WILD) {
      this._drawWild(cx, cy, plant.wildId);
    } else if (plant.kind === PlantKind.TREE) {
      this._drawTree(plant, cx, cy);
    } else if (plant.kind === PlantKind.STUMP) {
      this._drawStump(cx, cy);
    } else if (plant.kind === PlantKind.SEAFOOD) {
      this._drawSeafood(cx, cy, plant.seafoodId);
    } else {
      this._drawCrop(plant, cx, cy, watered);
    }
  }

  // α33–α34: silhouette of a fishable resource on a water tile.
  // Dispatch on species id so adding new ones is just a new case here.
  _drawSeafood(cx, cy, seafoodId) {
    switch (seafoodId) {
      case 'clam':       return this._drawClam(cx, cy);
      case 'shrimp':
      case 'lakeShrimp': return this._drawShrimp(cx, cy, seafoodId);
      case 'crab':       return this._drawCrab(cx, cy);
      case 'seaweed':    return this._drawSeaweed(cx, cy);
      case 'salmon':     return this._drawSalmon(cx, cy);
      default:           return this._drawFish(cx, cy, seafoodId);
    }
  }

  _drawFish(cx, cy, seafoodId) {
    const ctx = this.ctx;
    const ts = this.ts;
    const tint = seafoodId === 'saltFish' ? '#7fb8d2'
      : seafoodId === 'riverFish' ? '#a8c4a8' : '#9ab6c2';
    ctx.fillStyle = tint;
    ctx.strokeStyle = '#2c3a4a';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ts * 0.18, ts * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.18, cy);
    ctx.lineTo(cx + ts * 0.28, cy - ts * 0.08);
    ctx.lineTo(cx + ts * 0.28, cy + ts * 0.08);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2c3a4a';
    ctx.beginPath();
    ctx.arc(cx - ts * 0.08, cy - ts * 0.02, ts * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawClam(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    ctx.fillStyle = '#d8c89a';
    ctx.strokeStyle = '#6f5e34';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ts * 0.18, ts * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.18, cy);
    ctx.lineTo(cx + ts * 0.18, cy);
    ctx.stroke();
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) {
      ctx.moveTo(cx + i * ts * 0.05, cy - ts * 0.02);
      ctx.lineTo(cx + i * ts * 0.05, cy - ts * 0.10);
    }
    ctx.stroke();
  }

  // α34: shrimp — curled body, antennae. lakeShrimp is paler.
  _drawShrimp(cx, cy, id) {
    const ctx = this.ctx;
    const ts = this.ts;
    const tint = id === 'lakeShrimp' ? '#c8a890' : '#e8a890';
    ctx.fillStyle = tint;
    ctx.strokeStyle = '#7a3a30';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(cx, cy + ts * 0.02, ts * 0.13, Math.PI * 0.15, Math.PI * 1.85, false);
    ctx.lineTo(cx + ts * 0.16, cy - ts * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    for (let i = 1; i <= 3; i++) {
      const a = Math.PI * (0.25 + i * 0.18);
      const r = ts * 0.13;
      ctx.moveTo(cx + Math.cos(a) * (r - ts * 0.03), cy + Math.sin(a) * (r - ts * 0.03) + ts * 0.02);
      ctx.lineTo(cx + Math.cos(a) * (r + ts * 0.01), cy + Math.sin(a) * (r + ts * 0.01) + ts * 0.02);
    }
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.14, cy - ts * 0.05);
    ctx.lineTo(cx + ts * 0.26, cy - ts * 0.14);
    ctx.moveTo(cx + ts * 0.14, cy - ts * 0.05);
    ctx.lineTo(cx + ts * 0.26, cy - ts * 0.02);
    ctx.stroke();
  }

  // α34: crab — round shell, two claws, side legs.
  _drawCrab(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    ctx.fillStyle = '#d4665a';
    ctx.strokeStyle = '#5c2620';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ts * 0.16, ts * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#1a0a08';
    ctx.beginPath();
    ctx.arc(cx - ts * 0.05, cy - ts * 0.06, ts * 0.015, 0, Math.PI * 2);
    ctx.arc(cx + ts * 0.05, cy - ts * 0.06, ts * 0.015, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5c2620';
    ctx.fillStyle = '#d4665a';
    ctx.lineWidth = 0.6;
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + sx * ts * 0.15, cy);
      ctx.lineTo(cx + sx * ts * 0.24, cy - ts * 0.10);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + sx * ts * 0.26, cy - ts * 0.10, ts * 0.035, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      for (let i = 0; i < 3; i++) {
        const yOff = (i - 1) * ts * 0.04;
        ctx.moveTo(cx + sx * ts * 0.13, cy + yOff);
        ctx.lineTo(cx + sx * ts * 0.22, cy + yOff + ts * 0.04);
      }
      ctx.stroke();
    }
  }

  // α34: seaweed — three swaying strands.
  _drawSeaweed(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    ctx.strokeStyle = '#3a7a4a';
    ctx.fillStyle = '#4d9a5e';
    ctx.lineWidth = 1.4;
    const base = cy + ts * 0.18;
    for (const ox of [-ts * 0.10, 0, ts * 0.10]) {
      ctx.beginPath();
      ctx.moveTo(cx + ox, base);
      ctx.quadraticCurveTo(cx + ox + ts * 0.04, cy + ts * 0.04, cx + ox - ts * 0.02, cy - ts * 0.10);
      ctx.stroke();
    }
    ctx.lineWidth = 0.7;
    for (const ox of [-ts * 0.10, 0, ts * 0.10]) {
      ctx.beginPath();
      ctx.ellipse(cx + ox - ts * 0.02, cy - ts * 0.10, ts * 0.04, ts * 0.025, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // α34 followup: salmon — fatter than the generic riverFish, with a
  // pink-orange body, dark back stripe, distinctive forked tail and
  // pronounced upturned snout. Replaces the eel silhouette.
  _drawSalmon(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    // Body — pink-orange salmon flesh tone.
    ctx.fillStyle = '#e08770';
    ctx.strokeStyle = '#7a3520';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(cx, cy, ts * 0.20, ts * 0.11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Darker back stripe.
    ctx.fillStyle = '#7a3520';
    ctx.beginPath();
    ctx.ellipse(cx, cy - ts * 0.05, ts * 0.18, ts * 0.035, 0, 0, Math.PI * 2);
    ctx.fill();
    // Forked tail (two triangles fanning out from the body).
    ctx.fillStyle = '#e08770';
    ctx.strokeStyle = '#7a3520';
    ctx.beginPath();
    ctx.moveTo(cx + ts * 0.20, cy);
    ctx.lineTo(cx + ts * 0.30, cy - ts * 0.10);
    ctx.lineTo(cx + ts * 0.26, cy);
    ctx.lineTo(cx + ts * 0.30, cy + ts * 0.10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Upturned snout — a small wedge poking forward and down.
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.20, cy - ts * 0.01);
    ctx.lineTo(cx - ts * 0.28, cy + ts * 0.02);
    ctx.lineTo(cx - ts * 0.20, cy + ts * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Eye.
    ctx.fillStyle = '#1a0a08';
    ctx.beginPath();
    ctx.arc(cx - ts * 0.10, cy - ts * 0.02, ts * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  // α27: wild plants come in five ancestor species. Branches keep the
  // same overall footprint (≈ ts*0.45 across) so foraging tooltips and
  // task-pick paths don't shift; the variant just changes the silhouette.
  _drawWild(cx, cy, wildId) {
    switch (wildId) {
      case 'wildgrain':  return this._drawWildGrain(cx, cy);
      case 'wildlegume': return this._drawWildLegume(cx, cy);
      case 'wildroot':   return this._drawWildRoot(cx, cy);
      case 'wildberry':  return this._drawWildBerry(cx, cy);
      case 'wildgreens':
      default:           return this._drawWildGreens(cx, cy);
    }
  }

  // Three small green pebbles — the original wildgreens look.
  _drawWildGreens(cx, cy) {
    const ctx = this.ctx;
    const r = this.ts * 0.15;
    ctx.fillStyle = '#2e6b34';
    ctx.strokeStyle = '#19401f';
    ctx.lineWidth = 1;
    for (const [ox, oy] of [
      [-r, r * 0.6],
      [r, r * 0.6],
      [0, -r * 0.7],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Three thin upright stalks with a tiny seed head on top.
  _drawWildGrain(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const baseY = cy + ts * 0.18;
    ctx.strokeStyle = '#8d8f3a';
    ctx.lineWidth = 1.2;
    for (const off of [-0.18, 0, 0.18]) {
      const tipX = cx + ts * off;
      const tipY = cy - ts * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx + ts * off * 0.4, baseY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
      // Seed head.
      ctx.fillStyle = '#b5a358';
      ctx.beginPath();
      ctx.ellipse(tipX, tipY - ts * 0.04, ts * 0.045, ts * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Sprawling vine with a couple of small pods hanging off it.
  _drawWildLegume(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    // Vine curve.
    ctx.strokeStyle = '#5b8a3a';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - ts * 0.22, cy + ts * 0.18);
    ctx.quadraticCurveTo(cx, cy - ts * 0.05, cx + ts * 0.22, cy + ts * 0.18);
    ctx.stroke();
    // Two small leaves.
    ctx.fillStyle = '#6da840';
    for (const off of [-0.12, 0.12]) {
      ctx.beginPath();
      ctx.ellipse(cx + ts * off, cy - ts * 0.02, ts * 0.07, ts * 0.05, off * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Two pods.
    ctx.fillStyle = '#a4c468';
    ctx.strokeStyle = '#4a6f2a';
    ctx.lineWidth = 0.8;
    for (const off of [-0.16, 0.16]) {
      ctx.beginPath();
      ctx.ellipse(cx + ts * off, cy + ts * 0.10, ts * 0.05, ts * 0.10, off * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // A rosette of long pointed leaves at ground level — root hidden.
  _drawWildRoot(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    ctx.fillStyle = '#4f8a3a';
    ctx.strokeStyle = '#2a5520';
    ctx.lineWidth = 0.9;
    for (const ang of [-1.2, -0.6, 0, 0.6, 1.2]) {
      ctx.save();
      ctx.translate(cx, cy + ts * 0.05);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.ellipse(0, -ts * 0.13, ts * 0.04, ts * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  // A green bush dotted with little red berries — the visual hook.
  _drawWildBerry(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const r = ts * 0.16;
    // Foliage clump.
    ctx.fillStyle = '#3d7a3a';
    ctx.strokeStyle = '#23491f';
    ctx.lineWidth = 1;
    for (const [ox, oy] of [
      [-r * 0.7, r * 0.5],
      [r * 0.7, r * 0.5],
      [0, -r * 0.7],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, r * 0.95, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Berries — bright red dots scattered over the foliage.
    ctx.fillStyle = '#d3354a';
    ctx.strokeStyle = '#7e1d2a';
    ctx.lineWidth = 0.6;
    for (const [ox, oy] of [
      [-r * 0.4, -r * 0.1],
      [r * 0.45, -r * 0.05],
      [-r * 0.05, r * 0.45],
      [r * 0.15, -r * 0.55],
      [-r * 0.55, r * 0.5],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, Math.max(1.1, ts * 0.04), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // α36 iso tree: trunk rises from the ground, canopy as a hemispherical
  // volume above. Drop shadow at the base. Young trees scale down via
  // plant.growth (0.25..1). Visible from upper-left, so the canopy
  // shows lit top-left + shaded bottom-right.
  _drawTree(plant, cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const g = Math.max(0.25, Math.min(1, plant.growth || 1));
    // α36 perf: at small zoom every tree dropped from ~25 canvas calls
    // to one filled arc — they read as forest pixels and the FPS
    // doubles. The 14 px cutoff matches the rest of the LOD threshold.
    if (ts < 14) {
      ctx.fillStyle = '#2f6b34';
      ctx.beginPath();
      ctx.arc(cx, cy - ts * 0.10, ts * 0.30 * g, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    const trunkH = ts * 0.42 * g;
    const trunkW = Math.max(1.5, ts * 0.10 * g);
    const baseY = cy + ts * 0.06; // ground meet point
    // Ground shadow (offset slightly right of trunk).
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx + ts * 0.03, baseY + ts * 0.02, ts * 0.20 * g, ts * 0.08 * g, 0, 0, Math.PI * 2);
    ctx.fill();
    // Trunk (a tapered vertical column).
    ctx.fillStyle = '#5a3a20';
    ctx.beginPath();
    ctx.moveTo(cx - trunkW * 0.5, baseY);
    ctx.lineTo(cx + trunkW * 0.5, baseY);
    ctx.lineTo(cx + trunkW * 0.35, baseY - trunkH);
    ctx.lineTo(cx - trunkW * 0.35, baseY - trunkH);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3b2614';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Canopy — large central blob + lit + shaded highlights.
    const cr = ts * 0.30 * g;
    const crownY = baseY - trunkH - cr * 0.25;
    // Shaded back (drawn first so lit lobes overlap).
    ctx.fillStyle = '#1f4d23';
    ctx.beginPath();
    ctx.arc(cx + cr * 0.32, crownY + cr * 0.20, cr * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#19401f';
    ctx.stroke();
    // Main body.
    ctx.fillStyle = '#2f6b34';
    ctx.beginPath();
    ctx.arc(cx, crownY, cr * 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Lit highlight (lobe up-left).
    ctx.fillStyle = '#4f9248';
    ctx.beginPath();
    ctx.arc(cx - cr * 0.35, crownY - cr * 0.25, cr * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // α36 iso stump: a short cylinder (top ellipse + side rectangle).
  // Reads as "tree cut, base remains" from quarter view.
  _drawStump(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const baseY = cy + ts * 0.06;
    const rx = ts * 0.13;
    const ry = ts * 0.06;
    const h = ts * 0.10;
    // Ground shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(cx + ts * 0.02, baseY + ts * 0.02, rx * 1.05, ry * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    // Side (lower trapezoid).
    ctx.fillStyle = '#5a3e22';
    ctx.beginPath();
    ctx.moveTo(cx - rx, baseY);
    ctx.lineTo(cx + rx, baseY);
    ctx.lineTo(cx + rx, baseY - h);
    ctx.lineTo(cx - rx, baseY - h);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#3b2614';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Top (lit ellipse).
    ctx.fillStyle = '#8a5d35';
    ctx.beginPath();
    ctx.ellipse(cx, baseY - h, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Growth ring (small inner ellipse).
    ctx.strokeStyle = '#4d3320';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(cx, baseY - h, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  _drawWithered(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    ctx.strokeStyle = '#6b5535';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy + ts * 0.28);
    ctx.lineTo(cx, cy + ts * 0.02);
    ctx.lineTo(cx + ts * 0.13, cy - ts * 0.05);
    ctx.stroke();
    ctx.fillStyle = '#7a6038';
    ctx.beginPath();
    ctx.ellipse(cx + ts * 0.13, cy - ts * 0.03, ts * 0.1, ts * 0.06, 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawCrop(plant, cx, cy, watered) {
    if (plant.withered) {
      this._drawWithered(cx, cy);
      return;
    }
    this._paintCrop(this.ctx, this.ts, plant.cropId, plant.genome, plant.growth, cx, cy);
    if (watered) {
      const ctx = this.ctx;
      const ts = this.ts;
      ctx.fillStyle = '#5ba8d8';
      ctx.beginPath();
      ctx.arc(cx + ts * 0.26, cy - ts * 0.24, ts * 0.07, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draw a mature crop of `genome` filling a w×h preview area on `ctx`. */
  drawCropPreview(ctx, w, h, cropId, genome) {
    ctx.clearRect(0, 0, w, h);
    const crop = getCrop(cropId);
    // Root vegetables, tubers, bulbs and ground fruit all draw with the
    // body sitting at or below the soil-line anchor. In a real tile the
    // tile background sits behind them; in the bare preview canvas they
    // would clip off the bottom edge, so lift the anchor up to keep the
    // whole plant inside the box.
    const cat = crop && crop.category;
    const cyMul =
      cat === 'tuber' || cat === 'root' || cat === 'bulb' || cat === 'fruit'
        ? 0.55
        : 0.66;
    this._paintCrop(ctx, h * 0.82, cropId, genome, 1, w / 2, h * cyMul);
  }

  // Compose a crop from its genome: a stem, leaves and fruit, with the
  // fruit shape, leaf style, surface, colour and speckling all gene-driven.
  // Dispatch by crop category — each plant family has its own silhouette.
  _paintCrop(ctx, ts, cropId, genome, growth, cx, cy) {
    const crop = getCrop(cropId);
    // Wild greens have their own scruffy painter — distinct from the
    // tidy cabbage / lettuce silhouette of the leaf category.
    if (cropId === 'wildgreens') {
      return this._paintWildgreens(ctx, ts, crop, genome, growth, cx, cy);
    }
    switch (crop.category) {
      case 'grain':    return this._paintGrain(ctx, ts, crop, genome, growth, cx, cy);
      case 'legume':   return this._paintLegume(ctx, ts, crop, genome, growth, cx, cy);
      case 'root':     return this._paintRoot(ctx, ts, crop, genome, growth, cx, cy);
      case 'tuber':    return this._paintTuber(ctx, ts, crop, genome, growth, cx, cy);
      case 'bulb':     return this._paintBulb(ctx, ts, crop, genome, growth, cx, cy);
      case 'leaf':     return this._paintLeafMass(ctx, ts, crop, genome, growth, cx, cy);
      case 'stem':     return this._paintStemVeg(ctx, ts, crop, genome, growth, cx, cy);
      case 'flower':   return this._paintFlowerVeg(ctx, ts, crop, genome, growth, cx, cy);
      case 'fruit':    return this._paintGroundFruit(ctx, ts, crop, genome, growth, cx, cy);
      case 'nut':      return this._paintNutCluster(ctx, ts, crop, genome, growth, cx, cy);
      case 'fruitVeg':
      default:         return this._paintFruitBearing(ctx, ts, crop, genome, growth, cx, cy, 1);
    }
  }

  // Genome-derived visual parameters shared by most category painters.
  _cropLook(genome) {
    return {
      shapeIdx: partIndex(genome, 'shape', 4),
      surfIdx: partIndex(genome, 'surface', 3),
      leafIdx: partIndex(genome, 'leaf', 3),
      yieldP: phenotype(genome, 'yield'),
      hueP: phenotype(genome, 'hue'),
      satP: phenotype(genome, 'saturation'),
      spotsP: phenotype(genome, 'spots'),
    };
  }

  _ripeFill(crop, look, ripe) {
    const hueDeg = (look.hueP - 0.5) * 300;
    const satMul = 0.5 + look.satP * 1.15;
    return ripe
      ? tintColor(crop.ripeColor, hueDeg, satMul)
      : tintColor(crop.color, hueDeg * 0.25, 1);
  }

  // A green stem from `base` upward by `stemH`.
  _drawStem(ctx, ts, cx, base, stemH, thickness = 0.1) {
    ctx.strokeStyle = '#3f7a2b';
    ctx.lineWidth = Math.max(1.4, ts * thickness);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, base - stemH);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // ----- Category painters ------------------------------------------------

  // Fruit-bearing crops (tomato, eggplant, pepper, cucumber...).
  // `sizeMul` lets the larger fruit category swell the fruit a touch.
  _paintFruitBearing(ctx, ts, crop, genome, growth, cx, cy, sizeMul = 1) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.3;
    const stemH = ts * (0.16 + 0.42 * g);
    this._drawStem(ctx, ts, cx, base, stemH);
    if (g > 0.2) {
      const leafY = base - stemH * 0.5;
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, -1);
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, 1);
    }
    if (g > 0.45) {
      const top = base - stemH;
      const r = ts * (0.07 + 0.15 * g) * (0.78 + look.yieldP * 0.62) * sizeMul;
      const fill = this._ripeFill(crop, look, ripe);
      this._drawFruit(ctx, cx, top, r, look.shapeIdx, fill, ripe, look.surfIdx, look.spotsP);
    }
  }

  // Ground-growing fruits (strawberry, melon): the fruit body sits low,
  // close to the soil, with a short green calyx (the "ヘタ") of three to
  // five little spikes pointing upward on top — no tall hanging stem.
  _paintGroundFruit(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    // Body sits a touch above the soil line so the whole shape stays
    // inside the tile / preview box.
    const r = ts * (0.1 + 0.18 * g) * (0.8 + look.yieldP * 0.55);
    const by = cy + ts * 0.18 - r * 0.1;
    const fill = this._ripeFill(crop, look, ripe);
    if (g > 0.3) {
      this._drawFruit(ctx, cx, by, r, look.shapeIdx, fill, ripe, look.surfIdx, look.spotsP);
      // Calyx: a few short tapered green leaflets fanning UP from the
      // top of the berry. Three to five of them, alternating angle.
      const calyxColor = ripe ? '#3f7a2b' : '#5ba23c';
      ctx.fillStyle = calyxColor;
      ctx.strokeStyle = '#1f3f17';
      ctx.lineWidth = 0.7;
      const blades = 3 + (look.leafIdx % 3); // 3, 4 or 5
      const baseY = by - r * 0.78; // sit on the top of the fruit
      const spread = r * 0.55;
      const blade = r * 0.5;
      for (let i = 0; i < blades; i++) {
        const tNorm = blades === 1 ? 0.5 : i / (blades - 1);
        const ox = (tNorm - 0.5) * 2 * spread;
        const tilt = (tNorm - 0.5) * 1.1;
        const tipX = cx + ox + Math.sin(tilt) * blade * 0.35;
        const tipY = baseY - blade * (0.9 + 0.15 * Math.cos(tilt));
        const wx = blade * 0.22;
        // A small triangular leaflet from (cx,baseY) curving to its tip.
        ctx.beginPath();
        ctx.moveTo(cx + ox - wx * 0.6, baseY + wx * 0.2);
        ctx.quadraticCurveTo(cx + ox - wx * 0.3, baseY - blade * 0.45, tipX, tipY);
        ctx.quadraticCurveTo(cx + ox + wx * 0.3, baseY - blade * 0.45, cx + ox + wx * 0.6, baseY + wx * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else {
      // Early growth — just a few short shoots, no fruit body yet.
      const calyxColor = '#5ba23c';
      ctx.strokeStyle = calyxColor;
      ctx.lineWidth = Math.max(1.2, ts * 0.05);
      ctx.lineCap = 'round';
      for (const t of [-1, 0, 1]) {
        ctx.beginPath();
        ctx.moveTo(cx, by);
        ctx.lineTo(cx + t * r * 0.3, by - r * 0.6);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }

  // Grains: a tuft of slender curving stalks, each topped with a chunky
  // bristled spike when ripe — a wheat / barley / rye silhouette.
  _paintGrain(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.34;
    const stemH = ts * (0.22 + 0.55 * g);
    const stalkColor = ripe ? '#b8a35a' : '#7eb84a';
    // Five slender stalks splaying out from the same root, each curving
    // a touch to the side — much closer to how real wheat sits.
    const stalks = [-0.22, -0.11, 0, 0.11, 0.22];
    ctx.strokeStyle = stalkColor;
    ctx.lineWidth = Math.max(0.9, ts * 0.04);
    ctx.lineCap = 'round';
    for (const off of stalks) {
      const tipX = cx + ts * off;
      const tipY = base - stemH * (0.92 + 0.08 * Math.cos(off * 8));
      const cpX = cx + ts * off * 0.5;
      const cpY = base - stemH * 0.55;
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (g > 0.55) {
      const fill = this._ripeFill(crop, look, ripe);
      const headColor = tintColor(crop.ripeColor, (look.hueP - 0.5) * 200, 0.7);
      for (const off of stalks) {
        const tipX = cx + ts * off;
        const tipY = base - stemH * (0.92 + 0.08 * Math.cos(off * 8));
        const spikeH = ts * 0.26 * (0.7 + look.yieldP * 0.6);
        const spikeW = ts * 0.045 * (0.8 + look.yieldP * 0.4);
        const spikeTop = tipY - spikeH;
        // Grain kernels stacked along the spike — small offset ellipses
        // alternating left and right.
        ctx.fillStyle = fill;
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 0.6;
        const kernels = 5;
        for (let i = 0; i < kernels; i++) {
          const t = i / (kernels - 1);
          const ky = spikeTop + spikeH * (1 - t);
          const sideSign = i % 2 === 0 ? -1 : 1;
          const kx = tipX + sideSign * spikeW * 0.55;
          ctx.beginPath();
          ctx.ellipse(kx, ky, spikeW, spikeW * 1.35, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        if (ripe) {
          // A few long awns rising past the spike top.
          ctx.strokeStyle = headColor;
          ctx.lineWidth = 0.7;
          for (const a of [-0.6, -0.2, 0.2, 0.6]) {
            ctx.beginPath();
            ctx.moveTo(tipX + spikeW * a, spikeTop);
            ctx.lineTo(tipX + spikeW * a * 1.6, spikeTop - spikeH * 0.55);
            ctx.stroke();
          }
        }
      }
    }
  }

  // Legumes: vine on a stem with a couple of pods hanging off.
  _paintLegume(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.3;
    const stemH = ts * (0.18 + 0.46 * g);
    this._drawStem(ctx, ts, cx, base, stemH);
    if (g > 0.2) {
      const leafY = base - stemH * 0.5;
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, -1);
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, 1);
    }
    if (g > 0.5) {
      const fill = this._ripeFill(crop, look, ripe);
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#3f7a2b';
      ctx.lineWidth = 1;
      // Two pods, one each side, slanting down the stem.
      for (const side of [-1, 1]) {
        const px = cx + side * ts * 0.18;
        const py = base - stemH * 0.7;
        ctx.beginPath();
        ctx.ellipse(px, py + ts * 0.06, ts * 0.06, ts * 0.16 * (0.7 + look.yieldP * 0.5), side * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Roots: only a tuft of leaves shows; the root itself is under ground.
  _paintRoot(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.34;
    // Several short leaf blades sprouting from the soil.
    ctx.strokeStyle = ripe ? '#4f8f3c' : '#5ea642';
    ctx.lineWidth = Math.max(1.3, ts * 0.06);
    ctx.lineCap = 'round';
    const fan = 0.5 + 0.4 * g;
    for (const t of [-1, -0.4, 0.2, 0.8]) {
      const ang = t * fan;
      const tx = cx + Math.sin(ang) * ts * 0.22;
      const ty = base - ts * (0.18 + 0.28 * g) * Math.cos(ang);
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (g > 0.7) {
      // Hint of the root just under the surface (a sliver of its colour).
      const fill = this._ripeFill(crop, look, ripe);
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.ellipse(cx, base + ts * 0.05, ts * 0.12 * (0.7 + look.yieldP * 0.5), ts * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Tubers: similar to roots but with a couple of round bumps at ground
  // level when ripe — potatoes pushing up through the soil.
  _paintTuber(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.34;
    if (g > 0.2) {
      const leafY = base - ts * 0.05;
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, -1);
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, 1);
    }
    if (g > 0.5) {
      const fill = this._ripeFill(crop, look, ripe);
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      for (const off of [-0.16, 0.14]) {
        ctx.beginPath();
        ctx.ellipse(cx + ts * off, base + ts * 0.08, ts * 0.11 * (0.8 + look.yieldP * 0.4), ts * 0.08, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Bulbs: a plump egg-shaped bulb half-buried in the soil with a narrow
  // tapered tail underneath and a fan of green leaves shooting up. The
  // bulb gets vertical streaks suggesting onion layers.
  _paintBulb(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.32;
    // Slender curved leaves splaying out from the bulb's neck (4 blades).
    ctx.strokeStyle = ripe ? '#5fa84a' : '#7cba5a';
    ctx.lineWidth = Math.max(1.2, ts * 0.045);
    ctx.lineCap = 'round';
    const leafH = ts * (0.22 + 0.36 * g);
    for (const off of [-0.6, -0.2, 0.2, 0.6]) {
      const tipX = cx + ts * off * 0.18;
      const tipY = base - leafH * (1 - Math.abs(off) * 0.15);
      const cpX = cx + ts * off * 0.12;
      const cpY = base - leafH * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.quadraticCurveTo(cpX, cpY, tipX, tipY);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (g > 0.4) {
      const fill = this._ripeFill(crop, look, ripe);
      // The bulb body — an egg shape, fatter at the bottom, sitting
      // half-buried so the bottom slightly clips the soil line.
      const rw = ts * 0.15 * (0.85 + look.yieldP * 0.4);
      const rh = ts * 0.2 * (0.85 + look.yieldP * 0.4);
      const by = base + ts * 0.02;
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.32)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, by, rw, rh, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Vertical streaks suggest the onion's papery layers.
      ctx.strokeStyle = tintColor(fill, 0, 0.55);
      ctx.lineWidth = 0.8;
      for (const s of [-0.6, -0.25, 0.25, 0.6]) {
        const x = cx + rw * s;
        const lift = rh * Math.cos(s * 1.2) * 0.85;
        ctx.beginPath();
        ctx.moveTo(x, by - lift);
        ctx.lineTo(x, by + lift);
        ctx.stroke();
      }
      // Small root tail at the bottom of the bulb (3 tiny strokes).
      ctx.strokeStyle = 'rgba(60, 40, 25, 0.55)';
      ctx.lineWidth = 0.8;
      ctx.lineCap = 'round';
      for (const t of [-0.25, 0, 0.25]) {
        ctx.beginPath();
        ctx.moveTo(cx + rw * t, by + rh * 0.85);
        ctx.lineTo(cx + rw * t * 1.3, by + rh * 1.15);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
  }

  // Wild greens: a scruffy, asymmetric tuft of jagged blades sprouting
  // straight up from the soil. Reads as "wild plant", not "neat cabbage".
  _paintWildgreens(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.34;
    const reach = ts * (0.22 + 0.32 * g);
    // Six blades, alternating heights and angles so the tuft looks uneven.
    const fill = this._ripeFill(crop, look, ripe);
    ctx.fillStyle = fill;
    ctx.strokeStyle = tintColor(fill, 0, 0.55);
    ctx.lineWidth = 0.8;
    const blades = [
      { off: -0.55, tilt: -0.7, scale: 0.85 },
      { off: -0.30, tilt: -0.3, scale: 1.05 },
      { off: -0.05, tilt: 0.1,  scale: 1.00 },
      { off:  0.18, tilt: 0.05, scale: 1.15 },
      { off:  0.40, tilt: 0.45, scale: 0.95 },
      { off:  0.60, tilt: 0.85, scale: 0.80 },
    ];
    for (const b of blades) {
      const x0 = cx + ts * b.off * 0.18;
      const y0 = base;
      const len = reach * b.scale;
      const tipX = x0 + Math.sin(b.tilt) * len * 0.55;
      const tipY = y0 - len;
      const wx = ts * 0.04;
      ctx.beginPath();
      ctx.moveTo(x0 - wx, y0);
      ctx.quadraticCurveTo(x0 + Math.sin(b.tilt) * len * 0.2, y0 - len * 0.55, tipX, tipY);
      ctx.quadraticCurveTo(x0 + Math.sin(b.tilt) * len * 0.3, y0 - len * 0.45, x0 + wx, y0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    // A scatter of small berries / seed heads when ripe, suggesting that
    // wild-greens DOES drop seed on harvest.
    if (ripe) {
      ctx.fillStyle = tintColor(fill, 30, 0.7);
      for (const [ox, oy] of [[-0.25, -0.55], [0.15, -0.4], [0.4, -0.7]]) {
        ctx.beginPath();
        ctx.arc(cx + reach * ox, base + reach * oy, ts * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Leaf greens: a low rounded mass of leaves, no stem, no fruit.
  _paintLeafMass(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const fill = ripe
      ? tintColor(crop.ripeColor, (look.hueP - 0.5) * 180, 0.6 + look.satP * 0.9)
      : tintColor(crop.color, (look.hueP - 0.5) * 60, 1);
    const base = cy + ts * 0.34;
    const r = ts * (0.16 + 0.22 * g);
    // Outer wrap leaves (slightly darker) splay out around a tight head.
    const outer = tintColor(fill, 0, 0.7);
    ctx.fillStyle = outer;
    ctx.strokeStyle = '#3f7a2b';
    ctx.lineWidth = 1;
    const head = { cx, cy: base - r * 0.45 };
    const wrapPositions = [
      [-1.0, 0.05, -0.6],
      [-0.55, -0.35, -0.25],
      [0.55, -0.35, 0.25],
      [1.0, 0.05, 0.6],
    ];
    for (const [ox, oy, rot] of wrapPositions) {
      ctx.beginPath();
      ctx.ellipse(head.cx + r * ox * 0.55, head.cy + r * oy, r * 0.55, r * 0.4, rot, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Inner head — the cabbage ball itself.
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(head.cx, head.cy, r * 0.78, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Vein lines radiating from the centre of the head, suggesting the
    // tight inner-leaf wrapping you see on a real cabbage / lettuce.
    if (g > 0.5) {
      ctx.strokeStyle = tintColor(fill, 0, 0.55);
      ctx.lineWidth = 0.8;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.2;
        ctx.beginPath();
        ctx.moveTo(head.cx, head.cy);
        ctx.lineTo(head.cx + Math.cos(a) * r * 0.7, head.cy + Math.sin(a) * r * 0.55);
        ctx.stroke();
      }
    }
  }

  // Stem vegetables: a tight cluster of asparagus-style spears poking
  // straight up out of the soil — each spear has a pointed tip and a
  // few alternating bract scales on the sides.
  _paintStemVeg(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const fill = this._ripeFill(crop, look, ripe);
    const base = cy + ts * 0.34;
    const spearH = ts * (0.28 + 0.52 * g);
    const spearW = ts * 0.07 * (0.85 + look.yieldP * 0.4);
    const spears = [-0.16, -0.05, 0.06, 0.17];
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.7;
    for (const off of spears) {
      const x = cx + ts * off;
      const top = base - spearH;
      // Spear body: a thin rounded rectangle that tapers to a sharp point.
      ctx.beginPath();
      ctx.moveTo(x - spearW * 0.5, base);
      ctx.lineTo(x - spearW * 0.5, top + spearW * 0.8);
      ctx.lineTo(x, top - spearW * 0.6); // pointed tip
      ctx.lineTo(x + spearW * 0.5, top + spearW * 0.8);
      ctx.lineTo(x + spearW * 0.5, base);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // A few darker bract scales staggered along the spear.
      ctx.fillStyle = tintColor(crop.color, -10, 0.6);
      const scales = 3;
      for (let i = 0; i < scales; i++) {
        const t = (i + 1) / (scales + 1);
        const sy = base - spearH * t;
        const side = i % 2 === 0 ? -1 : 1;
        ctx.beginPath();
        ctx.ellipse(x + side * spearW * 0.45, sy, spearW * 0.4, spearW * 0.2, side * 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fill;
    }
  }

  // Flower vegetables (broccoli, cauliflower): stem topped with a domed head.
  _paintFlowerVeg(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.32;
    const stemH = ts * (0.16 + 0.36 * g);
    this._drawStem(ctx, ts, cx, base, stemH);
    if (g > 0.3) {
      const leafY = base - stemH * 0.4;
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, -1);
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, 1);
    }
    if (g > 0.5) {
      const fill = this._ripeFill(crop, look, ripe);
      const top = base - stemH;
      const r = ts * (0.1 + 0.12 * g) * (0.85 + look.yieldP * 0.45);
      // A few overlapping bumps to suggest a floret head.
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 1;
      for (const [ox, oy] of [[-0.5, 0.1], [0.5, 0.1], [0, -0.3]]) {
        ctx.beginPath();
        ctx.arc(cx + r * ox, top + r * oy, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Nuts: a short woody stem topped with a chunky cluster of three
  // almond-shaped nuts and a sheltering leaf above. Each nut is large
  // enough to read clearly at the 48px codex preview.
  _paintNutCluster(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.32;
    const stemH = ts * (0.18 + 0.32 * g);
    // Sturdy brown stem.
    ctx.strokeStyle = '#5a3a20';
    ctx.lineWidth = Math.max(1.5, ts * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, base - stemH);
    ctx.stroke();
    ctx.lineCap = 'butt';
    if (g > 0.6) {
      const fill = this._ripeFill(crop, look, ripe);
      const top = base - stemH;
      // Three almond/oval nuts in a triangular cluster centred on the
      // top of the stem. Each is a tall ellipse, large enough to read.
      const nr = ts * 0.13 * (0.85 + look.yieldP * 0.4);
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(60, 40, 20, 0.55)';
      ctx.lineWidth = 1;
      const triad = [[-0.8, 0.4], [0.8, 0.4], [0, -0.5]];
      for (const [ox, oy] of triad) {
        const x = cx + nr * ox;
        const y = top + nr * oy;
        ctx.beginPath();
        ctx.ellipse(x, y, nr * 0.65, nr * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // A subtle seam down the centre of each nut.
        ctx.strokeStyle = 'rgba(60, 40, 20, 0.45)';
        ctx.lineWidth = 0.6;
        ctx.beginPath();
        ctx.moveTo(x, y - nr * 0.78);
        ctx.lineTo(x, y + nr * 0.78);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(60, 40, 20, 0.55)';
        ctx.lineWidth = 1;
      }
      // A sheltering leaf above the cluster.
      ctx.fillStyle = '#3f7a2b';
      ctx.beginPath();
      ctx.ellipse(cx, top - nr * 1.25, nr * 1.15, nr * 0.45, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (g > 0.3) {
      // Early growth: just a couple of leaves at the top of the stem.
      const leafY = base - stemH;
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, -1);
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, 1);
    }
  }

  // One leaf, on the given side (-1 / +1) of the stem. α29: a vertical
  // gradient (brighter top, deeper green underside) plus a central vein
  // make the foliage read as a real leaf rather than a flat blob.
  _drawLeaf(ctx, cx, leafY, ts, idx, side) {
    const lr = ts * 0.15;
    const grad = ctx.createLinearGradient(cx, leafY - lr, cx, leafY + lr);
    grad.addColorStop(0, '#7cc257');
    grad.addColorStop(1, '#3f7a2b');
    ctx.fillStyle = grad;
    if (idx === 0) {
      ctx.beginPath(); // broad
      ctx.ellipse(cx + side * lr, leafY, lr, lr * 0.62, side * 0.5, 0, Math.PI * 2);
      ctx.fill();
      this._leafVein(ctx, cx, leafY, cx + side * lr * 1.8, leafY - side * lr * 0.9);
    } else if (idx === 1) {
      ctx.beginPath(); // narrow
      ctx.ellipse(cx + side * lr * 1.05, leafY, lr * 1.2, lr * 0.32, side * 0.85, 0, Math.PI * 2);
      ctx.fill();
      this._leafVein(ctx, cx, leafY, cx + side * lr * 2.0, leafY - side * lr * 1.4);
    } else {
      // serrated — a small jagged blade
      const tipX = cx + side * lr * 1.9;
      ctx.beginPath();
      ctx.moveTo(cx, leafY);
      for (let i = 1; i <= 4; i++) {
        const t = i / 4;
        const lx = cx + (tipX - cx) * t;
        ctx.lineTo(lx, leafY - lr * 0.42 * (1 - t));
        ctx.lineTo(lx, leafY + lr * 0.3 * (1 - t));
      }
      ctx.closePath();
      ctx.fill();
      this._leafVein(ctx, cx, leafY, tipX, leafY);
    }
  }

  // A faint midrib vein from the leaf base to its tip.
  _leafVein(ctx, x0, y0, x1, y1) {
    ctx.strokeStyle = 'rgba(40,90,30,0.45)';
    ctx.lineWidth = Math.max(0.5, this.ts * 0.012);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }

  // Trace one of four fruit silhouettes (does not fill or stroke).
  _fruitPath(ctx, cx, cy, r, shapeIdx) {
    ctx.beginPath();
    if (shapeIdx === 0) {
      ctx.arc(cx, cy, r, 0, Math.PI * 2); // round
    } else if (shapeIdx === 1) {
      ctx.ellipse(cx, cy, r * 1.32, r * 0.82, 0, 0, Math.PI * 2); // oval
    } else if (shapeIdx === 2) {
      ctx.ellipse(cx, cy, r * 0.74, r * 1.34, 0, 0, Math.PI * 2); // tall
    } else {
      ctx.arc(cx - r * 0.5, cy, r * 0.78, 0, Math.PI * 2); // lobed
      ctx.moveTo(cx + r * 1.28, cy);
      ctx.arc(cx + r * 0.5, cy, r * 0.78, 0, Math.PI * 2);
    }
  }

  _drawFruit(ctx, cx, cy, r, shapeIdx, fill, ripe, surfIdx, spotsP) {
    this._fruitPath(ctx, cx, cy, r, shapeIdx);
    // α29: a radial gradient (lit top-left → shaded bottom-right) gives
    // the fruit a rounded, more realistic body instead of a flat disc.
    const grad = ctx.createRadialGradient(
      cx - r * 0.4, cy - r * 0.45, r * 0.1,
      cx, cy, r * 1.35,
    );
    grad.addColorStop(0, shadeRGB(fill, 1.28));
    grad.addColorStop(0.55, fill);
    grad.addColorStop(1, shadeRGB(fill, 0.66));
    ctx.fillStyle = grad;
    ctx.fill();

    // α29: a soft specular highlight near the top-left sells the gloss.
    {
      ctx.save();
      this._fruitPath(ctx, cx, cy, r, shapeIdx);
      ctx.clip();
      ctx.fillStyle = ripe ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.38, cy - r * 0.42, r * 0.3, r * 0.18, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (ripe && (surfIdx > 0 || spotsP > 0.35)) {
      ctx.save();
      this._fruitPath(ctx, cx, cy, r, shapeIdx);
      ctx.clip();
      if (surfIdx === 1) {
        ctx.strokeStyle = 'rgba(0,0,0,0.22)'; // ridged
        ctx.lineWidth = Math.max(1, r * 0.13);
        for (const o of [-0.5, 0, 0.5]) {
          ctx.beginPath();
          ctx.moveTo(cx + o * r, cy - r * 1.4);
          ctx.lineTo(cx + o * r, cy + r * 1.4);
          ctx.stroke();
        }
      } else if (surfIdx === 2) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)'; // fuzzy
        ctx.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * r * 0.6, cy + Math.sin(a) * r * 0.6);
          ctx.lineTo(cx + Math.cos(a) * r * 1.15, cy + Math.sin(a) * r * 1.15);
          ctx.stroke();
        }
      }
      if (spotsP > 0.35) {
        ctx.fillStyle = 'rgba(0,0,0,0.26)';
        const n = Math.round(spotsP * 6);
        for (let i = 0; i < n; i++) {
          const a = i * 2.39996;
          const rr = r * (0.2 + ((i * 7) % 10) / 16);
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, r * 0.17, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    if (ripe) {
      this._fruitPath(ctx, cx, cy, r, shapeIdx);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
  }

  _drawTaskMarker(task, x, y, isCurrent, order) {
    const ctx = this.ctx;
    const ts = this.ts;
    const color = TASK_COLORS[task.type] || '#ffffff';
    if (isCurrent) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x + 2, y + 2, ts - 4, ts - 4);
      ctx.lineWidth = 3;
    } else {
      ctx.lineWidth = 2;
    }
    ctx.strokeStyle = color;
    ctx.strokeRect(x + 2.5, y + 2.5, ts - 5, ts - 5);
    if (!isCurrent && order > 0 && order <= 30) {
      ctx.fillStyle = color;
      ctx.font = '9px system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(String(order), x + 4, y + 4);
    }
  }

  // A small top-down figure that faces the way it walks; a progress ring
  // while it works. `selected` marks the colonist work orders go to.
  _drawColonist(colonist, cx, cy, selected, groupColor) {
    const ctx = this.ctx;
    const r = this.ts * 0.33;
    // Alpha 23: per-group body palette. Defaults to the amber stand-in
    // from the original single-colony rendering when no color is set.
    const bodyLight = groupColor?.fill || '#f3c277';
    const bodyDark = groupColor?.stroke || '#c47f1e';
    const outline = groupColor?.stroke || '#3a2606';

    // Facing — toward the next path waypoint, else downward.
    let fx = 0;
    let fy = 1;
    if (colonist.path.length > 0) {
      const dx = colonist.path[0].x - colonist.x;
      const dy = colonist.path[0].y - colonist.y;
      const m = Math.hypot(dx, dy);
      if (m > 0.01) {
        fx = dx / m;
        fy = dy / m;
      }
    }

    // Perpendicular (sideways) unit vector for placing limbs / feet.
    const px = -fy;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.92, r * 0.95, r * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();

    if (selected) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // α29 followup: a Sanrio-style mascot — a big round head on a small,
    // round body, with stubby feet & arms, two simple wide-set eyes, rosy
    // cheeks and a tiny mouth. The face is billboarded so it stays cute and
    // natural whether the colonist walks down, left, right or away.
    const skin = '#f7d6a0';
    const skinShade = '#e0b87e';

    // Feet — two stubby ovals peeking out below the little body.
    ctx.fillStyle = bodyDark;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        cx + fx * r * 0.16 + px * s * r * 0.3,
        cy + fy * r * 0.12 + r * 0.92,
        r * 0.2, r * 0.14, 0, 0, Math.PI * 2,
      );
      ctx.fill();
    }

    // Body — a small, round chibi torso so the head reads big & cute
    // (Sanrio proportions: head ≈ body).
    const bodyR = r * 0.74;
    const bodyCY = cy + r * 0.34;
    const grad = ctx.createRadialGradient(cx - r * 0.26, bodyCY - r * 0.18, r * 0.15, cx, bodyCY, bodyR * 1.25);
    grad.addColorStop(0, bodyLight);
    grad.addColorStop(1, bodyDark);
    ctx.beginPath();
    ctx.ellipse(cx, bodyCY, bodyR, r * 0.74, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = outline;
    ctx.stroke();

    // Little arms — small round nubs on each side of the body.
    ctx.fillStyle = bodyLight;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + px * s * bodyR * 0.95, bodyCY - r * 0.02, r * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = outline;
      ctx.stroke();
    }

    // Head — a big round Sanrio-style head sitting high on the body and
    // leaning slightly toward the way the colonist walks.
    const hr = r * 0.92;
    const hx = cx + fx * r * 0.14;
    const hy = cy - r * 0.5 + Math.max(0, fy) * r * 0.05;
    const hgrad = ctx.createRadialGradient(hx - hr * 0.3, hy - hr * 0.35, hr * 0.15, hx, hy, hr);
    hgrad.addColorStop(0, skin);
    hgrad.addColorStop(1, skinShade);
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fillStyle = hgrad;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = outline;
    ctx.stroke();

    // Facing — show the face when looking toward the viewer (downward or to
    // the side); show the back of the head when walking away (upward), so the
    // eyes never sit on the back of the skull.
    const facingAway = fy < -0.4;
    if (facingAway) {
      ctx.beginPath();
      ctx.arc(hx, hy, hr, 0, Math.PI * 2);
      ctx.fillStyle = bodyDark;
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = outline;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy - hr * 0.28, hr * 0.5, Math.PI, 0);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();
    } else {
      // Hair — a soft cap in the group's dark colour over the top of the head.
      ctx.beginPath();
      ctx.arc(hx, hy, hr * 1.02, Math.PI * 1.06, Math.PI * 1.94);
      ctx.lineTo(hx + Math.cos(-Math.PI * 0.06) * hr, hy + Math.sin(-Math.PI * 0.06) * hr);
      ctx.arc(hx, hy - hr * 0.1, hr * 0.95, Math.PI * 1.94, Math.PI * 1.06, true);
      ctx.closePath();
      ctx.fillStyle = bodyDark;
      ctx.fill();

      // Face — Sanrio balance: two simple, wide-set dark eyes low on the big
      // head, rosy cheeks and a tiny mouth. The eyes are billboarded (always a
      // horizontal pair) and the whole face slides toward the facing
      // direction, so the colonist looks natural in every walk direction.
      // Walking sideways shrinks the trailing eye for a gentle 3/4 turn.
      const turn = Math.max(-1, Math.min(1, fx));
      const faceX = hx + turn * hr * 0.16;
      const faceY = hy + hr * 0.2 + Math.max(0, fy) * hr * 0.12;
      const eyeSpace = hr * 0.44 * (1 - Math.abs(turn) * 0.2);
      const eyeR = hr * 0.18;
      for (const s of [-1, 1]) {
        const lead = turn === 0 ? true : Math.sign(turn) === s;
        const sc = lead ? 1 : 0.72;
        const ex = faceX + eyeSpace * s;
        const ey = faceY;
        // a solid dark "bean" eye — the iconic simple Sanrio eye
        ctx.beginPath();
        ctx.ellipse(ex, ey, eyeR * sc, eyeR * 1.4 * sc, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#33240f';
        ctx.fill();
        // a tiny catch-light keeps the eye glossy and alive
        ctx.beginPath();
        ctx.arc(ex - eyeR * 0.22, ey - eyeR * 0.55, eyeR * 0.3 * sc, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();
      }
      // rosy cheeks just outside & below the eyes
      ctx.fillStyle = 'rgba(244,150,150,0.5)';
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(faceX + eyeSpace * 1.55 * s, faceY + hr * 0.14, hr * 0.12, 0, Math.PI * 2);
        ctx.fill();
      }
      // tiny mouth — a small soft curve centred under the eyes
      ctx.strokeStyle = 'rgba(120,70,50,0.85)';
      ctx.lineWidth = Math.max(1, hr * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(faceX, faceY + hr * 0.18, hr * 0.1, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    if (colonist.workProgress > 0) {
      const start = -Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.6, start, start + colonist.workProgress * Math.PI * 2);
      ctx.strokeStyle = '#ffe178';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // A health bar appears only once a colonist has been hurt.
    if (colonist.health < 1) {
      const bw = r * 2.2;
      const bh = Math.max(3, this.ts * 0.1);
      const bx = cx - bw / 2;
      const by = cy - r * 1.7;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      const h = Math.max(0, colonist.health);
      ctx.fillStyle = h > 0.5 ? '#5fc46f' : h > 0.25 ? '#e8b23c' : '#d2493a';
      ctx.fillRect(bx, by, bw * h, bh);
    }

    // A cold colonist shivers — pale-blue specks drift above the head.
    if (colonist.cold) {
      ctx.fillStyle = '#bfe4ff';
      for (const ox of [-0.52, 0, 0.52]) {
        ctx.beginPath();
        ctx.arc(cx + ox * r, cy - r * 2.0, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Wild animal dispatcher — each species has its own painter so a deer,
  // wolf or rabbit reads differently from a boar at a glance.
  _drawAnimal(cx, cy, species = 'boar') {
    switch (species) {
      case 'wolf':   return this._drawWolf(cx, cy);
      case 'bear':   return this._drawBear(cx, cy);
      case 'deer':   return this._drawDeer(cx, cy);
      case 'rabbit': return this._drawRabbit(cx, cy);
      case 'sheep':  return this._drawSheep(cx, cy);
      case 'fowl':   return this._drawFowl(cx, cy);
      case 'boar':
      default:       return this._drawBoar(cx, cy);
    }
  }

  // A wild boar: a bristled body on stubby legs, with a snout and a tusk.
  _drawBoar(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.34;
    const ry = ts * 0.22;

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.85, rx * 1.05, ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Legs.
    ctx.strokeStyle = '#2c2014';
    ctx.lineWidth = Math.max(1.6, ts * 0.07);
    for (const lx of [-0.55, -0.2, 0.25, 0.6]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * lx, cy + ry * 0.35);
      ctx.lineTo(cx + rx * lx, cy + ry * 1.05);
      ctx.stroke();
    }

    // Tail.
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.95, cy - ry * 0.1);
    ctx.quadraticCurveTo(cx - rx * 1.3, cy - ry * 0.15, cx - rx * 1.12, cy + ry * 0.4);
    ctx.stroke();

    // Body.
    const grad = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    grad.addColorStop(0, '#7d6450');
    grad.addColorStop(1, '#4f3d2c');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#2c2014';
    ctx.stroke();

    // Bristle ridge.
    ctx.strokeStyle = '#33271a';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (let i = 0; i <= 4; i++) {
      const bx = cx + rx * (-0.55 + (i / 4) * 0.85);
      ctx.moveTo(bx, cy - ry * 0.72);
      ctx.lineTo(bx, cy - ry * 1.08);
    }
    ctx.stroke();

    // Ear.
    ctx.fillStyle = '#4f3d2c';
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.32, cy - ry * 0.65);
    ctx.lineTo(cx + rx * 0.52, cy - ry * 1.15);
    ctx.lineTo(cx + rx * 0.62, cy - ry * 0.55);
    ctx.closePath();
    ctx.fill();

    // Snout.
    ctx.beginPath();
    ctx.arc(cx + rx * 0.92, cy + ry * 0.1, ry * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#3a2c1f';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#2c2014';
    ctx.stroke();
    ctx.fillStyle = '#1a130c'; // nostrils
    for (const ny of [-0.16, 0.16]) {
      ctx.beginPath();
      ctx.arc(cx + rx * 1.03, cy + ry * 0.1 + ny * ry, 0.8 + ts * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }

    // Tusk.
    ctx.strokeStyle = '#e8e0cf';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + rx * 0.78, cy + ry * 0.3);
    ctx.lineTo(cx + rx * 0.96, cy + ry * 0.52);
    ctx.stroke();

    // Eye.
    ctx.fillStyle = '#120d08';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.4, cy - ry * 0.22, 0.9 + ts * 0.03, 0, Math.PI * 2);
    ctx.fill();
  }

  // A deer: tan body, slender legs, white belly, antlers and ears.
  _drawDeer(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.34;
    const ry = ts * 0.20;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.95, rx * 1.05, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    // Slender legs.
    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = Math.max(1.2, ts * 0.05);
    for (const lx of [-0.55, -0.18, 0.22, 0.58]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * lx, cy + ry * 0.3);
      ctx.lineTo(cx + rx * lx, cy + ry * 1.1);
      ctx.stroke();
    }
    // Body (tan).
    ctx.fillStyle = '#a8804f';
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.05, cy, rx * 0.95, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#4d3820';
    ctx.stroke();
    // White belly stripe.
    ctx.fillStyle = '#e3c89a';
    ctx.beginPath();
    ctx.ellipse(cx - rx * 0.1, cy + ry * 0.35, rx * 0.7, ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Neck + head.
    ctx.fillStyle = '#a8804f';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.75, cy - ry * 0.35, rx * 0.32, ry * 0.55, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Ears.
    ctx.fillStyle = '#7d5e3a';
    for (const off of [-0.12, 0.12]) {
      ctx.beginPath();
      ctx.ellipse(cx + rx * 0.85 + off * rx, cy - ry * 0.95, rx * 0.08, ry * 0.22, off * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Small antlers.
    ctx.strokeStyle = '#5e4a2a';
    ctx.lineWidth = 1.4;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * 0.78 + side * rx * 0.05, cy - ry * 0.85);
      ctx.lineTo(cx + rx * 0.85 + side * rx * 0.15, cy - ry * 1.45);
      ctx.moveTo(cx + rx * 0.82 + side * rx * 0.1, cy - ry * 1.2);
      ctx.lineTo(cx + rx * 0.95 + side * rx * 0.2, cy - ry * 1.3);
      ctx.stroke();
    }
    // Eye.
    ctx.fillStyle = '#120d08';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.92, cy - ry * 0.4, 0.8 + ts * 0.025, 0, Math.PI * 2);
    ctx.fill();
    // Tail (white).
    ctx.fillStyle = '#f0e0bb';
    ctx.beginPath();
    ctx.arc(cx - rx * 0.95, cy - ry * 0.05, ts * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }

  // A wolf: grey body, sleeker than a boar, pointed ears, long snout.
  _drawWolf(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.36;
    const ry = ts * 0.20;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.95, rx * 1.05, ry * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    // Legs (longer than boar).
    ctx.strokeStyle = '#3a3a3e';
    ctx.lineWidth = Math.max(1.5, ts * 0.06);
    for (const lx of [-0.55, -0.18, 0.22, 0.58]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * lx, cy + ry * 0.25);
      ctx.lineTo(cx + rx * lx, cy + ry * 1.1);
      ctx.stroke();
    }
    // Tail — long and angled out behind.
    ctx.lineWidth = Math.max(2, ts * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.9, cy);
    ctx.quadraticCurveTo(cx - rx * 1.3, cy + ry * 0.1, cx - rx * 1.35, cy - ry * 0.5);
    ctx.stroke();
    // Body — leaner ellipse with gradient.
    const grad = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    grad.addColorStop(0, '#7a7a80');
    grad.addColorStop(1, '#3f3f45');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry * 0.95, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#2a2a30';
    ctx.stroke();
    // Head.
    ctx.fillStyle = '#5c5c63';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.85, cy - ry * 0.15, rx * 0.35, ry * 0.55, -0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Pointed ears.
    ctx.fillStyle = '#3a3a3e';
    for (const off of [-0.05, 0.18]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * (0.75 + off), cy - ry * 0.55);
      ctx.lineTo(cx + rx * (0.78 + off), cy - ry * 1.15);
      ctx.lineTo(cx + rx * (0.92 + off), cy - ry * 0.45);
      ctx.closePath();
      ctx.fill();
    }
    // Snout.
    ctx.fillStyle = '#2a2a30';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 1.1, cy + ry * 0.05, rx * 0.18, ry * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eye (yellow — predator).
    ctx.fillStyle = '#d8b73a';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.88, cy - ry * 0.32, 1.0 + ts * 0.025, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#120d08';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.88, cy - ry * 0.32, 0.5 + ts * 0.014, 0, Math.PI * 2);
    ctx.fill();
  }

  // A rabbit: small round body, long ears, white tail.
  _drawRabbit(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.20;
    const ry = ts * 0.16;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 1.1, rx * 1.1, ry * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // Body (round, sand colour).
    ctx.fillStyle = '#c8b08a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#6e5a3a';
    ctx.stroke();
    // Head.
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.85, cy - ry * 0.25, rx * 0.5, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#d4ba90';
    ctx.fill();
    ctx.stroke();
    // Long ears.
    ctx.fillStyle = '#c8b08a';
    for (const off of [-0.08, 0.18]) {
      ctx.beginPath();
      ctx.ellipse(cx + rx * (0.75 + off), cy - ry * 1.1, rx * 0.13, ry * 0.55, off * 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Inner ear (pink).
    ctx.fillStyle = '#e8b8a8';
    for (const off of [-0.08, 0.18]) {
      ctx.beginPath();
      ctx.ellipse(cx + rx * (0.75 + off), cy - ry * 1.1, rx * 0.06, ry * 0.4, off * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    // Tiny tail (white puffball).
    ctx.fillStyle = '#f4ecd6';
    ctx.beginPath();
    ctx.arc(cx - rx * 0.95, cy - ry * 0.05, ts * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.8;
    ctx.stroke();
    // Eye.
    ctx.fillStyle = '#120d08';
    ctx.beginPath();
    ctx.arc(cx + rx * 1.1, cy - ry * 0.35, 0.7 + ts * 0.02, 0, Math.PI * 2);
    ctx.fill();
  }

  // A bear: hulking dark-brown body, broad shoulders, rounded ears,
  // short snout. Larger than a boar so it reads as the apex predator.
  _drawBear(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.40;
    const ry = ts * 0.26;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.85, rx * 1.1, ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // Stubby legs.
    ctx.strokeStyle = '#2a1a10';
    ctx.lineWidth = Math.max(2, ts * 0.09);
    for (const lx of [-0.55, -0.18, 0.22, 0.58]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * lx, cy + ry * 0.4);
      ctx.lineTo(cx + rx * lx, cy + ry * 1.05);
      ctx.stroke();
    }
    // Body — dark brown with a deeper shoulder gradient.
    const grad = ctx.createLinearGradient(cx, cy - ry, cx, cy + ry);
    grad.addColorStop(0, '#5a3a20');
    grad.addColorStop(1, '#2e1c0e');
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = '#1a0f06';
    ctx.stroke();
    // Head (large, set close to the body — no neck).
    ctx.fillStyle = '#4a2f1a';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.88, cy - ry * 0.05, rx * 0.42, ry * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Rounded ears (signature bear silhouette).
    ctx.fillStyle = '#3a2414';
    for (const off of [-0.05, 0.18]) {
      ctx.beginPath();
      ctx.arc(cx + rx * (0.78 + off), cy - ry * 0.5, ts * 0.06, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Snout.
    ctx.fillStyle = '#1a0f06';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 1.18, cy + ry * 0.05, rx * 0.14, ry * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eye.
    ctx.fillStyle = '#0a0604';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.95, cy - ry * 0.18, 1.0 + ts * 0.025, 0, Math.PI * 2);
    ctx.fill();
  }

  // A sheep: woolly cloud-shaped body in cream, with a small dark face
  // and short legs. Reads as a peaceful, domesticable grazer.
  _drawSheep(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.30;
    const ry = ts * 0.22;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.24)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.95, rx * 1.05, ry * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    // Short legs.
    ctx.strokeStyle = '#2a2018';
    ctx.lineWidth = Math.max(1.4, ts * 0.06);
    for (const lx of [-0.45, -0.15, 0.15, 0.45]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * lx, cy + ry * 0.5);
      ctx.lineTo(cx + rx * lx, cy + ry * 1.1);
      ctx.stroke();
    }
    // Fluffy wool — a base ellipse with overlapping bumps along the top.
    ctx.fillStyle = '#f4ecdc';
    ctx.strokeStyle = '#9c8d70';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const off of [-0.55, -0.2, 0.15, 0.5]) {
      ctx.beginPath();
      ctx.arc(cx + rx * off, cy - ry * 0.55, ts * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    // Dark face (sheep face hangs out at the front of the wool).
    ctx.fillStyle = '#3a2c1f';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.85, cy + ry * 0.05, rx * 0.22, ry * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tiny ear.
    ctx.fillStyle = '#3a2c1f';
    ctx.beginPath();
    ctx.ellipse(cx + rx * 0.65, cy - ry * 0.28, ts * 0.04, ts * 0.06, -0.4, 0, Math.PI * 2);
    ctx.fill();
    // Eye.
    ctx.fillStyle = '#f4ecdc';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.95, cy - ry * 0.05, 0.7 + ts * 0.018, 0, Math.PI * 2);
    ctx.fill();
  }

  // A fowl: small round body with a curved beak and a red comb on top.
  // Reads at a glance as poultry — the future-domestication candidate.
  _drawFowl(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.18;
    const ry = ts * 0.18;
    // Shadow.
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 1.0, rx * 1.1, ry * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // Two thin yellow legs.
    ctx.strokeStyle = '#d8a23a';
    ctx.lineWidth = Math.max(1.2, ts * 0.05);
    for (const lx of [-0.25, 0.25]) {
      ctx.beginPath();
      ctx.moveTo(cx + rx * lx, cy + ry * 0.5);
      ctx.lineTo(cx + rx * lx, cy + ry * 1.0);
      ctx.stroke();
    }
    // Round body — warm tan.
    ctx.fillStyle = '#e6c277';
    ctx.strokeStyle = '#7e5a24';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // Head — slightly forward and up.
    ctx.beginPath();
    ctx.arc(cx + rx * 0.55, cy - ry * 0.5, rx * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#e6c277';
    ctx.fill();
    ctx.stroke();
    // Red comb on top of the head.
    ctx.fillStyle = '#c43b3b';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.4, cy - ry * 0.9, ts * 0.045, 0, Math.PI * 2);
    ctx.arc(cx + rx * 0.6, cy - ry * 0.95, ts * 0.05, 0, Math.PI * 2);
    ctx.arc(cx + rx * 0.78, cy - ry * 0.85, ts * 0.04, 0, Math.PI * 2);
    ctx.fill();
    // Beak — a small orange triangle.
    ctx.fillStyle = '#e88a2a';
    ctx.beginPath();
    ctx.moveTo(cx + rx * 1.0, cy - ry * 0.45);
    ctx.lineTo(cx + rx * 1.25, cy - ry * 0.4);
    ctx.lineTo(cx + rx * 1.0, cy - ry * 0.3);
    ctx.closePath();
    ctx.fill();
    // Tail feather (one cocked up at the back).
    ctx.strokeStyle = '#7e5a24';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.9, cy - ry * 0.1);
    ctx.quadraticCurveTo(cx - rx * 1.3, cy - ry * 0.6, cx - rx * 1.05, cy - ry * 0.85);
    ctx.stroke();
    // Eye.
    ctx.fillStyle = '#120d08';
    ctx.beginPath();
    ctx.arc(cx + rx * 0.7, cy - ry * 0.55, 0.6 + ts * 0.015, 0, Math.PI * 2);
    ctx.fill();
  }
}
