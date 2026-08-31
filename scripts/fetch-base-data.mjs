import { mkdir, writeFile } from 'node:fs/promises';

const DATA_DIR = new URL('../public/data/', import.meta.url);
const IGAC_QUERY = new URL(
  'https://mapas2.igac.gov.co/server/rest/services/limites/limites/FeatureServer/1/query',
);
const EVA_QUERY = new URL('https://www.datos.gov.co/resource/uejq-wxrr.json');
const RUNAP_QUERY = new URL(
  'https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/runap/FeatureServer/0/query',
);
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

IGAC_QUERY.search = new URLSearchParams({
  where: "Depto='Huila'",
  outFields: '*',
  returnGeometry: 'true',
  outSR: '4326',
  geometryPrecision: '5',
  f: 'geojson',
}).toString();

EVA_QUERY.search = new URLSearchParams({
  $limit: '5000',
  $where: "c_digo_dane_departamento='41' AND cultivo='Café'",
}).toString();

RUNAP_QUERY.search = new URLSearchParams({
  where: '1=1',
  geometry: '-76.62466,1.55213,-74.41303,3.84321',
  geometryType: 'esriGeometryEnvelope',
  inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects',
  outFields: 'ap_nombre,ap_categoria,area_ha_total_geografica,organizacion',
  returnGeometry: 'true',
  outSR: '4326',
  geometryPrecision: '5',
  f: 'geojson',
}).toString();

async function fetchJson(url, label, options = {}) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Cafe2035Huila/1.0 educational prototype' },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`${label}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

