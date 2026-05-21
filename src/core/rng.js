// Seeded pseudo-random number generator (mulberry32).
//
// Deterministic: the same seed always yields the same sequence, which
// keeps generated maps reproducible — important both for the game's
// "replayability from a given starting hand" goal and for testing.

/**
 * Build a PRNG from a uint32 seed.
 * @param {number} seed
 * @returns {() => number} a function returning floats in [0, 1)
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash an arbitrary string into a uint32 seed (FNV-1a).
 * Lets the player type a memorable text seed.
 * @param {string} str
 * @returns {number}
 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * A fresh random uint32 seed, used when the player wants a brand-new map.
 * @returns {number}
 */
export function randomSeed() {
  return (Math.random() * 0x100000000) >>> 0;
}
