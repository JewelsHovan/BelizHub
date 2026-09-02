import { useCallback, useEffect, useRef, useState } from 'react';
import s from './Tabs.module.css';

export const TABS = [
  ['1', 'The idea'], ['2', 'Reagents'], ['3', 'The cycle'], ['4', 'Copies'],
  ['5', 'Primers'], ['6', 'Protocol'], ['7', 'Troubleshooting'], ['8', 'Review'],
];

// The app is deployed under the hub at /<repo>/pcr-explained/, so one level up is the hub index.
const HUB_URL = import.meta.env.BASE_URL.replace(/[^/]+\/$/, '') || './';

export default function Tabs({ current, onSelect }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ l: false, r: false });

  // Fade the edges of the tab strip only while there is more to scroll in that direction.
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useEffect(() => {
    const b = ref.current?.children[current];
    b?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [current]);

  return (
    <header className={s.top}>
      <div className={s.brand}>
        <span className={s.wordmark}>PCR</span>
        <span className={s.sub}>from molecule to protocol</span>
        <a className={s.hub} href={HUB_URL}>Beliz Hub</a>
      </div>
      <div className={`${s.wrap} ${edges.l ? s.fadeL : ''} ${edges.r ? s.fadeR : ''}`}>
        <nav className={s.tabs} aria-label="Sections" ref={ref} onScroll={measure}>
          {TABS.map(([n, label], i) => (
            <button key={n} className={s.tab} aria-current={i === current ? 'page' : undefined} onClick={() => onSelect(i)}>
              <span className={s.num}>{n}</span>{label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
