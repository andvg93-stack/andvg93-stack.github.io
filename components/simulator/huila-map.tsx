'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  FilterSpecification,
  GeoJSONSourceSpecification,
  Map as MapLibreMap,
  StyleSpecification,
} from 'maplibre-gl';
import { CloudOff, Layers3, MapPin } from 'lucide-react';

import { LocalTerritoryMap } from '@/components/simulator/local-territory-map';
import { monthLabel } from '@/lib/simulation/model';
import { sitePath } from '@/lib/site-path';

const FOCUS_MUNICIPALITIES = [
  'Acevedo',
  'Elías',
  'Isnos',
  'Oporapa',
  'Palestina',
  'Pitalito',
  'Saladoblanco',
  'San Agustín',
  'Timaná',
];

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

const OPEN_FREE_MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const HUILA_BOUNDS: [[number, number], [number, number]] = [
  [-76.62466, 1.55213],
  [-74.41303, 3.84321],
];

const sources: Record<string, GeoJSONSourceSpecification> = {
  'sim-municipalities': {
    type: 'geojson',
    data: sitePath('/data/huila-municipios.geojson'),
    attribution: 'Instituto Geográfico Agustín Codazzi (IGAC)',
  },
  'sim-protected': {
    type: 'geojson',
    data: sitePath('/data/huila-areas-protegidas.geojson'),
    attribution: 'RUNAP · Parques Nacionales Naturales de Colombia',
  },
  'sim-waterways': {
    type: 'geojson',
    data: sitePath('/data/huila-cauces-osm.geojson'),
    attribution: '© OpenStreetMap contributors',
  },
  'sim-frontier': {
    type: 'geojson',
    data: sitePath('/data/cafe-frontier.geojson'),
    attribution: 'Modelo didáctico Café 2035 · hectáreas calibradas con EVA/UPRA',
  },
};

const activeFilter = (month: number, origin: 'initial' | 'expansion'): FilterSpecification => [
  'all',
  ['==', ['get', 'origin'], origin],
  ['<=', ['get', 'startMonth'], month],
  ['>', ['coalesce', ['get', 'retireMonth'], 999], month],
];

const retiredFilter = (month: number): FilterSpecification => [
  'all',
  ['has', 'retireMonth'],
  ['<=', ['get', 'retireMonth'], month],
];

function overlayLayers(month: number): StyleSpecification['layers'] {
  return [
    {
      id: 'sim-huila-fill',
      type: 'fill',
      source: 'sim-municipalities',
      paint: {
        'fill-color': '#ece7d8',
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'sim-protected-fill',
      type: 'fill',
      source: 'sim-protected',
      paint: {
        'fill-color': '#2e6b4f',
        'fill-opacity': 0.34,
      },
    },
    {
      id: 'sim-protected-line',
      type: 'line',
      source: 'sim-protected',
      paint: {
        'line-color': '#1f5a43',
        'line-width': 0.7,
        'line-opacity': 0.65,
      },
    },
    {
      id: 'sim-focus-fill',
      type: 'fill',
      source: 'sim-municipalities',
      filter: ['match', ['get', 'MpNombre'], FOCUS_MUNICIPALITIES, true, false],
      paint: {
        'fill-color': '#f0c76b',
        'fill-opacity': 0.1,
      },
    },
    {
      id: 'sim-municipal-lines',
      type: 'line',
      source: 'sim-municipalities',
      paint: {
        'line-color': '#355653',
        'line-width': 0.65,
        'line-opacity': 0.58,
      },
    },
    {
      id: 'sim-focus-lines',
      type: 'line',
      source: 'sim-municipalities',
      filter: ['match', ['get', 'MpNombre'], FOCUS_MUNICIPALITIES, true, false],
      paint: {
        'line-color': '#173d39',
        'line-width': 1.5,
        'line-opacity': 0.92,
      },
    },
    {
      id: 'sim-coffee-retired',
      type: 'fill',
      source: 'sim-frontier',
      filter: retiredFilter(month),
      paint: {
        'fill-color': '#6e7772',
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'sim-coffee-initial',
      type: 'fill',
      source: 'sim-frontier',
      filter: activeFilter(month, 'initial'),
      paint: {
        'fill-color': '#d79d31',
        'fill-opacity': 0.82,
      },
    },
    {
      id: 'sim-coffee-expansion',
      type: 'fill',
      source: 'sim-frontier',
      filter: activeFilter(month, 'expansion'),
      paint: {
        'fill-color': '#e96f51',
        'fill-opacity': 0.76,
      },
    },
    {
      id: 'sim-coffee-outline',
      type: 'line',
      source: 'sim-frontier',
      filter: [
        'all',
        ['<=', ['get', 'startMonth'], month],
        ['>', ['coalesce', ['get', 'retireMonth'], 999], month],
      ],
      paint: {
        'line-color': [
          'match',
          ['get', 'origin'],
          'expansion',
          '#9f3c2a',
          '#81560b',
        ],
        'line-width': 0.8,
        'line-opacity': 0.82,
      },
    },
    {
      id: 'sim-waterways-casing',
      type: 'line',
      source: 'sim-waterways',
      paint: {
        'line-color': '#eef9fb',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 3.4, 10, 5.2],
        'line-opacity': 0.9,
      },
    },
    {
      id: 'sim-waterways-lines',
      type: 'line',
      source: 'sim-waterways',
      paint: {
        'line-color': '#197c9d',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.45, 10, 2.8],
        'line-opacity': 0.96,
      },
    },
    {
      id: 'sim-waterways-labels',
      type: 'symbol',
      source: 'sim-waterways',
      filter: ['match', ['get', 'name'], MAJOR_WATERWAYS, true, false],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 360,
        'text-field': ['get', 'name'],
        'text-size': 11,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
      },
      paint: {
        'text-color': '#155f7a',
        'text-halo-color': '#f5fbfa',
        'text-halo-width': 1.7,
        'text-halo-blur': 0.4,
      },
    },
  ];
}

