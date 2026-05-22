import './style.css';
import { GRID_COLS, GRID_ROWS, DRAG_THRESHOLD, SCROLL_STEP } from './config.js';
import { hashSeed, randomSeed } from './core/rng.js';
import { TASK_LABELS } from './tasks.js';
import { isRipe, cropSuitability, survivalChance, getCrop } from './crops.js';
import { SEASON_LABELS, SEASON_NOTE, tempGrowthFactor, sunGrowthFactor } from './season.js';
import { Game } from './game.js';

const canvas = document.getElementById('map');
const game = new Game(canvas);

const seedInput = document.getElementById('seed');
const tooltip = document.getElementById('tooltip');
const mapStatsEl = document.getElementById('map-stats');
const colonistStatsEl = document.getElementById('colonist-stats');
const taskStatsEl = document.getElementById('task-stats');
const taskReasonEl = document.getElementById('task-reason');
const colonyStatsEl = document.getElementById('colony-stats');
const logEl = document.getElementById('event-log');
const legendEl = document.getElementById('legend');
const viewModesEl = document.getElementById('view-modes');
const toolsEl = document.getElementById('tools');
const cropsEl = document.getElementById('crops');
const speedsEl = document.getElementById('speeds');
const zoomsEl = document.getElementById('zooms');
const envStatsEl = document.getElementById('env-stats');
const toastEl = document.getElementById('toast');

const PAN_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let tool = 'move'; // current task tool: move | harvest | sow
let cropId = 'wheat'; // crop the Sow tool will plant

// Point the "all versions" link up a level when viewing an archived build.
const archiveLink = document.getElementById('archive-link');
if (archiveLink && location.pathname.includes('/versions/')) {
  archiveLink.href = '../';
}

// --- transient hint popups (toast) ---------------------------------------

const TOOL_HINTS = {
  move: 'Move tool — click a tile and the colonist walks there.',
  harvest:
    'Harvest tool — click a ripe crop, wild plant or dead husk to gather or clear it.',
  sow: 'Sow tool — click tiles to plant the chosen crop. It grows over time; harvest it once ripe.',
};
const CROP_HINTS = {
  wheat: 'Wheat — moderate growth, yields 4 food.',
  potato: 'Potato — slow to grow, yields 7 food.',
  bean: 'Bean — quick to grow, yields 2 food.',
};

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  void toastEl.offsetWidth; // reflow so the fade-in transition runs
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 5500);
}
// Once the fade-out finishes, drop the toast out of the layout.
toastEl.addEventListener('transitionend', () => {
  if (!toastEl.classList.contains('show')) toastEl.hidden = true;
});

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
  moving: 'Moving',
  working: 'Working',
  wandering: 'Wandering',
};

function updateColonistStats() {
  const c = game.colonist;
  const cam = game.camera;
  renderRows(colonistStatsEl, [
    ['State', STATE_LABELS[c.state] || c.state],
    ['Tile', `(${c.tileX}, ${c.tileY})`],
    ['Camera', `(${Math.round(cam.x)}, ${Math.round(cam.y)})`],
  ]);
}

function describeTask(task) {
  return task ? `${TASK_LABELS[task.type]} (${task.x}, ${task.y})` : '—';
}

function updateTaskPanel() {
  const c = game.colonist;
  const task = c.currentTask;
  let phase = '—';
  if (task) {
    phase = c.state === 'working' ? `working ${Math.round(c.workProgress * 100)}%` : 'walking';
  } else if (c.state === 'wandering') {
    phase = 'wandering';
  }
  renderRows(taskStatsEl, [
    ['Queued', game.taskQueue.length],
    ['Current', describeTask(task)],
    ['Phase', phase],
  ]);
  taskReasonEl.textContent = game.lastAssignReason;
}

function updateColonyPanel() {
  const s = game.storage;
  renderRows(colonyStatsEl, [
    ['Food stored', game.totalFood],
    ['Wheat / Potato / Bean', `${s.wheat} / ${s.potato} / ${s.bean}`],
    ['Forage', s.forage],
    ['Crops lost', game.cropsLost],
    ['Meals eaten', game.meals.eaten],
    ['Missed meals', game.meals.missed],
    ['Next meal', `${Math.ceil(game.nextMealIn)}s`],
  ]);
  logEl.innerHTML = game.log
    .map((e) => `<li class="${e.cls}">${e.icon} ${e.text}</li>`)
    .join('');
}

