import { useEffect, useRef } from 'react';
import s from './Tabs.module.css';

export const TABS = [
  ['1', 'The idea'], ['2', 'Reagents'], ['3', 'The cycle'], ['4', 'Copies'],
  ['5', 'Primers'], ['6', 'Protocol'], ['7', 'Troubleshooting'], ['8', 'Review'],
];

export default function Tabs({ current, onSelect }) {
  const ref = useRef(null);
  useEffect(() => {
    const b = ref.current?.children[current];
    b?.scrollIntoView?.({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }, [current]);
  return (
    <header className={s.top}>
      <div className={s.brand}>
        <span className={s.wordmark}>PCR</span>
        <span className={s.sub}>from molecule to protocol</span>
      </div>
      <nav className={s.tabs} aria-label="Sections" ref={ref}>
        {TABS.map(([n, label], i) => (
          <button key={n} className={s.tab} aria-current={i === current ? 'page' : undefined} onClick={() => onSelect(i)}>
            <span className={s.num}>{n}</span>{label}
          </button>
        ))}
      </nav>
    </header>
  );
}
