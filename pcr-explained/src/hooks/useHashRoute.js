import { useCallback, useEffect, useState } from 'react';

const clampIdx = (i, count) => Math.min(Math.max(i, 0), count - 1);

function readHash(count) {
  try {
    const h = parseInt((window.location.hash || '').replace('#s', ''), 10);
    return Number.isNaN(h) ? 0 : clampIdx(h - 1, count);
  } catch {
    return 0;
  }
}

// Section index <-> "#s3". replaceState is wrapped because sandboxed iframes (artifact viewers) may refuse it.
export function useHashRoute(count) {
  const [tab, setTabState] = useState(() => readHash(count));
  const setTab = useCallback(
    (v) => setTabState((prev) => clampIdx(typeof v === 'function' ? v(prev) : v, count)),
    [count],
  );
  useEffect(() => {
    try {
      window.history.replaceState(null, '', '#s' + (tab + 1));
    } catch {
      /* ignore */
    }
  }, [tab]);
  useEffect(() => {
    const on = () => setTabState(readHash(count));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [count]);
  return [tab, setTab];
}
