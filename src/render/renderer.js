// Canvas 2D rendering: the visible slice of the map, plants, queued tasks,
// the colonist and its path.

import { TileType } from '../map/tile.js';
import { PlantKind } from '../world.js';
import { TaskType } from '../tasks.js';

const lerp = (a, b, t) => a + (b - a) * t;

// Linearly blend two [r,g,b] colors into a CSS rgb() string.
function mix(c1, c2, t) {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r},${g},${b})`;
}

// Each view mode maps a tile to a fill color.
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
  [TaskType.PLANT]: '#6fc46f',
};

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} tileSize
   */
  constructor(canvas, tileSize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ts = tileSize;
  }

  /**
   * Draw one frame from a scene description.
   * @param {object} scene { map, camera, mode, colonist, hover,
   *                          taskQueue, currentTask }
   */
  draw(scene) {
    const { map, camera, mode, colonist, hover, taskQueue, currentTask } = scene;
    const ctx = this.ctx;
    const ts = this.ts;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const colorOf = VIEW_MODES[mode] || VIEW_MODES.terrain;

    ctx.clearRect(0, 0, cw, ch);

    // World tile -> screen pixel of its top-left corner.
    const sx = (wx) => (wx - camera.x) * ts;
    const sy = (wy) => (wy - camera.y) * ts;

    const startCol = Math.floor(camera.x);
    const startRow = Math.floor(camera.y);
    const offX = (camera.x - startCol) * ts;
    const offY = (camera.y - startRow) * ts;
    const visCols = camera.viewCols + 1;
    const visRows = camera.viewRows + 1;

    // --- tiles ---
    for (let row = 0; row < visRows; row++) {
      const mapY = startRow + row;
      if (mapY < 0 || mapY >= map.rows) continue;
      for (let col = 0; col < visCols; col++) {
        const mapX = startCol + col;
        if (mapX < 0 || mapX >= map.cols) continue;
        ctx.fillStyle = colorOf(map.tiles[mapY][mapX]);
        ctx.fillRect(col * ts - offX, row * ts - offY, ts, ts);
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

    // --- plants ---
    for (let row = 0; row < visRows; row++) {
      const mapY = startRow + row;
      if (mapY < 0 || mapY >= map.rows) continue;
      for (let col = 0; col < visCols; col++) {
        const mapX = startCol + col;
        if (mapX < 0 || mapX >= map.cols) continue;
        const plant = map.tiles[mapY][mapX].plant;
        if (plant) {
          this._drawPlant(plant, col * ts - offX + ts / 2, row * ts - offY + ts / 2);
        }
      }
    }

    // --- queued task markers ---
    for (let i = 0; i < taskQueue.length; i++) {
      const task = taskQueue[i];
      this._drawTaskMarker(task, sx(task.x), sy(task.y), false, i + 1);
    }
    if (currentTask) {
      this._drawTaskMarker(currentTask, sx(currentTask.x), sy(currentTask.y), true, 0);
    }

    // --- the colonist's path ---
    if (colonist.path.length > 0) {
      const wandering = colonist.state === 'wandering';
      ctx.strokeStyle = wandering ? 'rgba(206,214,228,0.55)' : 'rgba(232,162,60,0.95)';
      ctx.lineWidth = wandering ? 2 : 3;
      ctx.setLineDash(wandering ? [5, 5] : []);
      ctx.beginPath();
      ctx.moveTo(sx(colonist.x + 0.5), sy(colonist.y + 0.5));
      for (const wp of colonist.path) {
        ctx.lineTo(sx(wp.x + 0.5), sy(wp.y + 0.5));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- hovered tile ---
    if (hover) {
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx(hover.x) + 1, sy(hover.y) + 1, ts - 2, ts - 2);
    }

    // --- the colonist ---
    this._drawColonist(colonist, sx(colonist.x + 0.5), sy(colonist.y + 0.5));
  }

  _drawPlant(plant, cx, cy) {
    const ctx = this.ctx;
    const ts = this.ts;
    if (plant.kind === PlantKind.WILD) {
      // A small wild bush: three clustered dark-green blobs.
      const r = ts * 0.15;
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
    } else {
      // A planted crop: a tidy upright sprout.
      const h = ts * 0.3;
      ctx.strokeStyle = '#3f7a2b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy + h * 0.7);
      ctx.lineTo(cx, cy - h * 0.5);
      ctx.stroke();
      ctx.fillStyle = '#86d65c';
      for (const ox of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + ox * h * 0.45, cy - h * 0.1, h * 0.4, h * 0.22, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(cx, cy - h * 0.55, h * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = '#a6e57d';
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

  // A small top-down figure: shadow, amber body, lighter head.
  // While working, a progress ring sweeps around it.
  _drawColonist(colonist, cx, cy) {
    const ctx = this.ctx;
    const r = this.ts * 0.34;

    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.7, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

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

    if (colonist.state === 'working') {
      const start = -Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r * 1.5, start, start + colonist.workProgress * Math.PI * 2);
      ctx.strokeStyle = '#ffe178';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }
}
