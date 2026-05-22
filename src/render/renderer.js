// Canvas 2D rendering: the visible slice of the map, tilled soil, plants
// and crops, queued tasks, and the colonists with their paths.

import { TileType } from '../map/tile.js';
import { PlantKind } from '../world.js';
import { TaskType, WORK_TYPES } from '../tasks.js';
import { getCrop } from '../crops.js';

const lerp = (a, b, t) => a + (b - a) * t;

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
    this.ts = scene.tileSize;
    const ctx = this.ctx;
    const ts = this.ts;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const colorOf = VIEW_MODES[mode] || VIEW_MODES.terrain;

    ctx.clearRect(0, 0, cw, ch);

    const sx = (wx) => (wx - camera.x) * ts;
    const sy = (wy) => (wy - camera.y) * ts;

    const startCol = Math.floor(camera.x);
    const startRow = Math.floor(camera.y);
    const offX = (camera.x - startCol) * ts;
    const offY = (camera.y - startRow) * ts;
    const visCols = camera.viewCols + 1;
    const visRows = camera.viewRows + 1;

    // --- tiles (with tilled-soil furrows) ---
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
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
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

    // --- structures (fences, huts, stockpiles) ---
    for (let row = 0; row < visRows; row++) {
      const mapY = startRow + row;
      if (mapY < 0 || mapY >= map.rows) continue;
      for (let col = 0; col < visCols; col++) {
        const mapX = startCol + col;
        if (mapX < 0 || mapX >= map.cols) continue;
        const structure = map.tiles[mapY][mapX].structure;
        if (structure) {
          this._drawStructure(structure, col * ts - offX, row * ts - offY);
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

  // A built structure, drawn from the tile's top-left corner (px, py).
  _drawStructure(structure, px, py) {
    const ctx = this.ctx;
    const ts = this.ts;
    if (structure === 'stockpile') {
      ctx.fillStyle = 'rgba(190,160,95,0.35)';
      ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
      ctx.strokeStyle = '#b9923f';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(px + 2.5, py + 2.5, ts - 5, ts - 5);
      ctx.setLineDash([]);
      ctx.fillStyle = '#a9762f';
      ctx.fillRect(px + ts * 0.34, py + ts * 0.34, ts * 0.32, ts * 0.32);
      ctx.strokeStyle = '#6e4a18';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + ts * 0.34, py + ts * 0.34, ts * 0.32, ts * 0.32);
      return;
    }
    if (structure === 'hut') {
      ctx.fillStyle = '#caa06a';
      ctx.fillRect(px + ts * 0.22, py + ts * 0.4, ts * 0.56, ts * 0.42);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#5a3a1e';
      ctx.strokeRect(px + ts * 0.22, py + ts * 0.4, ts * 0.56, ts * 0.42);
      ctx.fillStyle = '#8a4f2c';
      ctx.beginPath();
      ctx.moveTo(px + ts * 0.12, py + ts * 0.42);
      ctx.lineTo(px + ts * 0.5, py + ts * 0.13);
      ctx.lineTo(px + ts * 0.88, py + ts * 0.42);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#5a3a1e';
      ctx.fillRect(px + ts * 0.43, py + ts * 0.58, ts * 0.14, ts * 0.24);
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
    const ctx = this.ctx;
    const ts = this.ts;
    const crop = getCrop(plant.cropId);
    const g = Math.min(1, plant.growth);
    const ripe = g >= 1;

    const base = cy + ts * 0.3;
    const stemH = ts * (0.16 + 0.42 * g);
    const top = base - stemH;

    ctx.strokeStyle = '#3f7a2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, base);
    ctx.lineTo(cx, top);
    ctx.stroke();

    if (g > 0.2) {
      ctx.fillStyle = '#5ba23c';
      const leafY = base - stemH * 0.55;
      const leafR = ts * 0.13;
      for (const ox of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + ox * leafR, leafY, leafR, leafR * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (g > 0.45) {
      const r = ts * (0.05 + 0.18 * g);
      ctx.beginPath();
      ctx.arc(cx, top, r, 0, Math.PI * 2);
      ctx.fillStyle = ripe ? crop.ripeColor : crop.color;
      ctx.fill();
      if (ripe) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (watered) {
      ctx.fillStyle = '#5ba8d8';
      ctx.beginPath();
      ctx.arc(cx + ts * 0.26, cy - ts * 0.24, ts * 0.07, 0, Math.PI * 2);
      ctx.fill();
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

  // A small top-down figure; a progress ring while it works. `selected`
  // marks the colonist the player's work orders are currently directed at.
  _drawColonist(colonist, cx, cy, selected) {
    const ctx = this.ctx;
    const r = this.ts * 0.34;

    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    if (selected) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.32, 0, Math.PI * 2);
      ctx.strokeStyle = '#7fd4ff';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#e8a23c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#3a2606';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.52, 0, Math.PI * 2);
    ctx.fillStyle = '#f6cf94';
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
  }

  // A wild boar: a dark, low oval body with a blunt snout.
  _drawAnimal(cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    const rx = ts * 0.36;
    const ry = ts * 0.24;

    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + ry * 0.7, rx, ry * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#6b5440';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#2c2014';
    ctx.stroke();

    // Snout.
    ctx.beginPath();
    ctx.arc(cx + rx * 0.85, cy, ry * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = '#4a3829';
    ctx.fill();
    ctx.stroke();

    // Bristle ridge.
    ctx.strokeStyle = '#3a2c1e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx - rx * 0.5, cy - ry * 0.7);
    ctx.lineTo(cx + rx * 0.3, cy - ry * 0.7);
    ctx.stroke();
  }
}
