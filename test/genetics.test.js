// Logic tests for the alpha-12 crop genetics. Run with: npm test

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GENE_IDS,
  QUALITY_GENES,
  VISUAL_GENES,
  RANK_MAX,
  freshGenome,
  phenotype,
  partIndex,
  crossGenomes,
  genomeQuality,
  qualityRank,
  survivalGeneBonus,
  yieldMult,
  vigorMult,
  coldGrowthFactor,
} from '../src/genetics.js';

const isAllele = (v) => typeof v === 'number' && v >= 0 && v <= 1;

// Build a uniform genome with every allele set to `v`.
function uniformGenome(v) {
  const g = {};
  for (const id of GENE_IDS) g[id] = [v, v];
  return g;
}

test('freshGenome has every gene as a pair of alleles in 0..1', () => {
  const g = freshGenome();
  for (const id of GENE_IDS) {
    assert.ok(Array.isArray(g[id]) && g[id].length === 2, `${id} should be a 2-allele pair`);
    assert.ok(isAllele(g[id][0]) && isAllele(g[id][1]), `${id} alleles should be 0..1`);
  }
});

test('phenotype leans toward the dominant (higher) allele', () => {
  const p = phenotype({ trait: [0.9, 0.1] }, 'trait');
  assert.ok(p > 0.5, 'the strong allele pulls the phenotype up');
  assert.ok(p < 0.9, 'the recessive allele still drags it below the high allele');
});

test('phenotype does not depend on allele order', () => {
  assert.equal(phenotype({ t: [0.2, 0.8] }, 't'), phenotype({ t: [0.8, 0.2] }, 't'));
});

test('phenotype of two equal alleles is that value', () => {
  assert.equal(phenotype({ t: [0.5, 0.5] }, 't'), 0.5);
});

test('crossGenomes always produces a valid child genome', () => {
  const a = freshGenome();
  const b = freshGenome();
  for (let i = 0; i < 60; i++) {
    const { genome, legendary } = crossGenomes(a, b);
    assert.equal(typeof legendary, 'boolean');
    for (const id of GENE_IDS) {
      assert.ok(genome[id] && genome[id].length === 2, `${id} missing in child`);
      assert.ok(isAllele(genome[id][0]) && isAllele(genome[id][1]));
    }
  }
});

test('crossing two identical parents keeps the child close to the parent', () => {
  const parent = uniformGenome(0.5);
  for (let i = 0; i < 40; i++) {
    const { genome } = crossGenomes(parent, parent);
    for (const id of GENE_IDS) {
      assert.ok(Math.abs(genome[id][0] - 0.5) <= 0.4, 'mutation cannot exceed one legendary step');
    }
  }
});

test('qualityRank stays an integer within 1..RANK_MAX', () => {
  for (let i = 0; i < 50; i++) {
    const r = qualityRank(freshGenome());
    assert.ok(r >= 1 && r <= RANK_MAX);
    assert.equal(r, Math.round(r));
  }
  assert.equal(qualityRank(uniformGenome(0)), 1);
  assert.equal(qualityRank(uniformGenome(1)), RANK_MAX);
});

test('genomeQuality rises from a weak strain to a strong one', () => {
  assert.ok(genomeQuality(uniformGenome(0.9)) > genomeQuality(uniformGenome(0.1)));
});

test('QUALITY_GENES and VISUAL_GENES partition GENE_IDS', () => {
  assert.equal(QUALITY_GENES.length + VISUAL_GENES.length, GENE_IDS.length);
  for (const id of [...QUALITY_GENES, ...VISUAL_GENES]) {
    assert.ok(GENE_IDS.includes(id), `${id} should be a real gene`);
  }
  for (const q of QUALITY_GENES) {
    assert.ok(!VISUAL_GENES.includes(q), `${q} cannot be both gameplay and visual`);
  }
});

test('partIndex returns a whole bucket within 0..count-1', () => {
  for (let i = 0; i < 40; i++) {
    const g = freshGenome();
    for (const [id, count] of [
      ['shape', 4],
      ['leaf', 3],
      ['surface', 3],
    ]) {
      const idx = partIndex(g, id, count);
      assert.ok(Number.isInteger(idx) && idx >= 0 && idx < count, `${id} idx ${idx} out of range`);
    }
  }
  assert.equal(partIndex(uniformGenome(0), 'shape', 4), 0);
  assert.equal(partIndex(uniformGenome(1), 'shape', 4), 3);
});

test('gene effects all move in the expected direction', () => {
  const weak = uniformGenome(0.1);
  const strong = uniformGenome(0.95);
  assert.ok(survivalGeneBonus(strong) > survivalGeneBonus(weak));
  assert.ok(yieldMult(strong) > yieldMult(weak));
  assert.ok(vigorMult(strong) > vigorMult(weak));
  // a cold-hardy crop grows faster than a tender one in the same cold weather
  assert.ok(coldGrowthFactor(strong, 0.2) > coldGrowthFactor(weak, 0.2));
});