function updateEnvPanel() {
  const e = game.environment;
  renderRows(envStatsEl, [
    ['Year', e.year],
    ['Season', `${SEASON_LABELS[e.seasonIndex]} · day ${e.day}`],
    ['Temperature', `${Math.round(e.temperature)}°C`],
    ['Daylight', `${Math.round(e.daylight * 100)}%`],
    ['Season growth', `${Math.round(tempGrowthFactor(e.temperature) * 100)}%`],
  ]);
}

// --- map lifecycle --------------------------------------------------------

function newMap(seed) {
  game.newMap(seed);
  seedInput.value = String(game.seed);
  updateMapStats();
  updateColonistStats();
  updateTaskPanel();
  updateColonyPanel();
  updateEnvPanel();
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

// --- canvas pointer input: drag to pan, tap/click to queue a task --------

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
  const x = Math.floor(game.camera.x + px / game.tileSize);
  const y = Math.floor(game.camera.y + py / game.tileSize);
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return null;
  return { x, y };
}

function describePlant(plant) {
  if (!plant) return '';
  if (plant.kind === 'wild') return '<br>plant: wild';
  let status;
  if (plant.withered) status = 'withered';
  else if (isRipe(plant)) status = 'ripe';
  else status = `${Math.round(plant.growth * 100)}%`;
  return `<br>crop: ${plant.cropId} (${status})`;
}

// With the Sow tool active, hint how likely the chosen crop is to survive.
function sowHint(tile) {
  if (tool !== 'sow' || tile.type === 'water' || tile.plant) return '';
  const chance = survivalChance(cropSuitability(getCrop(cropId), tile));
  return `<br>sow ${cropId}: ~${Math.round(chance * 100)}% to survive`;
}

// How fast a crop grows on this tile now (temperature × the tile's sunlight).
function growthHint(tile) {
  if (tile.type === 'water') return '';
  const e = game.environment;
  const rate = tempGrowthFactor(e.temperature) * sunGrowthFactor(tile.sunlight, e.daylight);
  return `<br>crop growth here ~${Math.round(rate * 100)}%`;
}

function showTooltip(clientX, clientY, tile) {
  const t = game.map.tiles[tile.y][tile.x];
  const f = (v) => v.toFixed(3);
  tooltip.hidden = false;
  tooltip.innerHTML =
    `<strong>(${tile.x}, ${tile.y})</strong> ${t.type}<br>` +
    `elevation ${f(t.elevation)}<br>fertility ${f(t.fertility)}<br>` +
    `moisture ${f(t.moisture)}<br>sunlight ${f(t.sunlight)}` +
    `${describePlant(t.plant)}${growthHint(t)}${sowHint(t)}`;
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
        -((ev.clientX - lastX) * scaleX) / game.tileSize,
        -((ev.clientY - lastY) * scaleY) / game.tileSize,
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
    if (tile) {
      game.enqueueTask(tool, tile.x, tile.y, cropId);
      updateTaskPanel();
    }
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
    game.camera.pan(dx * SCROLL_STEP, dy * SCROLL_STEP);
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

function selectIn(container, btn, attr) {
  for (const b of container.querySelectorAll('button')) {
    b.classList.toggle('active', b === btn);
  }
  return btn.dataset[attr];
}

toolsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-tool]');
  if (!btn) return;
  tool = selectIn(toolsEl, btn, 'tool');
  showToast(TOOL_HINTS[tool]);
});

cropsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-crop]');
  if (!btn) return;
  cropId = selectIn(cropsEl, btn, 'crop');
  showToast(CROP_HINTS[cropId]);
});

speedsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-speed]');
  if (!btn) return;
  game.setSpeed(Number(btn.dataset.speed));
  selectIn(speedsEl, btn, 'speed');
});

zoomsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-zoom]');
  if (!btn) return;
  game.setZoom(Number(btn.dataset.zoom));
  selectIn(zoomsEl, btn, 'zoom');
});

viewModesEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-mode]');
  if (!btn) return;
  game.viewMode = selectIn(viewModesEl, btn, 'mode');
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
document.getElementById('clear-tasks').addEventListener('click', () => {
  game.clearTasks();
  updateTaskPanel();
});

// --- start ----------------------------------------------------------------

newMap(randomSeed());
game.start();
showToast('Pick a tool, then click map tiles to set the colonist tasks. Drag or use the arrows to scroll.');
setInterval(() => {
  updateColonistStats();
  updateTaskPanel();
  updateColonyPanel();
  updateEnvPanel();
  const season = game.consumeSeasonChange();
  if (season) showToast(SEASON_NOTE[season]);
}, 150);
