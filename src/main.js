import './style.css';
import {
  GRID_COLS,
  GRID_ROWS,
  DRAG_THRESHOLD,
  SCROLL_STEP,
  TILL_SURVIVAL_BONUS,
  STOCKPILE_CAP,
  BUILD_COSTS,
} from './config.js';
import { hashSeed, randomSeed } from './core/rng.js';
import {
  isRipe,
  cropSuitability,
  survivalChance,
  getCrop,
  CROP_IDS,
  CROP_TYPES,
  CATEGORIES,
  cropsOfCategory,
} from './crops.js';
import {
  qualityRank,
  RANK_MAX,
  phenotype,
  QUALITY_GENES,
  partIndex,
  survivalGeneBonus,
} from './genetics.js';
import { tempGrowthFactor, sunGrowthFactor } from './season.js';
import { t, setLang, getLang } from './i18n.js';
import { Game, STOCKPILE_ITEMS } from './game.js';
import { GROUP_COLORS } from './groups.js';
import { TIPS, randomTipIndex } from './tips.js';

const canvas = document.getElementById('map');
const game = new Game(canvas);

// Exposed for debugging and headless checks; harmless in production.
window.game = game;
window.GROUP_COLORS = GROUP_COLORS;
window.crops = { CROP_TYPES, CROP_IDS, CATEGORIES, getCrop, cropsOfCategory };

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
const foodBreakdownEl = $('food-breakdown');
const codexEl = $('codex');
const logEl = $('event-log');
const legendEl = $('legend');
const gameoverEl = $('gameover');
const victoryEl = $('victory');
const victorySummaryEl = $('victory-summary');
const autoHuntBtn = $('autohunt-btn');
const autoModeBtn = $('automode-btn');
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
const cropPanelEl = $('crop-panel');
const structurePanelEl = $('structure-panel');
const tipCatEl = $('tip-cat');
const tipTextEl = $('tip-text');
const tipNextEl = $('tip-next');

const PAN_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

let tool = 'move';
let cropId = null; // picked from this run's starting crops after newMap
let structure = 'fence';

const archiveLink = $('archive-link');
if (archiveLink && location.pathname.includes('/versions/')) {
  archiveLink.href = '../';
}

// --- transient hint popups (toast) ---------------------------------------

