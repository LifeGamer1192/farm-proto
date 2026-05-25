// Canvas 2D rendering: the visible slice of the map, tilled soil, plants
// and crops, queued tasks, and the colonists with their paths.

import { TileType } from '../map/tile.js';
import { PlantKind } from '../world.js';
import { TaskType, WORK_TYPES } from '../tasks.js';
import { getCrop } from '../crops.js';
import { phenotype, partIndex } from '../genetics.js';

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

function mix(c1, c2, t) {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r},${g},${b})`;
}

const VIEW_MODES = {
  terrain(tile) {
    if (tile.type === TileType.WATER) {
      return mix([92, 152, 200], [28, 66, 122], 1 - tile.elevation);
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

    const sx = (wx) => (wx - camera.x) * ts;
    const sy = (wy) => (wy - camera.y) * ts;

    const startCol = Math.floor(camera.x);
    const startRow = Math.floor(camera.y);
    const offX = (camera.x - startCol) * ts;
    const offY = (camera.y - startRow) * ts;
    const visCols = camera.viewCols + 1;
    const visRows = camera.viewRows + 1;

    // --- tiles (with terrain texture and tilled-soil furrows) ---
    for (let row = 0; row < visRows; row++) {
      const mapY = startRow + row;
      if (mapY < 0 || mapY >= map.rows) continue;
      for (let col = 0; col < visCols; col++) {
        const mapX = startCol + col;
        if (mapX < 0 || mapX >= map.cols) continue;
        const tile = map.tiles[mapY][mapX];
        const px = col * ts - offX;
        const py = row * ts - offY;
        ctx.fillStyle = colorOf(tile);
        ctx.fillRect(px, py, ts, ts);
        if (detailed) this._terrainDetail(tile, map, mapX, mapY, px, py);
        if (tile.tilled && tile.type === TileType.LAND) {
          ctx.strokeStyle = 'rgba(60,40,20,0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let f = 1; f <= 3; f++) {
            const fy = py + (ts * f) / 4;
            ctx.moveTo(px + 2, fy);
            ctx.lineTo(px + ts - 2, fy);
          }
          ctx.stroke();
        }
      }
    }

    // --- grid lines ---
    ctx.strokeStyle = 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 0; col <= visCols; col++) {
      const x = Math.round(col * ts - offX) + 0.5;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, ch);
    }
    for (let row = 0; row <= visRows; row++) {
      const y = Math.round(row * ts - offY) + 0.5;
      ctx.moveTo(0, y);
      ctx.lineTo(cw, y);
    }
    ctx.stroke();

    // --- seasonal tint ---
    if (scene.seasonTint) {
      ctx.fillStyle = scene.seasonTint;
      ctx.fillRect(0, 0, cw, ch);
    }

    // --- structures (fences, huts, warehouses, hearths) ---
    for (let row = 0; row < visRows; row++) {
      const mapY = startRow + row;
      if (mapY < 0 || mapY >= map.rows) continue;
      for (let col = 0; col < visCols; col++) {
        const mapX = startCol + col;
        if (mapX < 0 || mapX >= map.cols) continue;
        const structure = map.tiles[mapY][mapX].structure;
        if (structure) {
          this._drawStructure(structure, col * ts - offX, row * ts - offY, hearthsLit);
        }
      }
    }

    // --- plants & crops ---
    for (let row = 0; row < visRows; row++) {
      const mapY = startRow + row;
      if (mapY < 0 || mapY >= map.rows) continue;
      for (let col = 0; col < visCols; col++) {
        const mapX = startCol + col;
        if (mapX < 0 || mapX >= map.cols) continue;
        const plant = map.tiles[mapY][mapX].plant;
        if (plant) {
          const cx = col * ts - offX + ts / 2;
          const cy = row * ts - offY + ts / 2;
          const watered = plant.kind === PlantKind.CROP && scene.clock < plant.wateredUntil;
          this._drawPlant(plant, cx, cy, watered);
        }
      }
    }

    // --- task markers: queued tasks, then each colonist's active work ---
    for (let i = 0; i < taskQueue.length; i++) {
      const task = taskQueue[i];
      this._drawTaskMarker(task, sx(task.x), sy(task.y), false, i + 1);
    }
    for (const c of colonists) {
      const task = c.currentTask;
      if (task && WORK_TYPES.includes(task.type)) {
        this._drawTaskMarker(task, sx(task.x), sy(task.y), true, 0);
      }
    }

    // --- colonist paths ---
    for (const c of colonists) {
      if (c.path.length === 0) continue;
      const strolling = c.state === 'strolling';
      ctx.strokeStyle = strolling ? 'rgba(206,214,228,0.5)' : 'rgba(232,162,60,0.9)';
      ctx.lineWidth = strolling ? 2 : 3;
      ctx.setLineDash(strolling ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(sx(c.x + 0.5), sy(c.y + 0.5));
      for (const wp of c.path) ctx.lineTo(sx(wp.x + 0.5), sy(wp.y + 0.5));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- hovered tile ---
    if (hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(hover.x) + 1, sy(hover.y) + 1, ts - 2, ts - 2);
    }

    // --- wild animals ---
    if (animals) {
      for (const a of animals) {
        this._drawAnimal(sx(a.x + 0.5), sy(a.y + 0.5));
      }
    }

    // --- colonists ---
    for (const c of colonists) {
      this._drawColonist(c, sx(c.x + 0.5), sy(c.y + 0.5), c.name === selectedColonist);
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

  // A built structure, drawn from the tile's top-left corner (px, py).
  _drawStructure(structure, px, py, hearthsLit) {
    const ctx = this.ctx;
    const ts = this.ts;

    if (structure === 'hearth') {
      const mx = px + ts * 0.5;
      const my = py + ts * 0.52;
      if (hearthsLit) {
        const glow = ctx.createRadialGradient(mx, my, ts * 0.08, mx, my, ts * 0.62);
        glow.addColorStop(0, 'rgba(255,170,60,0.5)');
        glow.addColorStop(1, 'rgba(255,170,60,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(px - ts * 0.3, py - ts * 0.3, ts * 1.6, ts * 1.6);
      }
      // Ring of individual stones.
      ctx.strokeStyle = '#4a4a4a';
      ctx.lineWidth = 1;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        ctx.fillStyle = i % 2 ? '#888' : '#6f6f6f';
        ctx.beginPath();
        ctx.arc(mx + Math.cos(ang) * ts * 0.32, my + Math.sin(ang) * ts * 0.32, ts * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = '#221c18'; // ash pit
      ctx.beginPath();
      ctx.arc(mx, my, ts * 0.21, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a5230'; // crossed logs
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(mx - ts * 0.16, my + ts * 0.12);
      ctx.lineTo(mx + ts * 0.16, my - ts * 0.12);
      ctx.moveTo(mx - ts * 0.16, my - ts * 0.12);
      ctx.lineTo(mx + ts * 0.16, my + ts * 0.12);
      ctx.stroke();
      if (hearthsLit) {
        for (const [w, h, col] of [
          [0.2, 0.52, '#e8590f'],
          [0.13, 0.38, '#f59a1e'],
          [0.07, 0.22, '#ffd751'],
        ]) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(mx, my - ts * h);
          ctx.quadraticCurveTo(mx + ts * w, my - ts * h * 0.3, mx, my + ts * 0.04);
          ctx.quadraticCurveTo(mx - ts * w, my - ts * h * 0.3, mx, my - ts * h);
          ctx.fill();
        }
      }
      return;
    }

    if (structure === 'stockpile') {
      // A warehouse — a plank-walled barn with a gabled roof and a wide door.
      const ix = px + ts * 0.5;
      ctx.fillStyle = '#bd8e52';
      ctx.fillRect(px + ts * 0.16, py + ts * 0.42, ts * 0.68, ts * 0.42);
      ctx.strokeStyle = '#5e3f1c';
      ctx.lineWidth = 1.4;
      ctx.strokeRect(px + ts * 0.16, py + ts * 0.42, ts * 0.68, ts * 0.42);
      ctx.strokeStyle = 'rgba(94,63,28,0.4)'; // plank lines
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + ts * 0.16, py + ts * 0.56);
      ctx.lineTo(px + ts * 0.84, py + ts * 0.56);
      ctx.moveTo(px + ts * 0.16, py + ts * 0.7);
      ctx.lineTo(px + ts * 0.84, py + ts * 0.7);
      ctx.stroke();
      ctx.fillStyle = '#7a4f24'; // gabled roof
      ctx.beginPath();
      ctx.moveTo(px + ts * 0.09, py + ts * 0.44);
      ctx.lineTo(px + ts * 0.5, py + ts * 0.19);
      ctx.lineTo(px + ts * 0.91, py + ts * 0.44);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#3f2a12';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.fillStyle = '#6e4a22'; // double door
      ctx.fillRect(ix - ts * 0.15, py + ts * 0.54, ts * 0.3, ts * 0.3);
      ctx.strokeStyle = '#3f2a12';
      ctx.lineWidth = 1;
      ctx.strokeRect(ix - ts * 0.15, py + ts * 0.54, ts * 0.3, ts * 0.3);
      ctx.beginPath();
      ctx.moveTo(ix, py + ts * 0.54);
      ctx.lineTo(ix, py + ts * 0.84);
      ctx.stroke();
      return;
    }

    if (structure === 'hut') {
      ctx.fillStyle = '#caa06a'; // body
      ctx.fillRect(px + ts * 0.26, py + ts * 0.44, ts * 0.48, ts * 0.38);
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = '#5a3a1e';
      ctx.strokeRect(px + ts * 0.26, py + ts * 0.44, ts * 0.48, ts * 0.38);
      ctx.fillStyle = '#8a4f2c'; // roof
      ctx.beginPath();
      ctx.moveTo(px + ts * 0.16, py + ts * 0.46);
      ctx.lineTo(px + ts * 0.5, py + ts * 0.14);
      ctx.lineTo(px + ts * 0.84, py + ts * 0.46);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,222,170,0.45)'; // roof highlight
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + ts * 0.5, py + ts * 0.14);
      ctx.lineTo(px + ts * 0.31, py + ts * 0.45);
      ctx.stroke();
      ctx.fillStyle = '#4a3018'; // door
      ctx.fillRect(px + ts * 0.43, py + ts * 0.58, ts * 0.14, ts * 0.24);
      ctx.fillStyle = '#e8c873'; // lit window
      ctx.fillRect(px + ts * 0.6, py + ts * 0.52, ts * 0.1, ts * 0.1);
      ctx.strokeStyle = '#5a3a1e';
      ctx.strokeRect(px + ts * 0.6, py + ts * 0.52, ts * 0.1, ts * 0.1);
      return;
    }

    // fence — corner posts joined by crossed rails.
    ctx.strokeStyle = '#9a7042';
    ctx.lineWidth = 2;
    const a = ts * 0.18;
    const b = ts * 0.82;
    ctx.strokeRect(px + a, py + a, b - a, b - a);
    ctx.beginPath();
    ctx.moveTo(px + a, py + a);
    ctx.lineTo(px + b, py + b);
    ctx.moveTo(px + b, py + a);
    ctx.lineTo(px + a, py + b);
    ctx.stroke();
    ctx.fillStyle = '#6e4a26';
    for (const [fx, fy] of [
      [a, a],
      [b, a],
      [a, b],
      [b, b],
    ]) {
      ctx.fillRect(px + fx - ts * 0.07, py + fy - ts * 0.07, ts * 0.14, ts * 0.14);
    }
  }

  _drawPlant(plant, cx, cy, watered) {
    if (plant.kind === PlantKind.WILD) {
      this._drawWild(cx, cy);
    } else if (plant.kind === PlantKind.TREE) {
      this._drawTree(plant, cx, cy);
    } else if (plant.kind === PlantKind.STUMP) {
      this._drawStump(cx, cy);
    } else {
      this._drawCrop(plant, cx, cy, watered);
    }
  }

  _drawWild(cx, cy) {
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

  // A tree: a brown trunk with a green leafy crown on top. Young trees
  // (growth < 1) draw smaller — a fresh sprout that grows over time.
  _drawTree(plant, cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const g = Math.max(0.25, Math.min(1, plant.growth || 1));
    const trunkH = ts * 0.32 * g;
    const trunkW = Math.max(1.2, ts * 0.09 * g);
    const baseY = cy + ts * 0.34;
    // Trunk.
    ctx.fillStyle = '#5a3a20';
    ctx.fillRect(cx - trunkW * 0.5, baseY - trunkH, trunkW, trunkH);
    ctx.strokeStyle = '#3b2614';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - trunkW * 0.5, baseY - trunkH, trunkW, trunkH);
    // Leafy crown — three overlapping circles to suggest a canopy.
    const cr = ts * 0.22 * g;
    const crownY = baseY - trunkH - cr * 0.4;
    ctx.fillStyle = '#2f6b34';
    ctx.strokeStyle = '#19401f';
    for (const [ox, oy] of [
      [-cr * 0.55, cr * 0.25],
      [cr * 0.55, cr * 0.25],
      [0, -cr * 0.45],
    ]) {
      ctx.beginPath();
      ctx.arc(cx + ox, crownY + oy, cr * 0.75, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // A stump: a low, flat brown ellipse where a tree used to stand.
  _drawStump(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const baseY = cy + ts * 0.3;
    ctx.fillStyle = '#6b4a2d';
    ctx.strokeStyle = '#3b2614';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, ts * 0.16, ts * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    // A few growth rings.
    ctx.strokeStyle = '#4d3320';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.ellipse(cx, baseY, ts * 0.1, ts * 0.05, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, baseY, ts * 0.05, ts * 0.025, 0, 0, Math.PI * 2);
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
    // Root vegetables, tubers and bulbs draw a slice of the harvest BELOW
    // the soil-line anchor. In a real tile the tile background sits behind
    // them; in the bare preview canvas they would clip off the bottom edge,
    // so lift the anchor up to keep the whole plant inside the box.
    const cat = crop && crop.category;
    const cyMul = cat === 'tuber' || cat === 'root' || cat === 'bulb' ? 0.55 : 0.66;
    this._paintCrop(ctx, h * 0.82, cropId, genome, 1, w / 2, h * cyMul);
  }

  // Compose a crop from its genome: a stem, leaves and fruit, with the
  // fruit shape, leaf style, surface, colour and speckling all gene-driven.
  // Dispatch by crop category — each plant family has its own silhouette.
  _paintCrop(ctx, ts, cropId, genome, growth, cx, cy) {
    const crop = getCrop(cropId);
    switch (crop.category) {
      case 'grain':    return this._paintGrain(ctx, ts, crop, genome, growth, cx, cy);
      case 'legume':   return this._paintLegume(ctx, ts, crop, genome, growth, cx, cy);
      case 'root':     return this._paintRoot(ctx, ts, crop, genome, growth, cx, cy);
      case 'tuber':    return this._paintTuber(ctx, ts, crop, genome, growth, cx, cy);
      case 'bulb':     return this._paintBulb(ctx, ts, crop, genome, growth, cx, cy);
      case 'leaf':     return this._paintLeafMass(ctx, ts, crop, genome, growth, cx, cy);
      case 'stem':     return this._paintStemVeg(ctx, ts, crop, genome, growth, cx, cy);
      case 'flower':   return this._paintFlowerVeg(ctx, ts, crop, genome, growth, cx, cy);
      case 'fruit':    return this._paintFruitBearing(ctx, ts, crop, genome, growth, cx, cy, 1.2);
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

  // Fruit-bearing crops (tomato, eggplant, pepper, strawberry, melon...).
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

  // Grains: stalks topped with a seed head once they ripen.
  _paintGrain(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.32;
    const stemH = ts * (0.2 + 0.52 * g);
    // Three or four stalks side by side.
    ctx.strokeStyle = ripe ? '#bba85a' : '#7ab44d';
    ctx.lineWidth = Math.max(1.2, ts * 0.06);
    ctx.lineCap = 'round';
    for (const off of [-0.18, 0, 0.18]) {
      ctx.beginPath();
      ctx.moveTo(cx + ts * off, base);
      ctx.lineTo(cx + ts * off * 0.6, base - stemH);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (g > 0.6) {
      const fill = this._ripeFill(crop, look, ripe);
      // Small seed heads at the top of each stalk.
      for (const off of [-0.18, 0, 0.18]) {
        const hx = cx + ts * off * 0.6;
        const hy = base - stemH;
        const w = ts * 0.08 * (0.8 + look.yieldP * 0.5);
        const h = ts * 0.22 * (0.7 + look.yieldP * 0.6);
        ctx.beginPath();
        ctx.ellipse(hx, hy - h * 0.4, w, h * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        if (ripe) {
          // Awns — tiny lines at the top to suggest bristles.
          ctx.strokeStyle = tintColor(crop.ripeColor, (look.hueP - 0.5) * 200, 0.6);
          ctx.lineWidth = 0.8;
          for (const d of [-0.7, -0.35, 0, 0.35, 0.7]) {
            ctx.beginPath();
            ctx.moveTo(hx + w * d, hy - h * 0.7);
            ctx.lineTo(hx + w * d, hy - h * 1.1);
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

  // Bulbs: a rounded bulb at the base with narrow green leaves shooting up.
  _paintBulb(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.34;
    ctx.strokeStyle = '#5fa84a';
    ctx.lineWidth = Math.max(1.2, ts * 0.05);
    ctx.lineCap = 'round';
    const stemH = ts * (0.18 + 0.34 * g);
    for (const off of [-0.06, 0, 0.06]) {
      ctx.beginPath();
      ctx.moveTo(cx + ts * off, base);
      ctx.lineTo(cx + ts * off * 0.4, base - stemH);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (g > 0.5) {
      const fill = this._ripeFill(crop, look, ripe);
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.28)';
      ctx.lineWidth = 1;
      const r = ts * 0.14 * (0.8 + look.yieldP * 0.5);
      ctx.beginPath();
      ctx.ellipse(cx, base + ts * 0.04, r, r * 0.85, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
    const r = ts * (0.14 + 0.22 * g);
    ctx.fillStyle = fill;
    ctx.strokeStyle = '#3f7a2b';
    ctx.lineWidth = 1;
    // Stack of overlapping leaf lobes.
    for (const off of [-0.5, 0, 0.5]) {
      ctx.beginPath();
      ctx.ellipse(cx + r * off * 0.6, base - r * 0.4, r * 0.85, r * 0.65, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Stem vegetables: a few thick stems clustered together.
  _paintStemVeg(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const fill = this._ripeFill(crop, look, ripe);
    const base = cy + ts * 0.32;
    const stemH = ts * (0.22 + 0.48 * g);
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(1.6, ts * 0.07);
    ctx.lineCap = 'round';
    for (const off of [-0.12, 0, 0.12]) {
      ctx.beginPath();
      ctx.moveTo(cx + ts * off, base);
      ctx.lineTo(cx + ts * off * 0.6, base - stemH);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    if (g > 0.4) {
      // A small leafy crown at the top.
      ctx.fillStyle = '#5ba23c';
      ctx.beginPath();
      ctx.ellipse(cx, base - stemH - ts * 0.04, ts * 0.12, ts * 0.06, 0, 0, Math.PI * 2);
      ctx.fill();
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

  // Nuts: stem with a cluster of small nuts at the top.
  _paintNutCluster(ctx, ts, crop, genome, growth, cx, cy) {
    const g = Math.min(1, growth);
    const ripe = g >= 1;
    const look = this._cropLook(genome);
    const base = cy + ts * 0.3;
    const stemH = ts * (0.2 + 0.4 * g);
    this._drawStem(ctx, ts, cx, base, stemH, 0.08);
    if (g > 0.25) {
      const leafY = base - stemH * 0.55;
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, -1);
      this._drawLeaf(ctx, cx, leafY, ts, look.leafIdx, 1);
    }
    if (g > 0.6) {
      const fill = this._ripeFill(crop, look, ripe);
      const top = base - stemH;
      const nr = ts * 0.07 * (0.8 + look.yieldP * 0.5);
      ctx.fillStyle = fill;
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 0.8;
      for (const [ox, oy] of [[-0.7, 0.4], [0.7, 0.4], [-0.2, -0.4], [0.6, -0.2]]) {
        ctx.beginPath();
        ctx.arc(cx + nr * ox * 2, top + nr * oy * 2, nr, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // One leaf, on the given side (-1 / +1) of the stem.
  _drawLeaf(ctx, cx, leafY, ts, idx, side) {
    ctx.fillStyle = '#5ba23c';
    const lr = ts * 0.15;
    if (idx === 0) {
      ctx.beginPath(); // broad
      ctx.ellipse(cx + side * lr, leafY, lr, lr * 0.62, side * 0.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (idx === 1) {
      ctx.beginPath(); // narrow
      ctx.ellipse(cx + side * lr * 1.05, leafY, lr * 1.2, lr * 0.32, side * 0.85, 0, Math.PI * 2);
      ctx.fill();
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
    }
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
    ctx.fillStyle = fill;
    ctx.fill();

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
  _drawColonist(colonist, cx, cy, selected) {
    const ctx = this.ctx;
    const r = this.ts * 0.33;

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

    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.8, r * 0.95, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    if (selected) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2);
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Feet — two dots set across the facing direction.
    ctx.fillStyle = '#3a2606';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(
        cx + fx * r * 0.5 - fy * s * r * 0.42,
        cy + fy * r * 0.5 + fx * s * r * 0.42,
        r * 0.2,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Body — a rounded torso with a soft top-down highlight.
    const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.2, cx, cy, r);
    grad.addColorStop(0, '#f3c277');
    grad.addColorStop(1, '#c47f1e');
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#3a2606';
    ctx.stroke();

    // Head — offset toward the facing direction.
    const hx = cx + fx * r * 0.36;
    const hy = cy + fy * r * 0.36;
    ctx.beginPath();
    ctx.arc(hx, hy, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#f7d6a0';
    ctx.fill();
    ctx.stroke();

    if (colonist.workProgress > 0) {
      const start = -Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, start, start + colonist.workProgress * Math.PI * 2);
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
        ctx.arc(cx + ox * r, cy - r * 1.28, r * 0.17, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // A wild boar: a bristled body on stubby legs, with a snout and a tusk.
  _drawAnimal(cx, cy) {
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
}
