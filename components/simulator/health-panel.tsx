'use client';

import { Cloudy, Droplets, Gauge, Leaf, Trees, Sun } from 'lucide-react';

import {
  formatHectares,
  METRICS,
} from '@/lib/simulation/model';
import type { SimulationSnapshot } from '@/lib/simulation/types';

const metricIcons = { waterIndex: Droplets, soilIndex: Leaf, biodiversityIndex: Trees, resilienceIndex: Sun };

function MetricRow({
  metric,
  snapshot,
  snapshots,
}: {
  metric: (typeof METRICS)[number];
  snapshot: SimulationSnapshot;
  snapshots: SimulationSnapshot[];
}) {
  const value = snapshot[metric.key];
  const initial = snapshots[0][metric.key];
  const Icon = metricIcons[metric.key];
  return (
    <div className="health-metric" data-testid={`metric-${metric.key}`}>
      <div className="health-metric__label">
        <span><Icon aria-hidden="true" />{metric.label}</span>
        <div>
          <strong>{Math.round(value)}</strong>
          <small>/100</small>
        </div>
      </div>
      <progress
        className="health-meter"
        aria-label={`${metric.label}: ${Math.round(value)} de 100`}
        max={100}
        value={value}
        style={{ '--meter-color': metric.color } as React.CSSProperties}
      >
        {Math.round(value)}%
      </progress>
      <div className="metric-comparison" aria-label={`En 2026: ${Math.round(initial)}. En la fecha seleccionada: ${Math.round(value)}.`}>
        <span>{Math.round(initial)} <small>2026</small></span>
        <span className="metric-comparison__line" aria-hidden="true" />
        <span>{Math.round(value)} <small>{snapshot.date.slice(0, 4)}</small></span>
      </div>
    </div>
  );
}

function insight(snapshot: SimulationSnapshot) {
  if (snapshot.month < 12) {
    return 'Este es el punto de partida estimado. Reproduce la línea de tiempo para observar dónde aparecen las tensiones.';
  }
  if (snapshot.biodiversityIndex < 72) {
    return 'La conversión de cobertura natural concentra el mayor deterioro: biodiversidad y agua caen antes que el área total de café.';
  }
  if (snapshot.expansionHa > snapshot.retiredHa) {
    return 'La huella crece, pero algunas zonas pierden aptitud. Los índices ilustran presiones sobre el territorio.';
  }
  return 'La huella se desplaza: algunas zonas se retiran mientras otras se incorporan. El balance total oculta ese cambio territorial.';
}

export function HealthPanel({
  snapshot,
  snapshots,
}: {
  snapshot: SimulationSnapshot;
  snapshots: SimulationSnapshot[];
}) {
  return (
    <aside className="health-panel" aria-labelledby="health-title">
      <div className="health-panel__header">
        <div>
          <span className="panel-kicker"><Gauge aria-hidden="true" /> Índices didácticos estimados</span>
          <h2 id="health-title">Salud del territorio</h2>
        </div>
        <span className="panel-score">{Math.round((snapshot.waterIndex + snapshot.soilIndex + snapshot.biodiversityIndex + snapshot.resilienceIndex) / 4)}<small>/100</small></span>
      </div>

      <div className="territory-balance">
        <div>
          <span>Huella cafetera</span>
          <strong>{formatHectares(snapshot.areaHa)} ha</strong>
          <small>{snapshot.coffeeAreaDeltaPercent >= 0 ? '+' : ''}{snapshot.coffeeAreaDeltaPercent.toFixed(1)}% vs. 2026</small>
        </div>
        <div>
          <span>Expansión</span>
          <strong>+{formatHectares(snapshot.expansionHa)} ha</strong>
          <small>desde enero de 2026</small>
        </div>
        <div>
          <span>Retiro</span>
          <strong>−{formatHectares(snapshot.retiredHa)} ha</strong>
          <small>pérdida o desplazamiento</small>
        </div>
      </div>

      <div className="co2-card" data-testid="metric-co2">
        <div className="co2-card__icon"><Cloudy aria-hidden="true" /></div>
        <div>
          <span>CO₂ equivalente acumulado</span>
          <strong>{snapshot.co2eKt.toFixed(1)} <small>kt CO₂e</small></strong>
        </div>
        <span className="co2-delta">+{snapshot.co2eDeltaPercent.toFixed(1)}%</span>
      </div>

      <div className="health-metrics">
        {METRICS.map((metric) => (
          <MetricRow key={metric.key} metric={metric} snapshot={snapshot} snapshots={snapshots} />
        ))}
      </div>

      <div className="insight-card">
        <Droplets aria-hidden="true" />
        <div>
          <span>Lectura del escenario</span>
          <p>{insight(snapshot)}</p>
        </div>
      </div>

      <p className="panel-disclaimer">
        Escenario tendencial educativo. No es predicción parcelaria ni autorización de expansión agrícola.
      </p>
    </aside>
  );
}
