import './style.css';
import {
  GRID_COLS,
  GRID_ROWS,
  DRAG_THRESHOLD,
  SCROLL_STEP,
  TILL_SURVIVAL_BONUS,
  STOCKPILE_CAP,
} from './config.js';
import { hashSeed, randomSeed } from './core/rng.js';
import { isRipe, cropSuitability, survivalChance, getCrop, CROP_IDS } from './crops.js';
import {
  qualityRank,
  RANK_MAX,
  phenotype,
  GENE_IDS,
  survivalGeneBonus,
} from './genetics.js';
import { tempGrowthFactor, sunGrowthFactor } from './season.js';
import { t, setLang, getLang } from './i18n.js';
import { Game, STOCKPILE_ITEMS } from './game.js';

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
const seedStockEl = $('seed-stock');
const codexEl = $('codex');
const logEl = $('event-log');
const legendEl = $('legend');
const gameoverEl = $('gameover');
const victoryEl = $('victory');
const victorySummaryEl = $('victory-summary');
const autoHuntBtn = $('autohunt-btn');
const viewModesEl = $('view-modes');
const toolsEl = $('tools');
const cropsEl = $('crops');
const structuresEl = $('structures');
const speedsEl = $('speeds');
const zoomsEl = $('zooms');
const langsEl = $('langs');
const envStatsEl = $('env-stats');
const pauseBtn = $('pause-btn');
const pausedBadge = $('paused-badge');
const targetAllBtn = $('target-all');

const PAN_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let tool = 'move';
let cropId = 'wheat';
let structure = 'fence';

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
  // Drop a stale selection if that colonist is no longer with us.
  if (game.selectedColonist && !game.colonists.some((c) => c.name === game.selectedColonist)) {
    game.selectedColonist = null;
  }
  colonistsEl.innerHTML = game.colonists
    .map((c) => {
      const bars =
        statBar('stat.fed', 1 - c.hunger) +
        statBar('stat.health', c.health) +
        statBar('stat.mood', c.mood);
      const sel = c.name === game.selectedColonist ? ' selected' : '';
      return (
        `<div class="colonist-row${sel}" data-colonist="${c.name}">` +
        `<div class="crow-head"><span>${c.name}</span>` +
        `<span class="cstate">${t('state.' + c.state)}</span></div>` +
        `<div class="crow-bars">${bars}</div></div>`
      );
    })
    .join('');
  targetAllBtn.classList.toggle('active', !game.selectedColonist);
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
  // Item rows show the colony's whole holding — on hand plus every stockpile.
  const ti = (it) => game.totalItem(it);
  let spUsed = 0;
  for (const sp of game.stockpiles) spUsed += game.stockpileFood(sp);
  const spCap = game.stockpiles.length * STOCKPILE_CAP;
  renderRows(colonyStatsEl, [
    [t('stat.foodStored'), game.totalFood],
    [t('stat.harvest'), `${ti('wheat')} / ${ti('potato')} / ${ti('bean')}`],
    [t('stat.forage'), ti('forage')],
    [t('stat.meat'), ti('meat')],
    [t('stat.cooked'), ti('meal')],
    [t('stat.wood'), Math.ceil(s.wood)],
    [t('stat.stockpiles'), `${spUsed} / ${spCap}`],
    [t('stat.cropsLost'), game.cropsLost],
    [t('stat.spoiled'), game.pestsLost],
    [t('stat.meals'), game.meals.eaten],
    [t('stat.missed'), game.meals.missed],
  ]);
}

