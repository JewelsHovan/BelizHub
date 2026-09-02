import { useMemo } from 'react';
import { useCycleClock } from '../hooks/useCycleClock.js';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import { BOUNDARIES, BOUNDARY_T, PHASE, TOTAL_S, geometry, caption } from '../lib/cycle.js';
import { mmss } from '../lib/units.js';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import s from './CycleAnimation.module.css';

const X = (t) => 20 + t * 320;
const Y = (T) => 100 - (T - 50) * 1.6;
const FWD = '#6A4C9C';
const REV = '#B8336A';
const POL = '#C98A1B';

function TemperatureTrace({ t, T }) {
  const pts = useMemo(() => BOUNDARIES.map((b, i) => `${X(b).toFixed(1)},${Y(BOUNDARY_T[i]).toFixed(1)}`).join(' '), []);
  const band = (a, c, fill) => <rect x={X(a)} y="14" width={X(c) - X(a)} height="86" fill={fill} />;
  return (
    <svg viewBox="0 0 360 110" role="img" aria-label="Temperature over one PCR cycle">
      {band(0.056, 0.264, '#F8DED5')}{band(0.333, 0.541, '#D8E5F4')}{band(0.583, 1, '#F6E7C9')}
      <line x1="20" x2="340" y1="100" y2="100" stroke="#D7DDDA" />
      <polyline points={pts} fill="none" stroke="#1B2430" strokeWidth="2" strokeLinejoin="round" />
      <text x={X(0.16)} y="24" textAnchor="middle" fontSize="11" fill="#D64B2A" fontWeight="600">95 °C</text>
      <text x={X(0.437)} y="84" textAnchor="middle" fontSize="11" fill="#2F6FB5" fontWeight="600">58 °C</text>
      <text x={X(0.79)} y="60" textAnchor="middle" fontSize="11" fill="#8a5a08" fontWeight="600">72 °C</text>
      <text x="10" y="104" fontSize="9" fill="#5A6470">50</text>
      <text x="6" y="24" fontSize="9" fill="#5A6470">100</text>
      <circle cx={X(t)} cy={Y(T)} r="5" fill="#1B2430" stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

function ticks(from, to, step, y1, y2, stroke, opacity) {
  const out = [];
  if (step > 0) for (let x = from; x <= to; x += step) out.push(<line key={x} x1={x} x2={x} y1={y1} y2={y2} stroke={stroke} strokeWidth="2" opacity={opacity} />);
  else for (let x = from; x >= to; x += step) out.push(<line key={x} x1={x} x2={x} y1={y1} y2={y2} stroke={stroke} strokeWidth="2" opacity={opacity} />);
  return out;
}

function dntpDots(cx, cy, ext, pv, phaseShift) {
  return Array.from({ length: 5 }, (_, i) => {
    const a = i * 1.256 + ext * 18 + phaseShift;
    const r = 20 + 6 * Math.sin(ext * 30 + i);
    return <circle key={i} cx={(cx + r * Math.cos(a)).toFixed(1)} cy={(cy + r * Math.sin(a) * 0.6).toFixed(1)} r="2.2" opacity={(0.5 * pv).toFixed(2)} />;
  });
}

function MolecularView({ t, g, cycleNo }) {
  const { sep, dock, ext, yt, yb, fwdPrimer, revPrimer, fEnd, rEnd, polVisible: pv } = g;
  const hbondXs = useMemo(() => Array.from({ length: 29 }, (_, i) => 40 + i * 10), []);
  return (
    <svg viewBox="0 0 360 230" role="img" aria-label="Two DNA strands, two primers and the polymerase during one cycle">
      <defs>
        <marker id="ahf" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill={FWD} /></marker>
        <marker id="ahr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0L10 5L0 10z" fill={REV} /></marker>
      </defs>
      <g opacity={(1 - sep).toFixed(3)}>
        {hbondXs.map((x) => <line key={x} x1={x} x2={x} y1={yt + 3} y2={yb - 3} stroke="#C9D0D8" strokeWidth="2" />)}
      </g>
      <g>
        {dock > 0.5 && ticks(34, 66, 8, yb - 9, yb - 3, FWD, (dock - 0.5) * 2)}
        {ticks(74, fEnd - 4, 8, yb - 9, yb - 3, FWD, 0.55)}
      </g>
      <g>
        {dock > 0.5 && ticks(294, 326, 8, yt + 3, yt + 9, REV, (dock - 0.5) * 2)}
        {ticks(286, rEnd + 4, -8, yt + 3, yt + 9, REV, 0.55)}
      </g>
      <line x1="30" x2="330" y1={yt} y2={yt} stroke="#1B2430" strokeWidth="4" strokeLinecap="round" />
      <line x1="30" x2="330" y1={yb} y2={yb} stroke="#7A8797" strokeWidth="4" strokeLinecap="round" />
      <text x="12" y={yt + 3.5} fontSize="10" fill="#5A6470">5′</text><text x="338" y={yt + 3.5} fontSize="10" fill="#5A6470">3′</text>
      <text x="12" y={yb + 3.5} fontSize="10" fill="#5A6470">3′</text><text x="338" y={yb + 3.5} fontSize="10" fill="#5A6470">5′</text>
      {ext > 0 && <line x1="70" x2={fEnd} y1={yb - 12} y2={yb - 12} stroke={FWD} strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" />}
      {ext > 0 && <line x1="290" x2={rEnd} y1={yt + 12} y2={yt + 12} stroke={REV} strokeOpacity=".55" strokeWidth="4" strokeLinecap="round" />}
      <g transform={`translate(${fwdPrimer.x.toFixed(1)},${fwdPrimer.y.toFixed(1)})`}>
        <line x1="0" x2="36" y1="0" y2="0" stroke={FWD} strokeWidth="5" strokeLinecap="round" markerEnd="url(#ahf)" />
        <text x="0" y="-8" fontSize="9" fill={FWD}>fwd 5′</text>
      </g>
      <g transform={`translate(${revPrimer.x.toFixed(1)},${revPrimer.y.toFixed(1)})`}>
        <line x1="0" x2="-36" y1="0" y2="0" stroke={REV} strokeWidth="5" strokeLinecap="round" markerEnd="url(#ahr)" />
        <text x="0" y="14" fontSize="9" fill={REV} textAnchor="end">5′ rev</text>
      </g>
      {pv > 0 && (
        <g fill={POL}>
          {dntpDots(fEnd, yb - 12, ext, pv, 0)}
          {dntpDots(rEnd, yt + 12, ext, pv, 1)}
        </g>
      )}
      <g transform={`translate(${fEnd.toFixed(1)},${(yb - 12).toFixed(1)})`} opacity={pv}><circle r="11" fill={POL} /><circle r="3" fill="#fff" opacity=".8" /></g>
      <g transform={`translate(${rEnd.toFixed(1)},${(yt + 12).toFixed(1)})`} opacity={pv}><circle r="11" fill={POL} /><circle r="3" fill="#fff" opacity=".8" /></g>
      <text x="180" y="222" textAnchor="middle" fontSize="11" fill="#5A6470">{caption(t, g, cycleNo)}</text>
    </svg>
  );
}

export default function CycleAnimation({ active }) {
  const reduced = useReducedMotion();
  const { t, playing, cycleNo, seek, toggle } = useCycleClock({ autoplay: active && !reduced });
  const g = geometry(t);
  const P = PHASE[g.phase];
  const secs = Math.round(t * TOTAL_S);
  return (
    <>
      <h1>Three temperatures, one cycle. The template is now cDNA.</h1>
      <p className="lede">Once cDNA exists, the reaction is ordinary PCR. Watch a single cycle at the molecular level while the block temperature changes. Play it, step to a phase, or drag through it.</p>
      <div className="panel">
        <TemperatureTrace t={t} T={g.T} />
        <MolecularView t={t} g={g} cycleNo={cycleNo} />
        <div className="controls">
          <button className="btn primary" onClick={toggle}>{playing ? 'Pause' : 'Play'}</button>
          <div className="seg">
            {Object.entries(PHASE).map(([k, ph]) => (
              <button key={k} className={`${ph.cls} ${g.phase === k ? 'on' : ''}`} onClick={() => seek(ph.jump)}>{k[0].toUpperCase() + k.slice(1)}</button>
            ))}
          </div>
          <span className="readout">{g.T.toFixed(0)} °C, {mmss(secs)} into cycle {cycleNo}</span>
        </div>
        <input type="range" min="0" max="1000" value={Math.round(t * 1000)} aria-label="Scrub through the cycle"
          onChange={(e) => { if (playing) toggle(); seek(Number(e.target.value) / 1000); }} />
        <div className="legend">
          <span><i style={{ background: 'var(--strand)' }} />template strand 5′→3′</span>
          <span><i style={{ background: 'var(--strand2)' }} />complementary strand</span>
          <span><i style={{ background: 'var(--fwd)' }} />forward primer, new strand</span>
          <span><i style={{ background: 'var(--rev)' }} />reverse primer, new strand</span>
          <span><i style={{ background: 'var(--warm)', width: 10, height: 10, borderRadius: '50%' }} />polymerase</span>
        </div>
      </div>
      <div className={`${s.phasebox} ${s[P.cls]}`}>
        <h3>{P.title}</h3>
        <p>{P.body}</p>
      </div>
      <Details summary="Why these exact temperatures">
        <p><b>94–98 °C, denaturation.</b> The two strands are held together by hydrogen bonds (two per A·T, three per G·C) and by base stacking. Above the DNA's melting temperature nearly every duplex is open. 95 °C clears even GC-rich stretches within seconds; the phosphodiester backbone is covalent and unaffected. Longer than needed costs enzyme activity (Taq half-life about 40 min at 95 °C) and causes depurination.</p>
        <p><b>50–65 °C, annealing.</b> On cooling, the primers (present at roughly 10⁸ times the molar amount of template) find their sites long before the two original long strands can re-pair. The temperature sets stringency: at Tm − 3 to 5 °C a perfectly matched primer stays bound while mismatched sites do not. Too low and primers tolerate mismatches, giving extra bands; too high and the primer melts off before the polymerase can extend it.</p>
        <p><b>68–72 °C, extension.</b> Near the enzyme's optimum, hot enough that any mispaired primer melts off, cool enough that the correctly paired primer and the growing strand stay on. Taq adds about 1,000 nucleotides per minute, so extension time scales with amplicon length (1 min per kb is the safe rule). NEB notes their Taq is often more robust at 68 °C.</p>
      </Details>
      <Details summary="The first cycle is one-sided">
        <p>First-strand cDNA is a single strand, antisense to the mRNA. In cycle 1 only the <b>forward</b> primer (which has the mRNA's own sequence) can pair with it; the reverse primer has nothing to bind until the forward primer has been extended. From cycle 2 both primers have templates and the reaction doubles as usual. Two consequences: a one-cycle lag that is identical for every sample so it cancels in comparisons, and the fact that if your forward primer is written on the wrong strand, cycle 1 never happens at all. The Primers tab checks orientation against your transcript.</p>
      </Details>
      <Details summary="Initial and final steps">
        <p><b>Initial denaturation</b> (95 °C, 30 s to 3 min) fully melts the template and activates hot-start formulations; qPCR mixes call it polymerase activation and it is often the only long step. <b>Final extension</b> (72 °C, 5 min) lets the polymerase finish any partially extended strands and add the single 3′ A overhang Taq leaves on products, which TA-cloning vectors rely on. <b>Hold</b> at 4–10 °C keeps products stable until you take the tubes out. Real-time programs skip the final extension and, for SYBR assays, end with a <b>melt curve</b> instead: a slow ramp from 60 to 95 °C reading fluorescence every 0.5 °C, which is how you learn whether one product or several were made.</p>
      </Details>
      <Details summary="What the thermal cycler does">
        <p>A metal block on Peltier elements ramps at 3–6 °C/s between set points, so a 30-cycle program of 30 s steps takes roughly 60–90 min including ramps. The heated lid (about 105 °C) stops condensation on the tube cap, which would otherwise change the concentrations below. Thin-walled tubes and small volumes matter because the reaction only sees the block temperature after the liquid has equilibrated.</p>
      </Details>
      <Videos topics={['pcr']} label="Watch: PCR animated" />
      <Sources keys={['neb_taq', 'tf_basics', 'rychlik', 'lorenz', 'khan', 'tf_rtqpcr']} />
    </>
  );
}
