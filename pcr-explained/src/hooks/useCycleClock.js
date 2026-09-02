import { useCallback, useEffect, useRef, useState } from 'react';
import { CYCLE_MS } from '../lib/cycle.js';

/** Drives t ∈ [0,1) through one PCR cycle with requestAnimationFrame; loops and counts cycles. */
export function useCycleClock({ autoplay = false } = {}) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [cycleNo, setCycleNo] = useState(1);
  const ref = useRef({ base: 0, t0: 0, raf: 0, t: 0 });

  useEffect(() => {
    if (!playing) return undefined;
    ref.current.base = ref.current.t;
    ref.current.t0 = performance.now();
    const loop = (now) => {
      let tt = ref.current.base + (now - ref.current.t0) / CYCLE_MS;
      if (tt >= 1) {
        setCycleNo((c) => c + 1);
        ref.current.base = 0;
        ref.current.t0 = now;
        tt = 0;
      }
      ref.current.t = tt;
      setT(tt);
      ref.current.raf = requestAnimationFrame(loop);
    };
    ref.current.raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(ref.current.raf);
  }, [playing]);

  useEffect(() => {
    if (autoplay) setPlaying(true);
    else setPlaying(false);
  }, [autoplay]);

  const seek = useCallback((v) => {
    ref.current.t = v;
    ref.current.base = v;
    ref.current.t0 = performance.now();
    setT(v);
  }, []);

  return { t, playing, cycleNo, seek, play: () => setPlaying(true), pause: () => setPlaying(false), toggle: () => setPlaying((p) => !p) };
}