// Seed stock: each crop's seeds bucketed by quality rank (★).
function updateSeedPanel() {
  seedStockEl.innerHTML = CROP_IDS.map((id) => {
    const buckets = new Array(RANK_MAX + 1).fill(0);
    for (const seed of game.seeds[id]) buckets[qualityRank(seed.genome)]++;
    let chips = '';
    for (let r = 1; r <= RANK_MAX; r++) {
      if (buckets[r] > 0) {
        chips += `<span class="seed-chip">${'★'.repeat(r)}<b>×${buckets[r]}</b></span>`;
      }
    }
    if (!chips) chips = `<span class="seed-none">${t('val.none')}</span>`;
    return (
      `<div class="seed-row"><span class="seed-crop">${t('crop.' + id)}</span>` +
      `<span class="seed-chips">${chips}</span></div>`
    );
  }).join('');
}

// Variety codex: per crop, the best variety bred so far — its ★ rank and a
// bar per gene, with a notch marking the origin strain's value.
function updateCodexPanel() {
  const legend = GENE_IDS.map((g) => t('gene.' + g)).join(' · ');
  const rows = CROP_IDS.map((id) => {
    const c = game.codex[id];
    const genes = GENE_IDS.map((gid) => {
      const cur = Math.round(phenotype(c.best, gid) * 100);
      const org = Math.round(phenotype(c.origin, gid) * 100);
      return (
        `<span class="gene-cell" title="${t('gene.' + gid)}: ${cur}% (origin ${org}%)">` +
        `<i style="width:${cur}%"></i><u style="left:${org}%"></u></span>`
      );
    }).join('');
    return (
      `<div class="codex-row"><div class="codex-head">` +
      `<span class="codex-crop">${t('crop.' + id)}</span>` +
      `<span class="codex-rank">${'★'.repeat(qualityRank(c.best))}</span></div>` +
      `<div class="codex-genes">${genes}</div></div>`
    );
  }).join('');
  codexEl.innerHTML = `<p class="codex-legend">${legend}</p>${rows}`;
}

// The activity log keeps up to ~1000 events. It re-renders only when an
// entry is added (game.logRev) and prepends just the new entries, so the
// panel stays cheap and does not snap to the top while it is scrolled.
let lastLogRev = -1;
const logEntryHtml = (e) => `<li class="${e.cls}">${e.icon} ${e.text}</li>`;
function updateLog() {
  if (game.logRev === lastLogRev) return;
  const added = game.logRev - lastLogRev;
  lastLogRev = game.logRev;
  // Full rebuild after a reset, or if more changed than the log now holds.
  if (added < 0 || added >= game.log.length) {
    logEl.innerHTML = game.log.map(logEntryHtml).join('');
    return;
  }
  const followNewest = logEl.scrollTop <= 1;
  const beforeH = logEl.scrollHeight;
  const frag = document.createElement('template');
  frag.innerHTML = game.log.slice(0, added).map(logEntryHtml).join('');
  logEl.prepend(frag.content);
  while (logEl.childElementCount > game.log.length) logEl.lastElementChild.remove();
  // Keep the player's place if they have scrolled back to read history.
  if (!followNewest) logEl.scrollTop += logEl.scrollHeight - beforeH;
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
  updateSeedPanel();
  updateCodexPanel();
  updateLog();
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
  updatePauseBtn();
  updateAutoHuntBtn();
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
  let line = t('tip.crop', { crop: t('crop.' + plant.cropId), status });
  if (plant.genome && !plant.withered) line += ` ${'★'.repeat(qualityRank(plant.genome))}`;
  return `<br>${line}`;
}

// Short label for a stored item, reusing the crop / stat strings.
function itemLabel(it) {
  if (it === 'forage') return t('stat.forage');
  if (it === 'meat') return t('stat.meat');
  if (it === 'meal') return t('stat.cooked');
  return t('crop.' + it);
}

