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
      <Details summary="Variants you will meet">
        <ul>
          <li><b>Hot-start.</b> The polymerase is blocked (antibody, aptamer or chemical modification) until the first 95 °C step, so nothing extends during setup. Fewer primer-dimers and nonspecific bands; the default for most modern enzymes.</li>
          <li><b>Touchdown.</b> The annealing temperature starts several degrees above Tm and drops 0.5–1 °C per cycle for the first 10–15 cycles, then holds. The earliest, most stringent cycles seed the specific product, which then out-competes everything else.</li>
          <li><b>Nested.</b> A second round with primers that sit inside the first amplicon. Any off-target product from round one lacks the inner sites, so specificity and sensitivity both rise.</li>
          <li><b>Multiplex.</b> Several primer pairs in one tube for several targets at once. Needs matched Tm across all primers and products that separate on a gel or by probe colour.</li>
          <li><b>Colony PCR.</b> A scrape of a bacterial colony straight into the tube; the initial denaturation lyses the cells. Screens clones in an afternoon without a miniprep.</li>
          <li><b>RT-PCR.</b> A reverse transcriptase first copies RNA into cDNA, then ordinary PCR amplifies it. How gene expression and RNA viruses are detected.</li>
          <li><b>qPCR (real-time).</b> A fluorescent dye or probe reports product every cycle. The cycle at which fluorescence crosses a threshold (Cq) is proportional to log of the starting copies, which is what makes it quantitative.</li>
          <li><b>Long-range and high-fidelity.</b> Proofreading enzymes (Q5, Phusion, KOD) or blends for amplicons above about 3 kb and for anything you will sequence or clone.</li>
        </ul>
      </Details>
      <Sources keys={['saiki', 'mullis', 'chien', 'nobel', 'garibyan', 'khan', 'tf_basics', 'tf_methods']} />
    </>
  );
}
