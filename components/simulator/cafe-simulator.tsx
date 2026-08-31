'use client';

import { useEffect, useMemo, useState } from 'react';
import { Coffee, Leaf, MapPinned, WifiOff } from 'lucide-react';

import { HealthPanel } from '@/components/simulator/health-panel';
import { HuilaMap } from '@/components/simulator/huila-map';
import { MethodSheet } from '@/components/simulator/method-sheet';
import { PwaRegistration } from '@/components/simulator/pwa-registration';
import { Timeline } from '@/components/simulator/timeline';
import { useSimulationClock } from '@/hooks/use-simulation-clock';
import { interpolateSnapshot, LAST_MONTH } from '@/lib/simulation/model';
import type { ModelManifest, SimulationSnapshot } from '@/lib/simulation/types';

interface SnapshotResponse {
  version: string;
  snapshots: SimulationSnapshot[];
}

export function CafeSimulator() {
  const [snapshots, setSnapshots] = useState<SimulationSnapshot[]>([]);
  const [manifest, setManifest] = useState<ModelManifest | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  const { playhead, isPlaying, toggle, seek, pause, step } = useSimulationClock();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch('/data/simulation-snapshots.json').then((response) => {
        if (!response.ok) throw new Error('No se pudieron cargar los cortes mensuales.');
        return response.json() as Promise<SnapshotResponse>;
      }),
      fetch('/data/model-manifest.json').then((response) => {
        if (!response.ok) throw new Error('No se pudo cargar el manifiesto del modelo.');
        return response.json() as Promise<ModelManifest>;
      }),
    ])
      .then(([snapshotData, manifestData]) => {
        if (cancelled) return;
        setSnapshots(snapshotData.snapshots);
        setManifest(manifestData);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      const formControl = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (event.code === 'Space' && tag !== 'BUTTON') {
        event.preventDefault();
        toggle();
        return;
      }
      if (formControl) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      } else if (event.key === 'Home') {
        event.preventDefault();
        seek(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        seek(LAST_MONTH);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [seek, step, toggle]);

  const snapshot = useMemo(
    () => (snapshots.length ? interpolateSnapshot(snapshots, playhead) : null),
    [playhead, snapshots],
  );

  if (loadError) {
    return (
      <main className="fatal-state">
        <Coffee aria-hidden="true" />
        <h1>No fue posible abrir el escenario local</h1>
        <p>Recarga la página. Los datos del simulador deben viajar junto con la aplicación.</p>
      </main>
    );
  }

  if (!snapshot || !manifest) {
    return (
      <main className="simulator-loading" aria-live="polite">
        <div className="brand-mark"><Coffee aria-hidden="true" /></div>
        <span>Cargando Café 2035 · Huila</span>
        <div className="loading-line"><i /></div>
      </main>
    );
  }

  return (
    <main className="simulator-app">
      <PwaRegistration />
      <header className="app-header">
        <div className="app-brand">
          <div className="brand-mark"><Coffee aria-hidden="true" /></div>
          <div>
            <span>Explorador territorial</span>
            <h1>CAFÉ 2035 <i>·</i> HUILA</h1>
          </div>
        </div>

        <div className="header-context">
          <MapPinned aria-hidden="true" />
          <span>Escenario SSP2-4.5</span>
          <strong>2026—2035</strong>
        </div>

        <div className="header-actions">
          {!online && <span className="offline-label"><WifiOff aria-hidden="true" /> Sin conexión</span>}
          <MethodSheet manifest={manifest} />
        </div>
      </header>

      <div className="simulator-grid">
        <section className="map-column" aria-label="Evolución espacial de la huella cafetera">
          <HuilaMap month={playhead} />
          <Timeline
            playhead={playhead}
            isPlaying={isPlaying}
            onToggle={toggle}
            onSeek={seek}
            onPause={pause}
          />
        </section>
        <HealthPanel snapshot={snapshot} snapshots={snapshots} />
      </div>

      <footer className="app-footer">
        <span><Leaf aria-hidden="true" /> Proyección didáctica · datos y geometrías estimadas</span>
        <span>Hectáreas municipales EVA · huella espacial no parcelaria</span>
      </footer>
    </main>
  );
}
