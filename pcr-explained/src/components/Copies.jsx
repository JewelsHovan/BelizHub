import { useMemo, useState } from 'react';
import { EXT, duplexesAt, counts, amplification } from '../lib/copies.js';
import { sci } from '../lib/units.js';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import s from './Copies.module.css';

const FWD = '#6A4C9C';
const REV = '#B8336A';

function Strand({ type, y }) {
  const [a, b] = EXT[type];
  if (type === 'T' || type === 'B') {
    const [siteX, siteColor] = type === 'T' ? [0.68, REV] : [0.25, FWD];
    return (
      <>
        <rect x={a * 300} y={y} width={(b - a) * 300} height="6" rx="3" fill={type === 'T' ? '#1B2430' : '#7A8797'} />
        <rect x={siteX * 300} y={y - 1.5} width="21" height="9" rx="3.5" fill="none" stroke={siteColor} strokeWidth="1.2" strokeDasharray="2 2" />
      </>
    );
  }
  const isF = type[1] === 'f';
  const isLong = type[0] === 'L';
  return (
    <>
      <rect x="75" y={y} width="150" height="6" rx="3" fill="#C9D0D8" />
      {isLong && (isF ? <rect x="220" y={y} width="80" height="6" fill="url(#fadeR)" /> : <rect x="0" y={y} width="80" height="6" fill="url(#fadeL)" />)}
      <rect x={isF ? 75 : 204} y={y} width="21" height="6" rx="3" fill={isF ? FWD : REV} />
    </>
  );
}

function Duplex({ pair: [a, b] }) {
  return (
    <svg className={s.dup} viewBox="0 0 300 30" aria-hidden="true">
      <Strand type={a} y={5} />
      <Strand type={b} y={19} />
    </svg>
  );
}

function Chart({ E, N0 }) {
  const W = 360, H = 210, L = 40, R = 12, Tp = 12, B = 30, MAXC = 35, Nmax = 1e12;
  const x = (n) => L + (n / MAXC) * (W - L - R);
  const y = (v) => Tp + (1 - Math.log10(Math.max(v, 1)) / 13) * (H - Tp - B);
  const real = amplification({ E, N0, Nmax, cycles: MAXC });
  const ideal = Array.from({ length: MAXC + 1 }, (_, n) => [n, N0 * 2 ** n]);
  const path = (pts) => pts.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Copies versus cycle number">
        {[0, 3, 6, 9, 12].map((e) => (
          <g key={e}>
            <line x1={L} x2={W - R} y1={y(10 ** e)} y2={y(10 ** e)} stroke="#E6EAE8" />
            <text x={L - 4} y={y(10 ** e) + 3} textAnchor="end" fontSize="9" fill="#5A6470">10^{e}</text>
          </g>
        ))}
        {[0, 5, 10, 15, 20, 25, 30, 35].map((n) => <text key={n} x={x(n)} y={H - 12} textAnchor="middle" fontSize="9" fill="#5A6470">{n}</text>)}
        <text x={(L + W - R) / 2} y={H - 1} textAnchor="middle" fontSize="9" fill="#5A6470">cycle</text>
        <line x1={L} x2={W - R} y1={y(Nmax)} y2={y(Nmax)} stroke="#C98A1B" strokeDasharray="3 3" />
        <text x={W - R} y={y(Nmax) - 4} textAnchor="end" fontSize="9" fill="#8a5a08">plateau</text>
        <path d={path(ideal)} fill="none" stroke="#C9D0D8" strokeWidth="1.5" strokeDasharray="4 3" />
        <path d={path(real)} fill="none" stroke="#1B2430" strokeWidth="2.2" />
        <circle cx={x(30)} cy={y(real[30][1])} r="4" fill="#1B2430" />
      </svg>
      <div className="stat">
        <span>cycle 25: <b>{sci(real[25][1], 1)}</b></span>
        <span>cycle 30: <b>{sci(real[30][1], 1)}</b></span>
        <span>dashed: ideal doubling</span>
      </div>
    </>
  );
}

