'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';

import {
  buildFrontierVisuals,
  descriptorTransform,
  interpolatePoint,
  roughnessForMonth,
  visualScale,
  visualWeights,
  type FrontierVisualDescriptor,
} from '@/lib/simulation/frontier-visuals';
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

interface OrganicFilterProps {
  id: string;
  fill: string;
  outline: string;
  frequencyX: number;
  frequencyY: number;
  displacement: number;
}

function OrganicFilter({
  id,
  fill,
  outline,
  frequencyX,
  frequencyY,
  displacement,
}: OrganicFilterProps) {
  return (
    <filter
      id={id}
      x={BASE_BOUNDS.minX - 0.18}
      y={BASE_BOUNDS.minY - 0.18}
      width={BASE_BOUNDS.width + 0.36}
      height={BASE_BOUNDS.height + 0.36}
      filterUnits="userSpaceOnUse"
      primitiveUnits="userSpaceOnUse"
      colorInterpolationFilters="sRGB"
    >
      <feGaussianBlur in="SourceGraphic" stdDeviation="0.0072" result="soft-field" />
      <feColorMatrix
        in="soft-field"
        type="matrix"
        values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 17 -6.2"
        result="joined-field"
      />
      <feTurbulence
        type="fractalNoise"
        baseFrequency={`${frequencyX.toFixed(2)} ${frequencyY.toFixed(2)}`}
        numOctaves="1"
        seed="2035"
        result="terrain-noise"
      />
      <feDisplacementMap
        in="joined-field"
        in2="terrain-noise"
        scale={displacement}
        xChannelSelector="R"
        yChannelSelector="G"
        result="rough-field"
      />
      <feMorphology in="rough-field" operator="dilate" radius="0.00155" result="outline-field" />
      <feFlood floodColor={outline} result="outline-color" />
      <feComposite in="outline-color" in2="outline-field" operator="in" result="outline-shape" />
      <feFlood floodColor={fill} result="fill-color" />
      <feComposite in="fill-color" in2="rough-field" operator="in" result="fill-shape" />
      <feMerge>
        <feMergeNode in="outline-shape" />
        <feMergeNode in="fill-shape" />
      </feMerge>
    </filter>
  );
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

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}

