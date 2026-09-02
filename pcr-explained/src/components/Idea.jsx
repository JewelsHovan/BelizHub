import { useState } from 'react';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import { sci } from '../lib/units.js';
import s from './Idea.module.css';

const MAX = 30;

function MiniDuplex({ original }) {
  return (
    <svg viewBox="0 0 36 12" aria-hidden="true">
      <rect x="1" y="1" width="34" height="4" rx="2" fill={original ? '#1B2430' : '#C9D0D8'} />
      <rect x="1" y="7" width="34" height="4" rx="2" fill={original ? '#7A8797' : '#C9D0D8'} />
    </svg>
  );
}

export default function Idea() {
  const [n, setN] = useState(0);
  const copies = 2 ** n;
  return (
    <>
      <h1>One region of DNA, copied a billion times.</h1>
      <p className="lede">Heat pulls the two strands apart. Two primers choose the region. A heat-stable polymerase copies it. Every product carries the primer sites, so it becomes a template in the next round and the count doubles each cycle.</p>
      <div className="panel">
        <div style={{ minHeight: 70 }}>
          {n <= 6 ? (
            <div className={s.mini}>{Array.from({ length: copies }, (_, i) => <MiniDuplex key={i} original={i === 0} />)}</div>
          ) : (
            <>
              <div className={s.big}>{copies.toLocaleString('en-US')}</div>
              <div className="note">{sci(copies)} copies from one template, ideal doubling</div>
              <div className={s.bar}><div className={s.fill} style={{ width: `${Math.round((n / MAX) * 100)}%` }} /></div>
            </>
          )}
        </div>
        <div className="controls">
          <button className="btn primary" onClick={() => setN((v) => Math.min(v + 1, MAX))} disabled={n >= MAX}>{n >= MAX ? '30 cycles done' : 'Run one cycle'}</button>
          <button className="btn" onClick={() => setN(0)}>Reset</button>
          <span className="readout">Cycle {n}: {copies.toLocaleString('en-US')} {copies === 1 ? 'copy' : 'copies'}</span>
        </div>
      </div>
      <p>PCR, the polymerase chain reaction, turns a single DNA segment into millions or billions of identical copies in a tube in about two hours. Kary Mullis conceived it in 1983. It became routine in 1988, when Saiki and colleagues replaced the heat-sensitive <em>E. coli</em> Klenow enzyme with Taq polymerase, which survives the 95 °C step so the reaction runs unattended in a thermal cycler.</p>
      <p>The "chain" is the exponential part: each product has the primer sites at its ends, so it is a template next cycle. With perfect doubling, <em>n</em> cycles give 2<sup><em>n</em></sup> copies of the target; 30 cycles is about 10<sup>9</sup>.</p>
      <p>Everything needed fits in 25–50 µL: template, two primers, polymerase, dNTPs, Mg²⁺, buffer and water. The next tab takes each one in turn.</p>
      <Details summary="What PCR is used for">
        <p>Genotyping and mutation detection, amplifying inserts for cloning, preparing templates for Sanger and next-generation sequencing, pathogen detection in diagnostics, forensic STR profiling, site-directed mutagenesis, and checking that a construct or knockout is what you think it is. Whatever the application, the reaction is the same; only the primers and template change.</p>
      </Details>
      <Details summary="Timeline in five lines">
        <p>1971: Kleppe and Khorana describe primer-directed replication in principle. 1976: Chien, Edgar and Trela isolate a thermostable polymerase from <em>Thermus aquaticus</em>. 1983–85: Mullis conceives PCR at Cetus and the first working version uses Klenow, added fresh every cycle. 1988: Saiki et al. publish PCR with Taq; the first thermal cycler follows. 1993: Mullis shares the Nobel Prize in Chemistry.</p>
      </Details>
      <Sources keys={['saiki', 'mullis', 'nobel', 'garibyan', 'khan', 'tf_basics']} />
    </>
  );
}
