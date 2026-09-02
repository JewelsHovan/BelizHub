import { useMemo, useState } from 'react';
import { EXT, duplexesAt, counts, amplification } from '../lib/copies.js';
import { cqFromCurve, ddCq, pfaffl, efficiencyFromSlope } from '../lib/qpcr.js';
import { sci, sup } from '../lib/units.js';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import s from './Readout.module.css';

const FWD = '#6A4C9C';
const REV = '#B8336A';
const THRESHOLD = 1e9;

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

function ExactLength() {
  const [n, setN] = useState(0);
  const duplexes = useMemo(() => duplexesAt(n), [n]);
  const c = counts(n);
  return (
    <div className="panel">
      <div className="seg">
        {[0, 1, 2, 3, 4].map((k) => <button key={k} className={k === n ? 'on' : ''} onClick={() => setN(k)}>{k === 0 ? 'Cycle 0' : k}</button>)}
      </div>
      <div className={s.grid}>{duplexes.map((pair, i) => <Duplex key={i} pair={pair} />)}</div>
      <div className="stat">
        <span><b>{c.duplexes}</b> duplexes</span>
        <span><b>{c.exact}</b> exact-length on both strands (2ⁿ − 2n)</span>
        <span><b>{c.longs}</b> long strands (2n)</span>
      </div>
      <div className="legend">
        <span><i style={{ background: 'var(--strand)' }} />original strand</span>
        <span><i style={{ background: 'var(--new)' }} />synthesized strand</span>
        <span><i style={{ background: 'var(--fwd)' }} />starts with forward primer</span>
        <span><i style={{ background: 'var(--rev)' }} />starts with reverse primer</span>
      </div>
      <p className="note" style={{ marginTop: 8 }}>Cycle 1 makes "long products" with one defined end. Cycle 2 copies those into strands with both ends defined. Cycle 3 gives the first duplex that is exactly target-length on both strands; from there it doubles while long products grow only linearly. With cDNA as template the same holds, one cycle later, because the first cycle is one-sided.</p>
    </div>
  );
}

const N0_OPTIONS = [[1, '1 (single molecule)'], [10, '10'], [100, '10²'], [1000, '10³'], [1e4, '10⁴'], [1e5, '10⁵'], [1e6, '10⁶'], [1e7, '10⁷']];

