// The camera: which part of the (larger) map is currently on screen.
//
// Its position is the top-left visible tile, in tile coordinates, and is
// always clamped so the viewport stays inside the map.

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
}
