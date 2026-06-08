// α37 combat system — all mutating combat orchestration lives here so
// future features (new weapons, group-specific tactics, alliances,
// diplomacy, prisoners-of-war …) can grow inside ONE module rather than
// re-touching game.js / eventSystem.js / autonomy.js / colonist.js each
// time.
//
// What lives here
//   - fireShot                    a single bow shot, with damage, effects, log
//   - updateCombatEffects         age out the transient arrow / damage lists
//   - tickAttack                  the per-tick ATTACK-task driver (called
//                                 from colonist.update once the path is done)
//   - pickWarEngagement           the autonomy "go pick a target" branch
//   - checkSurrender              loss-ratio surrender pass, runs every tick
//   - declareWar / endWar         war start / end (called from both the
//                                 winter auto-pass and the manual order)
//   - maybeDeclareWar             winter auto-pass driver
//   - enqueueAttackTask           the ATTACK branch from Game.enqueueTask
//
// What stays elsewhere
//   - Pure geometry helpers       src/combat.js (no mutations there)
//   - The ATTACK / MARCH TaskType  src/tasks.js
//   - War state field defaults     src/groups.js (createGroup)
//   - Renderer visuals             src/render/combatRender.js
//
// This module is consumed from:
//   - src/game.js                  (fireShot, updateCombatEffects,
//                                   checkSurrender, enqueueAttackTask,
//                                   consumeWarDeclaration)
//   - src/entities/colonist.js     (tickAttack)
//   - src/systems/eventSystem.js   (maybeDeclareWar on winter)
//   - src/autonomy.js              (pickWarEngagement)
//
// Imports from elsewhere are kept narrow on purpose — combatSystem is a
// leaf of the dependency graph below game/colonist so it never creates
// a cycle.

import {
  BOW_RANGE,
  BOW_FIRE_INTERVAL,
  SURRENDER_LOSS_FRACTION,
  SURRENDER_FOOD_TRIBUTE,
  WAR_DECLARE_POP_THRESHOLD,
  WAR_TIMEOUT_SEC,
} from '../config.js';
import {
  bowDamage,
  chebyshev,
  colonyCenter,
  nearestEnemyFor,
} from '../combat.js';
import { TaskType, createTask } from '../tasks.js';
import { STOCKPILE_ITEMS } from './foodSystem.js';
import { findPathStaged } from '../core/pathfinder.js';
import { t } from '../i18n.js';

// α37 followup combat tuning
// ---------------------------
// ENGAGEMENT_RANGE: max distance at which a colonist switches from MARCH
//   to ATTACK. Set to 3× bow range (= 12 tiles) so a marching squad
//   commits to a fight as soon as enemies enter that horizon, instead
//   of marching past them to the opposing center.
// MARCH_CHUNK_TILES: distance (in tiles) of a single MARCH segment.
//   After this many tiles the colonist re-enters autonomy and can
//   switch to ATTACK if enemies have come into range. Short enough
//   to react, long enough to keep the simulator cheap.
// TARGET_COMMITMENT: sim-seconds a colonist stays locked on the chosen
//   target before re-evaluating. 15 sim-sec ≈ 2.5 sim-days, matching
//   the "every 2-3 days re-pick target" spec. Stops target-flickering
//   when two enemies are at very similar distances.
const ENGAGEMENT_RANGE = BOW_RANGE * 3;
const MARCH_CHUNK_TILES = 8;
const TARGET_COMMITMENT = 15;

/** Pick the next MARCH waypoint when MARCH_CHUNK_TILES away from the
 *  long-range goal. Returns the goal itself once we're within one
 *  chunk's distance. */
function _shortMarchTarget(colonist, goal) {
  const dx = goal.x - colonist.tileX;
  const dy = goal.y - colonist.tileY;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist <= MARCH_CHUNK_TILES) return goal;
  const t = MARCH_CHUNK_TILES / dist;
  return {
    x: Math.floor(colonist.tileX + dx * t),
    y: Math.floor(colonist.tileY + dy * t),
  };
}

