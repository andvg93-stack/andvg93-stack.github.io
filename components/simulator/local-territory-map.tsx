'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import type { Feature, FeatureCollection, GeoJsonProperties, Geometry } from 'geojson';

import {
  buildFrontierVisuals,
  visualWeights,
  type FrontierVisualDescriptor,
} from '@/lib/simulation/frontier-visuals';
import type { FrontierCollection, FrontierFeature } from '@/lib/simulation/types';
import { prepareSurface, surfacePaths, type SurfaceData } from '@/lib/simulation/frontier-surface';
import { sitePath } from '@/lib/site-path';

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
  surface: SurfaceData;
}

interface HoverInfo {
  x: number;
  y: number;
  municipality: string;
  hectares: number;
  aptitude2026: string;
  aptitude2035: string;
  confidence: string;
}

type MunicipalitySummary = Omit<HoverInfo, 'x' | 'y'>;

interface DragState {
  startX: number;
  startY: number;
  latestX: number;
  latestY: number;
  centerX: number;
  centerY: number;
  viewWidth: number;
  viewHeight: number;
  pixelsPerUnit: number;
  pointerId: number;
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

function pointInRing([x, y]: [number, number], ring: number[][]) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];
    const intersects =
      currentY > y !== previousY > y &&
      x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInMunicipality(point: [number, number], geometry: Geometry | null) {
  const insidePolygon = (rings: number[][][]) =>
    Boolean(rings[0] && pointInRing(point, rings[0])) &&
    rings.slice(1).every((ring) => !pointInRing(point, ring));
  if (geometry?.type === 'Polygon') return insidePolygon(geometry.coordinates);
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates.some(insidePolygon);
  return false;
}