function createStyle(
  base: StyleSpecification | null,
  month: number,
  localSources: Record<string, GeoJSONSourceSpecification> = sources,
): StyleSpecification {
  const baseLayers = base?.layers ?? [
    {
      id: 'sim-background',
      type: 'background' as const,
      paint: { 'background-color': '#d9e4de' },
    },
  ];
  return {
    ...base,
    version: 8,
    sources: { ...base?.sources, ...localSources },
    layers: [...baseLayers, ...overlayLayers(month)],
  } as StyleSpecification;
}

function setTimelineFilters(map: MapLibreMap, month: number) {
  if (!map.getLayer('sim-coffee-initial')) return;
  map.setFilter('sim-coffee-initial', activeFilter(month, 'initial'));
  map.setFilter('sim-coffee-expansion', activeFilter(month, 'expansion'));
  map.setFilter('sim-coffee-retired', retiredFilter(month));
  map.setFilter('sim-coffee-outline', [
    'all',
    ['<=', ['get', 'startMonth'], month],
    ['>', ['coalesce', ['get', 'retireMonth'], 999], month],
  ]);
}

function popupNode(properties: Record<string, unknown>, month: number) {
  const retireMonth = Number(properties.retireMonth);
  const origin = String(properties.origin);
  const state =
    Number.isFinite(retireMonth) && retireMonth <= month
      ? 'Retiro / pérdida de aptitud'
      : origin === 'expansion'
        ? 'Nueva expansión'
        : 'Café inicial o persistente';
  const wrapper = document.createElement('div');
  wrapper.className = 'map-popup';

  const eyebrow = document.createElement('p');
  eyebrow.className = 'map-popup__eyebrow';
  eyebrow.textContent = state;
  const title = document.createElement('strong');
  title.textContent = typeof properties.municipality === 'string' ? properties.municipality : 'Huila';
  const area = document.createElement('p');
  area.textContent = `≈ ${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(Number(properties.hectares ?? 0))} ha representadas`;
  const aptitude = document.createElement('p');
  const initialAptitude = typeof properties.aptitude2026 === 'string' ? properties.aptitude2026 : 'Sin dato';
  const futureAptitude = typeof properties.aptitude2035 === 'string' ? properties.aptitude2035 : 'Sin dato';
  aptitude.textContent = `Aptitud: ${initialAptitude} → ${futureAptitude}`;
  const confidence = document.createElement('p');
  confidence.textContent = `Confianza espacial: ${typeof properties.confidence === 'string' ? properties.confidence : 'Media'}`;
  wrapper.appendChild(eyebrow);
  wrapper.appendChild(title);
  wrapper.appendChild(area);
  wrapper.appendChild(aptitude);
  wrapper.appendChild(confidence);
  return wrapper;
}