let toastTimer = null;
function showToast(text, isError = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle('error', isError);
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

// Condition icons next to the colonist's name (alpha 21). Tooltip on
// each icon explains the reason and the in-game penalty it carries.
function colonistConditionIcons(c) {
  const ico = [];
  if (c.health !== undefined && c.health < 0.5) {
    ico.push(`<span class="cond-ico" title="${t('cond.injured')}">🤕</span>`);
  }
  if (c.sleep !== undefined && c.sleep < 0.3) {
    ico.push(`<span class="cond-ico" title="${t('cond.sleepy')}">😴</span>`);
  }
  // Skill highlight: any skill above 0.7 gets a star tooltip.
  if (c.skills) {
    const top = Object.entries(c.skills).reduce((m, e) => (e[1] > m[1] ? e : m), [null, 0]);
    if (top[0] && top[1] >= 0.7) {
      const pct = Math.round(top[1] * 100);
      ico.push(
        `<span class="cond-ico" title="${t('cond.skilled', { skill: t('skill.' + top[0]), pct })}">⭐</span>`,
      );
    }
  }
  return ico.length ? ` ${ico.join('')}` : '';
}

// What the colonist is doing right now, with a parenthetical detail so a
// row can say "Working (sowing wheat)" or "Building (fence)" instead of
// just "Working".
function colonistStateLabel(c) {
  const base = t('state.' + c.state);
  const task = c.currentTask;
  if (!task) return base;
  let detail = '';
  if (task.type === 'sow' && task.cropId) {
    detail = t('detail.sow', { crop: t('crop.' + task.cropId) });
  } else if (task.type === 'harvest') {
    const tl = game.map.tiles[task.y]?.[task.x];
    if (tl?.plant?.kind === 'crop') {
      detail = t('detail.harvest', { crop: t('crop.' + tl.plant.cropId) });
    } else if (tl?.plant?.kind === 'tree' || tl?.plant?.kind === 'stump') {
      detail = t('detail.chop');
    } else if (tl?.plant?.kind === 'wild') {
      detail = t('detail.forage');
    }
  } else if (task.type === 'build' && task.structure) {
    detail = t('detail.build', { structure: t('structure.' + task.structure) });
  } else if (task.type === 'cook') {
    detail = t('detail.cook');
  } else if (task.type === 'hunt') {
    detail = t('detail.hunt');
  } else if (task.type === 'till') {
    detail = t('detail.till');
  } else if (task.type === 'water') {
    detail = t('detail.water');
  } else if (task.type === 'weed') {
    detail = t('detail.weed');
  } else if (task.type === 'store') {
    detail = t('detail.store');
  } else if (task.type === 'fetch') {
    detail = t('detail.fetch');
  }
  return detail ? `${base} (${detail})` : base;
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
      const icons = colonistConditionIcons(c);
      return (
        `<div class="colonist-row${sel}" data-colonist="${c.name}">` +
        `<div class="crow-head"><span>${c.name}${icons}</span>` +
        `<span class="cstate">${colonistStateLabel(c)}</span></div>` +
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

// Mini icons that give each stat row a quick visual handle.
const STAT_ICON = {
  population: '👥',
  food: '🥖',
  meal: '🍲',
  wood: '🪵',
  warehouse: '📦',
  seeds: '🌱',
  cropsLost: '🥀',
  spoiled: '🐛',
  meals: '🍴',
  missed: '⚠',
};
const labelIcon = (icon, text) => `<span class="stat-ico">${icon}</span>${text}`;

function updateColonyStats() {
  const s = game.storage;
  const ti = (it) => game.totalItem(it);
  let spUsed = 0;
  for (const sp of game.stockpiles) spUsed += game.stockpileFood(sp);
  const spCap = game.stockpiles.length * STOCKPILE_CAP;
  // Seed total across every crop the colony holds.
  let seedTotal = 0;
  for (const id of CROP_IDS) seedTotal += game.seeds[id]?.length || 0;
  renderRows(colonyStatsEl, [
    [labelIcon(STAT_ICON.population, t('stat.population')), game.colonists.length],
    [labelIcon(STAT_ICON.food, t('stat.foodStored')), game.totalFood],
    [labelIcon(STAT_ICON.wood, t('stat.wood')), Math.ceil(s.wood)],
    [labelIcon(STAT_ICON.seeds, t('stat.seedTotal')), seedTotal],
    [labelIcon(STAT_ICON.warehouse, t('stat.stockpiles')), `${spUsed} / ${spCap}`],
    [labelIcon(STAT_ICON.meals, t('stat.meals')), game.meals.eaten],
    [labelIcon(STAT_ICON.missed, t('stat.missed')), game.meals.missed],
    [labelIcon(STAT_ICON.cropsLost, t('stat.cropsLost')), game.cropsLost],
    [labelIcon(STAT_ICON.spoiled, t('stat.spoiled')), game.pestsLost],
  ]);
  // Breakdown sub-panel: per-food on-hand counts (combined raw on-hand and
  // any cooked meals). Hidden until the user expands the disclosure.
  const breakdown = [
    [labelIcon('🍲', t('stat.cooked')), ti('meal')],
    [labelIcon('🥩', t('stat.meat')), ti('meat')],
    [labelIcon('🌿', t('stat.forage')), ti('forage')],
  ];
  // Per-crop, but only crops the colony has any of.
  for (const id of CROP_IDS) {
    const n = ti(id);
    if (n > 0) breakdown.push([labelIcon('🌾', t('crop.' + id)), n]);
  }
  renderRows(foodBreakdownEl, breakdown);
}

// Show the crop / structure picker only for the tool that uses it.
function updateToolPanels() {
  cropPanelEl.hidden = tool !== 'sow';
  structurePanelEl.hidden = tool !== 'build';
}

// Grey out a crop the colony has no seed of — it cannot be sown.
function updateCropButtons() {
  for (const btn of cropsEl.querySelectorAll('button[data-crop]')) {
    btn.classList.toggle('disabled-opt', game.seedCount(btn.dataset.crop) === 0);
  }
}

// A one-line hover hint built from the crop's own data.
function cropHint(id) {
  const c = getCrop(id);
  return `${t('crop.' + id)} — ${t('cat.' + c.category)} · ${t('hint.cropStats', {
    grow: c.growthTime,
    yield: c.yield,
    nut: Math.round(c.nutrition * 100),
  })}`;
}

// Crops the picker should expose — the run's eight starters plus any
// extras the colony has picked up since (e.g. a trader gift).
function pickerCrops() {
  const set = new Set(game.startingCrops || []);
  for (const id of CROP_IDS) {
    if (game.seeds[id] && game.seeds[id].length > 0) set.add(id);
  }
  return CROP_IDS.filter((id) => set.has(id));
}

// Rebuild the crop picker. Called on new map and after a trader visit.
function rebuildCropPicker() {
  const ids = pickerCrops();
  if (!ids.length) {
    cropsEl.innerHTML = '';
    cropId = null;
    return;
  }
  if (!ids.includes(cropId)) cropId = ids[0];
  cropsEl.innerHTML = ids
    .map((id) => {
      const sel = id === cropId ? ' active' : '';
      return `<button type="button" data-crop="${id}" class="crop-btn${sel}">${t('crop.' + id)}</button>`;
    })
    .join('');
  for (const btn of cropsEl.querySelectorAll('button[data-crop]')) {
    btn.title = cropHint(btn.dataset.crop);
  }
  updateCropButtons();
}

// A single random tip from the pool, rotated on a timer or the Next button.
let tipIndex = randomTipIndex();
function showTip() {
  const tip = TIPS[tipIndex];
  tipCatEl.textContent = t('tipcat.' + tip.cat);
  tipCatEl.className = 'tip-cat tip-cat-' + tip.cat;
  tipTextEl.textContent = getLang() === 'ja' ? tip.ja : tip.en;
}
function nextTip() {
  tipIndex = randomTipIndex(tipIndex);
  showTip();
}

// Seed stock: each crop's seeds bucketed by quality rank (★).
// Only the crops the colony has ever held seeds of show up — the catalogue
// holds many more, but listing every empty row would dwarf the panel.
function seedPanelCrops() {
  const set = new Set(game.startingCrops || []);
  for (const id of CROP_IDS) if (game.seeds[id] && game.seeds[id].length > 0) set.add(id);
  return CROP_IDS.filter((id) => set.has(id));
}

function updateSeedPanel() {
  seedStockEl.innerHTML = seedPanelCrops().map((id) => {
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
  // Reflect the running total in the disclosure label so the panel says
  // "Seed stock · 96" while collapsed.
  let n = 0;
  for (const id of CROP_IDS) n += game.seeds[id]?.length || 0;
  const sum = seedStockEl.parentElement?.querySelector('summary');
  if (sum) sum.textContent = `${t('label.seeds')} · ${n}`;
}

// Variety codex: per crop, a picture of the best variety bred so far, its
// ★ rank, and a bar per gameplay gene with a notch marking the origin.
// Only crops the colony has actually held seed of make it into the codex.
function updateCodexPanel() {
  const legend = QUALITY_GENES.map((g) => t('gene.' + g)).join(' · ');
  const ids = CROP_IDS.filter((id) => game.codex[id]);
  const rows = ids.map((id) => {
    const c = game.codex[id];
    const genes = QUALITY_GENES.map((gid) => {
      const cur = Math.round(phenotype(c.best, gid) * 100);
      const org = Math.round(phenotype(c.origin, gid) * 100);
      return (
        `<span class="gene-cell" title="${t('gene.' + gid)}: ${cur}% (origin ${org}%)">` +
        `<i style="width:${cur}%"></i><u style="left:${org}%"></u></span>`
      );
    }).join('');
    return (
      `<div class="codex-row">` +
      `<canvas class="codex-preview" data-crop="${id}" width="48" height="48"></canvas>` +
      `<div class="codex-info"><div class="codex-head">` +
      `<span class="codex-crop">${t('crop.' + id)}</span>` +
      `<span class="codex-rank">${'★'.repeat(qualityRank(c.best))}</span></div>` +
      `<div class="codex-genes">${genes}</div></div></div>`
    );
  }).join('');
  codexEl.innerHTML = `<p class="codex-legend">${legend}</p>${rows}`;
  for (const cv of codexEl.querySelectorAll('canvas.codex-preview')) {
    const id = cv.dataset.crop;
    game.renderer.drawCropPreview(cv.getContext('2d'), cv.width, cv.height, id, game.codex[id].best);
  }
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
  updateCropButtons();
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
  // Hover hints on the tool / crop / structure buttons.
  for (const b of toolsEl.querySelectorAll('button[data-tool]')) {
    b.title = t('hint.task.' + b.dataset.tool);
  }
  // The crop picker is built dynamically — relabel & retitle its buttons.
  for (const b of cropsEl.querySelectorAll('button[data-crop]')) {
    const id = b.dataset.crop;
    b.textContent = t('crop.' + id);
    b.title = cropHint(id);
  }
  for (const b of structuresEl.querySelectorAll('button[data-structure]')) {
    const id = b.dataset.structure;
    const cost = BUILD_COSTS[id] || 0;
    b.title = `${t('hint.structure.' + id)} ${t('hint.buildCost', { n: cost })}`;
  }
  showTip();
  document.documentElement.lang = getLang();
  refreshPanels();
  updatePauseBtn();
  updateAutoHuntBtn();
  updateAutoModeBtn();
}

// --- map lifecycle --------------------------------------------------------

function newMap(seed, biomeId, groupSetup) {
  game.newMap(seed, biomeId, groupSetup);
  seedInput.value = String(game.seed);
  rebuildCropPicker();
  updateBiomePicker();
  updateGroupSetup();
  refreshPanels();
}

// --- Group setup (alpha 23) --------------------------------------------
//
// One-shot setup at start (or on Regenerate). Picks the number of
// colony groups, and for each group, picks an autonomy script. The
// number-of-groups slider lives in the World panel; the per-group
// editor is rendered into its sibling list. State persists across
// Regenerate clicks until the user explicitly changes it.
const groupCountEl = $('group-count');
const groupCountLabelEl = $('group-count-label');
const groupListEl = $('group-list');
const AUTONOMY_OPTIONS = ['balanced', 'farmer', 'scout'];

function readGroupSetup() {
  // Pull current values from the DOM into a setup array.
  if (!groupListEl) return null;
  const rows = [...groupListEl.querySelectorAll('.group-row')];
  return rows.map((row, i) => ({
    name: `Colony ${String.fromCharCode(65 + i)}`,
    scriptId: row.querySelector('select.group-script')?.value || 'balanced',
    colonistCount: Math.max(1, Math.min(20,
      parseInt(row.querySelector('input.group-colonists')?.value, 10) || 4)),
  }));
}

function renderGroupRows(n) {
  if (!groupListEl) return;
  // Carry forward whatever the user had selected, only adding rows.
  const prev = readGroupSetup() || [];
  const setup = [];
  for (let i = 0; i < n; i++) {
    setup.push(prev[i] || { scriptId: 'balanced', colonistCount: 4 });
  }
  // Group color is decided by the game; the row shows it as a chip so
  // the user knows what color each colony will be.
  groupListEl.innerHTML = setup.map((s, i) => {
    const color = window.GROUP_COLORS?.[i] || null;
    const chip = color ? `<span class="group-chip" style="background:${color.fill}"></span>` : '';
    const opts = AUTONOMY_OPTIONS.map(
      (id) => `<option value="${id}"${id === s.scriptId ? ' selected' : ''}>${t('script.' + id)}</option>`,
    ).join('');
    return (
      `<div class="group-row">` +
      `${chip}<strong>${t('group.label', { letter: String.fromCharCode(65 + i) })}</strong> ` +
      `<select class="group-script" data-group="${i}">${opts}</select>` +
      `<label class="group-colcount">${t('group.colonists')} ` +
      `<input class="group-colonists" type="number" min="1" max="20" value="${s.colonistCount}"></label>` +
      `</div>`
    );
  }).join('');
}

function updateGroupSetup() {
  if (!groupCountEl) return;
  // After newMap: sync slider + rows to whatever the game currently has.
  const n = game.groups.length || 1;
  groupCountEl.value = n;
  if (groupCountLabelEl) groupCountLabelEl.textContent = n;
  renderGroupRows(n);
}

if (groupCountEl) {
  groupCountEl.addEventListener('input', () => {
    const n = Math.max(1, Math.min(8, parseInt(groupCountEl.value, 10) || 1));
    if (groupCountLabelEl) groupCountLabelEl.textContent = n;
    renderGroupRows(n);
  });
}

const applyGroupsBtn = $('apply-groups');
if (applyGroupsBtn) {
  applyGroupsBtn.addEventListener('click', () => {
    const setup = readGroupSetup();
    if (!setup || setup.length === 0) return;
    newMap(randomSeed(), null, setup);
    showToast(t('hint.groupsApplied', { n: setup.length }));
  });
}

// --- Biome picker (alpha 22) ---------------------------------------------
const biomePickerEl = $('biomes');
function updateBiomePicker() {
  if (!biomePickerEl) return;
  const current = game.biome?.id || 'temperate';
  for (const b of biomePickerEl.querySelectorAll('button[data-biome]')) {
    b.classList.toggle('active', b.dataset.biome === current);
  }
}
if (biomePickerEl) {
  biomePickerEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-biome]');
    if (!btn) return;
    newMap(randomSeed(), btn.dataset.biome);
    showToast(t('hint.biome.' + btn.dataset.biome));
  });
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
  if (plant.kind === 'tree') {
    return `<br>${t('tip.plantTree', { n: Math.round((plant.growth || 1) * 100) })}`;
  }
  if (plant.kind === 'stump') {
    const left = Math.max(0, Math.ceil(plant.regrowAt - game.clock));
    return `<br>${t('tip.plantStump', { n: left })}`;
  }
  let status;
  if (plant.withered) status = t('tip.withered');
  else if (isRipe(plant)) status = t('tip.ripe');
  else status = `${Math.round(plant.growth * 100)}%`;
  let line = t('tip.crop', { crop: t('crop.' + plant.cropId), status });
  const crop = getCrop(plant.cropId);
  if (crop) {
    line += `<br>${t('cat.' + crop.category)} · ${t('tip.nutrition', {
      n: Math.round(crop.nutrition * 100),
    })}`;
  }
  if (plant.genome && !plant.withered) {
    line += ` ${'★'.repeat(qualityRank(plant.genome))}`;
    const shape = t('look.shape.' + partIndex(plant.genome, 'shape', 4));
    const leaf = t('look.leaf.' + partIndex(plant.genome, 'leaf', 3));
    const surface = t('look.surface.' + partIndex(plant.genome, 'surface', 3));
    line += `<br>${t('tip.look', { desc: `${shape} · ${leaf} · ${surface}` })}`;
  }
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

// An order error is shown at most once per pointer gesture (a click or a
// paint drag), so a long drag over bad tiles does not flood the toast.
let gestureErrorShown = false;

function showOrderError(key) {
  const params = key === 'err.noSeed' ? { crop: t('crop.' + cropId) } : undefined;
  showToast(`⚠ ${t(key, params)}`, true);
}

function placeTask(pos) {
  if (tool === 'cancel') {
    game.cancelTasksAt(pos.x, pos.y);
    updateTaskPanel();
    return;
  }
  const err = game.enqueueTask(tool, pos.x, pos.y, {
    cropId,
    structure,
    assignee: game.selectedColonist,
  });
  if (err && !gestureErrorShown) {
    gestureErrorShown = true;
    showOrderError(err);
  }
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
  gestureErrorShown = false;
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
  updateToolPanels();
  showToast(t('hint.task.' + tool));
});

cropsEl.addEventListener('click', (ev) => {
  const btn = ev.target.closest('button[data-crop]');
  if (!btn) return;
  cropId = selectIn(cropsEl, btn, 'crop');
  showToast(cropHint(cropId));
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

function updateAutoModeBtn() {
  autoModeBtn.textContent = `${t('label.autoMode')}: ${t(game.autoMode ? 'val.on' : 'val.off')}`;
  autoModeBtn.classList.toggle('on', game.autoMode);
}

autoModeBtn.addEventListener('click', () => {
  game.autoMode = !game.autoMode;
  updateAutoModeBtn();
});

// --- victory: surviving the first year -----------------------------------

let victoryAutoClose = null;
function closeVictory() {
  victoryEl.hidden = true;
  game.paused = false;
  updatePauseBtn();
  if (victoryAutoClose) {
    clearTimeout(victoryAutoClose);
    victoryAutoClose = null;
  }
}

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
  // Auto-close the celebration after a beat — the colony plays on.
  if (victoryAutoClose) clearTimeout(victoryAutoClose);
  victoryAutoClose = setTimeout(() => closeVictory(), 10000);
}

$('victory-continue').addEventListener('click', closeVictory);

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

tipNextEl.addEventListener('click', nextTip);
setInterval(nextTip, 45000); // a fresh tip every so often

newMap(randomSeed());
applyI18n();
updateToolPanels();
game.start();
showToast(t('hint.welcome'));
setInterval(() => {
  updateColonistsPanel();
  updateTaskPanel();
  updateColonyStats();
  updateSeedPanel();
  updateCropButtons();
  updateCodexPanel();
  updateLog();
  updateEnvPanel();
  updateMapStats();
  if (gameoverEl.hidden === game.over) gameoverEl.hidden = !game.over;
  const season = game.consumeSeasonChange();
  if (season) showToast(t('note.' + season));
  if (game.consumePestEvent()) showToast(t('note.pests'));
  if (game.consumeColdEvent()) showToast(t('note.cold'));
  const baby = game.consumeBirthEvent();
  if (baby) showToast(t('note.birth', { name: baby }));
  const trader = game.consumeTraderEvent();
  if (trader) {
    const cropList = trader.seeds.map((id) => t('crop.' + id)).join(', ');
    showToast(t('note.trader', { wood: trader.wood, crops: cropList }));
    // Trader gifts may include crops the colony had never grown — rebuild
    // the picker so they show up as new options to sow.
    rebuildCropPicker();
  }
  if (game.consumeWinEvent()) showVictory();
}, 150);