// ---------------------------------------------------------------------
// fireShot — emit one bow shot from attacker to target.
// ---------------------------------------------------------------------

export function fireShot(game, attacker, target) {
  if (!attacker || !target || target.dead) return;
  const dmg = bowDamage(game, attacker, target);
  target.health = Math.max(0, target.health - dmg);
  target.lastDamage = 'combat';
  game._arrows.push({
    fromX: attacker.x, fromY: attacker.y,
    toX: target.x, toY: target.y,
    bornAt: game.clock,
  });
  game._damageNumbers.push({
    x: target.x, y: target.y,
    n: Math.round(dmg * 100),
    bornAt: game.clock,
  });
  game._pushLog?.({
    icon: 'swords',
    text: t('log.bowHit', {
      attacker: attacker.name,
      target: target.name,
      n: Math.round(dmg * 100),
    }),
    groupId: attacker.groupId,
    cls: 'log-warn',
  });
}

// ---------------------------------------------------------------------
// updateCombatEffects — age out the transient arrow + damage-number lists.
// ---------------------------------------------------------------------

export function updateCombatEffects(game) {
  const now = game.clock;
  if (game._arrows.length > 0) {
    game._arrows = game._arrows.filter((a) => now - a.bornAt < 0.4);
  }
  if (game._damageNumbers.length > 0) {
    game._damageNumbers = game._damageNumbers.filter((d) => now - d.bornAt < 1.2);
  }
}

// ---------------------------------------------------------------------
// tickAttack — per-tick ATTACK task driver, invoked from colonist.update
//              after the path has been walked. Returns nothing; mutates
//              colonist state and task.status directly.
// ---------------------------------------------------------------------

export function tickAttack(game, c, task) {
  const target = task._target || _findColonistByName(game, c.attackTargetName);
  if (!target || target.dead) {
    c.attackTargetName = null;
    task.status = 'done';
    c.state = 'idle';
    return;
  }
  task._target = target;

  const myGrp = game.groups?.[c.groupId];
  if (!myGrp || myGrp.warWith == null || myGrp.warWith !== target.groupId) {
    c.attackTargetName = null;
    task.status = 'done';
    c.state = 'idle';
    return;
  }

  c.state = 'attacking';
  const range = chebyshev(c, target);
  if (range > BOW_RANGE) {
    const anchor = { x: Math.round(c.x), y: Math.round(c.y) };
    const goal = { x: target.tileX, y: target.tileY };
    const cache = game.map?.pathCache;
    const path = cache
      ? cache.findCached(game.map, anchor, goal, true /* fallback ok */)
      : findPathStaged(game.map, anchor, goal);
    if (path && path.length > 0) {
      c.path = [anchor, ...path];
    } else {
      task.status = 'failed';
      c.state = 'idle';
    }
    return;
  }
  if (game.clock - c.lastShotAt >= BOW_FIRE_INTERVAL) {
    fireShot(game, c, target);
    c.lastShotAt = game.clock;
  }
}

function _findColonistByName(game, name) {
  if (!name) return null;
  for (const c of game.colonists) if (c.name === name && !c.dead) return c;
  return null;
}

// ---------------------------------------------------------------------
// pickWarEngagement — the high-priority autonomy branch.
//
// Two-phase combat:
//   1. MARCH toward the opposing colony's center in MARCH_CHUNK_TILES
//      segments. Each segment ends and the colonist re-enters
//      autonomy, so enemies that come into ENGAGEMENT_RANGE flip the
//      colonist into the attack phase mid-march. This is what makes
//      the two armies meet in the middle instead of strolling past
//      each other to empty bases.
//   2. ATTACK the nearest enemy in range, committing to that target for
//      TARGET_COMMITMENT sim-seconds (~2-3 sim-days) so colonists don't
//      flicker between similarly-distant enemies every tick.
//
// Returns either an ATTACK task (committed target, drives tickAttack)
// or a MARCH task (chunk waypoint toward opposing center), never null
// while at war — defenders never fall back to farming during a war.
// ---------------------------------------------------------------------