function AmpChart({ E, a, b }) {
  const W = 360, H = 220, L = 40, R = 12, Tp = 12, B = 30, MAXC = 45, Nmax = 1e13;
  const x = (n) => L + (n / MAXC) * (W - L - R);
  const y = (v) => Tp + (1 - Math.log10(Math.max(v, 1)) / 13) * (H - Tp - B);
  const ca = amplification({ E, N0: a, Nmax, cycles: MAXC });
  const cb = amplification({ E, N0: b, Nmax, cycles: MAXC });
  const cqA = cqFromCurve(ca, THRESHOLD);
  const cqB = cqFromCurve(cb, THRESHOLD);
  const path = (pts) => pts.map(([n, v], i) => `${i ? 'L' : 'M'}${x(n).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const dCq = cqA !== null && cqB !== null ? cqA - cqB : null;
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Copies versus cycle for two samples, with the detection threshold and their Cq values">
        {[0, 3, 6, 9, 12].map((e) => (
          <g key={e}>
            <line x1={L} x2={W - R} y1={y(10 ** e)} y2={y(10 ** e)} stroke="#E6EAE8" />
            <text x={L - 4} y={y(10 ** e) + 3} textAnchor="end" fontSize="9" fill="#5A6470">10{sup(e)}</text>
          </g>
        ))}
        {[0, 10, 20, 30, 40].map((n) => <text key={n} x={x(n)} y={H - 12} textAnchor="middle" fontSize="9" fill="#5A6470">{n}</text>)}
        <text x={(L + W - R) / 2} y={H - 1} textAnchor="middle" fontSize="9" fill="#5A6470">cycle</text>
        <line x1={L} x2={W - R} y1={y(Nmax)} y2={y(Nmax)} stroke="#C98A1B" strokeDasharray="3 3" />
        <text x={W - R} y={y(Nmax) - 4} textAnchor="end" fontSize="9" fill="#8a5a08">plateau</text>
        <line x1={L} x2={W - R} y1={y(THRESHOLD)} y2={y(THRESHOLD)} stroke="#2E8B57" strokeDasharray="5 3" />
        <text x={L + 4} y={y(THRESHOLD) - 4} fontSize="9" fill="#2E8B57">threshold</text>
        <path d={path(ca)} fill="none" stroke="#1B2430" strokeWidth="2.2" />
        <path d={path(cb)} fill="none" stroke="#2F6FB5" strokeWidth="2.2" />
        {cqA !== null && <g><line x1={x(cqA)} x2={x(cqA)} y1={y(THRESHOLD)} y2={H - B} stroke="#1B2430" strokeDasharray="2 3" /><circle cx={x(cqA)} cy={y(THRESHOLD)} r="4" fill="#1B2430" /><text x={x(cqA)} y={H - B + 10} textAnchor="middle" fontSize="9" fill="#1B2430" fontWeight="600">Cq {cqA.toFixed(1)}</text></g>}
        {cqB !== null && <g><line x1={x(cqB)} x2={x(cqB)} y1={y(THRESHOLD)} y2={H - B} stroke="#2F6FB5" strokeDasharray="2 3" /><circle cx={x(cqB)} cy={y(THRESHOLD)} r="4" fill="#2F6FB5" /><text x={x(cqB)} y={H - B + 10} textAnchor="middle" fontSize="9" fill="#2F6FB5" fontWeight="600">Cq {cqB.toFixed(1)}</text></g>}
      </svg>
      <div className="stat">
        <span>sample A <b style={{ color: '#1B2430' }}>Cq {cqA === null ? 'none' : cqA.toFixed(1)}</b></span>
        <span>sample B <b style={{ color: '#2F6FB5' }}>Cq {cqB === null ? 'none' : cqB.toFixed(1)}</b></span>
        {dCq !== null && <span>ΔCq <b>{dCq.toFixed(1)}</b> → B has <b>{((1 + E) ** dCq).toPrecision(3)}×</b> the input of A</span>}
      </div>
    </>
  );
}

function DdCq() {
  const [v, setV] = useState({ tC: 24.0, rC: 18.0, tT: 21.5, rT: 18.2, Et: 100, Er: 100 });
  const set = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));
  const n = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Number(x) || 0]));
  const r = ddCq(n);
  const ratio = pfaffl({ Et: n.Et / 100, Er: n.Er / 100, dCqT: n.tC - n.tT, dCqR: n.rC - n.rT });
  return (
    <div className="panel">
      <div className={s.ddgrid}>
        <div />
        <div className={s.colh}>Control</div>
        <div className={s.colh}>Treated</div>
        <div className={s.rowh}>Target Cq</div>
        <input type="number" step="0.1" value={v.tC} onChange={set('tC')} aria-label="Target Cq, control" />
        <input type="number" step="0.1" value={v.tT} onChange={set('tT')} aria-label="Target Cq, treated" />
        <div className={s.rowh}>Reference Cq</div>
        <input type="number" step="0.1" value={v.rC} onChange={set('rC')} aria-label="Reference Cq, control" />
        <input type="number" step="0.1" value={v.rT} onChange={set('rT')} aria-label="Reference Cq, treated" />
        <div className={s.rowh}>ΔCq (target − ref)</div>
        <div className={s.out}>{r.dC.toFixed(2)}</div>
        <div className={s.out}>{r.dT.toFixed(2)}</div>
      </div>
      <div className="stat">
        <span>ΔΔCq <b>{r.dd.toFixed(2)}</b></span>
        <span>fold change 2<sup>−ΔΔCq</sup> = <b>{r.fold.toPrecision(3)}</b>{r.fold > 1 ? ' up' : r.fold < 1 ? ' down' : ''}</span>
      </div>
      <div className="form" style={{ marginTop: 10 }}>
        <label>Target assay efficiency (%)<input type="number" step="1" min="50" max="120" value={v.Et} onChange={set('Et')} /></label>
        <label>Reference assay efficiency (%)<input type="number" step="1" min="50" max="120" value={v.Er} onChange={set('Er')} /></label>
      </div>
      <div className="stat"><span>efficiency-corrected ratio (Pfaffl) <b>{ratio.toPrecision(3)}</b></span><span className="note">equals the Livak value when both are 100 %</span></div>
      <p className="note" style={{ marginTop: 8 }}>Use the <b>mean Cq of technical triplicates</b>. Biological replicates go through the whole chain separately, and the <b>statistics are done on ΔCq values</b>, not on fold changes.</p>
    </div>
  );
}

function MeltCurve({ dimer }) {
  const W = 360, H = 130, L = 34, R = 10, Tp = 10, B = 24;
  const x = (T) => L + ((T - 60) / 35) * (W - L - R);
  const peak = (T, mu, sig, h) => h * Math.exp(-((T - mu) ** 2) / (2 * sig * sig));
  const pts = (f) => Array.from({ length: 141 }, (_, i) => 60 + i * 0.25).map((T) => `${x(T).toFixed(1)},${(H - B - f(T) * (H - Tp - B)).toFixed(1)}`).join(' ');
  const sample = (T) => peak(T, 84, 1.2, 0.95) + (dimer ? peak(T, 74, 1.6, 0.25) : 0);
  const ntc = (T) => (dimer ? peak(T, 74, 1.6, 0.55) : 0.01);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Melt curve: negative first derivative of fluorescence against temperature">
      <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="#D7DDDA" />
      {[60, 70, 80, 90, 95].map((T) => <text key={T} x={x(T)} y={H - B + 12} textAnchor="middle" fontSize="9" fill="#5A6470">{T}</text>)}
      <text x={(L + W - R) / 2} y={H - 1} textAnchor="middle" fontSize="9" fill="#5A6470">°C</text>
      <text x="4" y={Tp + 8} fontSize="9" fill="#5A6470">−dF/dT</text>
      <polyline points={pts(ntc)} fill="none" stroke="#7A8797" strokeWidth="1.8" strokeDasharray="4 3" />
      <polyline points={pts(sample)} fill="none" stroke="#2E8B57" strokeWidth="2.2" />
      <text x={x(84)} y={Tp + 10} textAnchor="middle" fontSize="9" fill="#2E8B57" fontWeight="600">product, 84 °C</text>
      {dimer && <text x={x(74)} y={H - B - 0.55 * (H - Tp - B) - 6} textAnchor="middle" fontSize="9" fill="#7A8797" fontWeight="600">primer-dimer, 74 °C</text>}
    </svg>
  );
}

function Gel({ gdna }) {
  const lanes = ['ladder', 'sample 1', 'sample 2', '−RT', 'NTC'];
  const W = 360, H = 170;
  const lx = (i) => 40 + i * 64;
  const band = (i, y, w = 36, o = 1, h = 5) => <rect key={`${i}-${y}`} x={lx(i) - w / 2} y={y} width={w} height={h} rx="2" fill="#fff" opacity={o} />;
  const ladderY = [34, 52, 66, 80, 96, 116, 134];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Agarose gel sketch with sample, minus-RT and no-template lanes">
      <rect x="4" y="18" width={W - 8} height={H - 22} rx="6" fill="#1b2430" />
      {lanes.map((l, i) => <text key={l} x={lx(i)} y="12" textAnchor="middle" fontSize="9" fill="#5A6470">{l}</text>)}
      {lanes.map((l, i) => <rect key={l} x={lx(i) - 20} y="22" width="40" height="6" fill="#303a48" />)}
      {ladderY.map((y, k) => band(0, y, 36, k === 3 ? 1 : 0.7, k === 3 ? 6 : 4))}
      <text x={lx(0) - 24} y="84" textAnchor="end" fontSize="8" fill="#C9D0D8">500</text>
      <text x={lx(0) - 24} y="120" textAnchor="end" fontSize="8" fill="#C9D0D8">200</text>
      {band(1, 110, 36, 1, 6)}{band(2, 110, 36, 0.8, 6)}
      {gdna && <>{band(1, 50, 36, 0.35, 5)}{band(2, 50, 36, 0.3, 5)}{band(3, 50, 36, 0.4, 5)}</>}
      <text x={lx(1) + 22} y="114" fontSize="8" fill="#C9D0D8">← 230 bp, cDNA</text>
      {gdna && <text x={lx(3) + 22} y="54" fontSize="8" fill="#C9D0D8">← 1.1 kb, gDNA (intron kept)</text>}
    </svg>
  );
}

export default function Readout() {
  const [eff, setEff] = useState(95);
  const [a, setA] = useState(1000);
  const [b, setB] = useState(1e5);
  const [dimer, setDimer] = useState(false);
  const [gdna, setGdna] = useState(false);
  const [slope, setSlope] = useState(-3.4);
  return (
    <>
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
        <defs>
          <linearGradient id="fadeR" x1="0" x2="1"><stop offset="0" stopColor="#C9D0D8" /><stop offset="1" stopColor="#C9D0D8" stopOpacity="0" /></linearGradient>
          <linearGradient id="fadeL" x1="1" x2="0"><stop offset="0" stopColor="#C9D0D8" /><stop offset="1" stopColor="#C9D0D8" stopOpacity="0" /></linearGradient>
        </defs>
      </svg>
      <h1>Read it on a gel, or watch it happen.</h1>
      <p className="lede">Every cycle doubles the product until the reaction runs out of steam. A <b>gel shows where it ended</b>. A real-time machine <b>watches the exponential phase</b>, where the numbers still mean something.</p>
      <h2>Real time: the cycle that crosses the line</h2>
      <div className="panel">
        <AmpChart E={eff / 100} a={a} b={b} />
        <div className="form">
          <label>Sample A starting copies
            <select value={a} onChange={(e) => setA(Number(e.target.value))}>{N0_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label>Sample B starting copies
            <select value={b} onChange={(e) => setB(Number(e.target.value))}>{N0_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <label className="wide">Amplification efficiency: {eff} %<input type="range" min="70" max="100" value={eff} onChange={(e) => setEff(Number(e.target.value))} /></label>
        </div>
      </div>
      <p>The machine reads fluorescence every cycle. Early on it is noise; then product rises above a <b>threshold</b> set in the exponential phase, and the fractional cycle where a well crosses it is its <b>Cq</b> (also called Ct or Cp). <b>More starting template crosses earlier.</b> At 100 % efficiency <b>one cycle is a factor of 2</b>, so <b>3.32 cycles is a factor of 10</b>; a sample with Cq 21 has about eight times the template of one with Cq 24. Above the threshold the curves bend over and flatten, which is why <b>endpoint intensity cannot tell 10³ from 10⁶</b> starting copies.</p>
      <h2>From Cq to fold change</h2>
      <p><b>Two normalisations</b> turn Cq values into biology. First subtract a <b>reference gene</b> measured in the same cDNA (<b>ΔCq</b>), which cancels differences in RNA input and RT yield. Then subtract the control condition (<b>ΔΔCq</b>). With efficiencies near 100 % the fold change is <b>2<sup>−ΔΔCq</sup></b>; with measured efficiencies use the Pfaffl ratio.</p>
      <DdCq />
      <h2>Melt curve: one product, or several?</h2>
      <div className="panel">
        <MeltCurve dimer={dimer} />
        <div className="controls">
          <label className={s.chk}><input type="checkbox" checked={dimer} onChange={(e) => setDimer(e.target.checked)} /> show primer-dimer in the NTC and a little in the sample</label>
        </div>
        <div className="legend">
          <span><i style={{ background: '#2E8B57' }} />sample</span>
          <span><i style={{ background: '#7A8797' }} />no-template control</span>
        </div>
      </div>
      <p>SYBR Green fluoresces in <b>any double-stranded DNA</b>, so after the last cycle the machine heats slowly and watches the signal drop as each duplex melts. Plotted as −dF/dT, <b>one product gives one sharp peak</b> at its own Tm, typically 78–88 °C. A second peak <b>below 75 °C</b>, strongest in the no-template control, is <b>primer-dimer</b>; a shoulder near the product is a second amplicon. Probe assays do not need this step because the probe reports only its own sequence.</p>
      <h2>Endpoint: the gel</h2>
      <div className="panel">
        <Gel gdna={gdna} />
        <div className="controls">
          <label className={s.chk}><input type="checkbox" checked={gdna} onChange={(e) => setGdna(e.target.checked)} /> genomic DNA left in the RNA prep, primers flanking a 900 bp intron</label>
        </div>
      </div>
      <p>Run <b>5 µL beside a ladder</b> on a 1.5–2 % agarose gel (higher percentage for shorter products). Expect <b>one band of the predicted size</b> in the samples, <b>nothing in the −RT lane</b>, nothing in the NTC lane. Primers that flank an intron turn genomic contamination into a <b>visibly larger band</b>, which is the gel's own −RT check; primers that span an exon junction give no genomic product at all. A faint smear near 40–80 bp is primer-dimer.</p>
      <Details summary="Efficiency from a standard curve">
        <p>Make a <b>5-point, 10-fold dilution series</b> of a cDNA pool and run each point in duplicate or triplicate. Plot Cq against log₁₀(dilution). The slope gives the efficiency: <em>E</em> = 10<sup>−1/slope</sup> − 1. A slope of <b>−3.32 is 100 %</b>; accept <b>−3.1 to −3.6 (90–110 %)</b> with R² above 0.98. Steeper than −3.6 means <b>inhibition</b> or a poor assay; shallower than −3.1 usually means pipetting error or primer-dimer contributing signal. MIQE asks for this number for every assay you report.</p>
        <div className="form">
          <label>Slope of Cq vs log₁₀(input)<input type="number" step="0.01" value={slope} onChange={(e) => setSlope(Number(e.target.value))} /></label>
          <div className="stat" style={{ alignSelf: 'end' }}><span>efficiency <b>{Number.isFinite(efficiencyFromSlope(slope)) && slope < 0 ? (100 * efficiencyFromSlope(slope)).toFixed(0) : '–'} %</b></span></div>
        </div>
      </Details>
      <Details summary="How many cycles to run">
        <p><b>Real time: 40 cycles</b>, always; the machine records where each well crosses, and late wells (<b>Cq above 35</b>) are treated as below the limit of quantification rather than as data. <b>Endpoint: 30–35 cycles</b> for a transcript of ordinary abundance, 25 for a very abundant one (a reference gene will smear at 35), and if 40 cycles give no band, <b>fix the reaction</b> rather than adding cycles.</p>
      </Details>
      <Details summary="Deeper: where the exact-length product comes from">
        <ExactLength />
      </Details>
      <Videos topics={['qpcr', 'analysis']} label="Watch: reading and analysing a real-time run" />
      <Sources keys={['livak', 'pfaffl', 'nolan', 'bustin_nolan', 'miqe', 'biorad_qpcr', 'taylor', 'qiagen_qpcr', 'khan']} />
    </>
  );
}
