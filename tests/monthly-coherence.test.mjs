import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { frontierWeights, temporalProgress, monthAtProgress } from '../lib/simulation/temporal-progress.mjs';
const read = (name) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url)));
const { snapshots } = read('simulation-snapshots.json');
const { features } = read('cafe-frontier.geojson');
const { municipalities } = read('municipality-model.json');
const baseline = snapshots[0].areaHa;

test('all 120 months conserve hectares and recompute from the same feature weights as tooltips', () => {
  for (const s of snapshots) {
    let active = 0, expanded = 0, retired = 0;
    for (const f of features) {
      const w = frontierWeights(f.properties, s.month), ha = f.properties.hectares;
      active += ha * w.active; expanded += ha * w.expansion; retired += ha * w.retired;
    }
    assert.ok(Math.abs(active - s.areaHa) < 0.06, s.date);
    assert.ok(Math.abs(expanded - s.expansionHa) < 0.06, s.date);
    assert.ok(Math.abs(retired - s.retiredHa) < 0.06, s.date);
    assert.ok(Math.abs(s.areaHa - (baseline + s.expansionHa - s.retiredHa)) < 0.2, s.date);
  }
});

test('every month and rolling year stays within gradual scenario budgets without one-month shocks', () => {
  for (let i = 1; i < snapshots.length; i++) {
    const a = snapshots[i - 1], b = snapshots[i];
    assert.ok(b.expansionHa >= a.expansionHa && b.retiredHa >= a.retiredHa, b.date);
    assert.ok(b.co2eKt >= a.co2eKt, b.date);
    assert.ok(Math.abs(b.areaHa - a.areaHa) < baseline * 0.001, `Net monthly shock ${b.date}`);
    assert.ok(b.expansionHa - a.expansionHa < baseline * 0.0025, `Gross expansion ${b.date}`);
    assert.ok(b.retiredHa - a.retiredHa < baseline * 0.0025, `Gross retirement ${b.date}`);
    for (const k of ['waterIndex', 'soilIndex', 'biodiversityIndex', 'resilienceIndex']) {
      assert.ok(Math.abs(b[k] - a[k]) <= 0.5, `${k} discontinuity ${b.date}`);
    }
    if (i >= 12) assert.ok(Math.abs(b.areaHa - snapshots[i - 12].areaHa) < baseline * 0.03, b.date);
  }
  assert.ok(Math.abs(snapshots[112].areaHa - snapshots[111].areaHa) < 100);
});

test('municipal end areas and retirement volumes respect their targets even with few cells', () => {
  for (const municipality of municipalities) {
    const local = features.filter((f) => f.properties.municipality === municipality.municipality);
    let finalArea = 0, retired = 0;
    for (const f of local) {
      const w = frontierWeights(f.properties, 119);
      finalArea += w.active * f.properties.hectares;
      retired += w.retired * f.properties.hectares;
      assert.ok((f.properties.retirementFraction ?? 0) <= 1);
    }
    assert.ok(Math.abs(finalArea - municipality.target2035Ha) < 2, municipality.municipality);
    assert.ok(Math.abs(retired - municipality.retirementTargetHa) < 0.2, municipality.municipality);
    const start = local.filter((f) => f.properties.origin === 'initial').reduce((v, f) => v + f.properties.hectares, 0);
    let previous = start;
    for (let month = 1; month <= 119; month++) {
      const value = local.reduce((v, f) => v + f.properties.hectares * frontierWeights(f.properties, month).active, 0);
      assert.ok(Math.abs(value - previous) / start < 0.005, `${municipality.municipality}, month ${month}`);
      if (month >= 12) {
        const past = local.reduce((v, f) => v + f.properties.hectares * frontierWeights(f.properties, month - 12).active, 0);
        // The requested 1.92× classroom scenario doubles territorial turnover.
        // A municipality may exceed the former 3% yearly cap; retain a 5% cap.
        assert.ok(Math.abs(value - past) / start < 0.05, `${municipality.municipality}, year ${month}`);
      }
      previous = value;
    }
  }
});

test('classroom calibration increases territorial turnover and emphasizes water, soil and resilience', () => {
  const initial = snapshots[0], final = snapshots.at(-1);
  assert.ok(final.expansionHa > 19000 && final.expansionHa < 21000);
  assert.ok(Math.abs(final.expansionHa / 10312.1 - 1.92) < 0.001);
  assert.ok(Math.abs(final.retiredHa / 7966 - 1.92) < 0.001);
  const bioDrop = initial.biodiversityIndex - final.biodiversityIndex;
  assert.ok(bioDrop > 0 && bioDrop < 11);
  for (const key of ['waterIndex', 'soilIndex', 'resilienceIndex']) {
    const drop = initial[key] - final[key];
    assert.ok(drop >= 12 && drop <= 20, key);
    assert.ok(drop > bioDrop, key);
  }
});

test('continuous partial retirement never drops an entire cell and has an invertible timeline', () => {
  const p = { origin: 'initial', startMonth: 0, retireMonth: 119, retirementStartMonth: 12, retirementFraction: 0.2 };
  assert.equal(frontierWeights(p, 0).active, 1);
  assert.equal(frontierWeights(p, 119).active, 0.8);
  assert.equal(frontierWeights(p, 119).retired, 0.2);
  for (const fraction of [0, 0.01, 0.25, 0.7, 1]) {
    assert.ok(Math.abs(temporalProgress(monthAtProgress(fraction, 12, 119), 12, 119) - fraction) < 1e-8);
  }
});