export function pickWarEngagement(game, colonist) {
  const myGrp = game.groups?.[colonist.groupId];
  if (!myGrp || myGrp.warWith == null || myGrp.surrendered) return null;

  // 1a. Honor an existing target commitment if still inside the window.
  if (colonist.attackTargetName && game.clock < (colonist.combatTargetUntil || 0)) {
    const heldTarget = game.colonists.find(
      (c) => c.name === colonist.attackTargetName && !c.dead,
    );
    if (heldTarget) {
      const task = createTask(TaskType.ATTACK, heldTarget.tileX, heldTarget.tileY, {
        assignee: colonist.name,
        groupId: colonist.groupId,
        targetName: heldTarget.name,
      });
      task._target = heldTarget;
      return task;
    }
    // Held target died — clear and re-evaluate below.
    colonist.attackTargetName = null;
  }

  // 1b. Re-evaluate: nearest live enemy within engagement range?
  const enemy = nearestEnemyFor(game, colonist);
  if (enemy && chebyshev(colonist, enemy) <= ENGAGEMENT_RANGE) {
    colonist.attackTargetName = enemy.name;
    colonist.combatTargetUntil = game.clock + TARGET_COMMITMENT;
    const task = createTask(TaskType.ATTACK, enemy.tileX, enemy.tileY, {
      assignee: colonist.name,
      groupId: colonist.groupId,
      targetName: enemy.name,
    });
    task._target = enemy;
    return task;
  }

  // 2. Too far — march one chunk toward the opposing colony's center.
  const opposingCenter = colonyCenter(game, myGrp.warWith);
  if (!opposingCenter) return null;
  colonist.attackTargetName = null;
  const next = _shortMarchTarget(colonist, opposingCenter);
  return createTask(TaskType.MARCH, next.x, next.y, {
    assignee: colonist.name,
    groupId: colonist.groupId,
  });
}

// ---------------------------------------------------------------------
// checkSurrender / endWar / transferTribute — surrender flow.
// ---------------------------------------------------------------------

export function checkSurrender(game) {
  for (const grp of game.groups) {
    if (grp.warWith == null) continue;
    if (grp.surrendered) continue;

    const other = game.groups[grp.warWith];
    if (!other) continue;

    // 1. Normal surrender path — one side lost SURRENDER_LOSS_FRACTION
    //    of its at-war-start population. Pays tribute.
    if (grp.warStartPop > 0) {
      const lost = grp.warStartPop - grp.colonists.length;
      if (lost / grp.warStartPop >= SURRENDER_LOSS_FRACTION) {
        const tributeTotal = transferTribute(game, grp, other);
        endWar(game, grp, other);
        if (game._warSummary) game._warSummary.tribute = tributeTotal;
        continue;
      }
    }

    // 2. α37 followup: stalemate timeout — half a sim-year has passed
    //    since the declaration and nobody crossed the surrender
    //    threshold. Force-end as a stalemate. NO tribute (distinct
    //    from surrender). Both sides still march home via endWar's
    //    queued MARCH tasks. The summary carries timeout: true so the
    //    popup picks a different message.
    if (game.clock - grp.warDeclaredAt >= WAR_TIMEOUT_SEC) {
      endWar(game, grp, other);
      if (game._warSummary) {
        game._warSummary.timeout = true;
        game._warSummary.tribute = 0;
      }
    }
  }
}