export default function Copies() {
  const [n, setN] = useState(0);
  const [eff, setEff] = useState(95);
  const [n0, setN0] = useState(1000);
  const duplexes = useMemo(() => duplexesAt(n), [n]);
  const c = counts(n);
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="fadeR" x1="0" x2="1"><stop offset="0" stopColor="#C9D0D8" /><stop offset="1" stopColor="#C9D0D8" stopOpacity="0" /></linearGradient>
          <linearGradient id="fadeL" x1="1" x2="0"><stop offset="0" stopColor="#C9D0D8" /><stop offset="1" stopColor="#C9D0D8" stopOpacity="0" /></linearGradient>
        </defs>
      </svg>
      <h1>Where the exact-length product comes from.</h1>
      <p className="lede">The first cycles do not make the band you see on the gel. Step through cycles 0 to 4 and watch the defined-length product appear, then take over.</p>
      <div className="panel">
        <div className="seg">
          {[0, 1, 2, 3, 4].map((k) => <button key={k} className={k === n ? 'on' : ''} onClick={() => setN(k)}>{k === 0 ? 'Cycle 0' : k}</button>)}
        </div>
        <div className={s.grid}>{duplexes.map((pair, i) => <Duplex key={i} pair={pair} />)}</div>
        <div className="stat">
          <span><b>{c.duplexes}</b> duplexes</span>
          <span><b>{c.exact}</b> exact-length on both strands (2ⁿ − 2n)</span>
          <span><b>{c.shortStrands}</b> defined-length strands</span>
          <span><b>{c.longs}</b> long strands (2n)</span>
        </div>
        <div className="legend">
          <span><i style={{ background: 'var(--strand)' }} />original strand</span>
          <span><i style={{ background: 'var(--new)' }} />synthesized strand</span>
          <span><i style={{ background: 'var(--fwd)' }} />starts with forward primer</span>
          <span><i style={{ background: 'var(--rev)' }} />starts with reverse primer</span>
          <span><i className={s.site} />primer site on template</span>
        </div>
      </div>
      <p><b>Cycle 1.</b> Each primer extends along the original strand until the polymerase runs out of time or template. The new strands have a defined start (the primer) but an undefined end: "long products".</p>
      <p><b>Cycle 2.</b> A long product is now a template. The other primer anneals to it and extension runs off the end of the template, which is the first primer's position. That strand has both ends defined, but it is paired with a long product.</p>
      <p><b>Cycle 3.</b> Two of those defined strands are copied, and for the first time a duplex is exactly target-length on both strands. From here the defined product doubles each cycle while long products grow only linearly (two new per cycle, from the original template). After <em>n</em> cycles the number of exact duplexes is 2<sup><em>n</em></sup> − 2<em>n</em>, so long products become a negligible fraction.</p>
      <h2>Exponential, then not</h2>
      <div className="panel">
        <Chart E={eff / 100} N0={n0} />
        <div className="form">
          <label>Efficiency per cycle: {eff}%<input type="range" min="60" max="100" value={eff} onChange={(e) => setEff(Number(e.target.value))} /></label>
          <label>Starting copies
            <select value={n0} onChange={(e) => setN0(Number(e.target.value))}>
              <option value={1}>1 (single molecule)</option>
              <option value={1000}>10³</option>
              <option value={1000000}>10⁶</option>
            </select>
          </label>
        </div>
      </div>
      <p>Real reactions follow <em>N</em> = <em>N</em>₀(1 + <em>E</em>)<sup><em>n</em></sup> with efficiency <em>E</em> below 1, then flatten. The plateau is not the polymerase dying: as product reaches about 10¹²–10¹³ molecules, its strands re-anneal to each other faster than primers can find them, the polymerase-to-template ratio collapses, and primers or dNTPs run down. That is why endpoint band intensity is not quantitative and why qPCR reads fluorescence during the exponential phase instead.</p>
      <Details summary="How many cycles to run">
        <p>25–35 is the usual window. Fewer cycles when template is abundant (plasmid, purified amplicon): 20–25 avoids smearing and off-target accumulation. More cycles for rare templates: up to 40–45 for single-copy targets in a few nanograms of genomic DNA. If 40 cycles give nothing, the reaction has a problem to fix, not a cycle count to raise; even one starting molecule should be visible by then.</p>
      </Details>
      <Sources keys={['khan', 'garibyan', 'neb_ts', 'wiki']} />
    </>
  );
}
