'use client';

import { ArrowDownRight, ArrowRight, ArrowUpRight, Cloudy, Droplets, Gauge } from 'lucide-react';

import {
  formatHectares,
  METRICS,
  metricDelta,
} from '@/lib/simulation/model';
import type { SimulationSnapshot, TerritoryMetricKey } from '@/lib/simulation/types';

function Trend({ delta }: { delta: number }) {
  const Icon = Math.abs(delta) < 0.5 ? ArrowRight : delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="metric-trend" data-direction={delta > 0.4 ? 'up' : delta < -0.4 ? 'down' : 'flat'}>
      <Icon aria-hidden="true" />
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}

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
  const delta = metricDelta(snapshots, snapshot.month, metric.key as TerritoryMetricKey);
  return (
    <div className="health-metric" data-testid={`metric-${metric.key}`}>
      <div className="health-metric__label">
        <span>{metric.label}</span>
        <div>
          <strong>{Math.round(value)}</strong>
          <small>/100</small>
          <Trend delta={delta} />
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
    return 'La huella crece, pero parte del aumento ocurre cerca de cauces y núcleos naturales. El lugar importa tanto como las hectáreas.';
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
        <span className="panel-score">{Math.round((snapshot.waterIndex + snapshot.soilIndex + snapshot.biodiversityIndex + snapshot.resilienceIndex) / 4)}</span>
      </div>

      <div className="co2-card" data-testid="metric-co2">
        <div className="co2-card__icon"><Cloudy aria-hidden="true" /></div>
        <div>
          <span>CO₂ equivalente acumulado</span>
          <strong>{snapshot.co2eKt.toFixed(1)} <small>kt</small></strong>
        </div>
        <span className="co2-delta">+{snapshot.co2eDeltaPercent.toFixed(1)}%</span>
      </div>

      <div className="health-metrics">
        {METRICS.map((metric) => (
          <MetricRow key={metric.key} metric={metric} snapshot={snapshot} snapshots={snapshots} />
        ))}
      </div>

      <div className="territory-balance">
        <div>
          <span>Huella cafetera</span>
          <strong>{formatHectares(snapshot.areaHa)} ha</strong>
          <small>{snapshot.coffeeAreaDeltaPercent >= 0 ? '+' : ''}{snapshot.coffeeAreaDeltaPercent.toFixed(1)}% vs. 2026</small>
        </div>
        <div>
          <span>Expansión visible</span>
          <strong>+{formatHectares(snapshot.expansionHa)} ha</strong>
          <small>incorporación acumulada</small>
        </div>
        <div>
          <span>Retiro</span>
          <strong>−{formatHectares(snapshot.retiredHa)} ha</strong>
          <small>pérdida o desplazamiento</small>
        </div>
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
