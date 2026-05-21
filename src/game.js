// The game: owns the map, camera and colonist, and runs the frame loop.

import {
  GRID_COLS,
  GRID_ROWS,
  VIEW_COLS,
  VIEW_ROWS,
  TILE_SIZE,
  CAMERA_SPEED,
} from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { TileType } from './map/tile.js';
import { Camera } from './render/camera.js';
import { Renderer } from './render/renderer.js';
import { Colonist } from './entities/colonist.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = VIEW_COLS * TILE_SIZE;
    canvas.height = VIEW_ROWS * TILE_SIZE;
    this.renderer = new Renderer(canvas, TILE_SIZE);

    this.viewMode = 'terrain';
    this.panDir = { x: 0, y: 0 }; // from on-screen arrows
    this.keys = new Set(); // held WASD keys
    this.hover = null;

    this.map = null;
    this.camera = null;
    this.colonist = null;
    this.stats = null;

    this._loop = this._loop.bind(this);
    this._lastTime = 0;
  }

  get seed() {
    return this.map.seed;
  }

  /** Generate a fresh map and place the colonist near its center. */
  newMap(seed) {
    this.map = generateMap(GRID_COLS, GRID_ROWS, seed);
    this.stats = mapStats(this.map);
    this.camera = new Camera(VIEW_COLS, VIEW_ROWS, GRID_COLS, GRID_ROWS);
    const spawn = this._findSpawn();
    this.colonist = new Colonist(spawn.x, spawn.y);
    this.camera.centerOn(spawn.x + 0.5, spawn.y + 0.5);
    this.hover = null;
  }

  // Nearest land tile to the map center (outward ring search).
  _findSpawn() {
    const cx = (this.map.cols / 2) | 0;
    const cy = (this.map.rows / 2) | 0;
    const maxR = Math.max(this.map.cols, this.map.rows);
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) continue;
          if (this.map.tiles[y][x].type === TileType.LAND) return { x, y };
        }
      }
    }
    return { x: cx, y: cy };
  }

  /** Send the colonist to a tile (player command). */
  commandColonist(x, y) {
    return this.colonist.commandTo(this.map, x, y);
  }

  centerOnColonist() {
    this.camera.centerOn(this.colonist.x + 0.5, this.colonist.y + 0.5);
  }

  // Combined pan direction from on-screen arrows and held WASD keys.
  _panVector() {
    let dx = this.panDir.x;
    let dy = this.panDir.y;
    if (this.keys.has('a')) dx -= 1;
    if (this.keys.has('d')) dx += 1;
    if (this.keys.has('w')) dy -= 1;
    if (this.keys.has('s')) dy += 1;
    return { dx, dy };
  }

  update(dt) {
    const { dx, dy } = this._panVector();
    if (dx !== 0 || dy !== 0) {
      this.camera.pan(dx * CAMERA_SPEED * dt, dy * CAMERA_SPEED * dt);
    }
    this.colonist.update(dt, this.map);
  }

  render() {
    this.renderer.draw(this.map, this.camera, this.viewMode, this.colonist, this.hover);
  }

  _loop(time) {
    // Clamp dt so a backgrounded tab doesn't produce a huge jump.
    const dt = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;
    this.update(dt);
    this.render();
    requestAnimationFrame(this._loop);
  }

  start() {
    this._lastTime = performance.now();
    requestAnimationFrame(this._loop);
  }
}