export function transferTribute(game, loser, winner) {
  if (!winner) return 0;
  let totalTribute = 0;
  for (const id of STOCKPILE_ITEMS) {
    if (id === 'wood') continue;
    let total = loser.storage?.[id] || 0;
    for (const sp of game.stockpiles) {
      if (sp.ownerId !== loser.id) continue;
      total += sp.items?.[id] || 0;
    }
    if (total <= 0) continue;
    const give = Math.floor(total * SURRENDER_FOOD_TRIBUTE);
    if (give <= 0) continue;
    let remaining = give;
    const sourceOnHand = loser.storage?.[id] || 0;
    const takeFromOnHand = Math.min(remaining, sourceOnHand);
    if (takeFromOnHand > 0) {
      loser.storage[id] -= takeFromOnHand;
      remaining -= takeFromOnHand;
    }
    if (remaining > 0) {
      for (const sp of game.stockpiles) {
        if (sp.ownerId !== loser.id) continue;
        const have = sp.items?.[id] || 0;
        const take = Math.min(remaining, have);
        if (take > 0) {
          sp.items[id] -= take;
          remaining -= take;
          if (remaining <= 0) break;
        }
      }
    }
    winner.storage[id] = (winner.storage[id] || 0) + give;
    totalTribute += give;
  }
  return totalTribute;
}

export function endWar(game, a, b) {
  // α37 followup: capture the wartime stats for the big "war summary"
  // popup BEFORE we reset war state on both sides.
  const summary = (a && b) ? {
    loser: a.id,
    winner: b.id,
    loserName: String.fromCharCode(65 + a.id),
    winnerName: String.fromCharCode(65 + b.id),
    loserStartPop: a.warStartPop,
    loserEndPop: a.colonists.length,
    winnerStartPop: b.warStartPop,
    winnerEndPop: b.colonists.length,
  } : null;
  for (const g of [a, b]) {
    if (!g) continue;
    g.warWith = null;
    g.warDeclaredAt = -1;
    g.warStartPop = 0;
    g.warRole = null;
    g.surrendered = false;
  }
  for (const g of [a, b]) {
    if (!g) continue;
    const center = colonyCenter(game, g.id);
    if (!center) continue;
    for (const c of game.colonists) {
      if (c.groupId !== g.id) continue;
      c.attackTargetName = null;
      c.combatTargetUntil = 0;
      if (c.currentTask) {
        c.currentTask.status = 'failed';
        c.currentTask = null;
        c.state = 'idle';
      }
      const task = createTask(TaskType.MARCH, center.x, center.y, {
        assignee: c.name,
        groupId: g.id,
      });
      game.taskQueue.push(task);
    }
  }
  if (a && b) {
    game._pushLog?.({
      icon: 'trophy',
      text: t('log.surrendered', {
        loser: String.fromCharCode(65 + a.id),
        winner: String.fromCharCode(65 + b.id),
      }),
      cls: 'log-warn',
    });
  }
  // α37 followup: expose the summary so main.js can fire a big popup.
  if (summary) game._warSummary = summary;
}

// ---------------------------------------------------------------------
// declareWar / maybeDeclareWar — auto war on winter start.
// ---------------------------------------------------------------------

export function declareWar(game, attacker, defender) {
  attacker.warWith = defender.id;
  attacker.warDeclaredAt = game.clock;
  attacker.warStartPop = attacker.colonists.length;
  attacker.warRole = 'attacker';
  attacker.surrendered = false;
  defender.warWith = attacker.id;
  defender.warDeclaredAt = game.clock;
  defender.warStartPop = defender.colonists.length;
  defender.warRole = 'defender';
  defender.surrendered = false;
  game._warDeclaration = {
    attacker: attacker.id,
    defender: defender.id,
    attackerName: String.fromCharCode(65 + attacker.id),
    defenderName: String.fromCharCode(65 + defender.id),
    at: game.clock,
  };
  game._pushLog?.({
    icon: 'swords',
    text: t('log.warDeclared', {
      attacker: String.fromCharCode(65 + attacker.id),
      defender: String.fromCharCode(65 + defender.id),
    }),
    cls: 'log-warn',
  });
  // α37 followup: both sides march toward the opposing colony center
  // (not just the attacker). pickWarEngagement does the chunked walk +
  // engagement-range switch every time autonomy fires, so the two
  // squads naturally converge and engage at the midpoint instead of
  // walking past each other to empty bases.
  const attackerGoal = colonyCenter(game, defender.id);
  const defenderGoal = colonyCenter(game, attacker.id);
  for (const c of game.colonists) {
    const myGoal = c.groupId === attacker.id ? attackerGoal
      : c.groupId === defender.id ? defenderGoal
      : null;
    if (!myGoal) continue;
    if (c.currentTask) {
      c.currentTask.status = 'failed';
      c.currentTask = null;
    }
    c.state = 'idle';
    c.attackTargetName = null;
    c.combatTargetUntil = 0;
    // First MARCH chunk — autonomy will queue more on arrival.
    const next = _shortMarchTarget(c, myGoal);
    const task = createTask(TaskType.MARCH, next.x, next.y, {
      assignee: c.name,
      groupId: c.groupId,
    });
    game.taskQueue.push(task);
  }
}

