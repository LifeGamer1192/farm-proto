// Crop genetics for alpha 12.
//
// Every crop plant and seed carries a genome: one gene per id in GENE_IDS.
// A gene is diploid — two alleles, each a float 0..1. The expressed value
// (phenotype) leans toward the higher allele, so a strong allele dominates
// while a weak one is carried hidden and may resurface in later crosses.
//
// Seeds are bred by adjacent cross-pollination (see game.js): a child gene
// takes one allele at random from each parent, then each allele may mutate.
// Mutation supplies new variation; crossing optimises it.

// Genes. The first four drive gameplay; the rest are purely cosmetic and
// shape how the crop looks — its fruit shape, leaf style, surface, colour
// hue, colour saturation and speckling.
export const GENE_IDS = [
  'hardiness',
  'yield',
  'vigor',
  'cold',
  'hue',
  'shape',
  'leaf',
  'surface',
  'saturation',
  'spots',
];

// Genes that count toward a genome's overall quality (and its ★ rank).
export const QUALITY_GENES = ['hardiness', 'yield', 'vigor', 'cold'];

// Genes that only affect appearance (not quality).
export const VISUAL_GENES = ['hue', 'shape', 'leaf', 'surface', 'saturation', 'spots'];

// Quality ranks run ★1..★5.
export const RANK_MAX = 5;

// How strongly the higher allele shows over the lower one.
const DOMINANCE = 0.8;

// Per-allele mutation chances applied when a child gene is formed.
const MUTATION_RATE = 0.08; // a normal nudge
const LEGENDARY_RATE = 0.012; // a rare, large jump — a "legendary" mutation
const MUTATION_STEP = 0.11;
const LEGENDARY_STEP = 0.38;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A fresh starting genome. Gameplay genes start middling — a weak strain
 * to breed up — while the cosmetic genes start spread wide, so the first
 * crops already vary in appearance.
 */
export function freshGenome(rand = Math.random) {
  const g = {};
  for (const id of GENE_IDS) {
    const visual = VISUAL_GENES.includes(id);
    const lo = visual ? 0.08 : 0.32;
    const span = visual ? 0.84 : 0.26;
    g[id] = [lo + rand() * span, lo + rand() * span];
  }
  return g;
}

/** Expressed value (phenotype, 0..1) of one gene — the dominance blend. */
export function phenotype(genome, id) {
  const a = genome[id][0];
  const b = genome[id][1];
  const hi = a > b ? a : b;
  const lo = a > b ? b : a;
  return hi * DOMINANCE + lo * (1 - DOMINANCE);
}

/**
 * Bucket a cosmetic gene's phenotype into one of `count` discrete parts —
 * e.g. which fruit shape or leaf style the genome expresses.
 */
export function partIndex(genome, id, count) {
  const i = Math.floor(phenotype(genome, id) * count);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

// Mutate one allele; returns { v, legendary }.
function mutateAllele(v, rand) {
  const r = rand();
  if (r < LEGENDARY_RATE) {
    return { v: clamp01(v + (rand() * 2 - 1) * LEGENDARY_STEP), legendary: true };
  }
  if (r < LEGENDARY_RATE + MUTATION_RATE) {
    return { v: clamp01(v + (rand() * 2 - 1) * MUTATION_STEP), legendary: false };
  }
  return { v, legendary: false };
}

/**
 * Breed a child genome from two parents. Each child gene takes one allele at
 * random from each parent (Mendelian recombination), then each allele may
 * mutate. Returns { genome, legendary } — legendary is true if any allele
 * took a rare large mutation.
 */
export function crossGenomes(parentA, parentB, rand = Math.random) {
  const child = {};
  let legendary = false;
  for (const id of GENE_IDS) {
    const fromA = parentA[id][rand() < 0.5 ? 0 : 1];
    const fromB = parentB[id][rand() < 0.5 ? 0 : 1];
    const ma = mutateAllele(fromA, rand);
    const mb = mutateAllele(fromB, rand);
    child[id] = [ma.v, mb.v];
    if (ma.legendary || mb.legendary) legendary = true;
  }
  return { genome: child, legendary };
}

/** Overall quality of a genome, 0..1 — the mean of its gameplay phenotypes. */
export function genomeQuality(genome) {
  let sum = 0;
  for (const id of QUALITY_GENES) sum += phenotype(genome, id);
  return sum / QUALITY_GENES.length;
}

/** Quality rank ★1..★RANK_MAX derived from a genome's overall quality. */
export function qualityRank(genome) {
  return 1 + Math.round(genomeQuality(genome) * (RANK_MAX - 1));
}

// --- how phenotypes translate into gameplay effects ----------------------

/** Extra survival chance from the hardiness gene (≈0 for the origin strain). */
export function survivalGeneBonus(genome) {
  return (phenotype(genome, 'hardiness') - 0.45) * 0.55;
}

/** Harvest-yield multiplier from the yield gene. */
export function yieldMult(genome) {
  return 0.7 + phenotype(genome, 'yield') * 0.85;
}

/** Growth-speed multiplier from the vigor gene. */
export function vigorMult(genome) {
  return 0.78 + phenotype(genome, 'vigor') * 0.55;
}

/**
 * Adjust a temperature growth factor for the cold gene — a cold-hardy crop
 * keeps growing when the weather turns against it.
 */
export function coldGrowthFactor(genome, tempFactor) {
  return tempFactor + (1 - tempFactor) * phenotype(genome, 'cold') * 0.6;
}