function municipalityInteriorPoint(geometry: Geometry | null) {
  const bounds = geometryBounds(geometry);
  const center: [number, number] = [
    (bounds[0] + bounds[2]) / 2,
    (bounds[1] + bounds[3]) / 2,
  ];
  if (pointInMunicipality(center, geometry)) return center;

  let closest: [number, number] | null = null;
  let closestDistance = Infinity;
  for (let row = 1; row < 20; row += 1) {
    for (let column = 1; column < 20; column += 1) {
      const candidate: [number, number] = [
        bounds[0] + ((bounds[2] - bounds[0]) * column) / 20,
        bounds[1] + ((bounds[3] - bounds[1]) * row) / 20,
      ];
      if (!pointInMunicipality(candidate, geometry)) continue;
      const distance = Math.hypot(candidate[0] - center[0], candidate[1] - center[1]);
      if (distance < closestDistance) {
        closest = candidate;
        closestDistance = distance;
      }
    }
  }
  return closest ?? center;
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

function summarizeMunicipality(
  municipality: string,
  descriptors: FrontierVisualDescriptor[],
  month: number,
): MunicipalitySummary | null {
  const entries = descriptors
    .map((descriptor) => {
      const weights = visualWeights(descriptor, month);
      return {
        feature: descriptor.feature,
        weight: Math.max(weights.active, weights.retired),
      };
    })
    .filter(({ weight }) => weight > 0.02);
  if (!entries.length) {
    return {
      municipality,
      hectares: 0,
      aptitude2026: 'Sin huella activa',
      aptitude2035: 'Sin huella activa',
      confidence: 'Sin dato',
    };
  }

  const dominantValue = (selector: (feature: FrontierFeature) => string) => {
    const totals = new Map<string, number>();
    entries.forEach(({ feature, weight }) => {
      const value = selector(feature);
      totals.set(value, (totals.get(value) ?? 0) + feature.properties.hectares * weight);
    });
    return [...totals.entries()].sort((first, second) =>
      second[1] - first[1] || first[0].localeCompare(second[0]),
    )[0]?.[0] ?? 'Sin dato';
  };

  return {
    municipality,
    hectares: entries.reduce(
      (total, { feature, weight }) => total + feature.properties.hectares * weight,
      0,
    ),
    aptitude2026: dominantValue((feature) => feature.properties.aptitude2026),
    aptitude2035: dominantValue((feature) => feature.properties.aptitude2035),
    confidence: dominantValue((feature) => feature.properties.confidence),
  };
}

export function LocalTerritoryMap({ month }: { month: number }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const panFrameRef = useRef<number | null>(null);
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
      fetch(sitePath('/data/huila-municipios.geojson')).then((response) => response.json() as Promise<FeatureCollection>),
      fetch(sitePath('/data/huila-areas-protegidas.geojson')).then((response) => response.json() as Promise<FeatureCollection>),
      fetch(sitePath('/data/huila-cauces-osm.geojson')).then((response) => response.json() as Promise<FeatureCollection>),
      fetch(sitePath('/data/cafe-frontier.geojson')).then((response) => response.json() as Promise<FrontierCollection>),
      fetch(sitePath('/data/frontier-surface.json')).then((response) => response.json() as Promise<SurfaceData>),
    ])
      .then(([municipalities, protectedAreas, waterways, frontier, surface]) => {
        if (!cancelled) setData({ municipalities, protectedAreas, waterways, frontier, surface });
      })
      .catch(() => {
        if (!cancelled) setData(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => () => {
    if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
  }, []);

  const viewBox = useMemo(() => {
    const width = BASE_BOUNDS.width / zoom;
    const height = BASE_BOUNDS.height / zoom;
    return `${center.x - width / 2} ${center.y - height / 2} ${width} ${height}`;
  }, [center, zoom]);

  const setZoomClamped = (value: number) => setZoom(Math.min(3.6, Math.max(1, value)));

  const requestedVisualMonth = reducedMotion ? Math.round(month) : month;
  const visualMonth = requestedVisualMonth;
  const municipalityFeatures = useMemo(() => (
    (data?.municipalities.features ?? []) as Array<Feature<Geometry, GeoJsonProperties>>
  ), [data?.municipalities.features]);
  const municipalityPaths = useMemo(() => municipalityFeatures.map((feature, index) => ({
    key: String(feature.id ?? index),
    name: String(feature.properties?.MpNombre ?? ''),
    d: geometryPath(feature.geometry),
  })), [municipalityFeatures]);
  const protectedPaths = useMemo(() => (data?.protectedAreas.features ?? []).map((feature, index) => ({
    key: String(feature.id ?? index),
    d: geometryPath(feature.geometry),
  })), [data?.protectedAreas.features]);
  const waterwayPaths = useMemo(() => (data?.waterways.features ?? []).map((feature, index) => ({
    key: String(feature.id ?? index),
    d: geometryPath(feature.geometry),
  })), [data?.waterways.features]);
  const labels = useMemo(() => municipalityFeatures
    .filter((feature) => FOCUS.has(String(feature.properties?.MpNombre)))
    .map((feature) => {
      const bounds = geometryBounds(feature.geometry);
      return {
        name: String(feature.properties?.MpNombre),
        x: (bounds[0] + bounds[2]) / 2,
        y: -((bounds[1] + bounds[3]) / 2),
      };
    }), [municipalityFeatures]);
  const waterwayLabels = useMemo(() => MAJOR_WATERWAYS.flatMap((name) => {
    const longestLine = (data?.waterways.features ?? [])
      .filter((feature) => feature.properties?.name === name)
      .flatMap((feature) => geometryLines(feature.geometry))
      .sort((a, b) => lineLength(b) - lineLength(a))[0];

    return longestLine ? [{ name, ...lineMidpoint(longestLine) }] : [];
  }), [data?.waterways.features]);
  const descriptors = useMemo(
    () => buildFrontierVisuals(data?.frontier.features ?? []),
    [data],
  );
  const surface = useMemo(() => data ? prepareSurface(data.surface) : null, [data]);
  const paths = useMemo(() => surface ? surfacePaths(surface, visualMonth) : null, [surface, visualMonth]);
  const baselinePath = useMemo(() => surface ? surfacePaths(surface, 0, true).persistent : '', [surface]);
  const summaryMonth = Math.round(visualMonth);
  const descriptorsByMunicipality = useMemo(() => {
    const grouped = new Map<string, FrontierVisualDescriptor[]>();
    descriptors.forEach((descriptor) => {
      const municipality = descriptor.feature.properties.municipality;
      grouped.set(municipality, [...(grouped.get(municipality) ?? []), descriptor]);
    });
    return grouped;
  }, [descriptors]);
  const municipalityHitPoints = useMemo(() => new Map(
    ((data?.municipalities.features ?? []) as Array<Feature<Geometry, GeoJsonProperties>>)
      .map((feature) => [String(feature.properties?.MpNombre ?? ''), municipalityInteriorPoint(feature.geometry)]),
  ), [data]);

  const applyPanTransform = () => {
    panFrameRef.current = null;
    const drag = dragRef.current;
    if (!drag || !contentRef.current) return;
    contentRef.current.setAttribute('transform', `translate(${(drag.latestX - drag.startX) / drag.pixelsPerUnit} ${(drag.latestY - drag.startY) / drag.pixelsPerUnit})`);
  };

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    if (panFrameRef.current !== null) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
    }
    const nextCenter = {
      x: drag.centerX - (drag.latestX - drag.startX) / drag.pixelsPerUnit,
      y: drag.centerY - (drag.latestY - drag.startY) / drag.pixelsPerUnit,
    };
    const nextViewBox = `${nextCenter.x - drag.viewWidth / 2} ${nextCenter.y - drag.viewHeight / 2} ${drag.viewWidth} ${drag.viewHeight}`;
    svgRef.current?.setAttribute('viewBox', nextViewBox);
    if (contentRef.current) {
      contentRef.current.removeAttribute('transform');
      contentRef.current.classList.remove('is-panning');
    }
    dragRef.current = null;
    if (svgRef.current?.hasPointerCapture(drag.pointerId)) svgRef.current.releasePointerCapture(drag.pointerId);
    setCenter(nextCenter);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (drag) {
      if (event.pointerId !== drag.pointerId) return;
      drag.latestX = event.clientX;
      drag.latestY = event.clientY;
      if (panFrameRef.current === null) panFrameRef.current = requestAnimationFrame(applyPanTransform);
      return;
    }

    if (!shellRef.current) return;
    const shellRect = shellRef.current.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();
    const width = BASE_BOUNDS.width / zoom;
    const height = BASE_BOUNDS.height / zoom;

    const scale = Math.min(rect.width / width, rect.height / height);
    const offsetX = (rect.width - width * scale) / 2;
    const offsetY = (rect.height - height * scale) / 2;
    const svgX = center.x - width / 2 + (event.clientX - rect.left - offsetX) / scale;
    const svgY = center.y - height / 2 + (event.clientY - rect.top - offsetY) / scale;
    const municipalityFeature = municipalityFeatures.find((feature) =>
      pointInMunicipality([svgX, -svgY], feature.geometry),
    );
    const municipality = String(municipalityFeature?.properties?.MpNombre ?? '');
    const summary = summarizeMunicipality(
      municipality,
      descriptorsByMunicipality.get(municipality) ?? [],
      summaryMonth,
    );
    if (!municipality || !summary) {
      setHover(null);
      return;
    }
    setHover({
      x: event.clientX - shellRect.left,
      y: event.clientY - shellRect.top,
      ...summary,
    });
  };

  return (
    <div ref={shellRef} className="local-territory-map" data-testid="local-territory-map">
      {data && (
        <svg
          ref={svgRef}
          viewBox={viewBox}
          aria-label="Mapa vectorial local del Huila con municipios, áreas protegidas, cauces y huella cafetera"
          onWheel={(event) => {
            event.preventDefault();
            if (dragRef.current) return;
            setZoomClamped(zoom * (event.deltaY < 0 ? 1.18 : 0.85));
          }}
          onPointerDown={(event) => {
            if (dragRef.current || (event.pointerType === 'mouse' && event.button !== 0)) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const width = BASE_BOUNDS.width / zoom;
            const height = BASE_BOUNDS.height / zoom;
            setHover(null);
            dragRef.current = {
              startX: event.clientX,
              startY: event.clientY,
              latestX: event.clientX,
              latestY: event.clientY,
              centerX: center.x,
              centerY: center.y,
              viewWidth: width,
              viewHeight: height,
              pixelsPerUnit: Math.min(rect.width / width, rect.height / height),
              pointerId: event.pointerId,
            };
            contentRef.current?.classList.add('is-panning');
            if (event.isTrusted) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            if (dragRef.current?.pointerId !== event.pointerId) return;
            dragRef.current.latestX = event.clientX;
            dragRef.current.latestY = event.clientY;
            finishDrag();
          }}
          onPointerCancel={finishDrag}
          onLostPointerCapture={finishDrag}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <clipPath id="huila-mask">
              {municipalityPaths.map((shape) => (
                <path key={shape.key} d={shape.d} />
              ))}
            </clipPath>
            <mask id="coffee-allowed" maskUnits="userSpaceOnUse" x="-77" y="-5" width="4" height="5">
              <rect x="-77" y="-5" width="4" height="5" fill="white" />
              {protectedPaths.map((shape) => <path key={shape.key} d={shape.d} fill="black" />)}
            </mask>
            <pattern id="retirement-hatch" width="0.014" height="0.014" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
              <rect width="0.014" height="0.014" fill="#ddd6e7" />
              <path d="M0 0V0.014" stroke="#735989" strokeWidth="0.004" />
            </pattern>
          </defs>
          <g ref={contentRef} className="svg-map-content">
          <g className="svg-territory-base">
            {municipalityPaths.map((shape) => (
              <path key={shape.key} d={shape.d} />
            ))}
          </g>

          <g className="svg-protected" clipPath="url(#huila-mask)">
            {protectedPaths.map((shape) => (
              <path key={shape.key} d={shape.d} />
            ))}
          </g>

          <g className="svg-focus-municipalities">
            {municipalityPaths
              .filter((shape) => FOCUS.has(shape.name))
              .map((shape) => (
                <path key={shape.key} d={shape.d} />
              ))}
          </g>

          <g className="svg-surface-layer" clipPath="url(#huila-mask)" mask="url(#coffee-allowed)" data-testid="coffee-blob-layer" data-visual-month={visualMonth.toFixed(3)}>
            <path className="surface-persistent" data-testid="active-surface" d={paths?.persistent ?? ''} fillRule="evenodd" />
            <path className="surface-expansion" data-testid="expansion-surface" d={paths?.expansion ?? ''} fillRule="evenodd" />
            <path className="surface-retired" data-testid="retired-surface" d={paths?.retired ?? ''} fillRule="evenodd" />
            <path className="surface-baseline" d={baselinePath} fillRule="evenodd" />
          </g>

          <g className="svg-waterways svg-waterways--casing" clipPath="url(#huila-mask)" aria-hidden="true">
            {waterwayPaths.map((shape) => (
              <path key={shape.key} d={shape.d} />
            ))}
          </g>

          <g
            className="svg-waterways svg-waterways--main"
            clipPath="url(#huila-mask)"
            data-testid="waterways-layer"
          >
            {waterwayPaths.map((shape) => (
              <path key={shape.key} d={shape.d} />
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

          <g className="svg-municipality-hit-layer" data-testid="municipality-hit-layer" aria-hidden="true">
            {municipalityFeatures.map((feature, index) => {
              const municipality = String(feature.properties?.MpNombre ?? '');
              const [hitX, hitY] = municipalityHitPoints.get(municipality) ?? [0, 0];
              return (
                <circle
                  key={feature.id ?? index}
                  cx={hitX}
                  cy={-hitY}
                  r="0"
                  data-municipality={municipality}
                  data-hit-x={hitX}
                  data-hit-y={-hitY}
                />
              );
            })}
          </g>
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
        <button type="button" aria-label="Restablecer vista del Huila" onClick={() => {
          finishDrag();
          setZoom(1);
          setCenter({ x: BASE_BOUNDS.minX + BASE_BOUNDS.width / 2, y: BASE_BOUNDS.minY + BASE_BOUNDS.height / 2 });
        }}>⌖</button>
      </div>

      {hover && (
        <div className="local-map-tooltip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <span>Resumen municipal · huella estimada</span>
          <strong>{hover.municipality}</strong>
          <p>≈ {new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(hover.hectares)} ha representadas</p>
          <p>Aptitud dominante: {hover.aptitude2026} → {hover.aptitude2035}</p>
          <p>Confianza espacial dominante: {hover.confidence}</p>
        </div>
      )}
    </div>
  );
}