export function maybeDeclareWar(game) {
  // α37 followup: respect the Auto-war toggle (default ON). Manual
  // ATTACK orders bypass this gate — only the winter auto-pass is
  // suppressed when the player turns it off.
  if (game.autoWar === false) return;
  if (!game.groups || game.groups.length < 2) return;
  for (const g of game.groups) if (g.warWith != null) return;
  if (game._warCheckedYear === game.environment.year) return;
  game._warCheckedYear = game.environment.year;
  let largest = null;
  let smallest = null;
  for (const g of game.groups) {
    const n = g.colonists.length;
    if (n === 0) continue;
    if (!largest || n > largest.colonists.length) largest = g;
    if (!smallest || n < smallest.colonists.length) smallest = g;
  }
  if (!largest || !smallest) return;
  if (largest.id === smallest.id) return;
  if (largest.colonists.length <= WAR_DECLARE_POP_THRESHOLD) return;
  declareWar(game, largest, smallest);
}

// ---------------------------------------------------------------------
// enqueueAttackTask — the ATTACK branch from Game.enqueueTask, lifted
//                     here so the manual-attack path lives next to the
//                     auto-attack path. Returns an error key on failure
//                     or null on success (matching Game.enqueueTask's
//                     contract).
// ---------------------------------------------------------------------

export function enqueueAttackTask(game, x, y, { assignee, scopeGid }) {
  const target = game.colonists.find((c) => !c.dead && c.tileX === x && c.tileY === y);
  if (!target) return 'err.noTarget';
  const attackerGid = assignee
    ? game.colonists.find((c) => c.name === assignee)?.groupId
    : scopeGid;
  if (attackerGid == null) return 'err.noGroup';
  if (target.groupId === attackerGid) return 'err.friendlyFire';
  const aGrp = game.groups[attackerGid];
  const dGrp = game.groups[target.groupId];
  if (!aGrp || !dGrp) return 'err.noGroup';

  if (aGrp.warWith !== dGrp.id || dGrp.warWith !== aGrp.id) {
    aGrp.warWith = dGrp.id;
    aGrp.warDeclaredAt = game.clock;
    aGrp.warStartPop = aGrp.colonists.length;
    aGrp.warRole = 'attacker';
    aGrp.surrendered = false;
    dGrp.warWith = aGrp.id;
    dGrp.warDeclaredAt = game.clock;
    dGrp.warStartPop = dGrp.colonists.length;
    dGrp.warRole = 'defender';
    dGrp.surrendered = false;
    game._warDeclaration = {
      attacker: aGrp.id, defender: dGrp.id,
      attackerName: String.fromCharCode(65 + aGrp.id),
      defenderName: String.fromCharCode(65 + dGrp.id),
      at: game.clock,
    };
  }
  const attackers = assignee
    ? [game.colonists.find((c) => c.name === assignee)]
    : game.colonists.filter((c) => c.groupId === attackerGid);
  for (const c of attackers) {
    if (!c || c.dead) continue;
    c.attackTargetName = target.name;
    const tk = createTask(TaskType.ATTACK, x, y, {
      assignee: c.name,
      targetName: target.name,
    });
    tk.groupId = c.groupId;
    tk._target = target;
    game.taskQueue.push(tk);
  }
  return null;
}
