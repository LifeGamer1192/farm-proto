import './style.css';
import { GRID_COLS, GRID_ROWS, TILE_SIZE } from './config.js';
import { generateMap, mapStats } from './map/mapGenerator.js';
import { Renderer } from './render/renderer.js';
import { hashSeed, randomSeed } from './core/rng.js';

const canvas = document.getElementById('map');
canvas.width = GRID_COLS * TILE_SIZE;
canvas.height = GRID_ROWS * TILE_SIZE;

const renderer = new Renderer(canvas, TILE_SIZE);
const seedInput = document.getElementById('seed');
const tooltip = document.getElementById('tooltip');
const statsEl = document.getElementById('stats');
const legendEl = document.getElementById('legend');
const viewModesEl = document.getElementById('view-modes');

let currentMap = null;
let viewMode = 'terrain';
let hover = null; // {x, y} of the hovered tile, or null

// --- rendering -------------------------------------------------------------

function render() {
  renderer.draw(currentMap, viewMode);
  if (hover) renderer.highlight(hover.x, hover.y);
}

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

function updateLegend() {
  legendEl.innerHTML = (LEGENDS[viewMode] || [])
    .map(
      ([color, label]) =>
        `<span class="swatch"><i style="background:${color}"></i>${label}</span>`,
    )
    .join('');
}

function updateStats() {
  const s = mapStats(currentMap);
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const num = (v) => v.toFixed(3);
  const rows = [
    ['Seed', currentMap.seed],
    ['Size', `${currentMap.cols}×${currentMap.rows}`],
    ['Water', `${s.water} (${pct(s.waterFraction)})`],
    ['Land', s.land],
    ['Avg fertility', num(s.avgFertility)],
    ['Avg moisture', num(s.avgMoisture)],
    ['Avg sunlight', num(s.avgSunlight)],
  ];
  statsEl.innerHTML = rows
    .map(([dt, dd]) => `<div><dt>${dt}</dt><dd>${dd}</dd></div>`)
    .join('');
}

// --- map lifecycle ---------------------------------------------------------

function setMap(seed) {
  currentMap = generateMap(GRID_COLS, GRID_ROWS, seed);
  seedInput.value = String(currentMap.seed);
  hover = null;
  tooltip.hidden = true;
  render();
  updateStats();
  updateLegend();
}

function applySeed() {
  const raw = seedInput.value.trim();
  if (raw === '') {
    setMap(randomSeed());
    return;
  }
  // A plain number is used directly; any other text is hashed to a seed.
  const seed = /^\d+$/.test(raw) ? Number(raw) >>> 0 : hashSeed(raw);
  setMap(seed);
}

// --- input -----------------------------------------------------------------

function tileFromEvent(ev) {
  const rect = canvas.getBoundingClientRect();
  // The canvas may be scaled down by CSS on small screens.
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = Math.floor(((ev.clientX - rect.left) * scaleX) / TILE_SIZE);
  const y = Math.floor(((ev.clientY - rect.top) * scaleY) / TILE_SIZE);
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return null;
  return { x, y };
}

function showTooltip(ev, tilePos) {
  const tile = currentMap.tiles[tilePos.y][tilePos.x];
  const f = (v) => v.toFixed(3);
  tooltip.hidden = false;
  tooltip.innerHTML =
    `<strong>(${tilePos.x}, ${tilePos.y})</strong> ${tile.type}<br>` +
    `elevation ${f(tile.elevation)}<br>` +
    `fertility ${f(tile.fertility)}<br>` +
    `moisture ${f(tile.moisture)}<br>` +
    `sunlight ${f(tile.sunlight)}`;
  const rect = canvas.getBoundingClientRect();
  tooltip.style.left = `${ev.clientX - rect.left + 14}px`;
  tooltip.style.top = `${ev.clientY - rect.top + 14}px`;
}

canvas.addEventListener('mousemove', (ev) => {
  const tilePos = tileFromEvent(ev);
  hover = tilePos;
  render();
  if (tilePos) {
    showTooltip(ev, tilePos);
  } else {
    tooltip.hidden = true;
  }
});

canvas.addEventListener('mouseleave', () => {
  hover = null;
  tooltip.hidden = true;
  render();
});

document.getElementById('regenerate').addEventListener('click', () => {
  setMap(randomSeed());
});

document.getElementById('apply-seed').addEventListener('click', applySeed);

seedInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') applySeed();
});

viewModesEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-mode]');
  if (!btn) return;
  viewMode = btn.dataset.mode;
  for (const b of viewModesEl.querySelectorAll('button')) {
    b.classList.toggle('active', b === btn);
  }
  render();
  updateLegend();
});

// --- start -----------------------------------------------------------------

setMap(randomSeed());
