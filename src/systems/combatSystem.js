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
// pickWarEngagement — the high-priority autonomy branch. Returns an
//                     ATTACK task targeting the nearest in-range enemy,
//                     or null if not engaged / no target close enough.
// ---------------------------------------------------------------------

export function pickWarEngagement(game, colonist) {
  const myGrp = game.groups?.[colonist.groupId];
  if (!myGrp || myGrp.warWith == null || myGrp.surrendered) return null;
  const enemy = nearestEnemyFor(game, colonist);
  if (!enemy) return null;
  if (chebyshev(colonist, enemy) > BOW_RANGE * 2) return null;
  colonist.attackTargetName = enemy.name;
  const task = createTask(TaskType.ATTACK, enemy.tileX, enemy.tileY, {
    assignee: colonist.name,
    groupId: colonist.groupId,
    targetName: enemy.name,
  });
  task._target = enemy;
  return task;
}

// ---------------------------------------------------------------------
// checkSurrender / endWar / transferTribute — surrender flow.
// ---------------------------------------------------------------------

export function checkSurrender(game) {
  for (const grp of game.groups) {
    if (grp.warWith == null) continue;
    if (grp.surrendered) continue;
    if (grp.warStartPop <= 0) continue;
    const lost = grp.warStartPop - grp.colonists.length;
    if (lost / grp.warStartPop < SURRENDER_LOSS_FRACTION) continue;
    const winner = game.groups[grp.warWith];
    transferTribute(game, grp, winner);
    endWar(game, grp, winner);
  }
}

export function transferTribute(game, loser, winner) {
  if (!winner) return;
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
  }
}

export function endWar(game, a, b) {
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
  const target = colonyCenter(game, defender.id);
  if (!target) return;
  for (const c of game.colonists) {
    if (c.groupId !== attacker.id) continue;
    if (c.currentTask) {
      c.currentTask.status = 'failed';
      c.currentTask = null;
    }
    c.state = 'idle';
    c.attackTargetName = null;
    const task = createTask(TaskType.MARCH, target.x, target.y, {
      assignee: c.name,
      groupId: attacker.id,
    });
    game.taskQueue.push(task);
  }
}

export function maybeDeclareWar(game) {
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