// Extra tooltip lines for any structure on the tile (added, not replacing).
function structureHint(pos) {
  const tl = game.map.tiles[pos.y][pos.x];
  if (!tl.structure) return '';
  let s = `<br><strong>${t('structure.' + tl.structure)}</strong>`;
  if (tl.structure === 'stockpile') {
    const sp = game.stockpileAt(pos.x, pos.y);
    if (sp) {
      s += ` · ${t('tip.stored', { n: game.stockpileFood(sp), cap: STOCKPILE_CAP })}`;
      const parts = STOCKPILE_ITEMS.filter((it) => sp.items[it] > 0).map(
        (it) => `${itemLabel(it)} ${sp.items[it]}`,
      );
      if (parts.length) s += `<br>${parts.join(' · ')}`;
    }
  } else if (tl.structure === 'hearth') {
    s += ` · ${t(game.hearthsLit ? 'tip.hearthLit' : 'tip.hearthUnlit')}`;
  }
  return s;
}

function growthHint(tile) {
  if (tile.type === 'water') return '';
  const e = game.environment;
  const rate = tempGrowthFactor(e.temperature) * sunGrowthFactor(tile.sunlight, e.daylight);
  return `<br>${t('tip.growthHere', { n: Math.round(rate * 100) })}`;
}

function sowHint(tile) {
  if (tool !== 'sow' || tile.type === 'water' || tile.plant) return '';
  if (!game.canSow(cropId)) {
    return `<br>${t('tip.noSeed', { crop: t('crop.' + cropId) })}`;
  }
  const seed = game.bestSeed(cropId);
  const bonus = (tile.tilled ? TILL_SURVIVAL_BONUS : 0) + survivalGeneBonus(seed.genome);
  const chance = survivalChance(cropSuitability(getCrop(cropId), tile), bonus);
  return `<br>${t('tip.sowHere', {
    crop: t('crop.' + cropId),
    rank: '★'.repeat(qualityRank(seed.genome)),
    n: Math.round(chance * 100),
  })}`;
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
    `${tilled}${describePlant(tl.plant)}${structureHint(pos)}${growthHint(tl)}${sowHint(tl)}`;
  const { rect } = canvasMetrics();
  tooltip.style.left = `${clientX - rect.left + 14}px`;
  tooltip.style.top = `${clientY - rect.top + 14}px`;
}

// Range tools paint a task on every tile a drag crosses; single-target
// tools (move / hunt) keep the classic drag-to-pan.
const PAINT_TOOLS = new Set(['harvest', 'sow', 'till', 'water', 'build', 'cancel']);

let activePointer = null;
let dragged = false;
let painting = false;
let downX = 0;
let downY = 0;
let lastX = 0;
let lastY = 0;
const paintedTiles = new Set();

function placeTask(pos) {
  if (tool === 'cancel') {
    game.cancelTasksAt(pos.x, pos.y);
    updateTaskPanel();
    return;
  }
  game.enqueueTask(tool, pos.x, pos.y, {
    cropId,
    structure,
    assignee: game.selectedColonist,
  });
  updateTaskPanel();
}

// Queue a task on the tile under the pointer — at most once per tile per drag.
function paintTile(clientX, clientY) {
  const pos = tileAt(clientX, clientY);
  if (!pos) return;
  const key = `${pos.x},${pos.y}`;
  if (paintedTiles.has(key)) return;
  paintedTiles.add(key);
  placeTask(pos);
}

canvas.addEventListener('pointerdown', (ev) => {
  activePointer = ev.pointerId;
  dragged = false;
  downX = lastX = ev.clientX;
  downY = lastY = ev.clientY;
  canvas.setPointerCapture(ev.pointerId);
  painting = PAINT_TOOLS.has(tool);
  paintedTiles.clear();
  if (painting) {
    tooltip.hidden = true;
    paintTile(ev.clientX, ev.clientY);
  }
});