export function HuilaMap({ month }: { month: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const monthRef = useRef(Math.round(month));
  const [status, setStatus] = useState<'loading' | 'open' | 'local'>('loading');
  const [renderedFeatures, setRenderedFeatures] = useState(0);
  const [sourceFeatures, setSourceFeatures] = useState(0);
  const [viewState, setViewState] = useState('');
  const [mapError, setMapError] = useState('');

  useEffect(() => {
    monthRef.current = Math.round(month);
    if (mapRef.current?.isStyleLoaded()) setTimelineFilters(mapRef.current, monthRef.current);
  }, [month]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;
    let popup: import('maplibre-gl').Popup | null = null;
    let map: MapLibreMap | null = null;

    async function initialise() {
      const maplibregl = await import('maplibre-gl');
      let baseStyle: StyleSpecification | null = null;
      const localOnly = new URLSearchParams(window.location.search).get('basemap') === 'local';
      const inlineSources = Object.fromEntries(
        await Promise.all(
          Object.entries(sources).map(async ([id, source]) => {
            try {
              const sourceUrl = typeof source.data === 'string' ? source.data : '';
              const response = await fetch(sourceUrl);
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return [id, { ...source, data: await response.json() }];
            } catch {
              return [id, source];
            }
          }),
        ),
      ) as Record<string, GeoJSONSourceSpecification>;

      if (!localOnly && navigator.onLine) {
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 2200);
        try {
          const response = await fetch(OPEN_FREE_MAP_STYLE, { signal: controller.signal });
          if (response.ok) baseStyle = (await response.json()) as StyleSpecification;
        } catch {
          baseStyle = null;
        } finally {
          window.clearTimeout(timeout);
        }
      }

      if (cancelled || !containerRef.current) return;
      setStatus(baseStyle ? 'open' : 'local');
      map = new maplibregl.Map({
        container: containerRef.current,
        style: createStyle(baseStyle, monthRef.current, inlineSources),
        bounds: HUILA_BOUNDS,
        fitBoundsOptions: { padding: 28, duration: 0 },
        minZoom: 5.8,
        maxZoom: 13,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');

      map.on('load', () => {
        if (!map) return;
        setTimelineFilters(map, monthRef.current);
      });

      map.on('idle', () => {
        if (!map?.getLayer('sim-municipal-lines')) return;
        setRenderedFeatures(map.queryRenderedFeatures(undefined, { layers: ['sim-municipal-lines'] }).length);
        setSourceFeatures(map.querySourceFeatures('sim-municipalities').length);
        const center = map.getCenter();
        setViewState(`${center.lng.toFixed(3)},${center.lat.toFixed(3)},z${map.getZoom().toFixed(2)}`);
      });

      map.on('error', (event) => {
        const message = event.error?.message ?? 'Error cartográfico';
        setMapError(message);
      });

      map.on('mousemove', (event) => {
        if (!map) return;
        const layers = ['sim-coffee-expansion', 'sim-coffee-initial', 'sim-coffee-retired'].filter(
          (layer) => Boolean(map?.getLayer(layer)),
        );
        const feature = map.queryRenderedFeatures(event.point, { layers })[0];
        map.getCanvas().style.cursor = feature ? 'pointer' : '';
        popup?.remove();
        popup = null;
        if (!feature) return;
        popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 })
          .setLngLat(event.lngLat)
          .setDOMContent(popupNode(feature.properties as Record<string, unknown>, monthRef.current))
          .addTo(map);
      });

      map.getCanvasContainer().addEventListener('mouseleave', () => {
        popup?.remove();
        popup = null;
        if (map) map.getCanvas().style.cursor = '';
      });
    }

    void initialise();
    return () => {
      cancelled = true;
      popup?.remove();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  return (
    <div
      className="map-shell"
      data-testid="map-shell"
      data-map-status={status}
      data-rendered-features={renderedFeatures}
      data-source-features={sourceFeatures}
      data-view={viewState}
      data-map-error={mapError}
    >
      <div ref={containerRef} className="h-full w-full" aria-label="Mapa interactivo del Huila" />
      <LocalTerritoryMap month={month} />
      <output className="sr-only" data-testid="map-month" aria-live="polite">
        Mes del mapa: {Math.round(month)}
      </output>

      <div className="map-date-chip" aria-hidden="true">
        <span>Escenario fijo</span>
        <strong>{monthLabel(month, 'short')}</strong>
      </div>

      <div className="map-legend" aria-label="Leyenda del mapa">
        <div className="map-legend__title">
          <Layers3 aria-hidden="true" />
          <span>Huella estimada</span>
        </div>
        <span><i className="legend-swatch legend-swatch--coffee" /> Café inicial / persistente</span>
        <span><i className="legend-swatch legend-swatch--expansion" /> Nueva expansión</span>
        <span><i className="legend-swatch legend-swatch--retired" /> Retiro o pérdida de aptitud</span>
        <span><i className="legend-swatch legend-swatch--nature" /> Área protegida / natural</span>
        <span><i className="legend-swatch legend-swatch--water" /> Cauces con nombre</span>
      </div>

      <div className="south-focus-note">
        <MapPin aria-hidden="true" />
        <div>
          <span>Municipios priorizados · sur</span>
          <p>Pitalito · Acevedo · Elías · Isnos · Oporapa · Palestina · Saladoblanco · San Agustín · Timaná</p>
        </div>
      </div>

      {status === 'loading' && <div className="map-loading">Preparando el territorio…</div>}
      {status === 'local' && (
        <div className="map-mode-badge" title="El mapa conserva sus capas esenciales sin teselas externas">
          <CloudOff aria-hidden="true" /> Fondo local
        </div>
      )}

      <div className="map-attribution">
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          © OpenStreetMap
        </a>
        {' · '}
        <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">
          OpenFreeMap
        </a>
        {' · IGAC · RUNAP'}
      </div>
    </div>
  );
}
