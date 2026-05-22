import './style.css';
import {
  GRID_COLS,
  GRID_ROWS,
  DRAG_THRESHOLD,
  SCROLL_STEP,
  TILL_SURVIVAL_BONUS,
} from './config.js';
import { hashSeed, randomSeed } from './core/rng.js';
import { isRipe, cropSuitability, survivalChance, getCrop } from './crops.js';
import { tempGrowthFactor, sunGrowthFactor } from './season.js';
import { t, setLang, getLang } from './i18n.js';
import { Game } from './game.js';

const canvas = document.getElementById('map');
const game = new Game(canvas);

// Exposed for debugging and headless checks; harmless in production.
window.game = game;

const $ = (id) => document.getElementById(id);
const seedInput = $('seed');
const tooltip = $('tooltip');
const toastEl = $('toast');
const mapStatsEl = $('map-stats');
const colonistsEl = $('colonist-stats');
const taskStatsEl = $('task-stats');
const taskReasonEl = $('task-reason');
const colonyStatsEl = $('colony-stats');
const logEl = $('event-log');
const legendEl = $('legend');
const gameoverEl = $('gameover');
const viewModesEl = $('view-modes');
const toolsEl = $('tools');
const cropsEl = $('crops');
const speedsEl = $('speeds');
const zoomsEl = $('zooms');
const langsEl = $('langs');
const envStatsEl = $('env-stats');

const PAN_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let tool = 'move';
let cropId = 'wheat';

const archiveLink = $('archive-link');
if (archiveLink && location.pathname.includes('/versions/')) {
  archiveLink.href = '../';
}

// --- transient hint popups (toast) ---------------------------------------

let toastTimer = null;
function showToast(text) {
  toastEl.textContent = text;
  toastEl.hidden = false;
  void toastEl.offsetWidth; // reflow so the fade-in transition runs
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 5500);
}
toastEl.addEventListener('transitionend', () => {
  if (!toastEl.classList.contains('show')) toastEl.hidden = true;
});

// --- panels ---------------------------------------------------------------

const LEGENDS = {
  terrain: [
    ['#5c98c8', 'legend.water'],
    ['#c4b884', 'legend.poorSoil'],
    ['#468237', 'legend.richSoil'],
  ],
  fertility: [
    ['#3c3228', 'legend.low'],
    ['#78e66e', 'legend.high'],
    ['#2d343f', 'legend.waterNA'],
  ],
  moisture: [
    ['#c8aa78', 'legend.dry'],
    ['#286ec8', 'legend.wet'],
  ],
  sunlight: [
    ['#191e2d', 'legend.shade'],
    ['#ffe178', 'legend.bright'],
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
      ([color, key]) =>
        `<span class="swatch"><i style="background:${color}"></i>${t(key)}</span>`,
    )
    .join('');
}

function updateMapStats() {
  const s = game.stats;
  const pct = (v) => `${(v * 100).toFixed(1)}%`;
  const num = (v) => v.toFixed(3);
  renderRows(mapStatsEl, [
    [t('stat.seed'), game.seed],
    [t('stat.size'), `${GRID_COLS}×${GRID_ROWS}`],
    [t('stat.water'), `${s.water} (${pct(s.waterFraction)})`],
    [t('stat.land'), s.land],
    [t('stat.avgFertility'), num(s.avgFertility)],
    [t('stat.avgMoisture'), num(s.avgMoisture)],
    [t('stat.avgSunlight'), num(s.avgSunlight)],
    [t('stat.camera'), `(${Math.round(game.camera.x)}, ${Math.round(game.camera.y)})`],
  ]);
}

// A thin 0..1 bar; green when comfortable, red when the stat runs low.
function statBar(key, value) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const cls = value > 0.5 ? 'good' : value > 0.25 ? 'mid' : 'low';
  return (
    `<span class="cbar" title="${t(key)} ${pct}%">` +
    `<b class="${cls}" style="width:${pct}%"></b></span>`
  );
}

function updateColonistsPanel() {
  colonistsEl.innerHTML = game.colonists
    .map((c) => {
      const bars =
        statBar('stat.fed', 1 - c.hunger) +
        statBar('stat.health', c.health) +
        statBar('stat.mood', c.mood);
      return (
        '<div class="colonist-row">' +
        `<div class="crow-head"><span>${c.name}</span>` +
        `<span class="cstate">${t('state.' + c.state)}</span></div>` +
        `<div class="crow-bars">${bars}</div></div>`
      );
    })
    .join('');
}

function updateTaskPanel() {
  renderRows(taskStatsEl, [
    [t('stat.queued'), game.taskQueue.length],
    [t('stat.busy'), `${game.busyColonists} / ${game.colonists.length}`],
  ]);
  taskReasonEl.textContent = game.lastAssignReason;
}

function updateColonyStats() {
  const s = game.storage;
  renderRows(colonyStatsEl, [
    [t('stat.foodStored'), game.totalFood],
    [t('stat.harvest'), `${s.wheat} / ${s.potato} / ${s.bean}`],
    [t('stat.forage'), s.forage],
    [t('stat.meat'), s.meat],
    [t('stat.cropsLost'), game.cropsLost],
    [t('stat.meals'), game.meals.eaten],
    [t('stat.missed'), game.meals.missed],
  ]);
  logEl.innerHTML = game.log
    .map((e) => `<li class="${e.cls}">${e.icon} ${e.text}</li>`)
    .join('');
}