function connectionPath(descriptor: FrontierVisualDescriptor, progress: number) {
  if (!descriptor.connectsToParent || !descriptor.parentCentroid) return '';
  const endpoint = interpolatePoint(descriptor.parentCentroid, descriptor.centroid, progress);
  return `M${descriptor.parentCentroid.x},${descriptor.parentCentroid.y}L${endpoint.x},${endpoint.y}`;
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
  const reducedMotion = useReducedMotion();

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

  const visualMonth = reducedMotion ? Math.round(month) : month;
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
  const descriptors = useMemo(
    () => buildFrontierVisuals(data?.frontier.features ?? []),
    [data],
  );
  const visualFeatures = useMemo(
    () => descriptors.map((descriptor) => ({
      descriptor,
      weights: visualWeights(descriptor, visualMonth),
    })),
    [descriptors, visualMonth],
  );
  const roughness = roughnessForMonth(Math.round(visualMonth * 2) / 2);

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
            <OrganicFilter
              id="coffee-active-blob"
              fill="#d79d31"
              outline="#754d0b"
              frequencyX={34}
              frequencyY={29}
              displacement={roughness.displacement}
            />
            <OrganicFilter
              id="coffee-expansion-blob"
              fill="#e96f51"
              outline="#943b2b"
              frequencyX={34}
              frequencyY={29}
              displacement={roughness.displacement}
            />
            <OrganicFilter
              id="coffee-retired-blob"
              fill="#737c77"
              outline="#4d5651"
              frequencyX={34}
              frequencyY={29}
              displacement={roughness.displacement}
            />
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

          <g
            className="svg-blob-layer"
            clipPath="url(#huila-mask)"
            data-testid="coffee-blob-layer"
            data-visual-month={visualMonth.toFixed(3)}
            data-roughness={`${roughness.frequencyX.toFixed(3)}:${roughness.frequencyY.toFixed(3)}:${roughness.displacement.toFixed(5)}`}
          >
            <g className="svg-blob-source svg-blob-source--retired" filter="url(#coffee-retired-blob)" data-testid="retired-blob">
              {visualFeatures
                .filter(({ weights }) => weights.retired > 0.001)
                .map(({ descriptor, weights }) => (
                  <path
                    key={descriptor.feature.properties.id}
                    d={geometryPath(descriptor.feature.geometry)}
                    transform={descriptorTransform(descriptor, weights.retired, 1, 1.38)}
                    data-progress={weights.retired.toFixed(4)}
                  />
                ))}
            </g>

            <g className="svg-blob-source svg-blob-source--active" filter="url(#coffee-active-blob)" data-testid="active-blob">
              {visualFeatures
                .filter(({ weights }) => weights.active > 0.001)
                .flatMap(({ descriptor, weights }) => {
                  const connection = connectionPath(descriptor, weights.entry);
                  const width = descriptor.radiusDegrees * 1.08 * visualScale(weights.active);
                  return [
                    connection ? (
                      <path
                        key={`${descriptor.feature.properties.id}-link`}
                        className="blob-connection"
                        d={connection}
                        strokeWidth={width}
                        data-connected-to={descriptor.parentId ?? undefined}
                      />
                    ) : null,
                    <path
                      key={descriptor.feature.properties.id}
                      d={geometryPath(descriptor.feature.geometry)}
                      transform={descriptorTransform(descriptor, weights.active, weights.entry, 1.42)}
                      data-progress={weights.active.toFixed(4)}
                    />,
                  ];
                })}
            </g>

            <g className="svg-blob-source svg-blob-source--expansion" filter="url(#coffee-expansion-blob)" data-testid="expansion-blob">
              {visualFeatures
                .filter(({ weights }) => weights.expansion > 0.001)
                .flatMap(({ descriptor, weights }) => {
                  const connection = connectionPath(descriptor, weights.entry);
                  const width = descriptor.radiusDegrees * 0.92 * visualScale(weights.expansion);
                  return [
                    connection ? (
                      <path
                        key={`${descriptor.feature.properties.id}-expansion-link`}
                        className="blob-connection"
                        d={connection}
                        strokeWidth={width}
                      />
                    ) : null,
                    <path
                      key={`${descriptor.feature.properties.id}-expansion`}
                      d={geometryPath(descriptor.feature.geometry)}
                      transform={descriptorTransform(descriptor, weights.expansion, weights.entry, 1.42)}
                      data-progress={weights.expansion.toFixed(4)}
                    />,
                  ];
                })}
            </g>

            <g className="svg-expansion-texture" aria-hidden="true">
              {visualFeatures
                .filter(({ weights }) => weights.expansion > 0.001)
                .map(({ descriptor, weights }) => (
                  <path
                    key={`${descriptor.feature.properties.id}-texture`}
                    d={geometryPath(descriptor.feature.geometry)}
                    transform={descriptorTransform(descriptor, weights.expansion, weights.entry, 1.42)}
                  />
                ))}
            </g>

            <g className="svg-frontier-hit-layer" data-testid="frontier-hit-layer">
              {visualFeatures
                .filter(({ weights }) => weights.active + weights.retired > 0.02)
                .map(({ descriptor, weights }) => {
                  const useActivePosition = weights.active >= weights.retired;
                  const hitWeight = Math.max(weights.active, weights.retired);
                  return (
                    <path
                      key={`${descriptor.feature.properties.id}-hit`}
                      className="coffee-cell"
                      d={geometryPath(descriptor.feature.geometry)}
                      transform={descriptorTransform(
                        descriptor,
                        Math.max(0.28, hitWeight),
                        useActivePosition ? weights.entry : 1,
                        1.34,
                      )}
                      data-feature-id={descriptor.feature.properties.id}
                      onPointerMove={(event) => moveHover(event, descriptor.feature)}
                      onPointerLeave={() => setHover(null)}
                    />
                  );
                })}
            </g>
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
