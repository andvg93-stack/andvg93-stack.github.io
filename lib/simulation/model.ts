import type { SimulationSnapshot, TerritoryMetricKey } from './types';

export const LAST_MONTH = 119;
export const PLAY_DURATION_MS = 30_000;

export const METRICS: Array<{
  key: TerritoryMetricKey;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  {
    key: 'waterIndex',
    label: 'Salud de fuentes hídricas',
    shortLabel: 'Agua',
    color: '#59b8d3',
  },
  {
    key: 'soilIndex',
    label: 'Salud del suelo',
    shortLabel: 'Suelo',
    color: '#db9f55',
  },
  {
    key: 'biodiversityIndex',
    label: 'Biodiversidad',
    shortLabel: 'Biodiversidad',
    color: '#79b57f',
  },
  {
    key: 'resilienceIndex',
    label: 'Resiliencia climática',
    shortLabel: 'Resiliencia',
    color: '#d5bd68',
  },
];

export function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function monthDate(month: number) {
  return new Date(Date.UTC(2026, clamp(Math.round(month), 0, LAST_MONTH), 1));
}

export function monthLabel(month: number, style: 'long' | 'short' = 'long') {
  return new Intl.DateTimeFormat('es-CO', {
    month: style,
    year: 'numeric',
    timeZone: 'UTC',
  }).format(monthDate(month));
}

export function interpolateSnapshot(
  snapshots: SimulationSnapshot[],
  playhead: number,
): SimulationSnapshot {
  const lowerIndex = clamp(Math.floor(playhead), 0, snapshots.length - 1);
  const upperIndex = clamp(Math.ceil(playhead), 0, snapshots.length - 1);
  const lower = snapshots[lowerIndex];
  const upper = snapshots[upperIndex] ?? lower;
  const amount = playhead - lowerIndex;
  const numericKeys: Array<keyof SimulationSnapshot> = [
    'areaHa',
    'coffeeAreaDeltaPercent',
    'expansionHa',
    'retiredHa',
    'co2eKt',
    'co2eDeltaPercent',
    'waterIndex',
    'soilIndex',
    'biodiversityIndex',
    'resilienceIndex',
  ];
  const interpolated = { ...lower, month: playhead };

  for (const key of numericKeys) {
    const start = lower[key] as number;
    const end = upper[key] as number;
    (interpolated as unknown as Record<string, number>)[key] = start + (end - start) * amount;
  }

  interpolated.date = monthDate(playhead).toISOString().slice(0, 10);
  interpolated.label = monthLabel(playhead);
  return interpolated;
}

export function metricDelta(
  snapshots: SimulationSnapshot[],
  month: number,
  key: TerritoryMetricKey,
) {
  const currentIndex = clamp(Math.round(month), 0, snapshots.length - 1);
  const referenceIndex = Math.max(0, currentIndex - 12);
  return snapshots[currentIndex][key] - snapshots[referenceIndex][key];
}

export function formatHectares(value: number) {
  return new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value);
}

