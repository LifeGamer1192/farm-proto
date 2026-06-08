// α37 combat — shared helpers for ranged attacks between colony groups.
//
// Combat is GROUP vs GROUP. Two colonist a, b are valid combat targets
// for each other only when their groups have warWith set to each other.
// All distance math is Chebyshev (8-directional, matching the grid),
// matching how the game's movement and animal hunt range already work.
//
// Damage is computed per shot from the attacker's bow + the elevation
// difference between attacker and target tiles (the "high-ground" bonus).
// Future versions will let skills, equipment quality and accuracy stat
// influence each of these knobs — for now they're flat constants.

import {
  BOW_DAMAGE,
  BOW_ELEVATION_BONUS_PER_UNIT,
  COMBAT_HP_SCALE,
  BOW_RANGE,
} from './config.js';

/** Chebyshev distance in tiles between two entities with tileX/tileY. */
export function chebyshev(a, b) {
  return Math.max(Math.abs(a.tileX - b.tileX), Math.abs(a.tileY - b.tileY));
}

/** Are two groups actively at war with each other? */
export function groupsAtWar(grpA, grpB) {
  if (!grpA || !grpB) return false;
  if (grpA.id === grpB.id) return false;
  return grpA.warWith === grpB.id && grpB.warWith === grpA.id;
}

/** True if `attacker` can shoot at `target` right now — different group,
 *  groups at war, target alive, within bow range. Used both by the
 *  manual attack tool (to validate a click) and by the colonist update
 *  loop (to decide whether to fire). */
export function canShoot(game, attacker, target) {
  if (!attacker || !target) return false;
  if (attacker === target) return false;
  if (attacker.dead || target.dead) return false;
  if (attacker.groupId === target.groupId) return false;
  const ga = game.groups?.[attacker.groupId];
  const gb = game.groups?.[target.groupId];
  if (!groupsAtWar(ga, gb)) return false;
  return chebyshev(attacker, target) <= BOW_RANGE;
}

/** Compute the damage a single bow shot from `attacker` does to `target`
 *  on this map. Returns the FRACTIONAL HP delta (already multiplied by
 *  COMBAT_HP_SCALE so it can be subtracted from a colonist's 0..1 health).
 *  Includes the high-ground elevation bonus: +1 base damage per
 *  BOW_ELEVATION_BONUS_PER_UNIT of attacker-elevation over target. */
export function bowDamage(game, attacker, target) {
  const aTile = game.map.tiles[attacker.tileY]?.[attacker.tileX];
  const tTile = game.map.tiles[target.tileY]?.[target.tileX];
  const dEl = (aTile?.elevation || 0) - (tTile?.elevation || 0);
  const elevBonus = Math.max(0, Math.floor(dEl * BOW_ELEVATION_BONUS_PER_UNIT));
  return (BOW_DAMAGE + elevBonus) * COMBAT_HP_SCALE;
}

/** The "residential center" of a colony group — the average position
 *  of every hut the group owns. Used as the attacker's march waypoint
 *  during a declared war, and as the return target when combat ends.
 *  Falls back to the average colonist position if there are no huts.
 *
 *  α37 followup bug fix: huts in game.huts store their tile coords as
 *  `x`/`y` (not `tileX`/`tileY` as I had originally assumed), so the
 *  earlier version produced NaN waypoints that flooded the activity
 *  log with "March (NaN, NaN) — off the map" and froze the frame. */
export function colonyCenter(game, groupId) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const h of game.huts) {
    if (h.ownerId !== groupId) continue;
    sx += h.x + 0.5;
    sy += h.y + 0.5;
    n++;
  }
  if (n === 0) {
    for (const c of game.colonists) {
      if (c.groupId !== groupId) continue;
      sx += c.x;
      sy += c.y;
      n++;
    }
  }
  if (n === 0) return null;
  // Defensive clamp: if anything still produced NaN, drop to null so
  // callers (declareWar / endWar) skip the broken march push entirely
  // instead of queuing an off-map task that the log would spam every
  // tick.
  const cx = Math.floor(sx / n);
  const cy = Math.floor(sy / n);
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  return { x: cx, y: cy };
}

/** Find the closest enemy-engaged colonist `attacker` can target during
 *  a declared war. Used both for autonomy targeting (pick nearest after
 *  marching to enemy center) and for opportunistic engagement (a defender
 *  already on the field shooting the closest incoming attacker). */
export function nearestEnemyFor(game, attacker) {
  const myGrp = game.groups?.[attacker.groupId];
  const enemyId = myGrp?.warWith;
  if (enemyId == null) return null;
  let best = null;
  let bestD = Infinity;
  for (const c of game.colonists) {
    if (c.groupId !== enemyId) continue;
    if (c.dead) continue;
    const d = chebyshev(attacker, c);
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
