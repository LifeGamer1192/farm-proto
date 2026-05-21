// Canvas 2D rendering of the tile map, with selectable view modes.

import { TileType } from '../map/tile.js';

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
      // Lower elevation reads as deeper, darker water.
      return mix([92, 152, 200], [28, 66, 122], 1 - tile.elevation);
    }
    // Land shades from pale dry soil to rich green by fertility.
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

export const VIEW_MODE_NAMES = Object.keys(VIEW_MODES);

export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {number} tileSize
   */
  constructor(canvas, tileSize) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tileSize = tileSize;
  }

  /**
   * Draw the whole map in the given view mode.
   * @param {{cols:number, rows:number, tiles:object[][]}} map
   * @param {string} mode
   */
  draw(map, mode = 'terrain') {
    const colorOf = VIEW_MODES[mode] || VIEW_MODES.terrain;
    const ctx = this.ctx;
    const ts = this.tileSize;

    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        ctx.fillStyle = colorOf(map.tiles[y][x]);
        ctx.fillRect(x * ts, y * ts, ts, ts);
      }
    }

    // Subtle grid lines to keep tiles legible.
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= map.cols; x++) {
      ctx.moveTo(x * ts + 0.5, 0);
      ctx.lineTo(x * ts + 0.5, map.rows * ts);
    }
    for (let y = 0; y <= map.rows; y++) {
      ctx.moveTo(0, y * ts + 0.5);
      ctx.lineTo(map.cols * ts, y * ts + 0.5);
    }
    ctx.stroke();
  }

  /**
   * Outline a single tile to give hover feedback.
   * Call after draw(); it does not redraw the map.
   */
  highlight(x, y) {
    const ts = this.tileSize;
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x * ts + 1, y * ts + 1, ts - 2, ts - 2);
  }
}