canvas.addEventListener('pointermove', (ev) => {
  if (activePointer === ev.pointerId) {
    if (painting) {
      // Paint mode: mark tiles, never pan the map.
      game.hover = tileAt(ev.clientX, ev.clientY);
      paintTile(ev.clientX, ev.clientY);
      return;
    }
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
  // A single-target tool places its task on a tap (paint tools placed
  // theirs already, tile by tile, as the pointer moved).
  if (!painting && !dragged) {
    const pos = tileAt(ev.clientX, ev.clientY);
    if (pos) placeTask(pos);
  }
  activePointer = null;
  dragged = false;
  painting = false;
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', (ev) => {
  if (activePointer === ev.pointerId) {
    activePointer = null;
    dragged = false;
    painting = false;
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
  if (k === ' ') {
    togglePause();
    ev.preventDefault();
    return;
  }
  if (k >= '1' && k <= '5') {
    // Keys 1–5 pick a game speed.
    const idx = Number(k) - 1;
    game.setSpeed(idx);
    const btn = speedsEl.querySelector(`button[data-speed="${idx}"]`);
    if (btn) selectIn(speedsEl, btn, 'speed');
    ev.preventDefault();
    return;
  }
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

structuresEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-structure]');
  if (!btn) return;
  structure = selectIn(structuresEl, btn, 'structure');
  showToast(t('hint.structure.' + structure));
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

// --- pause / resume -------------------------------------------------------

function updatePauseBtn() {
  pauseBtn.textContent = t(game.paused ? 'btn.resume' : 'btn.pause');
  pauseBtn.classList.toggle('paused', game.paused);
  pausedBadge.hidden = !game.paused;
}

function togglePause() {
  game.togglePause();
  updatePauseBtn();
}

pauseBtn.addEventListener('click', togglePause);

// --- auto-hunt toggle -----------------------------------------------------

function updateAutoHuntBtn() {
  autoHuntBtn.textContent = `${t('label.autoHunt')}: ${t(game.autoHunt ? 'val.on' : 'val.off')}`;
  autoHuntBtn.classList.toggle('on', game.autoHunt);
}

autoHuntBtn.addEventListener('click', () => {
  game.autoHunt = !game.autoHunt;
  updateAutoHuntBtn();
});

// --- victory: surviving the first year -----------------------------------

function showVictory() {
  let bestSeed = 0;
  for (const id of CROP_IDS) bestSeed = Math.max(bestSeed, game.bestSeedRank(id));
  renderRows(victorySummaryEl, [
    [t('stat.survived'), game.colonists.length],
    [t('stat.foodStored'), game.totalFood],
    [t('stat.meals'), game.meals.eaten],
    [t('stat.bestSeed'), bestSeed ? '★'.repeat(bestSeed) : t('val.none')],
    [t('stat.cropsLost'), game.cropsLost],
    [t('stat.spoiled'), game.pestsLost],
  ]);
  victoryEl.hidden = false;
  game.paused = true; // freeze under the overlay so the summary can be read
  updatePauseBtn();
}

$('victory-continue').addEventListener('click', () => {
  victoryEl.hidden = true;
  game.paused = false;
  updatePauseBtn();
});

$('victory-new').addEventListener('click', () => {
  newMap(randomSeed());
  victoryEl.hidden = true;
  game.paused = false;
  updatePauseBtn();
});

// --- work-order target: the whole colony, or one named colonist -----------

colonistsEl.addEventListener('click', (ev) => {
  const row = ev.target.closest('.colonist-row');
  if (!row) return;
  game.selectedColonist = row.dataset.colonist;
  showToast(t('hint.targetOne', { name: game.selectedColonist }));
  updateColonistsPanel();
});

targetAllBtn.addEventListener('click', () => {
  game.selectedColonist = null;
  showToast(t('hint.targetAll'));
  updateColonistsPanel();
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
  updateSeedPanel();
  updateCodexPanel();
  updateLog();
  updateEnvPanel();
  updateMapStats();
  if (gameoverEl.hidden === game.over) gameoverEl.hidden = !game.over;
  const season = game.consumeSeasonChange();
  if (season) showToast(t('note.' + season));
  if (game.consumePestEvent()) showToast(t('note.pests'));
  if (game.consumeColdEvent()) showToast(t('note.cold'));
  if (game.consumeWinEvent()) showVictory();
}, 150);