function sqSegmentDistance(point, start, end) {
  let x = start[0];
  let y = start[1];
  let dx = end[0] - x;
  let dy = end[1] - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((point[0] - x) * dx + (point[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = end[0];
      y = end[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = point[0] - x;
  dy = point[1] - y;
  return dx * dx + dy * dy;
}

function simplifyLine(points, tolerance, closed = false) {
  if (points.length <= (closed ? 5 : 2)) return points;

  const working = closed ? points.slice(0, -1) : points;
  const sqTolerance = tolerance * tolerance;
  const keep = new Uint8Array(working.length);
  keep[0] = 1;
  keep[working.length - 1] = 1;

  const stack = [[0, working.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = sqTolerance;
    let index = 0;
    for (let i = first + 1; i < last; i += 1) {
      const distance = sqSegmentDistance(working[i], working[first], working[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const simplified = working.filter((_, index) => keep[index]);
  if (closed) {
    if (simplified.length < 3) return points;
    simplified.push(simplified[0]);
  }
  return simplified;
}

function simplifyGeometry(geometry, tolerance) {
  if (!geometry) return geometry;
  if (geometry.type === 'LineString') {
    return { ...geometry, coordinates: simplifyLine(geometry.coordinates, tolerance) };
  }
  if (geometry.type === 'MultiLineString') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((line) => simplifyLine(line, tolerance)),
    };
  }
  if (geometry.type === 'Polygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) => simplifyLine(ring, tolerance, true)),
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => simplifyLine(ring, tolerance, true)),
      ),
    };
  }
  return geometry;
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
  if (geometry.type === 'Polygon') {
    return pointInRing(point, geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => pointInRing(point, polygon[0]));
  }
  return false;
}

function flattenCoordinates(coordinates, output = []) {
  if (typeof coordinates?.[0] === 'number') {
    output.push(coordinates);
  } else {
    for (const child of coordinates ?? []) flattenCoordinates(child, output);
  }
  return output;
}

await mkdir(DATA_DIR, { recursive: true });

const municipalities = await fetchJson(IGAC_QUERY, 'IGAC municipios');
const evaRows = await fetchJson(EVA_QUERY, 'EVA café Huila');
const protectedAreas = await fetchJson(RUNAP_QUERY, 'RUNAP áreas protegidas');

const overpassQuery = `[out:json][timeout:90];
(
  way["waterway"~"river|stream"]["name"](1.55213,-76.62466,3.84321,-74.41303);
);
out tags geom;`;

const overpass = await fetchJson(OVERPASS_URL, 'OpenStreetMap cauces', {
  method: 'POST',
  headers: {
    'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'user-agent': 'Cafe2035Huila/1.0 educational prototype',
  },
  body: new URLSearchParams({ data: overpassQuery }),
});

if (municipalities.type !== 'FeatureCollection' || municipalities.features.length < 30) {
  throw new Error('La consulta del IGAC no devolvió los municipios esperados del Huila.');
}

const locatorMunicipalities = municipalities.features.map((feature) => {
  const geometry = simplifyGeometry(feature.geometry, 0.003);
  const coordinates = flattenCoordinates(geometry.coordinates);
  const bounds = coordinates.reduce(
    (accumulator, [x, y]) => [
      Math.min(accumulator[0], x),
      Math.min(accumulator[1], y),
      Math.max(accumulator[2], x),
      Math.max(accumulator[3], y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  return { geometry, bounds };
});

const pointInHuila = ([x, y]) =>
  locatorMunicipalities.some(
    ({ geometry, bounds }) =>
      x >= bounds[0] &&
      x <= bounds[2] &&
      y >= bounds[1] &&
      y <= bounds[3] &&
      pointInGeometry([x, y], geometry),
  );

const intersectsHuila = (geometry) => {
  const coordinates = flattenCoordinates(geometry.coordinates);
  const stride = Math.max(1, Math.floor(coordinates.length / 80));
  for (let index = 0; index < coordinates.length; index += stride) {
    if (pointInHuila(coordinates[index])) return true;
  }
  return coordinates.length > 0 && pointInHuila(coordinates.at(-1));
};

municipalities.features.sort((a, b) =>
  String(a.properties?.MpCodigo).localeCompare(String(b.properties?.MpCodigo)),
);

const simplifiedMunicipalities = {
  ...municipalities,
  features: municipalities.features.map((feature) => ({
    ...feature,
    geometry: simplifyGeometry(feature.geometry, 0.00035),
  })),
};

const localProtectedAreas = {
  ...protectedAreas,
  features: protectedAreas.features
    .filter((feature) => intersectsHuila(feature.geometry))
    .map((feature) => ({
      ...feature,
      geometry: simplifyGeometry(feature.geometry, 0.0012),
    })),
};

await writeFile(
  new URL('huila-municipios.geojson', DATA_DIR),
  `${JSON.stringify(simplifiedMunicipalities)}\n`,
  'utf8',
);

await writeFile(
  new URL('huila-areas-protegidas.geojson', DATA_DIR),
  `${JSON.stringify(localProtectedAreas)}\n`,
  'utf8',
);

const waterways = {
  type: 'FeatureCollection',
  features: overpass.elements
    .filter((element) => element.type === 'way' && element.geometry?.length > 1)
    .map((element) => ({
      type: 'Feature',
      id: element.id,
      properties: {
        name: element.tags?.name ?? 'Cauce sin nombre',
        waterway: element.tags?.waterway ?? 'stream',
        source: 'OpenStreetMap',
      },
      geometry: simplifyGeometry({
        type: 'LineString',
        coordinates: element.geometry.map(({ lon, lat }) => [lon, lat]),
      }, 0.00035),
    }))
    .filter((feature) => intersectsHuila(feature.geometry)),
};

await writeFile(
  new URL('huila-cauces-osm.geojson', DATA_DIR),
  `${JSON.stringify(waterways)}\n`,
  'utf8',
);

const municipalitySeries = new Map();

for (const row of evaRows) {
  const code = row.c_digo_dane_municipio;
  const year = Number(row.a_o);
  const planted = Number(row.rea_sembrada ?? 0);
  const harvested = Number(row.rea_cosechada ?? 0);
  const production = Number(row.producci_n ?? 0);
  const yieldValue = Number(row.rendimiento ?? 0);

  if (!code || !Number.isFinite(year) || !Number.isFinite(planted)) continue;

  const series = municipalitySeries.get(code) ?? {
    code,
    municipality: row.municipio,
    observations: [],
  };

  const current = series.observations.find((observation) => observation.year === year);
  if (current) {
    current.plantedHa += planted;
    current.harvestedHa += harvested;
    current.productionT += production;
    current.yieldTPerHa = Math.max(current.yieldTPerHa, yieldValue);
  } else {
    series.observations.push({
      year,
      plantedHa: planted,
      harvestedHa: harvested,
      productionT: production,
      yieldTPerHa: yieldValue,
    });
  }

  municipalitySeries.set(code, series);
}

const evaDerived = {
  source: 'EVA UPRA, conjunto uejq-wxrr',
  generatedAt: new Date().toISOString(),
  municipalities: [...municipalitySeries.values()]
    .map((series) => ({
      ...series,
      observations: series.observations.sort((a, b) => a.year - b.year),
    }))
    .sort((a, b) => a.code.localeCompare(b.code)),
};

await writeFile(
  new URL('eva-huila-cafe-derived.json', DATA_DIR),
  `${JSON.stringify(evaDerived, null, 2)}\n`,
  'utf8',
);

console.log(`IGAC: ${municipalities.features.length} municipios guardados.`);
console.log(`EVA: ${evaRows.length} registros agregados en ${evaDerived.municipalities.length} municipios.`);
console.log(`RUNAP: ${localProtectedAreas.features.length} áreas protegidas intersectan Huila.`);
console.log(`OSM: ${waterways.features.length} tramos hídricos con nombre guardados.`);
