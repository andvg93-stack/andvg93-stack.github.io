import { frontierWeights, temporalProgress } from '../lib/simulation/temporal-progress.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const FOCUS_MUNICIPALITIES = new Set([
  'Acevedo',
  'Elías',
  'Isnos',
  'Oporapa',
  'Palestina',
  'Pitalito',
  'Saladoblanco',
  'San Agustín',
  'Timaná',
]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function theilSen(observations) {
  const slopes = [];
  for (let first = 0; first < observations.length; first += 1) {
    for (let second = first + 1; second < observations.length; second += 1) {
      const yearDifference = observations[second].year - observations[first].year;
      if (yearDifference) {
        slopes.push((observations[second].plantedHa - observations[first].plantedHa) / yearDifference);
      }
    }
  }
  return median(slopes);
}

function hash01(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  const inPolygon = (polygon) =>
    pointInRing(point, polygon[0]) && !polygon.slice(1).some((hole) => pointInRing(point, hole));
  if (geometry.type === 'Polygon') return inPolygon(geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(inPolygon);
  return false;
}

function flattenCoordinates(coordinates, output = []) {
  if (typeof coordinates?.[0] === 'number') output.push(coordinates);
  else for (const child of coordinates ?? []) flattenCoordinates(child, output);
  return output;
}

function boundsOfGeometry(geometry) {
  return flattenCoordinates(geometry.coordinates).reduce(
    (bounds, [x, y]) => [
      Math.min(bounds[0], x),
      Math.min(bounds[1], y),
      Math.max(bounds[2], x),
      Math.max(bounds[3], y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function pointToSegmentDistanceSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (!dx && !dy) return (point[0] - start[0]) ** 2 + (point[1] - start[1]) ** 2;
  const t = clamp(
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy),
    0,
    1,
  );
  const x = start[0] + t * dx;
  const y = start[1] + t * dy;
  return (point[0] - x) ** 2 + (point[1] - y) ** 2;
}

function nearWaterway(point, waterways, threshold = 0.004) {
  const thresholdSquared = threshold * threshold;
  for (const feature of waterways.features) {
    const coordinates = feature.geometry.coordinates;
    for (let index = 1; index < coordinates.length; index += 1) {
      if (pointToSegmentDistanceSquared(point, coordinates[index - 1], coordinates[index]) <= thresholdSquared) {
        return true;
      }
    }
  }
  return false;
}

function pointToBoundsDistance([x, y], bounds) {
  const dx = Math.max(bounds[0] - x, 0, x - bounds[2]);
  const dy = Math.max(bounds[1] - y, 0, y - bounds[3]);
  return Math.sqrt(dx * dx + dy * dy);
}

function createCell(center, radius, seed) {
  const points = [];
  const rotation = hash01(`${seed}-rotation`) * Math.PI;
  for (let index = 0; index < 8; index += 1) {
    const angle = rotation + (index / 8) * Math.PI * 2;
    const irregularity = 0.83 + hash01(`${seed}-${index}`) * 0.28;
    points.push([
      Number((center[0] + Math.cos(angle) * radius * irregularity).toFixed(5)),
      Number((center[1] + Math.sin(angle) * radius * irregularity).toFixed(5)),
    ]);
  }
  points.push(points[0]);
  return { type: 'Polygon', coordinates: [points] };
}

function classifyClimate(temperature, precipitation) {
  const temperatureClass =
    temperature >= 17 && temperature <= 22
      ? 1
      : (temperature >= 15 && temperature < 17) || (temperature > 22 && temperature <= 25)
        ? 2
        : (temperature >= 12 && temperature < 15) || (temperature > 25 && temperature <= 28)
          ? 3
          : 4;
  const precipitationClass =
    precipitation >= 1400 && precipitation <= 1800
      ? 1
      : (precipitation >= 1000 && precipitation < 1400) ||
          (precipitation > 1800 && precipitation <= 2300)
        ? 2
        : (precipitation >= 750 && precipitation < 1000) ||
            (precipitation > 2300 && precipitation <= 4200)
          ? 3
          : 4;
  return ['S1 · alta', 'S2 · media', 'S3 · marginal', 'N · no apta'][
    Math.max(temperatureClass, precipitationClass) - 1
  ];
}

function aptitudeWeight(aptitude) {
  if (aptitude.startsWith('S1')) return 1;
  if (aptitude.startsWith('S2')) return 0.76;
  if (aptitude.startsWith('S3')) return 0.38;
  return 0;
}

function makeCandidates(feature, count, protectedAreas) {
  const bounds = boundsOfGeometry(feature.geometry);
  const [minX, minY, maxX, maxY] = bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  const gridSize = Math.max(8, Math.ceil(Math.sqrt(count * 7)));
  const protectedFeatures = protectedAreas.features.map((protectedFeature) => ({
    geometry: protectedFeature.geometry,
    bounds: boundsOfGeometry(protectedFeature.geometry),
  }));
  const candidates = [];

  for (let row = 1; row < gridSize; row += 1) {
    for (let column = 1; column < gridSize; column += 1) {
      const x = minX + (column / gridSize) * width;
      const y = minY + (row / gridSize) * height;
      const point = [x, y];
      if (!pointInGeometry(point, feature.geometry)) continue;
      if (protectedFeatures.some(({ geometry, bounds: areaBounds }) =>
        x >= areaBounds[0] &&
        x <= areaBounds[2] &&
        y >= areaBounds[1] &&
        y <= areaBounds[3] &&
        pointInGeometry(point, geometry),
      )) continue;

      const centerDistance = Math.hypot(column / gridSize - 0.5, row / gridSize - 0.5);
      const localVariation = hash01(`${feature.properties.MpCodigo}-${row}-${column}`);
      const coverCompatibility = 0.45 + localVariation * 0.55;
      const pressure = hash01(`pressure-${feature.properties.MpCodigo}-${row}-${column}`);
      const continuity = clamp(1 - centerDistance * 1.3, 0, 1);
      candidates.push({
        point,
        row,
        column,
        scoreBase: 0.15 * coverCompatibility + 0.1 * pressure + 0.1 * continuity,
        coverCompatibility,
        pressure,
        continuity,
      });
    }
  }

  return { candidates, bounds, radius: Math.min(width, height) / (gridSize * 2.5) };
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function buildSnapshot(month, features, baselineArea) {
  const weighted = features.map((feature) => ({ feature, ...frontierWeights(feature.properties, month) }));
  const active = weighted.filter((item) => item.active > 0);
  const expanded = weighted.filter((item) => item.expansion > 0);
  const sum = (items, weight, predicate = () => true) =>
    items.filter(({ feature }) => predicate(feature)).reduce((total, item) => total + item.feature.properties.hectares * item[weight], 0);
  const area = sum(active, 'active');
  const expansionArea = sum(expanded, 'expansion');
  const retiredArea = sum(weighted, 'retired');
  const convertedNatural = sum(expanded, 'expansion', (f) => f.properties.sourceCover === 'Cobertura natural');
  const nearWaterConversion = sum(expanded, 'expansion', (f) => f.properties.nearWater);
  const nearProtectedExpansion = sum(expanded, 'expansion', (f) => f.properties.nearProtected);
  const co2eTonnes = expanded.reduce((total, item) => total + item.feature.properties.hectares *
    item.expansion * (item.feature.properties.sourceCover === 'Cobertura natural' ? 96 : 17), 0);

  const weightedShare = (predicate) => area ? sum(active, 'active', predicate) / area : 0;

  const riparianScore = clamp(78 - (nearWaterConversion / baselineArea) * 950, 0, 100);
  const demandGrowth = Math.max(0, area / baselineArea - 1);
  const demandScore = clamp(82 - demandGrowth * 170, 0, 100);
  const waterIndex = clamp(0.6 * riparianScore + 0.4 * demandScore, 0, 100);

  const outsideSteep = weightedShare((feature) => !feature.properties.steepSlope);
  const outsideLowSoc = weightedShare((feature) => !feature.properties.lowSoc);
  // Burdens grow from zero with converted hectares. Avoid a first tiny expansion
  // changing an entire index through a denominator equal to expansion alone.
  const noNaturalConversion = clamp(1 - convertedNatural / (baselineArea * 0.1), 0, 1);
  const soilIndex = clamp(
    45 * outsideSteep + 30 * outsideLowSoc + 25 * noNaturalConversion,
    0,
    100,
  );

  const naturalRetention = clamp(0.84 - (convertedNatural / baselineArea) * 3.2, 0, 1);
  const distantFromProtected = clamp(1 - nearProtectedExpansion / (baselineArea * 0.2), 0, 1);
  const biodiversityIndex = clamp(
    60 * naturalRetention + 25 * distantFromProtected + 15 * noNaturalConversion,
    0,
    100,
  );

  const suitable = (aptitude) => ['S1', 'S2'].some((prefix) => aptitude.startsWith(prefix)) ? 1 : 0;
  const climateProgress = temporalProgress(month, 0, 119);
  const futureSuitable = area ? active.reduce((total, item) => {
    const p = item.feature.properties;
    const suitability = suitable(p.aptitude2026) * (1 - climateProgress) + suitable(p.aptitude2035) * climateProgress;
    return total + p.hectares * item.active * suitability;
  }, 0) / area : 0;
  const resilienceIndex = clamp(
    60 * futureSuitable + 0.2 * waterIndex + 0.2 * soilIndex,
    0,
    100,
  );

  const date = new Date(Date.UTC(2026, month, 1));
  return {
    month,
    date: date.toISOString().slice(0, 10),
    label: new Intl.DateTimeFormat('es-CO', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date),
    areaHa: round(area),
    coffeeAreaDeltaPercent: round(((area - baselineArea) / baselineArea) * 100),
    expansionHa: round(expansionArea),
    retiredHa: round(retiredArea),
    co2eKt: round(co2eTonnes / 1000),
    co2eDeltaPercent: round((co2eTonnes / 5_200_000) * 100),
    waterIndex: round(waterIndex),
    soilIndex: round(soilIndex),
    biodiversityIndex: round(biodiversityIndex),
    resilienceIndex: round(resilienceIndex),
  };
}

async function checksum(name) {
  const content = await readFile(new URL(name, DATA_DIR));
  return createHash('sha256').update(content).digest('hex');
}

const municipalities = JSON.parse(await readFile(new URL('huila-municipios.geojson', DATA_DIR), 'utf8'));
const eva = JSON.parse(await readFile(new URL('eva-huila-cafe-derived.json', DATA_DIR), 'utf8'));
const waterways = JSON.parse(await readFile(new URL('huila-cauces-osm.geojson', DATA_DIR), 'utf8'));
const protectedAreas = JSON.parse(
  await readFile(new URL('huila-areas-protegidas.geojson', DATA_DIR), 'utf8'),
);

const evaByName = new Map(eva.municipalities.map((entry) => [normalize(entry.municipality), entry]));
const protectedBounds = protectedAreas.features.map((feature) => boundsOfGeometry(feature.geometry));
const frontierFeatures = [];
const municipalitySummary = [];

for (const municipality of municipalities.features) {
  const name = municipality.properties.MpNombre;
  const series = evaByName.get(normalize(name));
  if (!series?.observations.length) continue;

  const recent = series.observations.slice(-5);
  const last = series.observations.at(-1);
  const slope = theilSen(recent);
  const annualRate = clamp(last.plantedHa ? slope / last.plantedHa : 0, -0.03, 0.03);
  const baselineArea = last.plantedHa * (1 + annualRate);
  const altitude = Number(municipality.properties.MpAltitud ?? 1200);
  const focus = FOCUS_MUNICIPALITIES.has(name);
  const climatePressure = altitude < 900 ? 0.1 : altitude < 1300 ? 0.06 : 0.025;
  const targetGrowth = clamp(annualRate * 2.2 + (focus ? 0.085 : 0.035) - climatePressure, -0.13, 0.16);
  const retirementFraction = clamp(Math.max(climatePressure * 0.8 + Math.max(0, -annualRate), -targetGrowth + 0.01), 0.025, 0.2);
  const initialCount = clamp(Math.round(baselineArea / 620), 2, 30);
  const retirementCount = clamp(Math.ceil(initialCount * retirementFraction), 1, Math.max(1, initialCount - 1));
  const expansionFraction = Math.max(0.035, targetGrowth + retirementFraction);
  const expansionCount = clamp(Math.ceil(initialCount * expansionFraction), 1, 8);
  const desiredCandidates = initialCount + expansionCount + 10;
  const { candidates, radius } = makeCandidates(municipality, desiredCandidates, protectedAreas);
  if (candidates.length < initialCount + expansionCount) continue;

  const prepared = candidates.map((candidate, candidateIndex) => {
    const seed = `${municipality.properties.MpCodigo}-${candidate.row}-${candidate.column}`;
    const localAltitude = altitude + (candidate.row / Math.max(1, Math.sqrt(candidates.length)) - 0.5) * 650;
    const currentTemperature = 28.2 - 0.0062 * localAltitude;
    const precipitation = 1420 + hash01(`${seed}-rain`) * 1050;
    const aptitude2026 = classifyClimate(currentTemperature, precipitation);
    const aptitude2035 = classifyClimate(
      currentTemperature + 0.9,
      precipitation * (0.97 + hash01(`${seed}-future-rain`) * 0.06),
    );
    const climateScore = aptitudeWeight(aptitude2026);
    const legalScore = 1;
    const totalScore =
      0.4 * legalScore + 0.25 * climateScore + candidate.scoreBase + hash01(seed) * 0.02;
    return {
      ...candidate,
      candidateIndex,
      seed,
      localAltitude,
      precipitation,
      aptitude2026,
      aptitude2035,
      totalScore,
    };
  });

  const initial = [...prepared]
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, initialCount);
  const initialKeys = new Set(initial.map((candidate) => candidate.seed));
  const future = prepared
    .filter((candidate) => !initialKeys.has(candidate.seed) && !candidate.aptitude2035.startsWith('N'))
    .sort((a, b) => b.totalScore + b.continuity * 0.08 - (a.totalScore + a.continuity * 0.08))
    .slice(0, expansionCount);

  const retiring = new Set(
    [...initial]
      .sort(
        (a, b) =>
          aptitudeWeight(a.aptitude2035) + a.totalScore -
          (aptitudeWeight(b.aptitude2035) + b.totalScore),
      )
      .slice(0, retirementCount)
      .map((candidate) => candidate.seed),
  );

  const initialAreaPerCell = baselineArea / initial.length;
  const retirementArea = baselineArea * retirementFraction;
  const retiringCellFraction = retirementArea / (initialAreaPerCell * retiring.size);
  const targetArea = baselineArea * (1 + targetGrowth);
  const expansionAreaPerCell = Math.max(0, (targetArea - baselineArea + retirementArea) / Math.max(1, future.length));

  initial.forEach((candidate, index) => {
    const retireMonth = retiring.has(candidate.seed) ? 119 : null;
    const retirementStartMonth = 12 + Math.round(hash01(`${candidate.seed}-retirement`) * 12);
    const nearProtected = protectedBounds.some(
      (areaBounds) => pointToBoundsDistance(candidate.point, areaBounds) <= 0.009,
    );
    frontierFeatures.push({
      type: 'Feature',
      id: `${municipality.properties.MpCodigo}-i-${index}`,
      properties: {
        id: `${municipality.properties.MpCodigo}-i-${index}`,
        municipality: name,
        municipalCode: municipality.properties.MpCodigo,
        focus,
        origin: 'initial',
        startMonth: 0,
        retireMonth,
        retirementStartMonth: retireMonth == null ? undefined : retirementStartMonth,
        retirementFraction: retireMonth == null ? 0 : Number(retiringCellFraction.toFixed(8)),
        hectares: round(initialAreaPerCell),
        aptitude2026: candidate.aptitude2026,
        aptitude2035: candidate.aptitude2035,
        confidence: candidate.totalScore > 0.78 ? 'Media-alta' : 'Media',
        sourceCover: 'Café estimado 2026',
        nearWater: nearWaterway(candidate.point, waterways),
        steepSlope: candidate.localAltitude > 1750 && hash01(`${candidate.seed}-slope`) > 0.42,
        lowSoc: hash01(`${candidate.seed}-soc`) < 0.18,
        nearProtected,
        score: round(candidate.totalScore * 100),
      },
      geometry: createCell(candidate.point, radius, candidate.seed),
    });
  });

  future.forEach((candidate, index) => {
    const startMonth = 1 + Math.round(((index + hash01(candidate.seed)) / future.length) * 23);
    const nearProtected = protectedBounds.some(
      (areaBounds) => pointToBoundsDistance(candidate.point, areaBounds) <= 0.009,
    );
    frontierFeatures.push({
      type: 'Feature',
      id: `${municipality.properties.MpCodigo}-e-${index}`,
      properties: {
        id: `${municipality.properties.MpCodigo}-e-${index}`,
        municipality: name,
        municipalCode: municipality.properties.MpCodigo,
        focus,
        origin: 'expansion',
        startMonth: clamp(startMonth, 1, 24),
        entryEndMonth: 119,
        retireMonth: null,
        hectares: round(expansionAreaPerCell),
        aptitude2026: candidate.aptitude2026,
        aptitude2035: candidate.aptitude2035,
        confidence: candidate.totalScore > 0.78 ? 'Media-alta' : 'Media',
        sourceCover:
          candidate.coverCompatibility < 0.61 ? 'Cobertura natural' : 'Mosaico agropecuario',
        nearWater: nearWaterway(candidate.point, waterways),
        steepSlope: candidate.localAltitude > 1750 && hash01(`${candidate.seed}-slope`) > 0.42,
        lowSoc: hash01(`${candidate.seed}-soc`) < 0.18,
        nearProtected,
        score: round(candidate.totalScore * 100),
      },
      geometry: createCell(candidate.point, radius, candidate.seed),
    });
  });

  municipalitySummary.push({
    code: municipality.properties.MpCodigo,
    municipality: name,
    focus,
    sourceYear: last.year,
    sourceAreaHa: round(last.plantedHa),
    theilSenHaPerYear: round(slope),
    annualRateCappedPercent: round(annualRate * 100, 2),
    estimated2026Ha: round(baselineArea),
    target2035Ha: round(targetArea),
    targetDeltaPercent: round(targetGrowth * 100),
    retirementTargetHa: round(retirementArea),
    expansionTargetHa: round(expansionAreaPerCell * future.length),
    impliedAnnualNetPercent: round((Math.pow(targetArea / baselineArea, 12 / 119) - 1) * 100, 3),
  });
}

frontierFeatures.sort((a, b) => String(a.id).localeCompare(String(b.id)));
const baselineArea = frontierFeatures
  .filter((feature) => feature.properties.origin === 'initial')
  .reduce((sum, feature) => sum + feature.properties.hectares, 0);
const snapshots = Array.from({ length: 120 }, (_, month) =>
  buildSnapshot(month, frontierFeatures, baselineArea),
);

const frontier = {
  type: 'FeatureCollection',
  name: 'Huella cafetera estimada Huila 2026–2035',
  crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:OGC:1.3:CRS84' } },
  features: frontierFeatures,
};

await writeFile(
  new URL('cafe-frontier.geojson', DATA_DIR),
  `${JSON.stringify(frontier)}\n`,
  'utf8',
);
await writeFile(
  new URL('simulation-snapshots.json', DATA_DIR),
  `${JSON.stringify({ version: '2.0.0', snapshots }, null, 2)}\n`,
  'utf8',
);
await writeFile(
  new URL('municipality-model.json', DATA_DIR),
  `${JSON.stringify({ version: '2.0.0', municipalities: municipalitySummary }, null, 2)}\n`,
  'utf8',
);

const generatedAt = new Date().toISOString();
const files = [
  'huila-municipios.geojson',
  'huila-areas-protegidas.geojson',
  'huila-cauces-osm.geojson',
  'eva-huila-cafe-derived.json',
  'cafe-frontier.geojson',
  'simulation-snapshots.json',
  'municipality-model.json',
];

const manifest = {
  model: 'Café 2035 · Huila',
  version: '2.0.0',
  generatedAt,
  coordinateSystems: {
    sourceAreaCalculations: 'MAGNA-SIRGAS / Origen-Nacional (EPSG:9377), valores EVA municipales',
    webDelivery: 'WGS 84 / CRS84',
  },
  scenario: {
    start: '2026-01-01',
    end: '2035-12-01',
    climate: 'SSP2-4.5, señal departamental didáctica interpolada',
    timeSteps: 120,
    deterministic: true,
  },
  sources: [
    {
      name: 'IGAC · Límites municipales',
      url: 'https://mapas2.igac.gov.co/server/rest/services/limites/limites/FeatureServer',
      accessedAt: eva.generatedAt,
      license: 'Datos abiertos de la República de Colombia; atribución IGAC',
      use: '37 límites municipales y contorno del Huila',
    },
    {
      name: 'UPRA · Evaluaciones Agropecuarias Municipales (EVA)',
      url: 'https://www.datos.gov.co/resource/uejq-wxrr.json',
      accessedAt: eva.generatedAt,
      license: 'Datos Abiertos Colombia; atribución UPRA',
      use: 'Área sembrada municipal de café 2019–2025',
    },
    {
      name: 'RUNAP · Parques Nacionales Naturales',
      url: 'https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/runap/FeatureServer',
      accessedAt: eva.generatedAt,
      license: 'Datos abiertos; atribución RUNAP / PNN',
      use: 'Exclusión legal y proximidad a áreas protegidas',
    },
    {
      name: 'OpenStreetMap contributors',
      url: 'https://www.openstreetmap.org/copyright',
      accessedAt: eva.generatedAt,
      license: 'ODbL',
      use: 'Cauces con nombre para contexto y proximidad hídrica',
    },
    {
      name: 'UPRA · Aptitud para café, julio de 2022',
      url: 'https://geoservicios.upra.gov.co/arcgis/rest/services/aptitud_uso_suelo/Aptitud_Cafe_Jul2022/MapServer/0',
      accessedAt: eva.generatedAt,
      license: 'Referencia institucional UPRA',
      use: 'Estructura conceptual A1/A2/A3/N; servicio no disponible durante esta compilación',
    },
    {
      name: 'IDEAM · Nuevos escenarios de cambio climático',
      url: 'https://ideam.gov.co/sala-de-prensa/noticia/el-instituto-lanza-nuevos-escenarios-de-cambio-climatico-escala-departamental-para-fortalecer-la',
      accessedAt: eva.generatedAt,
      license: 'Referencia institucional IDEAM',
      use: 'Señal SSP2-4.5 2021–2040',
    },
    {
      name: 'IPCC 2019 Refinement · AFOLU',
      url: 'https://efdb.ipcc-nggip.iges.or.jp/public/2019rf/vol4.html',
      accessedAt: eva.generatedAt,
      license: 'Referencia metodológica',
      use: 'Método de diferencia de existencias y conversión 44/12',
    },
  ],
  assumptions: [
    'La huella inicial es una estimación espacial calibrada a hectáreas municipales EVA; no representa lotes cafeteros observados.',
    'Las celdas son unidades visuales agregadas: su geometría no equivale a las hectáreas indicadas en el tooltip.',
    'Las incorporaciones y retiros son fracciones progresivas de las celdas, repartidas a lo largo de 2026–2035 mediante 80 % de avance lineal y 20 % de smoothstep; no son observaciones mensuales.',
    'El retiro municipal se calibra al porcentaje objetivo, sin obligar a retirar una celda completa; el área final respeta el objetivo municipal y el balance inicial + expansión − retiro.',
    'Los índices de conversión natural y proximidad RUNAP usan cargas acumuladas respecto al área inicial, con escalas didácticas del 10 % y 20 %; no porcentajes observados de biodiversidad.',
    'Los indicadores son índices didácticos estimados; no sustituyen monitoreo ambiental ni ordenamiento territorial.',
    'El CO₂e incluye solo cambio de cobertura; excluye fertilizantes, transporte, beneficio y energía.',
  ],
  checks: {
    municipalities: municipalities.features.length,
    evaMunicipalities: eva.municipalities.length,
    frontierFeatures: frontierFeatures.length,
    monthlySnapshots: snapshots.length,
    baselineAreaHa: round(baselineArea),
    finalAreaHa: snapshots.at(-1).areaHa,
    expansionInsideRunap: 0,
    maxMonthlyNetChangeHa: round(Math.max(...snapshots.slice(1).map((value, i) => Math.abs(value.areaHa - snapshots[i].areaHa)))),
    maxMonthlyExpansionHa: round(Math.max(...snapshots.slice(1).map((value, i) => value.expansionHa - snapshots[i].expansionHa))),
    maxMonthlyRetirementHa: round(Math.max(...snapshots.slice(1).map((value, i) => value.retiredHa - snapshots[i].retiredHa))),
    maxMonthlyIndexChange: round(Math.max(...snapshots.slice(1).flatMap((value, i) =>
      ['waterIndex', 'soilIndex', 'biodiversityIndex', 'resilienceIndex'].map((key) => Math.abs(value[key] - snapshots[i][key])))), 3),
    areaBalanceConsistent: snapshots.every((value) => Math.abs(value.areaHa - (baselineArea + value.expansionHa - value.retiredHa)) < 0.2),
    indicesWithinRange: snapshots.every((snapshot) =>
      [
        snapshot.waterIndex,
        snapshot.soilIndex,
        snapshot.biodiversityIndex,
        snapshot.resilienceIndex,
      ].every((value) => value >= 0 && value <= 100),
    ),
  },
  files: await Promise.all(
    files.map(async (name) => ({ name, sha256: await checksum(name) })),
  ),
};

await writeFile(
  new URL('model-manifest.json', DATA_DIR),
  `${JSON.stringify(manifest, null, 2)}\n`,
  'utf8',
);

console.log(
  `Modelo: ${frontierFeatures.length} celdas, ${snapshots.length} meses, ${round(baselineArea)} ha en 2026 → ${snapshots.at(-1).areaHa} ha en 2035.`,
);
