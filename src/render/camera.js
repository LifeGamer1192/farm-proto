// The camera: which part of the (larger) map is currently on screen.
//
// Its position is the top-left visible tile, in tile coordinates, and is
// always clamped so the viewport stays inside the map.
//
// α35: the renderer now uses an isometric (2:1 diamond) projection. Camera
// coordinates still walk the orthogonal grid in tile units (so panning
// behaves the same way), but the visible "centre point" is the camera's
// midpoint, projected to canvas centre. The helpers below convert between
// world (tile) coordinates and screen (canvas) pixels for both the renderer
// (forward projection) and the input layer (inverse for picking).

// Isometric tile aspect — diamonds are twice as wide as they are tall.
export const ISO_TILE_W_RATIO = 1.0;   // diamond half-width  = ts * 0.5
export const ISO_TILE_H_RATIO = 0.5;   // diamond half-height = ts * 0.25
// Pixels of vertical lift per 1.0 of elevation. α36 bumped 0.6 → 1.0 so
// the new mountain layer reads dramatically — hills are obvious mounds,
// mountains lift a full tile-width above the plains, rare peaks are
// commanding.
export const ISO_ELEV_RATIO = 1.0;

/**
 * Project a world (tile) point to screen pixels. `wx`, `wy` are floating
 * tile coordinates (e.g. a tile corner is integer; a tile centre is +0.5).
 * The camera's visible centre maps to the canvas centre; everything else
 * fans out from there into the iso diamond grid.
 *
 * `elevation` (0..1, default 0) lifts the point upward by ts*ISO_ELEV_RATIO
 * per unit — used for terrain height.
 */
export function worldToScreen(wx, wy, camera, ts, canvasW, canvasH, elevation = 0) {
  const cx = camera.x + camera.viewCols / 2;
  const cy = camera.y + camera.viewRows / 2;
  const dx = wx - cx;
  const dy = wy - cy;
  const tw = ts * ISO_TILE_W_RATIO; // full tile width  (diamond w)
  const th = ts * ISO_TILE_H_RATIO; // full tile height (diamond h)
  const sx = (dx - dy) * (tw / 2) + canvasW / 2;
  const sy = (dx + dy) * (th / 2) + canvasH / 2 - elevation * ts * ISO_ELEV_RATIO;
  return { x: sx, y: sy };
}

/**
 * Inverse of `worldToScreen`, ignoring elevation. Used by the input layer
 * to convert a click at (sx, sy) into the world (tile) coordinate it
 * lands on. Higher tiles look lifted on screen but the click resolves to
 * the flat ground tile beneath — a deliberate simplification (Banished
 * does the same) that keeps hit-testing cheap and predictable.
 */
export function screenToWorld(sxPx, syPx, camera, ts, canvasW, canvasH) {
  const cx = camera.x + camera.viewCols / 2;
  const cy = camera.y + camera.viewRows / 2;
  const tw = ts * ISO_TILE_W_RATIO;
  const th = ts * ISO_TILE_H_RATIO;
  const ax = (sxPx - canvasW / 2) / (tw / 2);
  const ay = (syPx - canvasH / 2) / (th / 2);
  const dx = (ay + ax) / 2;
  const dy = (ay - ax) / 2;
  return { x: cx + dx, y: cy + dy };
}

export class Camera {
  constructor(viewCols, viewRows, mapCols, mapRows) {
    this.viewCols = viewCols;
    this.viewRows = viewRows;
    this.mapCols = mapCols;
    this.mapRows = mapRows;
    this.x = 0;
    this.y = 0;
  }

  get maxX() {
    return Math.max(0, this.mapCols - this.viewCols);
  }
  get maxY() {
    return Math.max(0, this.mapRows - this.viewRows);
  }

  clamp() {
    if (this.x < 0) this.x = 0;
    else if (this.x > this.maxX) this.x = this.maxX;
    if (this.y < 0) this.y = 0;
    else if (this.y > this.maxY) this.y = this.maxY;
  }

  /** Move by a delta in tile units. */
  pan(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  /** Center the viewport on a point given in tile coordinates. */
  centerOn(tx, ty) {
    this.x = tx - this.viewCols / 2;
    this.y = ty - this.viewRows / 2;
    this.clamp();
  }

  /** Change how many tiles are visible (zoom), keeping the view centered. */
  resize(viewCols, viewRows) {
    const cx = this.x + this.viewCols / 2;
    const cy = this.y + this.viewRows / 2;
    this.viewCols = viewCols;
    this.viewRows = viewRows;
    this.x = cx - viewCols / 2;
    this.y = cy - viewRows / 2;
    this.clamp();
  }
}
