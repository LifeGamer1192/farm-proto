import './style.css';
import { GRID_COLS, GRID_ROWS, TILE_SIZE, DRAG_THRESHOLD } from './config.js';
import { hashSeed, randomSeed } from './core/rng.js';
import { Game } from './game.js';

const canvas = document.getElementById('map');
const game = new Game(canvas);

const seedInput = document.getElementById('seed');
const tooltip = document.getElementById('tooltip');
const mapStatsEl = document.getElementById('map-stats');
const colonistStatsEl = document.getElementById('colonist-stats');
const legendEl = document.getElementById('legend');
const viewModesEl = document.getElementById('view-modes');

const PAN_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// --- legend & stats panels ------------------------------------------------

const LEGENDS = {
  terrain: [
    ['#5c98c8', 'Water'],
    ['#c4b884', 'Poor soil'],
    ['#468237', 'Rich soil'],
  ],
  fertility: [
    ['#3c3228', 'Low'],
    ['#78e66e', 'High'],
    ['#2d343f', 'Water (n/a)'],
  ],
  moisture: [
    ['#c8aa78', 'Dry'],
    ['#286ec8', 'Wet'],
  ],
  sunlight: [
    ['#191e2d', 'Shade'],
    ['#ffe178', 'Bright'],
  ],
};

function renderRows(el, rows) {
  el.innerHTML = rows
    .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
    .join('');
}

function updateLegend() {
  legendEl.innerHTML = (LEGENDS[game.viewMode] || [])
    .map(
      ([color, label]) =>
        `<span class="swatch"><i style="background:${color}"></i>${label}</span>`,
    )
    .join('');
}

function updateMapStats() {
  const s = game.stats;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const num = (v) => v.toFixed(3);
  renderRows(mapStatsEl, [
    ['Seed', game.seed],
    ['Size', `${GRID_COLS}×${GRID_ROWS}`],
    ['Water', `${s.water} (${pct(s.waterFraction)})`],
    ['Land', s.land],
    ['Avg fertility', num(s.avgFertility)],
    ['Avg moisture', num(s.avgMoisture)],
    ['Avg sunlight', num(s.avgSunlight)],
  ]);
}

const STATE_LABELS = {
  idle: 'Idle',
  moving: 'Moving (commanded)',
  wandering: 'Wandering',
};

function updateColonistStats() {
  const c = game.colonist;
  const cam = game.camera;
  renderRows(colonistStatsEl, [
    ['State', STATE_LABELS[c.state] || c.state],
    ['Tile', `(${c.tileX}, ${c.tileY})`],
    ['Path', `${c.path.length} tiles`],
    ['Camera', `(${Math.round(cam.x)}, ${Math.round(cam.y)})`],
  ]);
}

// --- map lifecycle --------------------------------------------------------

function newMap(seed) {
  game.newMap(seed);
  seedInput.value = String(game.seed);
  updateMapStats();
  updateColonistStats();
  updateLegend();
}

function applySeed() {
  const raw = seedInput.value.trim();
  if (raw === '') {
    newMap(randomSeed());
    return;
  }
  newMap(/^\d+$/.test(raw) ? Number(raw) >>> 0 : hashSeed(raw));
}

// --- canvas pointer input: drag to pan, tap/click to command -------------

function canvasMetrics() {
  const rect = canvas.getBoundingClientRect();
  return {
    rect,
    scaleX: canvas.width / rect.width,
    scaleY: canvas.height / rect.height,
  };
}

function tileAt(clientX, clientY) {
  const { rect, scaleX, scaleY } = canvasMetrics();
  const px = (clientX - rect.left) * scaleX;
  const py = (clientY - rect.top) * scaleY;
  const x = Math.floor(game.camera.x + px / TILE_SIZE);
  const y = Math.floor(game.camera.y + py / TILE_SIZE);
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return null;
  return { x, y };
}