function updateEnvPanel() {
  const e = game.environment;
  renderRows(envStatsEl, [
    [t('stat.year'), e.year],
    [t('stat.season'), `${t('season.' + e.season)} · ${t('val.day', { n: e.day })}`],
    [t('stat.temperature'), `${Math.round(e.temperature)}°C`],
    [t('stat.daylight'), `${Math.round(e.daylight * 100)}%`],
    [t('stat.seasonGrowth'), `${Math.round(tempGrowthFactor(e.temperature) * 100)}%`],
  ]);
}

function refreshPanels() {
  updateMapStats();
  updateColonistsPanel();
  updateTaskPanel();
  updateColonyStats();
  updateEnvPanel();
  updateLegend();
}

// --- i18n -----------------------------------------------------------------

function applyI18n() {
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  document.documentElement.lang = getLang();
  refreshPanels();
}

// --- map lifecycle --------------------------------------------------------

function newMap(seed) {
  game.newMap(seed);
  seedInput.value = String(game.seed);
  refreshPanels();
}

function applySeed() {
  const raw = seedInput.value.trim();
  if (raw === '') {
    newMap(randomSeed());
    return;
  }
  newMap(/^\d+$/.test(raw) ? Number(raw) >>> 0 : hashSeed(raw));
}

// --- canvas pointer input -------------------------------------------------

function canvasMetrics() {
  const rect = canvas.getBoundingClientRect();
  return { rect, scaleX: canvas.width / rect.width, scaleY: canvas.height / rect.height };
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
  if (plant.kind === 'wild') return `<br>${t('tip.plantWild')}`;
  let status;
  if (plant.withered) status = t('tip.withered');
  else if (isRipe(plant)) status = t('tip.ripe');
  else status = `${Math.round(plant.growth * 100)}%`;
  return `<br>${t('tip.crop', { crop: t('crop.' + plant.cropId), status })}`;
}

function growthHint(tile) {
  if (tile.type === 'water') return '';
  const e = game.environment;
  const rate = tempGrowthFactor(e.temperature) * sunGrowthFactor(tile.sunlight, e.daylight);
  return `<br>${t('tip.growthHere', { n: Math.round(rate * 100) })}`;
}

function sowHint(tile) {
  if (tool !== 'sow' || tile.type === 'water' || tile.plant) return '';
  const bonus = tile.tilled ? TILL_SURVIVAL_BONUS : 0;
  const chance = survivalChance(cropSuitability(getCrop(cropId), tile), bonus);
  return `<br>${t('tip.sowHere', { crop: t('crop.' + cropId), n: Math.round(chance * 100) })}`;
}

function showTooltip(clientX, clientY, pos) {
  const tl = game.map.tiles[pos.y][pos.x];
  const f = (v) => v.toFixed(3);
  const tilled = tl.tilled ? `<br>${t('tip.tilled')}` : '';
  tooltip.hidden = false;
  tooltip.innerHTML =
    `<strong>(${pos.x}, ${pos.y})</strong> ${t('tile.' + tl.type)}<br>` +
    `${t('tip.elevation')} ${f(tl.elevation)}<br>${t('tip.fertility')} ${f(tl.fertility)}<br>` +
    `${t('tip.moisture')} ${f(tl.moisture)}<br>${t('tip.sunlight')} ${f(tl.sunlight)}` +
    `${tilled}${describePlant(tl.plant)}${growthHint(tl)}${sowHint(tl)}`;
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
    const pos = tileAt(ev.clientX, ev.clientY);
    game.hover = pos;
    if (pos) showTooltip(ev.clientX, ev.clientY, pos);
    else tooltip.hidden = true;
  }
});

function endPointer(ev) {
  if (activePointer !== ev.pointerId) return;
  if (!dragged) {
    const pos = tileAt(ev.clientX, ev.clientY);
    if (pos) {
      game.enqueueTask(tool, pos.x, pos.y, cropId);
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
window.addEventListener('keyup', (ev) => game.keys.delete(ev.key.toLowerCase()));
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
  showToast(t('hint.task.' + tool));
});

cropsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-crop]');
  if (!btn) return;
  cropId = selectIn(cropsEl, btn, 'crop');
  showToast(t('hint.crop.' + cropId));
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

langsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-lang]');
  if (!btn) return;
  setLang(selectIn(langsEl, btn, 'lang'));
  applyI18n();
});

$('regenerate').addEventListener('click', () => newMap(randomSeed()));
$('apply-seed').addEventListener('click', applySeed);
seedInput.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') applySeed();
});
$('center-colonist').addEventListener('click', () => game.centerOnColonist());
$('clear-tasks').addEventListener('click', () => {
  game.clearTasks();
  updateTaskPanel();
});
$('gameover-new').addEventListener('click', () => {
  newMap(randomSeed());
  gameoverEl.hidden = true;
});

// --- start ----------------------------------------------------------------

newMap(randomSeed());
applyI18n();
game.start();
showToast(t('hint.welcome'));
setInterval(() => {
  updateColonistsPanel();
  updateTaskPanel();
  updateColonyStats();
  updateEnvPanel();
  updateMapStats();
  if (gameoverEl.hidden === game.over) gameoverEl.hidden = !game.over;
  const season = game.consumeSeasonChange();
  if (season) showToast(t('note.' + season));
}, 150);
