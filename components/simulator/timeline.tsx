'use client';

import { Pause, Play, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LAST_MONTH, monthLabel } from '@/lib/simulation/model';

interface TimelineProps {
  playhead: number;
  isPlaying: boolean;
  onToggle: () => void;
  onSeek: (value: number) => void;
  onPause: () => void;
}

export function Timeline({ playhead, isPlaying, onToggle, onSeek, onPause }: TimelineProps) {
  const month = Math.round(playhead);
  const progress = (month / LAST_MONTH) * 100;

  return (
    <section className="timeline-card" aria-label="Control temporal del escenario">
      <div className="timeline-card__topline">
        <div>
          <span className="timeline-kicker">Evolución de la frontera cafetera</span>
          <output className="timeline-date" data-testid="timeline-date" aria-live="polite">
            {monthLabel(month)}
          </output>
        </div>
        <div className="timeline-actions">
          <Button
            type="button"
            size="icon-lg"
            className="timeline-play"
            onClick={onToggle}
            aria-label={isPlaying ? 'Pausar simulación' : month === LAST_MONTH ? 'Reiniciar simulación' : 'Reproducir simulación'}
            data-testid="play-toggle"
          >
            {isPlaying ? <Pause aria-hidden="true" /> : month === LAST_MONTH ? <RotateCcw aria-hidden="true" /> : <Play aria-hidden="true" />}
          </Button>
          <span className="timeline-status" data-playing={isPlaying}>
            {isPlaying ? 'Reproduciendo' : 'En pausa'}
          </span>
        </div>
      </div>

      <div className="timeline-range-wrap" style={{ '--timeline-progress': `${progress}%` } as React.CSSProperties}>
        <input
          className="timeline-range"
          type="range"
          min={0}
          max={LAST_MONTH}
          step={1}
          value={month}
          onPointerDown={onPause}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
          aria-label="Mes de la simulación"
          aria-valuetext={monthLabel(month)}
          data-testid="timeline-slider"
        />
        <div className="timeline-years" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => 2026 + index).map((year) => (
            <span key={year}>{year}</span>
          ))}
        </div>
      </div>

      <p className="timeline-help">
        Arrastra para elegir un mes · <kbd>Espacio</kbd> reproduce/pausa · <kbd>←</kbd><kbd>→</kbd> avanza mes a mes
      </p>
    </section>
  );
}