function showTooltip(clientX, clientY, tile) {
  const t = game.map.tiles[tile.y][tile.x];
  const f = (v) => v.toFixed(3);
  tooltip.hidden = false;
  tooltip.innerHTML =
    `<strong>(${tile.x}, ${tile.y})</strong> ${t.type}<br>` +
    `elevation ${f(t.elevation)}<br>fertility ${f(t.fertility)}<br>` +
    `moisture ${f(t.moisture)}<br>sunlight ${f(t.sunlight)}`;
  const { rect } = canvasMetrics();
  tooltip.style.left = `${clientX - rect.left + 14}px`;
  tooltip.style.top = `${clientY - rect.top + 14}px`;
}

let activePointer = null;
let dragged = false;
let downX = 0;
let downY = 0;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (ev) => {
  activePointer = ev.pointerId;
  dragged = false;
  downX = lastX = ev.clientX;
  downY = lastY = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
});

canvas.addEventListener('pointermove', (ev) => {
  if (activePointer === ev.pointerId) {
    if (!dragged && Math.hypot(ev.clientX - downX, ev.clientY - downY) > DRAG_THRESHOLD) {
      dragged = true;
      game.hover = null;
      tooltip.hidden = true;
    }
    if (dragged) {
      const { scaleX, scaleY } = canvasMetrics();
      game.camera.pan(
        -((ev.clientX - lastX) * scaleX) / TILE_SIZE,
        -((ev.clientY - lastY) * scaleY) / TILE_SIZE,
      );
      lastX = ev.clientX;
      lastY = ev.clientY;
    }
  } else if (ev.pointerType === 'mouse') {
    const tile = tileAt(ev.clientX, ev.clientY);
    game.hover = tile;
    if (tile) showTooltip(ev.clientX, ev.clientY, tile);
    else tooltip.hidden = true;
  }
});

function endPointer(ev) {
  if (activePointer !== ev.pointerId) return;
  if (!dragged) {
    const tile = tileAt(ev.clientX, ev.clientY);
    if (tile) game.commandColonist(tile.x, tile.y);
  }
  activePointer = null;
  dragged = false;
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (ev) => {
  if (activePointer === ev.pointerId) {
    activePointer = null;
    dragged = false;
  }
});
canvas.addEventListener('pointerleave', () => {
  game.hover = null;
  tooltip.hidden = true;
});

// --- keyboard scrolling (WASD) -------------------------------------------

window.addEventListener('keydown', (ev) => {
  const el = document.activeElement;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
  const k = ev.key.toLowerCase();
  if (k === 'w' || k === 'a' || k === 's' || k === 'd') {
    game.keys.add(k);
    ev.preventDefault();
  }
});
window.addEventListener('keyup', (ev) => {
  game.keys.delete(ev.key.toLowerCase());
});
window.addEventListener('blur', () => {
  game.keys.clear();
  game.panDir = { x: 0, y: 0 };
});

// --- on-screen scroll arrows ---------------------------------------------

for (const btn of document.querySelectorAll('.scroll-btn')) {
  const [dx, dy] = PAN_DIRS[btn.dataset.dir];
  const press = (ev) => {
    ev.preventDefault();
    game.panDir = { x: dx, y: dy };
  };
  const release = () => {
    game.panDir = { x: 0, y: 0 };
  };
  btn.addEventListener('pointerdown', press);
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointerleave', release);
  btn.addEventListener('pointercancel', release);
}

// --- controls -------------------------------------------------------------

viewModesEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-mode]');
  if (!btn) return;
  game.viewMode = btn.dataset.mode;
  for (const b of viewModesEl.querySelectorAll('button')) {
    b.classList.toggle('active', b === btn);
  }
  updateLegend();
});

document.getElementById('regenerate').addEventListener('click', () => {
  newMap(randomSeed());
});
document.getElementById('apply-seed').addEventListener('click', applySeed);
seedInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') applySeed();
});
document.getElementById('center-colonist').addEventListener('click', () => {
  game.centerOnColonist();
});

// --- start ----------------------------------------------------------------

newMap(randomSeed());
game.start();
setInterval(updateColonistStats, 150);
