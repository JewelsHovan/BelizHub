import { useEffect, useState } from 'react';

const PREFIX = 'rtpcr:';

/** useState that survives a reload. Storage failures (private mode, sandboxed iframes) fall back to plain state. */
export function useLocalState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw !== null) return { ...(typeof initial === 'object' && initial !== null && !Array.isArray(initial) ? initial : {}), ...JSON.parse(raw) };
    } catch {
      /* ignore */
    }
    return initial;
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  }, [key, value]);
  return [value, setValue];
}

export function clearLocalState() {
  try {
    Object.keys(window.localStorage).filter((k) => k.startsWith(PREFIX)).forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
