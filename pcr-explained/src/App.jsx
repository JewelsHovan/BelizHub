import { useEffect, useState } from 'react';
import Tabs, { TABS } from './components/Tabs.jsx';
import Idea from './components/Idea.jsx';
import Reagents from './components/Reagents.jsx';
import CycleAnimation from './components/CycleAnimation.jsx';
import Copies from './components/Copies.jsx';
import Primers from './components/Primers.jsx';
import Protocol from './components/Protocol.jsx';
import Troubleshooting from './components/Troubleshooting.jsx';
import Review from './components/Review.jsx';
import { useHashRoute } from './hooks/useHashRoute.js';
import { PrimerContext } from './context.js';

export default function App() {
  const [tab, setTab] = useHashRoute(TABS.length);
  const [primerTm, setPrimerTm] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.matches('input,select,textarea')) return;
      if (e.key === 'ArrowRight') setTab((t) => t + 1);
      if (e.key === 'ArrowLeft') setTab((t) => t - 1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setTab]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [tab]);

  // Every section stays mounted so inputs, quiz progress and animation position survive tab changes.
  const pages = [
    <Idea />, <Reagents />, <CycleAnimation active={tab === 2} />, <Copies />,
    <Primers />, <Protocol />, <Troubleshooting />, <Review />,
  ];
  const last = tab === TABS.length - 1;

  return (
    <PrimerContext.Provider value={{ primerTm, setPrimerTm }}>
      <Tabs current={tab} onSelect={setTab} />
      <main>
        {pages.map((page, i) => (
          <section key={TABS[i][1]} className="page" hidden={i !== tab} aria-label={TABS[i][1]}>{page}</section>
        ))}
        <div className="pager">
          <button className="btn" style={{ visibility: tab === 0 ? 'hidden' : 'visible' }} onClick={() => setTab(tab - 1)}>Previous</button>
          <button className="btn primary" onClick={() => setTab(last ? 0 : tab + 1)}>{last ? 'Back to start' : `Next: ${TABS[tab + 1][1]}`}</button>
        </div>
      </main>
    </PrimerContext.Provider>
  );
}
