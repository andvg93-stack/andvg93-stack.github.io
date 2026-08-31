'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';

import type { FrontierCollection, FrontierFeature } from '@/lib/simulation/types';

const BASE_BOUNDS = {
  minX: -76.72,
  minY: -3.94,
  width: 2.4,
  height: 2.48,
};

const FOCUS = new Set([
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

const MAJOR_WATERWAYS = [
  'Río Magdalena',
  'Río Páez',
  'Río Suaza',
  'Río Las Ceibas',
  'Río Guarapas',
  'Río Timaná',
  'Río Bordones',
  'Baché',
];

interface TerritoryData {
  municipalities: FeatureCollection;
  protectedAreas: FeatureCollection;
  waterways: FeatureCollection;
  frontier: FrontierCollection;
}

interface HoverInfo {
  x: number;
  y: number;
  feature: FrontierFeature;
  state: string;
}

function ringPath(ring: number[][]) {
  if (!ring.length) return '';
  return `${ring.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${-y}`).join('')}Z`;
}

function linePath(line: number[][]) {
  return line.map(([x, y], index) => `${index ? 'L' : 'M'}${x},${-y}`).join('');
}

function geometryPath(geometry: Geometry | null) {
  if (!geometry) return '';
  if (geometry.type === 'Polygon') return geometry.coordinates.map(ringPath).join('');
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap((polygon) => polygon.map(ringPath)).join('');
  }
  if (geometry.type === 'LineString') return linePath(geometry.coordinates);
  if (geometry.type === 'MultiLineString') return geometry.coordinates.map(linePath).join('');
  return '';
}

function geometryBounds(geometry: Geometry | null) {
  const points: number[][] = [];
  const walk = (coordinates: unknown) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === 'number') points.push(coordinates as number[]);
    else coordinates.forEach(walk);
  };
  if (geometry && 'coordinates' in geometry) walk(geometry.coordinates);
  return points.reduce(
    (bounds, [x, y]) => [
      Math.min(bounds[0], x),
      Math.min(bounds[1], y),
      Math.max(bounds[2], x),
      Math.max(bounds[3], y),
    ],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
}

function geometryLines(geometry: Geometry | null): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

function lineLength(line: number[][]) {
  return line.slice(1).reduce((total, [x, y], index) => {
    const [previousX, previousY] = line[index];
    return total + Math.hypot(x - previousX, y - previousY);
  }, 0);
}

function lineMidpoint(line: number[][]) {
  const total = lineLength(line);
  let travelled = 0;

  for (let index = 1; index < line.length; index += 1) {
    const [startX, startY] = line[index - 1];
    const [endX, endY] = line[index];
    const segment = Math.hypot(endX - startX, endY - startY);
    if (travelled + segment >= total / 2) {
      const ratio = segment ? (total / 2 - travelled) / segment : 0;
      return {
        x: startX + (endX - startX) * ratio,
        y: -(startY + (endY - startY) * ratio),
      };
    }
    travelled += segment;
  }

  const [x = 0, y = 0] = line[0] ?? [];
  return { x, y: -y };
}

function featureState(feature: FrontierFeature, month: number) {
  if (feature.properties.retireMonth != null && feature.properties.retireMonth <= month) {
    return 'Retiro / pérdida de aptitud';
  }
  return feature.properties.origin === 'expansion'
    ? 'Nueva expansión'
    : 'Café inicial o persistente';
}

function activeFrontier(feature: FrontierFeature, month: number) {
  return (
    feature.properties.startMonth <= month &&
    (feature.properties.retireMonth == null || feature.properties.retireMonth > month)
  );
}

export function LocalTerritoryMap({ month }: { month: number }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; centerX: number; centerY: number } | null>(null);
  const [data, setData] = useState<TerritoryData | null>(null);
  const [zoom, setZoom] = useState(1);
  const [center, setCenter] = useState({
    x: BASE_BOUNDS.minX + BASE_BOUNDS.width / 2,
    y: BASE_BOUNDS.minY + BASE_BOUNDS.height / 2,
  });
  const [hover, setHover] = useState<HoverInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetch('/data/huila-municipios.geojson').then((response) => response.json() as Promise<FeatureCollection>),
      fetch('/data/huila-areas-protegidas.geojson').then((response) => response.json() as Promise<FeatureCollection>),
      fetch('/data/huila-cauces-osm.geojson').then((response) => response.json() as Promise<FeatureCollection>),
      fetch('/data/cafe-frontier.geojson').then((response) => response.json() as Promise<FrontierCollection>),
    ])
      .then(([municipalities, protectedAreas, waterways, frontier]) => {
        if (!cancelled) setData({ municipalities, protectedAreas, waterways, frontier });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const viewBox = useMemo(() => {
    const width = BASE_BOUNDS.width / zoom;
    const height = BASE_BOUNDS.height / zoom;
    return `${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`;
  }, [center, zoom]);

  const setZoomClamped = (value: number) => setZoom(Math.min(3.6, Math.max(1, value)));

  const moveHover = (event: React.PointerEvent<SVGPathElement>, feature: FrontierFeature) => {
    const rect = shellRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHover({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      feature,
      state: featureState(feature, Math.round(month)),
    });
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !shellRef.current) return;
    const rect = shellRef.current.getBoundingClientRect();
    const width = BASE_BOUNDS.width / zoom;
    const height = BASE_BOUNDS.height / zoom;
    setCenter({
      x: dragRef.current.centerX - ((event.clientX - dragRef.current.x) / rect.width) * width,
      y: dragRef.current.centerY - ((event.clientY - dragRef.current.y) / rect.height) * height,
    });
  };

  const monthIndex = Math.round(month);
  const municipalityFeatures = (data?.municipalities.features ?? []) as Array<
    Feature<Geometry, GeoJsonProperties>
  >;
  const labels = municipalityFeatures
    .filter((feature) => FOCUS.has(String(feature.properties?.MpNombre)))
    .map((feature) => {
      const bounds = geometryBounds(feature.geometry);
      return {
        name: String(feature.properties?.MpNombre),
        x: (bounds[0] + bounds[2]) / 2,
        y: -((bounds[1] + bounds[3]) / 2),
      };
    });
  const waterwayLabels = MAJOR_WATERWAYS.flatMap((name) => {
    const longestLine = (data?.waterways.features ?? [])
      .filter((feature) => feature.properties?.name === name)
      .flatMap((feature) => geometryLines(feature.geometry))
      .sort((a, b) => lineLength(b) - lineLength(a))[0];

    return longestLine ? [{ name, ...lineMidpoint(longestLine) }] : [];
  });

  return (
    <div ref={shellRef} className="local-territory-map" data-testid="local-territory-map">
      {data && (
        <svg
          viewBox={viewBox}
          aria-label="Mapa vectorial local del Huila con municipios, áreas protegidas, cauces y huella cafetera"
          onWheel={(event) => {
            event.preventDefault();
            setZoomClamped(zoom * (event.deltaY < 0 ? 1.18 : 0.85));
          }}
          onPointerDown={(event) => {
            if ((event.target as SVGElement).classList.contains('coffee-cell')) return;
            dragRef.current = { x: event.clientX, y: event.clientY, centerX: center.x, centerY: center.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
        >
          <defs>
            <clipPath id="huila-mask">
              {municipalityFeatures.map((feature, index) => (
                <path key={feature.id ?? index} d={geometryPath(feature.geometry)} />
              ))}
            </clipPath>
            <pattern
              id="expansion-hatch"
              width="0.018"
              height="0.018"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <rect width="0.018" height="0.018" fill="#e96f51" />
              <line x1="0" y1="0" x2="0" y2="0.018" stroke="#ffe1d7" strokeWidth="0.005" />
            </pattern>
          </defs>
          <g className="svg-territory-base">
            {municipalityFeatures.map((feature, index) => (
              <path key={feature.id ?? index} d={geometryPath(feature.geometry)} />
            ))}
          </g>

          <g className="svg-protected" clipPath="url(#huila-mask)">
            {data.protectedAreas.features.map((feature, index) => (
              <path key={feature.id ?? index} d={geometryPath(feature.geometry)} />
            ))}
          </g>

          <g className="svg-focus-municipalities">
            {municipalityFeatures
              .filter((feature) => FOCUS.has(String(feature.properties?.MpNombre)))
              .map((feature, index) => (
                <path key={feature.id ?? index} d={geometryPath(feature.geometry)} />
              ))}
          </g>

          <g className="svg-frontier svg-frontier--retired">
            {data.frontier.features
              .filter((feature) => feature.properties.retireMonth != null && feature.properties.retireMonth <= monthIndex)
              .map((feature) => (
                <path
                  key={String(feature.id)}
                  className="coffee-cell"
                  d={geometryPath(feature.geometry)}
                  onPointerMove={(event) => moveHover(event, feature)}
                  onPointerLeave={() => setHover(null)}
                />
              ))}
          </g>

          <g className="svg-frontier svg-frontier--initial">
            {data.frontier.features
              .filter((feature) => feature.properties.origin === 'initial' && activeFrontier(feature, monthIndex))
              .map((feature) => (
                <path
                  key={String(feature.id)}
                  className="coffee-cell"
                  d={geometryPath(feature.geometry)}
                  onPointerMove={(event) => moveHover(event, feature)}
                  onPointerLeave={() => setHover(null)}
                />
              ))}
          </g>

          <g className="svg-frontier svg-frontier--expansion">
            {data.frontier.features
              .filter((feature) => feature.properties.origin === 'expansion' && activeFrontier(feature, monthIndex))
              .map((feature) => (
                <path
                  key={String(feature.id)}
                  className="coffee-cell"
                  d={geometryPath(feature.geometry)}
                  onPointerMove={(event) => moveHover(event, feature)}
                  onPointerLeave={() => setHover(null)}
                />
              ))}
          </g>

          <g className="svg-waterways svg-waterways--casing" clipPath="url(#huila-mask)" aria-hidden="true">
            {data.waterways.features.map((feature, index) => (
              <path key={feature.id ?? index} d={geometryPath(feature.geometry)} />
            ))}
          </g>

          <g
            className="svg-waterways svg-waterways--main"
            clipPath="url(#huila-mask)"
            data-testid="waterways-layer"
          >
            {data.waterways.features.map((feature, index) => (
              <path key={feature.id ?? index} d={geometryPath(feature.geometry)} />
            ))}
          </g>

          <g className="svg-waterway-labels" data-testid="waterway-labels" aria-hidden="true">
            {waterwayLabels.map((label) => (
              <text key={label.name} x={label.x} y={label.y}>{label.name}</text>
            ))}
          </g>

          <g className="svg-municipality-labels" aria-hidden="true">
            {labels.map((label) => (
              <text key={label.name} x={label.x} y={label.y}>{label.name}</text>
            ))}
          </g>
        </svg>
      )}

      <div className="local-map-controls" aria-label="Controles del mapa local">
        <button type="button" onClick={() => setZoomClamped(zoom * 1.25)} aria-label="Acercar mapa">
          <Plus aria-hidden="true" />
        </button>
        <button type="button" onClick={() => setZoomClamped(zoom / 1.25)} aria-label="Alejar mapa">
          <Minus aria-hidden="true" />
        </button>
      </div>

      {hover && (
        <div className="local-map-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <span>{hover.state}</span>
          <strong>{hover.feature.properties.municipality}</strong>
          <p>≈ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(hover.feature.properties.hectares)} ha representadas</p>
          <p>Aptitud: {hover.feature.properties.aptitude2026} → {hover.feature.properties.aptitude2035}</p>
          <p>Confianza espacial: {hover.feature.properties.confidence}</p>
        </div>
      )}
    </div>
  );
}
