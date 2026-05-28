// Language-aware colonist name picker (T4 / α27 followup).
//
// `pickStarterName(globalIndex)` returns the next initial-spawn name
// from the active language's STARTERS pool. `pickBirthName(globalIndex)`
// does the same for the BIRTHS pool. `formatColonistName(base, groupId)`
// applies the canonical `Name[GroupLetter]` decoration used across the
// activity log, hover tooltip and the colonist roster.
//
// Per-language pools live in `./<lang>.js`. Add a new locale by adding
// a file there and entering it in POOLS below.

import { getLang } from '../i18n.js';
import * as en from './en.js';
import * as ja from './ja.js';

const POOLS = { en, ja };

function poolFor(lang) {
  return POOLS[lang] || POOLS.en;
}

export function pickStarterName(globalIndex) {
  const pool = poolFor(getLang()).STARTERS;
  return pool[globalIndex % pool.length];
}

export function pickBirthName(globalIndex) {
  const pool = poolFor(getLang()).BIRTHS;
  return pool[globalIndex % pool.length];
}

export function groupLetter(groupId) {
  if (groupId == null || groupId < 0) return '?';
  return String.fromCharCode(65 + groupId);
}

/** "Ada[A]" / "あさ[B]" — used by every place that displays a name. */
export function formatColonistName(base, groupId) {
  return `${base}[${groupLetter(groupId)}]`;
}
