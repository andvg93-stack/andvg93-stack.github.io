'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { clamp, LAST_MONTH, PLAY_DURATION_MS } from '@/lib/simulation/model';

export function useSimulationClock() {
  const [playhead, setPlayheadState] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playheadRef = useRef(0);

  const setPlayhead = useCallback((value: number) => {
    const next = clamp(value, 0, LAST_MONTH);
    playheadRef.current = next;
    setPlayheadState(next);
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  const play = useCallback(() => {
    if (playheadRef.current >= LAST_MONTH) setPlayhead(0);
    setIsPlaying(true);
  }, [setPlayhead]);

  const toggle = useCallback(() => {
    setIsPlaying((currentlyPlaying) => {
      if (!currentlyPlaying && playheadRef.current >= LAST_MONTH) setPlayhead(0);
      return !currentlyPlaying;
    });
  }, [setPlayhead]);

  const seek = useCallback(
    (value: number) => {
      pause();
      setPlayhead(Math.round(value));
    },
    [pause, setPlayhead],
  );

  const step = useCallback(
    (amount: number) => {
      pause();
      setPlayhead(Math.round(playheadRef.current) + amount);
    },
    [pause, setPlayhead],
  );

  useEffect(() => {
    if (!isPlaying) return;
    const origin = playheadRef.current;
    const startedAt = performance.now();
    let frame = 0;

    const advance = (now: number) => {
      const next = origin + ((now - startedAt) / PLAY_DURATION_MS) * LAST_MONTH;
      if (next >= LAST_MONTH) {
        setPlayhead(LAST_MONTH);
        setIsPlaying(false);
        return;
      }
      setPlayhead(next);
      frame = requestAnimationFrame(advance);
    };

    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [isPlaying, setPlayhead]);

  return { playhead, isPlaying, play, pause, toggle, seek, step, setPlayhead };
}

