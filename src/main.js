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
  WILD_CROP_IDS,
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
const popupsBtn = $('popups-btn');
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

// --- Per-group view state (alpha 25) ----------------------------------
//
// `selectedGroupId` is the colony group the side panels show. `null`
// means "All colonies" — every colonist / every codex entry / every
// log line is visible. The group-tab strip above the Colony panel
// switches between groups (and back to All). Defaults to All until
// the player picks a tab.
let selectedGroupId = null;

function colonistsInView() {
  if (selectedGroupId == null) return game.colonists;
  return game.colonists.filter((c) => c.groupId === selectedGroupId);
}

function groupTabsEl() {
  return document.getElementById('group-tabs');
}

// G3: the tab strip used to rewrite its innerHTML every poll (150 ms),
// so a click whose mousedown landed on one button instance and mouseup
// on a freshly-rendered replacement would simply not fire. Cache the
// composed HTML and only assign when it actually changed. Keeping the
// nodes alive across polls makes single-click switching reliable.
let lastTabsHtml = null;
function renderGroupTabs() {
  const el = groupTabsEl();
  if (!el) return;
  let html;
  if (!game.groups || game.groups.length <= 1) {
    html = '';
  } else {
    const tabs = [
      `<button type="button" class="group-tab${selectedGroupId == null ? ' active' : ''}" data-group="all">${t('group.tabAll')}</button>`,
    ];
    for (const g of game.groups) {
      const sel = selectedGroupId === g.id ? ' active' : '';
      tabs.push(
        `<button type="button" class="group-tab${sel}" data-group="${g.id}">` +
        `<span class="group-chip" style="background:${g.color.fill}"></span>` +
        `${t('group.label', { letter: String.fromCharCode(65 + g.id) })}` +
        `</button>`,
      );
    }
    html = tabs.join('');
  }
  if (html === lastTabsHtml) return;
  lastTabsHtml = html;
  el.innerHTML = html;
}

function setupGroupTabsHandler() {
  const el = groupTabsEl();
  if (!el || el.dataset.bound) return;
  el.dataset.bound = '1';
  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button.group-tab[data-group]');
    if (!btn) return;
    const val = btn.dataset.group;
    selectedGroupId = val === 'all' ? null : Number(val);
    // Selected colonist may no longer be in the visible group.
    if (selectedGroupId != null && game.selectedColonist) {
      const c = game.colonists.find((x) => x.name === game.selectedColonist);
      if (!c || c.groupId !== selectedGroupId) game.selectedColonist = null;
    }
    renderGroupTabs();
    refreshPanels();
  });
}

// One colonist row used by both the per-group sections and the legacy
// flat render (kept around in case selectedColonist is still meaningful).
function colonistRowHtml(c) {
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
}

function updateColonistsPanel() {
  setupGroupTabsHandler();
  renderGroupTabs();
  // Drop a stale selection if that colonist is no longer with us.
  if (game.selectedColonist && !game.colonists.some((c) => c.name === game.selectedColonist)) {
    game.selectedColonist = null;
  }
  // F6: always render colonists as per-group sections. With a single
  // group, this collapses to one labelled section. With "All" the user
  // sees every group's roster stacked rather than a flat aggregated
  // list (which made it hard to tell who belonged to whom).
  const groups = game.groups || [];
  const visibleGroups = selectedGroupId == null
    ? groups
    : groups.filter((g) => g.id === selectedGroupId);
  const sections = visibleGroups.map((g) => {
    const label = g.name || t('group.label', { letter: String.fromCharCode(65 + g.id) });
    const rows = g.colonists.map(colonistRowHtml).join('')
      || `<div class="muted small">${t('val.none')}</div>`;
    return (
      `<div class="group-section">` +
      `<div class="group-section-head">` +
      `<span class="group-chip" style="background:${g.color.fill}"></span>` +
      `<strong>${label}</strong>` +
      `<span class="group-section-count">${g.colonists.length}</span>` +
      `</div>` +
      `<div class="group-section-body">${rows}</div>` +
      `</div>`
    );
  }).join('');
  colonistsEl.innerHTML = sections;
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
  beds: '🛏',
  seeds: '🌱',
  cropsLost: '🥀',
  spoiled: '🐛',
  meals: '🍴',
  missed: '⚠',
};
const labelIcon = (icon, text) => `<span class="stat-ico">${icon}</span>${text}`;

