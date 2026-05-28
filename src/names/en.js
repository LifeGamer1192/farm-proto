// English colonist name pool. Short single-syllable picks so the
// "Name[GroupLetter]" badge stays readable above each sprite.
//
// Two pools: STARTERS rotates through the initial spawns at newMap,
// BIRTHS rotates through newborns from maybeBirth. Both are pools, not
// fixed orderings — a colony of 4 starting colonists pulls indexes
// 0..3, and the birth counter continues from there. Pool size kept >
// 8 groups × 4 starters + several birth waves so we don't repeat too
// soon.

export const STARTERS = [
  'Ada', 'Bo', 'Cy', 'Dot',
  'Eli', 'Fae', 'Gus', 'Hen',
  'Ina', 'Jon', 'Kit', 'Lex',
  'Mio', 'Nan', 'Oz', 'Pip',
  'Quin', 'Ren', 'Sol', 'Tev',
  'Una', 'Vex', 'Wyn', 'Xio',
  'Yui', 'Zev', 'Aro', 'Bex',
  'Cas', 'Dev', 'Edi', 'Fox',
];

export const BIRTHS = [
  'Avi', 'Bri', 'Cleo', 'Dax',
  'Esra', 'Fia', 'Gale', 'Hux',
  'Idi', 'Jett', 'Kai', 'Lir',
  'Mara', 'Nox', 'Ola', 'Pax',
  'Quil', 'Rho', 'Suri', 'Taro',
  'Uma', 'Vela', 'Wren', 'Xian',
  'Yara', 'Zane', 'Arlo', 'Beni',
  'Coda', 'Dune', 'Echo', 'Fern',
];
