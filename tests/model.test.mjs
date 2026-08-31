import assert from 'node:assert/strict';
import test from 'node:test';

import {
  clampIndex,
  classifyCoffeeAptitude,
  isFrontierActive,
  theilSen,
} from '../lib/simulation/calculations.ts';
import { interpolateSnapshot } from '../lib/simulation/model.ts';

test('Theil–Sen resiste un año atípico', () => {
  const slope = theilSen([
    { year: 2021, plantedHa: 100 },
    { year: 2022, plantedHa: 103 },
    { year: 2023, plantedHa: 190 },
    { year: 2024, plantedHa: 109 },
    { year: 2025, plantedHa: 112 },
  ]);
  assert.equal(slope, 3);
});

test('clasifica los rangos publicados para Coffea arabica', () => {
  assert.equal(classifyCoffeeAptitude(19, 1600), 'S1');
  assert.equal(classifyCoffeeAptitude(24, 2100), 'S2');
  assert.equal(classifyCoffeeAptitude(27, 3000), 'S3');
  assert.equal(classifyCoffeeAptitude(30, 600), 'N');
});

test('activa y retira una celda en el mes correcto', () => {
  const feature = { startMonth: 12, retireMonth: 48 };
  assert.equal(isFrontierActive(feature, 11), false);
  assert.equal(isFrontierActive(feature, 12), true);
  assert.equal(isFrontierActive(feature, 47), true);
  assert.equal(isFrontierActive(feature, 48), false);
});

test('los índices se limitan a 0–100', () => {
  assert.equal(clampIndex(-8), 0);
  assert.equal(clampIndex(54), 54);
  assert.equal(clampIndex(140), 100);
});

test('interpola suavemente un corte mensual', () => {
  const base = {
    month: 0,
    date: '2026-01-01',
    label: 'enero de 2026',
    areaHa: 100,
    coffeeAreaDeltaPercent: 0,
    expansionHa: 0,
    retiredHa: 0,
    co2eKt: 0,
    co2eDeltaPercent: 0,
    waterIndex: 80,
    soilIndex: 80,
    biodiversityIndex: 80,
    resilienceIndex: 80,
  };
  const next = { ...base, month: 1, areaHa: 120, waterIndex: 70 };
  const result = interpolateSnapshot([base, next], 0.5);
  assert.equal(result.areaHa, 110);
  assert.equal(result.waterIndex, 75);
});