function updateColonyStats() {
  // When a specific group tab is active, show that group's identity-tracked
  // figures (own colonists, own seed stock, own meals/missed/lost counters
  // AND own on-hand store + wood). With B2/B3 the per-group ledgers are
  // maintained in lock-step with the colony aggregate, so the tab now
  // shows what that colony actually owns rather than the colony-wide pool.
  const g = selectedGroupId == null ? null : game.groups[selectedGroupId];
  const s = g ? g.storage : game.storage;
  // Item-total reader: per-group when a tab is active (on-hand from
  // g.storage only — stockpile items remain colony-wide), else colony.
  const ti = (it) => g ? (g.storage[it] || 0) : game.totalItem(it);
  // Stockpile rows: when a tab is active, only count piles this group
  // owns (B2 ownerId). With "All" selected, show every pile.
  let spUsed = 0;
  let spCap = 0;
  for (const sp of game.stockpiles) {
    if (g && sp.ownerId !== g.id) continue;
    spUsed += game.stockpileFood(sp);
    spCap += sp.cap || STOCKPILE_CAP;
  }
  // Seed total — either this group's stash, or the colony-wide aggregate.
  const seedSrc = g ? g.seeds : game.seeds;
  let seedTotal = 0;
  for (const id of CROP_IDS) seedTotal += seedSrc[id]?.length || 0;
  const popCount = g ? g.colonists.length : game.colonists.length;
  const mealsEaten = g ? g.meals.eaten : game.meals.eaten;
  const mealsMissed = g ? g.meals.missed : game.meals.missed;
  const cropsLost = g ? g.cropsLost : game.cropsLost;
  const pestsLost = g ? g.pestsLost : game.pestsLost;
  // Food-stored = on-hand (per-group when applicable) + the stockpile
  // food this group owns. For All this matches game.totalFood.
  let foodStored;
  if (g) {
    let onHand = 0;
    for (const id of STOCKPILE_ITEMS) {
      if (id === 'wood') continue;
      onHand += g.storage[id] || 0;
    }
    let owned = 0;
    for (const sp of game.stockpiles) {
      if (sp.ownerId !== g.id) continue;
      owned += game.stockpileFood(sp);
    }
    foodStored = onHand + owned;
  } else {
    foodStored = game.totalFood;
  }
  // α28 D3: mirror the Warehouses "used / cap" pattern with a Beds
  // row — pop / total hut capacity. Per-group when a tab is active.
  const bedCap = g ? game._hutCapacityFor(g.id) : game._hutCapacity();
  renderRows(colonyStatsEl, [
    [labelIcon(STAT_ICON.population, t('stat.population')), popCount],
    [labelIcon(STAT_ICON.beds, t('stat.beds')), `${popCount} / ${bedCap}`],
    [labelIcon(STAT_ICON.food, t('stat.foodStored')), foodStored],
    [labelIcon(STAT_ICON.wood, t('stat.wood')), Math.ceil(s.wood || 0)],
    [labelIcon(STAT_ICON.seeds, t('stat.seedTotal')), seedTotal],
    [labelIcon(STAT_ICON.warehouse, t('stat.stockpiles')), `${spUsed} / ${spCap}`],
    [labelIcon(STAT_ICON.meals, t('stat.meals')), mealsEaten],
    [labelIcon(STAT_ICON.missed, t('stat.missed')), mealsMissed],
    [labelIcon(STAT_ICON.cropsLost, t('stat.cropsLost')), cropsLost],
    [labelIcon(STAT_ICON.spoiled, t('stat.spoiled')), pestsLost],
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
  // T5: render the food-breakdown sparkline if the panel is in graph
  // mode (cheap when hidden; the SVG is just a string write).
  if (panelModes['food-breakdown'] === 'graph') {
    renderPanelGraph('food-breakdown', 'food', 'totalFood', '#e6b25a');
  }
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
//
// α25 follow-up: when a group tab is active, the panel filters down to
// that group's per-group seed pool (see B1 in cropSystem.js). With "All"
// selected, falls back to the colony-wide aggregate (`game.seeds`).
function seedPanelCrops() {
  const g = selectedGroupId == null ? null : game.groups[selectedGroupId];
  const src = g ? g.seeds : game.seeds;
  const set = new Set(g ? (g.startingCrops || []) : (game.startingCrops || []));
  for (const id of CROP_IDS) if (src[id] && src[id].length > 0) set.add(id);
  return CROP_IDS.filter((id) => set.has(id));
}

// T5: each sub-panel ("food-breakdown" / "seed-stock") has a Now-vs-Graph
// toggle. State + click handler lives here; the panel update functions
// check the mode and show either the numbers DL or the SVG sparkline.
const panelModes = { 'food-breakdown': 'current', 'seed-stock': 'current' };
function setPanelMode(target, mode) {
  panelModes[target] = mode;
  document.querySelectorAll(`.panel-mode-btn[data-target="${target}"]`).forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  // Show/hide table vs graph nodes.
  const table = document.getElementById(target);
  const graph = document.getElementById(`${target}-graph`);
  if (table) table.hidden = mode === 'graph';
  if (graph) graph.hidden = mode !== 'graph';
}
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('.panel-mode-btn[data-target]');
  if (!btn) return;
  setPanelMode(btn.dataset.target, btn.dataset.mode);
  refreshPanels();
});

function drawSparkline(samples, pickValue, color) {
  if (!samples || samples.length === 0) {
    return `<svg viewBox="0 0 220 60" preserveAspectRatio="none"><text x="110" y="33" text-anchor="middle" class="hist-empty">—</text></svg>`;
  }
  let min = Infinity, max = -Infinity;
  const vals = samples.map(pickValue);
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (samples.length < 2 || max === min) {
    const last = vals[vals.length - 1] || 0;
    return `<svg viewBox="0 0 220 60" preserveAspectRatio="none">` +
      `<line x1="2" y1="30" x2="218" y2="30" stroke="${color}" stroke-width="1.4" />` +
      `</svg>` +
      `<div class="graph-caption"><span>min ${min}</span><span>now ${last}</span><span>max ${max}</span></div>`;
  }
  const range = max - min;
  const n = samples.length;
  const pts = vals.map((v, i) => {
    const x = 2 + (i / (n - 1)) * 216;
    const y = 58 - ((v - min) / range) * 56;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 220 60" preserveAspectRatio="none">` +
    `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.4" />` +
    `</svg>` +
    `<div class="graph-caption"><span>min ${min}</span><span>now ${vals[vals.length - 1]}</span><span>max ${max}</span></div>`;
}

function renderPanelGraph(targetId, sampleKey, colonyKey, color) {
  const el = document.getElementById(`${targetId}-graph`);
  if (!el) return;
  const samples = game.history?.samples || [];
  const pick = selectedGroupId == null
    ? (s) => s[colonyKey] || 0
    : (s) => s.perGroup?.[selectedGroupId]?.[sampleKey] || 0;
  el.innerHTML = drawSparkline(samples, pick, color);
}

function updateSeedPanel() {
  // T5: when the panel is in graph mode, draw the sparkline and skip
  // the rows render. Total label on the summary still reflects the
  // current pool so the closed disclosure shows "Seed stock · N".
  if (panelModes['seed-stock'] === 'graph') {
    renderPanelGraph('seed-stock', 'seeds', 'seedTotal', '#9ab85a');
  }
  const g = selectedGroupId == null ? null : game.groups[selectedGroupId];
  const src = g ? g.seeds : game.seeds;
  seedStockEl.innerHTML = seedPanelCrops().map((id) => {
    const buckets = new Array(RANK_MAX + 1).fill(0);
    for (const seed of src[id] || []) buckets[qualityRank(seed.genome)]++;
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
  // "Seed stock · 96" while collapsed. Per-group when a tab is active.
  let n = 0;
  for (const id of CROP_IDS) n += src[id]?.length || 0;
  const sum = seedStockEl.parentElement?.querySelector('summary');
  if (sum) sum.textContent = `${t('label.seeds')} · ${n}`;
}

// One codex entry row — extracted so the per-group section render can
// reuse it. `crop` is the codex record { origin, best } for `id`.
function codexRowHtml(id, c, groupId) {
  const genes = QUALITY_GENES.map((gid) => {
    const cur = Math.round(phenotype(c.best, gid) * 100);
    const org = Math.round(phenotype(c.origin, gid) * 100);
    return (
      `<span class="gene-cell" title="${t('gene.' + gid)}: ${cur}% (origin ${org}%)">` +
      `<i style="width:${cur}%"></i><u style="left:${org}%"></u></span>`
    );
  }).join('');
  // α28-P2: each crop row gets a "Pedigree" link. Disabled (no click)
  // when the lineage is empty (= original strain only).
  const lineageCount = (c.lineage?.length) || 0;
  const pedigreeAttr = lineageCount > 0
    ? ` data-pedigree-crop="${id}" data-pedigree-group="${groupId}"`
    : '';
  const pedigreeClass = lineageCount > 0 ? 'codex-pedigree' : 'codex-pedigree disabled';
  return (
    `<div class="codex-row">` +
    `<canvas class="codex-preview" data-crop="${id}" data-best="1" width="48" height="48"></canvas>` +
    `<div class="codex-info"><div class="codex-head">` +
    `<span class="codex-crop">${t('crop.' + id)}</span>` +
    `<span class="codex-rank">${'★'.repeat(qualityRank(c.best))}</span>` +
    `<a class="${pedigreeClass}"${pedigreeAttr} title="${t('label.pedigreeHint')}">${t('label.pedigree')}</a>` +
    `</div>` +
    `<div class="codex-genes">${genes}</div></div></div>`
  );
}

// F5: variety codex is rendered as per-group sections. Each group tracks
// its own breeding programme, so the codex view stacks one section per
// colony (or a single section when a specific group tab is active).
// Stat-bar legend stays at the top.
function updateCodexPanel() {
  const legend = QUALITY_GENES.map((g) => t('gene.' + g)).join(' · ');
  const groups = game.groups || [];
  const visibleGroups = selectedGroupId == null
    ? groups
    : groups.filter((g) => g.id === selectedGroupId);
  const sections = visibleGroups.map((g) => {
    const label = g.name || t('group.label', { letter: String.fromCharCode(65 + g.id) });
    const codex = g.codex || {};
    const ids = CROP_IDS.filter((id) => codex[id]);
    const rows = ids.map((id) => codexRowHtml(id, codex[id], g.id)).join('')
      || `<div class="muted small">${t('val.none')}</div>`;
    return (
      `<div class="group-section" data-group="${g.id}">` +
      `<div class="group-section-head">` +
      `<span class="group-chip" style="background:${g.color.fill}"></span>` +
      `<strong>${label}</strong>` +
      `<span class="group-section-count">${ids.length}</span>` +
      `</div>` +
      `<div class="group-section-body">${rows}</div>` +
      `</div>`
    );
  }).join('');
  codexEl.innerHTML = `<p class="codex-legend">${legend}</p>${sections}`;
  // Paint each preview canvas with its group's best genome.
  for (const section of codexEl.querySelectorAll('.group-section')) {
    const gid = Number(section.dataset.group);
    const codex = game.groups[gid]?.codex || {};
    for (const cv of section.querySelectorAll('canvas.codex-preview')) {
      const id = cv.dataset.crop;
      if (codex[id]) {
        game.renderer.drawCropPreview(cv.getContext('2d'), cv.width, cv.height, id, codex[id].best);
      }
    }
  }
}

// The activity log keeps up to ~1000 events. It re-renders only when an
// entry is added (game.logRev) and prepends just the new entries, so the
// panel stays cheap and does not snap to the top while it is scrolled.
//
// Alpha 25: when a group tab is active, the log filters to entries the
// colonist's group is responsible for. Colony-wide events (cold snap,
// trader visit, pest outbreak) carry no groupId and always show.
let lastLogRev = -1;
let lastLogGroup = null;
const logEntryHtml = (e) => `<li class="${e.cls}">${e.icon} ${e.text}</li>`;
// H1: a group tab is now a STRICT filter — colony-wide entries (no
// groupId attached) stay in the "All" view only. This stops the
// per-colony log from being polluted by the season banner / cold snap
// / pest events of the colony as a whole.
function logEntryMatches(e) {
  if (selectedGroupId == null) return true;
  return e.groupId === selectedGroupId;
}
function updateLog() {
  // Group-tab change forces a rebuild even if no new entries arrived.
  if (game.logRev === lastLogRev && selectedGroupId === lastLogGroup) return;
  const groupChanged = selectedGroupId !== lastLogGroup;
  const added = game.logRev - lastLogRev;
  lastLogRev = game.logRev;
  lastLogGroup = selectedGroupId;
  // Full rebuild on group switch, on reset, or when more entries arrived
  // than the log now holds (older ones evicted).
  if (groupChanged || added < 0 || added >= game.log.length) {
    logEl.innerHTML = game.log.filter(logEntryMatches).map(logEntryHtml).join('');
    return;
  }
  const followNewest = logEl.scrollTop <= 1;
  const beforeH = logEl.scrollHeight;
  const frag = document.createElement('template');
  frag.innerHTML = game.log.slice(0, added).filter(logEntryMatches).map(logEntryHtml).join('');
  logEl.prepend(frag.content);
  // Cap the visible count loosely at game.log.length so the DOM does not
  // grow unbounded as filtered entries accumulate.
  while (logEl.childElementCount > game.log.length) logEl.lastElementChild.remove();
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

// --- α27 Run history sparklines -----------------------------------------
//
// `game.history.samples` is a ring buffer the engine pushes one snapshot
// into every HISTORY_INTERVAL sim-seconds. We draw 8 small SVG charts so
// the player can eyeball trends without leaving the live screen. Drawing
// is skipped when the panel is collapsed — it's a closed-by-default
// <details> so the cost is zero until the player opens it.

const historyGraphsEl = $('history-graphs');
const historyPanelEl = $('history-panel');

const HISTORY_METRICS = [
  { key: 'population',  label: 'hist.population',  color: '#6fb1e0' },
  { key: 'totalFood',   label: 'hist.food',        color: '#e6b25a' },
  { key: 'wood',        label: 'hist.wood',        color: '#b08652' },
  { key: 'seedTotal',   label: 'hist.seeds',       color: '#9ab85a' },
  { key: 'mealsEaten',  label: 'hist.meals',       color: '#a576c2' },
  { key: 'mealsMissed', label: 'hist.missed',      color: '#d85a5a' },
  { key: 'cropsLost',   label: 'hist.cropsLost',   color: '#c47030' },
  { key: 'animals',     label: 'hist.animals',     color: '#7ea670' },
];

// α28-R1/R2: which group's history is the panel showing, and an
// invalidate token so a tab switch forces a redraw even when sample
// count hasn't changed.
let lastHistoryRender = -1;
let lastHistoryGroup = '__init__';
function updateHistoryGraphs() {
  if (!historyGraphsEl) return;
  // Skip the SVG build entirely while the panel is closed.
  if (historyPanelEl && !historyPanelEl.open) return;
  const samples = game.history?.samples || [];
  const sigGroup = selectedGroupId == null ? 'all' : `g${selectedGroupId}`;
  if (samples.length === lastHistoryRender && sigGroup === lastHistoryGroup) return;
  lastHistoryRender = samples.length;
  lastHistoryGroup = sigGroup;
  const w = 220;
  const h = 36;
  const pad = 2;
  // α28-R1: pick the right per-sample reader based on selectedGroupId.
  const pickValue = (s, key) => {
    if (selectedGroupId == null) return s[key] || 0;
    return s.perGroup?.[selectedGroupId]?.[key] || 0;
  };
  // α28-R2: animals are a map-wide entity, not owned by any colony.
  // Hide that row entirely when a specific group tab is active.
  const metrics = selectedGroupId == null
    ? HISTORY_METRICS
    : HISTORY_METRICS.filter((m) => m.key !== 'animals');
  const out = [];
  for (const m of metrics) {
    const last = samples.length > 0 ? pickValue(samples[samples.length - 1], m.key) : 0;
    let body = '';
    if (samples.length < 2) {
      body = `<text x="${w / 2}" y="${h / 2 + 4}" text-anchor="middle" class="hist-empty">—</text>`;
    } else {
      let min = Infinity;
      let max = -Infinity;
      for (const s of samples) {
        const v = pickValue(s, m.key);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max === min) {
        // Flat line in the middle — still shows the metric is being tracked.
        const y = h / 2;
        body = `<line x1="${pad}" y1="${y}" x2="${w - pad}" y2="${y}" stroke="${m.color}" stroke-width="1.4" />`;
      } else {
        const range = max - min;
        const n = samples.length;
        const pts = samples.map((s, i) => {
          const x = pad + (i / (n - 1)) * (w - pad * 2);
          const y = h - pad - ((pickValue(s, m.key) - min) / range) * (h - pad * 2);
          return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(' ');
        body = `<polyline points="${pts}" fill="none" stroke="${m.color}" stroke-width="1.4" />`;
      }
    }
    out.push(
      `<div class="hist-row">` +
      `<span class="hist-label">${t(m.label)}</span>` +
      `<svg class="hist-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="${w}" height="${h}">${body}</svg>` +
      `<span class="hist-value">${last}</span>` +
      `</div>`
    );
  }
  historyGraphsEl.innerHTML = out.join('');
}

// When the user opens / closes the panel, force a redraw so the chart
// appears immediately on open instead of waiting for the next poll.
if (historyPanelEl) {
  historyPanelEl.addEventListener('toggle', () => {
    if (historyPanelEl.open) {
      lastHistoryRender = -1;
      updateHistoryGraphs();
    }
  });
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
  updateHistoryGraphs();
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
  updatePopupsBtn();
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

// --- Start screen (alpha 25) ------------------------------------------
//
// Boot does NOT auto-generate a world any more — the start screen shows
// first, and only when the player clicks Generate do we call newMap()
// and reveal the simulation UI. The start screen carries the full
// per-group setup (script / colonists / wood / 4 initial seeds + qty);
// the in-sim "Apply group setup" widget keeps the simpler subset.

const startScreenEl = $('start-screen');
const startBiomesEl = $('start-biomes');
const startSeedInputEl = $('start-seed');
const startSeedRandomBtn = $('start-seed-random');
const startGroupCountEl = $('start-group-count');
const startGroupCountLabelEl = $('start-group-count-label');
const startGroupListEl = $('start-group-list');
const startGenerateBtn = $('start-generate');

let startBiomeId = 'temperate';
const NO_CROP = '__random'; // marker value for "pick randomly"
const SEED_SLOTS = 4;
const SEED_DEFAULT_QTY = 12;

const WILD_SET = new Set(WILD_CROP_IDS);
function pickRandomSeed(excluded) {
  const pool = CROP_IDS.filter((id) => !WILD_SET.has(id) && !excluded.has(id));
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function readStartGroupSetup() {
  if (!startGroupListEl) return null;
  const rows = [...startGroupListEl.querySelectorAll('.group-row')];
  return rows.map((row, i) => {
    // Collect seed slots: each slot is a {id, count} pair. NO_CROP →
    // pick a random non-duplicate crop at generate time.
    const slots = [...row.querySelectorAll('.group-seed-slot')].map((slot) => ({
      id: slot.querySelector('select')?.value || NO_CROP,
      count: Math.max(0, Math.min(99, parseInt(slot.querySelector('input')?.value, 10) || 0)),
    }));
    // Resolve random slots; dedup so we don't gift the same crop twice.
    const used = new Set();
    const initialSeeds = [];
    for (const slot of slots) {
      let id = slot.id;
      if (id === NO_CROP || !id) id = pickRandomSeed(used);
      if (!id || used.has(id)) continue;
      used.add(id);
      if (slot.count > 0) initialSeeds.push({ id, count: slot.count });
    }
    return {
      name: `Colony ${String.fromCharCode(65 + i)}`,
      scriptId: row.querySelector('select.group-script')?.value || 'balanced',
      colonistCount: Math.max(1, Math.min(20,
        parseInt(row.querySelector('input.group-colonists')?.value, 10) || 4)),
      startingWood: Math.max(0, Math.min(999,
        parseInt(row.querySelector('input.group-wood')?.value, 10) || 30)),
      initialSeeds,
    };
  });
}

function renderStartGroupRows(n) {
  if (!startGroupListEl) return;
  const prev = readStartGroupSetup() || [];
  const setup = [];
  for (let i = 0; i < n; i++) {
    setup.push(prev[i] || { scriptId: 'balanced', colonistCount: 4, startingWood: 30, initialSeeds: [] });
  }
  // Build a list of crop ids for the dropdowns. Exclude every wild
  // ancestor — those are discovery items, not starter choices.
  const cropChoices = CROP_IDS.filter((id) => !WILD_SET.has(id));
  const cropOptHTML = (selected) => {
    const opts = [`<option value="${NO_CROP}"${selected === NO_CROP || !selected ? ' selected' : ''}>${t('start.random')}</option>`];
    for (const id of cropChoices) {
      opts.push(`<option value="${id}"${id === selected ? ' selected' : ''}>${t('crop.' + id)}</option>`);
    }
    return opts.join('');
  };
  startGroupListEl.innerHTML = setup.map((s, i) => {
    const color = GROUP_COLORS[i] || null;
    const chip = color ? `<span class="group-chip" style="background:${color.fill}"></span>` : '';
    const scriptOpts = AUTONOMY_OPTIONS.map(
      (id) => `<option value="${id}"${id === s.scriptId ? ' selected' : ''}>${t('script.' + id)}</option>`,
    ).join('');
    // Seed slot HTML — 4 dropdowns per group.
    const slots = [];
    for (let k = 0; k < SEED_SLOTS; k++) {
      const slot = s.initialSeeds[k] || { id: NO_CROP, count: SEED_DEFAULT_QTY };
      slots.push(
        `<span class="group-seed-slot">` +
        `<select>${cropOptHTML(slot.id || NO_CROP)}</select>` +
        `<input type="number" min="0" max="99" value="${slot.count ?? SEED_DEFAULT_QTY}">` +
        `</span>`,
      );
    }
    return (
      `<div class="group-row" data-group="${i}">` +
      `${chip}<strong>${t('group.label', { letter: String.fromCharCode(65 + i) })}</strong> ` +
      `<select class="group-script">${scriptOpts}</select>` +
      `<label class="group-colcount">${t('group.colonists')} ` +
      `<input class="group-colonists" type="number" min="1" max="20" value="${s.colonistCount}"></label>` +
      `<label class="group-colcount">${t('group.startingWood')} ` +
      `<input class="group-wood" type="number" min="0" max="999" value="${s.startingWood ?? 30}"></label>` +
      `<div class="group-seed-row">` +
      `<span class="start-row-label" style="margin:0 4px 0 0">${t('group.initialSeeds')}</span>` +
      slots.join('') +
      `</div>` +
      `</div>`
    );
  }).join('');
}

function showStartScreen() {
  if (!startScreenEl) return;
  if (startGroupCountEl) {
    const n = parseInt(startGroupCountEl.value, 10) || 1;
    if (startGroupCountLabelEl) startGroupCountLabelEl.textContent = n;
    renderStartGroupRows(n);
  }
  startScreenEl.hidden = false;
}

function hideStartScreen() {
  if (startScreenEl) startScreenEl.hidden = true;
}

if (startBiomesEl) {
  startBiomesEl.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-biome]');
    if (!btn) return;
    startBiomeId = btn.dataset.biome;
    for (const b of startBiomesEl.querySelectorAll('button')) b.classList.toggle('active', b === btn);
  });
}
if (startGroupCountEl) {
  startGroupCountEl.addEventListener('input', () => {
    const n = Math.max(1, Math.min(8, parseInt(startGroupCountEl.value, 10) || 1));
    if (startGroupCountLabelEl) startGroupCountLabelEl.textContent = n;
    renderStartGroupRows(n);
  });
}
if (startSeedRandomBtn) {
  startSeedRandomBtn.addEventListener('click', () => {
    startSeedInputEl.value = String(randomSeed());
  });
}
if (startGenerateBtn) {
  startGenerateBtn.addEventListener('click', () => {
    const raw = startSeedInputEl.value.trim();
    const seed = raw === ''
      ? randomSeed()
      : (/^\d+$/.test(raw) ? Number(raw) >>> 0 : hashSeed(raw));
    const setup = readStartGroupSetup();
    newMap(seed, startBiomeId, setup);
    game.paused = false;
    updatePauseBtn();
    hideStartScreen();
    showToast(t('hint.welcome'));
  });
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
const AUTONOMY_OPTIONS = ['balanced', 'farmer', 'farmer_breed', 'scout', 'temperate', 'builder'];

function readGroupSetup() {
  // Pull current values from the DOM into a setup array.
  if (!groupListEl) return null;
  const rows = [...groupListEl.querySelectorAll('.group-row')];
  return rows.map((row, i) => ({
    name: `Colony ${String.fromCharCode(65 + i)}`,
    scriptId: row.querySelector('select.group-script')?.value || 'balanced',
    colonistCount: Math.max(1, Math.min(20,
      parseInt(row.querySelector('input.group-colonists')?.value, 10) || 4)),
    startingWood: Math.max(0, Math.min(999,
      parseInt(row.querySelector('input.group-wood')?.value, 10) || 30)),
  }));
}

function renderGroupRows(n) {
  if (!groupListEl) return;
  // Carry forward whatever the user had selected, only adding rows.
  const prev = readGroupSetup() || [];
  const setup = [];
  for (let i = 0; i < n; i++) {
    setup.push(prev[i] || { scriptId: 'balanced', colonistCount: 4, startingWood: 30 });
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
      `<label class="group-colcount">${t('group.startingWood')} ` +
      `<input class="group-wood" type="number" min="0" max="999" value="${s.startingWood ?? 30}"></label>` +
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
    // α25 follow-up: the in-sim Apply form only edits script / colonist
    // count / starting wood. Carry over the previous run's `initialSeeds`
    // (and the original group name) so the start-screen seed choices
    // aren't silently dropped on Regenerate.
    const prev = game.groupSetup || [];
    const merged = setup.map((row, i) => {
      const prevRow = prev[i];
      return prevRow && Array.isArray(prevRow.initialSeeds) && prevRow.initialSeeds.length
        ? { ...row, initialSeeds: prevRow.initialSeeds, name: prevRow.name || row.name }
        : row;
    });
    newMap(randomSeed(), null, merged);
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
  // α28 D1: unify warehouse hover across all three tiers — show
  // stored / cap and the per-item breakdown for stockpile_med / large too.
  if (tl.structure === 'stockpile' || tl.structure === 'stockpile_med' || tl.structure === 'stockpile_large') {
    const sp = game.stockpileAt(pos.x, pos.y);
    if (sp) {
      s += ` · ${t('tip.stored', { n: game.stockpileFood(sp), cap: sp.cap || STOCKPILE_CAP })}`;
      const parts = STOCKPILE_ITEMS.filter((it) => sp.items[it] > 0).map(
        (it) => `${itemLabel(it)} ${sp.items[it]}`,
      );
      if (parts.length) s += `<br>${parts.join(' · ')}`;
    }
  } else if (tl.structure === 'hut' || tl.structure === 'hut_med' || tl.structure === 'hut_large') {
    // α28 D2: every hut tier reports its bed-cap (1 / 4 / 8) so the
    // player can read "Large hut · 8 beds" without poking at the config.
    const hut = (game.huts || []).find((h) => h.x === pos.x && h.y === pos.y);
    const cap = hut?.cap || 1;
    s += ` · ${t('tip.beds', { n: cap })}`;
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

// Entities whose sprite covers (x, y): wild animals first, then any
// colonist standing on the tile. α26 adds these to the hover tooltip so
// the player can read a deer's species / a colonist's vitals without
// clicking. Tile sits underneath the entity blurb.
function entityHint(pos) {
  let s = '';
  for (const a of game.animals || []) {
    if (a.tileX === pos.x && a.tileY === pos.y) {
      const sp = t('animal.' + (a.species || 'boar'));
      const traits = a.traits || {};
      const cls = traits.hostile ? t('tip.hostile') : t('tip.peaceful');
      s += `<br><strong>${sp}</strong> · ${cls}` +
           `<br>${t('tip.animalStats', {
             meat: traits.meat ?? '?',
             speed: ((traits.speedMul ?? 1) * 100).toFixed(0),
           })}`;
      break; // one animal per tile is plenty
    }
  }
  for (const c of game.colonists) {
    if (c.tileX === pos.x && c.tileY === pos.y) {
      const grp = game.groups?.[c.groupId];
      const groupName = grp ? t('group.label', { letter: String.fromCharCode(65 + c.groupId) }) : '';
      const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
      s += `<br><strong>${c.name}</strong>` + (groupName ? ` · ${groupName}` : '') +
           `<br>${t('state.' + c.state)}` +
           `<br>${t('tip.colonistVitals', {
             fed: pct(1 - c.hunger),
             hp: pct(c.health),
             mood: pct(c.mood),
             sleep: pct(c.sleep ?? 1),
           })}`;
      // Top skill summary — the four xp values are inside c.skills.
      if (c.skills) {
        const top = Object.entries(c.skills).sort((a, b) => b[1] - a[1])[0];
        if (top) {
          s += `<br>${t('tip.colonistTopSkill', {
            skill: t('skill.' + top[0]),
            pct: Math.round(top[1] * 100),
          })}`;
        }
      }
      break;
    }
  }
  return s;
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
    `${tilled}${describePlant(tl.plant)}${structureHint(pos)}${entityHint(pos)}${growthHint(tl)}${sowHint(tl)}`;
  const { rect } = canvasMetrics();
  tooltip.style.left = `${clientX - rect.left + 14}px`;
  tooltip.style.top = `${clientY - rect.top + 14}px`;
}

// Range tools paint a task on every tile a drag crosses; single-target
// tools (move / hunt) keep the classic drag-to-pan.
const PAINT_TOOLS = new Set(['harvest', 'sow', 'till', 'water', 'weed', 'build', 'cancel']);

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

// F1: big-popup on/off toggle. Default on. Persisted in localStorage so
// a player who turns the disruption off stays off across reloads. When
// disabled, events still log + show as a toast so info isn't lost.
let popupsEnabled = (() => {
  try {
    const v = localStorage.getItem('farm-proto:popups');
    return v == null ? true : v === '1';
  } catch { return true; }
})();
function updatePopupsBtn() {
  if (!popupsBtn) return;
  popupsBtn.textContent = `${t('label.popups')}: ${t(popupsEnabled ? 'val.on' : 'val.off')}`;
  popupsBtn.classList.toggle('on', popupsEnabled);
}
if (popupsBtn) {
  popupsBtn.addEventListener('click', () => {
    popupsEnabled = !popupsEnabled;
    try { localStorage.setItem('farm-proto:popups', popupsEnabled ? '1' : '0'); } catch {}
    updatePopupsBtn();
    if (!popupsEnabled) closeBigPopup();
  });
}

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

// --- D1: generic big-popup for disasters / big events / mutations ---------
//
// Same look as the victory overlay but reusable: title + body paragraph,
// closes after 10 s or on click anywhere on the overlay / OK button.
// Used for pest swarms, cold snaps, births, trader visits, and rare
// mutations — anything the player would regret missing.
const bigPopupEl = $('big-popup');
const bigPopupTitleEl = $('big-popup-title');
const bigPopupDetailEl = $('big-popup-detail');
const bigPopupCloseBtn = $('big-popup-close');
let bigPopupTimer = null;
function groupLabel(gid) {
  if (gid == null) return t('group.tabAll');
  const grp = game.groups?.[gid];
  if (!grp) return '';
  return grp.name || t('group.label', { letter: String.fromCharCode(65 + gid) });
}
// F2: shortened auto-close window — 5 s feels less interruptive while
// staying long enough to skim the title + detail.
const BIG_POPUP_AUTO_CLOSE_MS = 5000;
function showBigPopup(titleKey, bodyKey, params = {}, options = {}) {
  // F1: when the player has turned popups off, fall through silently.
  if (!popupsEnabled) return;
  bigPopupTitleEl.textContent = t(titleKey, params);
  // `detailHtml` lets the caller inject richer markup (e.g. F3's gene
  // table for mutations). Plain string `detailText` and the default i18n
  // key path both still set textContent.
  if (options.detailHtml) {
    bigPopupDetailEl.innerHTML = options.detailHtml;
  } else if (options.detailText) {
    bigPopupDetailEl.textContent = options.detailText;
  } else {
    bigPopupDetailEl.textContent = t(bodyKey, params);
  }
  bigPopupEl.hidden = false;
  if (bigPopupTimer) clearTimeout(bigPopupTimer);
  bigPopupTimer = setTimeout(closeBigPopup, BIG_POPUP_AUTO_CLOSE_MS);
}
function closeBigPopup() {
  bigPopupEl.hidden = true;
  if (bigPopupTimer) {
    clearTimeout(bigPopupTimer);
    bigPopupTimer = null;
  }
}
bigPopupCloseBtn.addEventListener('click', closeBigPopup);
// A click anywhere on the dimmed backdrop closes too.
bigPopupEl.addEventListener('click', (ev) => {
  if (ev.target === bigPopupEl) closeBigPopup();
});

// --- α28-P2: pedigree overlay -------------------------------------------
const pedigreeOverlayEl = $('pedigree-overlay');
const pedigreeTitleEl = $('pedigree-title');
const pedigreeBodyEl = $('pedigree-body');
const pedigreeCloseBtn = $('pedigree-close');

function openPedigree(cropId, groupId) {
  const grp = game.groups?.[groupId];
  const codex = grp?.codex?.[cropId];
  const lineage = codex?.lineage || [];
  const groupLabel = grp?.name || t('group.label', { letter: String.fromCharCode(65 + groupId) });
  pedigreeTitleEl.textContent = t('pedigree.title', { crop: t('crop.' + cropId), group: groupLabel });
  if (lineage.length === 0) {
    pedigreeBodyEl.innerHTML = `<div class="pedigree-empty">${t('pedigree.empty')}</div>`;
  } else {
    // Render each entry as a generation row: parent A | × | child | ← | parent B
    pedigreeBodyEl.innerHTML = lineage.map((entry, i) => {
      const tag = `g${i}`;
      const seasonStr = (entry.year != null && entry.season)
        ? t('pedigree.season', { year: entry.year, season: t('season.' + entry.season) })
        : '';
      return (
        `<div class="pedigree-gen">` +
        `<div class="pedigree-cell">` +
        `<div class="label">${t('pedigree.parents')}</div>` +
        `<canvas data-pedigree="${tag}-pa" data-crop="${cropId}" width="56" height="56"></canvas>` +
        `<div class="rank">${'★'.repeat(qualityRank(entry.parents[0]))}</div>` +
        `</div>` +
        `<div class="pedigree-glyph">×</div>` +
        `<div class="pedigree-cell">` +
        `<div class="label">${t('pedigree.child')} ${t('pedigree.gen', { n: i + 1 })}${entry.legendary ? ' ✨' : ''}</div>` +
        `<canvas data-pedigree="${tag}-c" data-crop="${cropId}" width="72" height="72"></canvas>` +
        `<div class="rank">${'★'.repeat(qualityRank(entry.child))}</div>` +
        `<div class="pedigree-meta">${seasonStr}</div>` +
        `</div>` +
        `<div class="pedigree-glyph">×</div>` +
        `<div class="pedigree-cell">` +
        `<div class="label">${t('pedigree.parents')}</div>` +
        `<canvas data-pedigree="${tag}-pb" data-crop="${cropId}" width="56" height="56"></canvas>` +
        `<div class="rank">${'★'.repeat(qualityRank(entry.parents[1]))}</div>` +
        `</div>` +
        `</div>`
      );
    }).join('');
    // Paint each canvas with the appropriate genome.
    for (let i = 0; i < lineage.length; i++) {
      const entry = lineage[i];
      const tag = `g${i}`;
      const draws = [
        { sel: `[data-pedigree="${tag}-pa"]`, genome: entry.parents[0] },
        { sel: `[data-pedigree="${tag}-c"]`, genome: entry.child },
        { sel: `[data-pedigree="${tag}-pb"]`, genome: entry.parents[1] },
      ];
      for (const d of draws) {
        const cv = pedigreeBodyEl.querySelector(d.sel);
        if (cv) {
          game.renderer.drawCropPreview(cv.getContext('2d'), cv.width, cv.height, cropId, d.genome);
        }
      }
    }
  }
  pedigreeOverlayEl.hidden = false;
}

function closePedigree() {
  pedigreeOverlayEl.hidden = true;
}
pedigreeCloseBtn.addEventListener('click', closePedigree);
pedigreeOverlayEl.addEventListener('click', (ev) => {
  if (ev.target === pedigreeOverlayEl) closePedigree();
});
// Codex link click → open pedigree. Event delegation on document so
// re-rendered codex rows pick up the handler automatically.
document.addEventListener('click', (ev) => {
  const link = ev.target.closest('[data-pedigree-crop]');
  if (!link) return;
  const cropId = link.dataset.pedigreeCrop;
  const groupId = Number(link.dataset.pedigreeGroup);
  if (Number.isNaN(groupId)) return;
  openPedigree(cropId, groupId);
});

// F4: pest popups fire only on the first strike per run; subsequent
// strikes keep their log line but no longer interrupt the player.
let pestPopupShown = false;

/**
 * F3 / α26 polish: detailed mutation popup. Now renders:
 *   - lead with crop + group + season/year + per-group mutation index
 *   - side-by-side parent vs new-variant previews so the visual change
 *     is the first thing you see
 *   - star-rank delta + overall quality delta
 *   - "biggest changes" callout for the top 2 gene deltas, then the
 *     full per-gene bar table underneath
 * Falls back to a plain text body when the event lacks a genome
 * (e.g. an old test event without the genome attached).
 */
function showMutationPopup(mut) {
  if (!popupsEnabled) return;
  if (!mut.genome) {
    showBigPopup('popup.mutation.title', 'popup.mutation.body', {
      crop: t('crop.' + mut.crop),
      group: groupLabel(mut.groupId),
    });
    return;
  }
  const newRank = qualityRank(mut.genome);
  const parentRank = mut.parent ? qualityRank(mut.parent) : null;
  const lead = t('popup.mutation.lead', {
    crop: t('crop.' + mut.crop),
    group: groupLabel(mut.groupId),
  });
  const stars = parentRank != null
    ? `<span class="mut-stars-old">${'★'.repeat(parentRank)}</span> <span class="mut-arrow">→</span> <span class="mut-stars-new">${'★'.repeat(newRank)}</span>`
    : `<span class="mut-stars-new">${'★'.repeat(newRank)}</span>`;
  // Overall quality % delta (mean of QUALITY_GENES phenotypes).
  const meanPct = (genome) => {
    if (!genome) return null;
    let sum = 0;
    for (const gid of QUALITY_GENES) sum += phenotype(genome, gid);
    return Math.round((sum / QUALITY_GENES.length) * 100);
  };
  const childQ = meanPct(mut.genome);
  const parentQ = meanPct(mut.parent);
  const deltaQ = parentQ != null ? childQ - parentQ : 0;
  const qualityLine = parentQ != null
    ? t('popup.mutation.qualityDelta', {
        parent: parentQ, child: childQ,
        sign: deltaQ > 0 ? '+' : '', delta: deltaQ,
      })
    : `${t('label.rank')}: ${childQ}%`;
  // Per-gene rows with deltas.
  const geneRows = QUALITY_GENES.map((gid) => {
    const cur = Math.round(phenotype(mut.genome, gid) * 100);
    const org = mut.parent ? Math.round(phenotype(mut.parent, gid) * 100) : cur;
    const delta = cur - org;
    return { gid, cur, org, delta };
  });
  // Top 2 biggest absolute deltas — highlight them in a callout.
  const topChanges = geneRows.slice().sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2)
    .filter((r) => r.delta !== 0);
  const renderArrow = (d) => {
    if (d >= 30) return '▲▲';
    if (d > 0)  return '▲';
    if (d <= -30) return '▼▼';
    if (d < 0)  return '▼';
    return '·';
  };
  const topHtml = topChanges.length
    ? `<div class="mut-top"><div class="mut-section-head">🏆 ${t('popup.mutation.topChanges')}</div>` +
      topChanges.map((r) => {
        const cls = r.delta > 0 ? 'mut-up' : 'mut-down';
        return `<div class="mut-top-row ${cls}"><span class="mut-top-name">${t('gene.' + r.gid)}</span>` +
               `<span class="mut-top-delta">${renderArrow(r.delta)} ${r.org}% → ${r.cur}% (${r.delta > 0 ? '+' : ''}${r.delta}%)</span></div>`;
      }).join('') +
      `</div>`
    : '';
  const genesHtml = geneRows.map((r) => (
    `<div class="mut-gene-row">` +
    `<span class="mut-gene-name">${t('gene.' + r.gid)}</span>` +
    `<span class="mut-gene-bar"><i style="width:${r.cur}%"></i><u style="left:${r.org}%"></u></span>` +
    `<span class="mut-gene-delta">${renderArrow(r.delta)} ${r.cur}% <em>(${r.org}%)</em></span>` +
    `</div>`
  )).join('');
  const seqLabel = (mut.seq != null)
    ? `<span class="mut-badge">${t('popup.mutation.seq', { n: mut.seq })}</span>`
    : '';
  const whenLabel = (mut.year != null && mut.season)
    ? `<span class="mut-when">${t('popup.mutation.when', { year: mut.year, season: t('season.' + mut.season) })}</span>`
    : '';
  // Wrap the whole rich detail in one block so the browser's HTML
  // parser doesn't auto-close the popup's <p> ancestor at the first
  // <div>. Everything inside lives in the wrapper as proper block
  // markup — figures, details, etc.
  const html =
    `<div class="mut-wrap">` +
    `<div class="mut-sparkle"></div>` +
    `<div class="mut-lead">${lead}</div>` +
    `<div class="mut-meta">${seqLabel}${whenLabel}</div>` +
    `<div class="mut-previews">` +
      `<figure class="mut-figure"><canvas class="mut-preview mut-preview-parent" width="96" height="96"></canvas>` +
      `<figcaption>${t('popup.mutation.parent')} ${parentRank != null ? '★'.repeat(parentRank) : ''}</figcaption></figure>` +
      `<div class="mut-vs">VS</div>` +
      `<figure class="mut-figure"><canvas class="mut-preview mut-preview-child" width="96" height="96"></canvas>` +
      `<figcaption>${t('popup.mutation.child')} ★${newRank}</figcaption></figure>` +
    `</div>` +
    `<div class="mut-rank"><b>${stars}</b> &middot; ${qualityLine}</div>` +
    topHtml +
    `<details class="mut-all"><summary>${t('popup.mutation.allGenes')}</summary>` +
    `<div class="mut-genes">${genesHtml}</div></details>` +
    `</div>`;
  showBigPopup('popup.mutation.title', null, {}, { detailHtml: html });
  // Paint both preview canvases after the popup renders.
  const cvNew = bigPopupDetailEl.querySelector('canvas.mut-preview-child');
  if (cvNew) game.renderer.drawCropPreview(cvNew.getContext('2d'), cvNew.width, cvNew.height, mut.crop, mut.genome);
  const cvOld = bigPopupDetailEl.querySelector('canvas.mut-preview-parent');
  if (cvOld && mut.parent) game.renderer.drawCropPreview(cvOld.getContext('2d'), cvOld.width, cvOld.height, mut.crop, mut.parent);
}

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

// Alpha 25: a placeholder world is built so the renderer always has
// something to draw, but the simulation stays paused and the start
// screen covers the canvas until the player presses Generate.
newMap(randomSeed());
game.paused = true;
applyI18n();
updateToolPanels();
game.start();
showStartScreen();
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
  updateHistoryGraphs();
  if (gameoverEl.hidden === game.over) gameoverEl.hidden = !game.over;
  const season = game.consumeSeasonChange();
  if (season) showToast(t('note.' + season));
  // D1/F1/F4: events surface as 5-s big popups (when popups are enabled).
  // The transient toast still fires for the seasonal banner.
  // F4: pest popups fire only the first time per run; subsequent strikes
  // stay in the log only so the player isn't repeatedly interrupted.
  const pest = game.consumePestEvent();
  if (pest) {
    if (!pestPopupShown) {
      pestPopupShown = true;
      showBigPopup('popup.pest.title', 'popup.pest.body', { n: pest.n || '?' });
    } else {
      // Log already pushed in eventSystem.pestStrike — nothing extra here.
    }
  }
  if (game.consumeColdEvent()) showBigPopup('popup.cold.title', 'popup.cold.body');
  const baby = game.consumeBirthEvent();
  if (baby) {
    const name = typeof baby === 'string' ? baby : baby.name;
    const gid = typeof baby === 'object' ? baby.groupId : null;
    showBigPopup('popup.birth.title', 'popup.birth.body', { name, group: groupLabel(gid) });
  }
  const trader = game.consumeTraderEvent();
  if (trader) {
    const cropList = trader.seeds.map((id) => t('crop.' + id)).join(', ');
    showBigPopup('popup.trader.title', 'popup.trader.body', {
      wood: trader.wood,
      crops: cropList,
      group: groupLabel(trader.groupId),
    });
    // Trader gifts may include crops the colony had never grown — rebuild
    // the picker so they show up as new options to sow.
    rebuildCropPicker();
  }
  const mut = game.consumeMutationEvent();
  if (mut) showMutationPopup(mut);
  if (game.consumeWinEvent()) showVictory();
}, 150);
