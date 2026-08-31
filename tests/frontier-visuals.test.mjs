import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_CONNECTION_GAP_KM,
  buildFrontierVisuals,
  eventProgress,
  polygonCentroid,
  roughnessForMonth,
  smoothstep,
  visualWeights,
} from '../lib/simulation/frontier-visuals.ts';

function feature({
  id,
  municipality = 'Pitalito',
  origin = 'initial',
  startMonth = 0,
  retireMonth = null,
  lng = -76.05,
  lat = 1.85,
  size = 0.012,
  hectares = 400,
}) {
  const half = size / 2;
  return {
    type: 'Feature',
    id,
    properties: {
      id,
      municipality,
      municipalCode: '41551',
      focus: true,
      origin,
      startMonth,
      retireMonth,
      hectares,
      aptitude2026: 'S1 · alta',
      aptitude2035: 'S2 · media',
      confidence: 'Media-alta',
      sourceCover: 'Prueba',
      nearWater: false,
      steepSlope: false,
      lowSoc: false,
      nearProtected: false,
      score: 80,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - half, lat - half],
        [lng + half, lat - half],
        [lng + half, lat + half],
        [lng - half, lat + half],
        [lng - half, lat - half],
      ]],
    },
  };
}

test('calcula un centroide estable para cada polígono', () => {
  const center = polygonCentroid(feature({ id: 'center', lng: -75.9, lat: 2.1 }));
  assert.ok(Math.abs(center.lng + 75.9) < 1e-9);
  assert.ok(Math.abs(center.lat - 2.1) < 1e-9);
  assert.equal(center.x, center.lng);
  assert.equal(center.y, -center.lat);
});

test('smoothstep interpola exactamente entre el mes anterior y el evento', () => {
  assert.equal(smoothstep(-1), 0);
  assert.equal(eventProgress(14, 15), 0);
  assert.equal(eventProgress(14.5, 15), 0.5);
  assert.equal(eventProgress(15, 15), 1);
});

test('solo conecta expansiones previas del mismo municipio con una brecha prudente', () => {
  const initial = feature({ id: 'initial', hectares: 500 });
  const near = feature({
    id: 'near',
    origin: 'expansion',
    startMonth: 20,
    lng: -76.03,
    hectares: 500,
  });
  const far = feature({
    id: 'far',
    origin: 'expansion',
    startMonth: 40,
    lng: -75.9,
    hectares: 100,
  });
  const otherMunicipality = feature({
    id: 'other',
    municipality: 'Acevedo',
    origin: 'expansion',
    startMonth: 20,
    lng: -76.03,
    hectares: 500,
  });
  const descriptors = buildFrontierVisuals([initial, near, far, otherMunicipality]);
  const nearDescriptor = descriptors.find((item) => item.feature.properties.id === 'near');
  const farDescriptor = descriptors.find((item) => item.feature.properties.id === 'far');
  const otherDescriptor = descriptors.find((item) => item.feature.properties.id === 'other');

  assert.equal(nearDescriptor.connectsToParent, true);
  assert.equal(nearDescriptor.parentId, 'initial');
  assert.ok(nearDescriptor.edgeGapKm <= MAX_CONNECTION_GAP_KM);
  assert.equal(farDescriptor.connectsToParent, false);
  assert.equal(otherDescriptor.parentId, null);
});

test('los núcleos iniciales próximos forman una red sin crear ciclos', () => {
  const first = feature({ id: 'a-initial', lng: -76.05, hectares: 500 });
  const second = feature({ id: 'b-initial', lng: -76.03, hectares: 500 });
  const descriptors = buildFrontierVisuals([second, first]);
  const firstDescriptor = descriptors.find((item) => item.feature.properties.id === 'a-initial');
  const secondDescriptor = descriptors.find((item) => item.feature.properties.id === 'b-initial');
  assert.equal(firstDescriptor.parentId, null);
  assert.equal(secondDescriptor.parentId, 'a-initial');
  assert.equal(secondDescriptor.connectsToParent, true);
});

test('la expansión y el retiro intercambian peso de forma continua', () => {
  const expanding = feature({ id: 'changing', origin: 'expansion', startMonth: 10, retireMonth: 30 });
  const descriptor = buildFrontierVisuals([expanding])[0];
  assert.equal(visualWeights(descriptor, 9).active, 0);
  assert.equal(visualWeights(descriptor, 9.5).expansion, 0.5);
  assert.equal(visualWeights(descriptor, 10).active, 1);
  assert.equal(visualWeights(descriptor, 29.5).active, 0.5);
  assert.equal(visualWeights(descriptor, 29.5).retired, 0.5);
  assert.equal(visualWeights(descriptor, 30).active, 0);
  assert.equal(visualWeights(descriptor, 30).retired, 1);
});

test('la rugosidad es determinista para cualquier instante', () => {
  assert.deepEqual(roughnessForMonth(47.25), roughnessForMonth(47.25));
  assert.notDeepEqual(roughnessForMonth(47.25), roughnessForMonth(47.75));
});
