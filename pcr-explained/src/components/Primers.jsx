import { useContext, useEffect, useMemo, useState } from 'react';
import { PrimerContext } from '../context.js';
import { analyze, clean, pairAnalysis, verdicts } from '../lib/thermo.js';
import Chip from './Chip.jsx';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import s from './Primers.module.css';

const RULES = [
  ['Length 18–24 nt', 'Long enough to be unique in a genome (a 17-mer is expected once per ~4¹⁷ bases), short enough to anneal cleanly and to synthesize cheaply.'],
  ['GC 40–60 %', 'Sets Tm into the useful range and avoids GC-runs that form stable off-target duplexes and hairpins.'],
  ['Tm 55–65 °C, pair within 5 °C', 'Both primers must work at one annealing temperature. A mismatch means the hotter primer is stringent while the cooler one is either loose or absent.'],
  ['3′ end: 1–2 G/C in the last five, never GGG/CCC', 'The 3′ end is where the polymerase starts, so a G/C "clamp" keeps it seated. Too much 3′ GC makes mispriming stable enough to extend.'],
  ['No runs ≥4 of one base, no dinucleotide repeats', 'Repeats slip, giving mixed-length products; runs cause misalignment and mispriming.'],
  ['No 3′ complementarity (self or cross)', 'Two primers whose 3′ ends pair extend each other into a 40–80 bp primer-dimer that soaks up enzyme and primer every cycle.'],
  ['No hairpins at the 3′ end', 'A folded primer cannot present its 3′-OH to the template.'],
  ['Check specificity', 'Primer-BLAST against the organism\'s genome. A primer that also binds a paralogue gives an extra band no amount of Ta tuning removes.'],
  ['Amplicon 100–1,000 bp for routine work', 'Short amplicons are efficient and tolerant of degraded template; long ones need high-fidelity or long-range enzymes and longer extension.'],
];

function PrimerCard({ label, A }) {
  if (A.len < 8) {
    return <div className={s.card}><div className={s.title}>{label}</div><div className="note">Enter at least 8 bases (A, C, G, T).</div></div>;
  }
  return (
    <div className={s.card}>
      <div className={s.title}>{label}</div>
      {verdicts(A).map(([k, v, status]) => (
        <div className={s.row} key={k}><span>{k}</span><span><Chip status={status}>{v}</Chip></span></div>
      ))}
    </div>
  );
}

export default function Primers() {
  const [f, setF] = useState('TGCCATGCACCAGGTTGTTG');
  const [r, setR] = useState('ATGTGGCACACTGCGTTGTC');
  const { setPrimerTm } = useContext(PrimerContext);
  const A = useMemo(() => analyze(clean(f)), [f]);
  const B = useMemo(() => analyze(clean(r)), [r]);
  const pair = useMemo(() => pairAnalysis(A, B), [A, B]);
  useEffect(() => { setPrimerTm(pair ? { f: A.tm, r: B.tm } : null); }, [pair, A.tm, B.tm, setPrimerTm]);
  return (
    <>
      <h1>Primers decide everything.</h1>
      <p className="lede">Polymerase cannot start a strand; it can only extend a 3′-OH that is base-paired to a template. So the primers choose what is copied, how specifically, and at what temperature.</p>
      <div className="panel">
        <div className="form">
          <label className="wide">Forward primer, 5′→3′<input className="mono" type="text" value={f} spellCheck={false} autoComplete="off" onChange={(e) => setF(e.target.value)} /></label>
          <label className="wide">Reverse primer, 5′→3′<input className="mono" type="text" value={r} spellCheck={false} autoComplete="off" onChange={(e) => setR(e.target.value)} /></label>
        </div>
        <div className={s.res}><PrimerCard label="Forward" A={A} /><PrimerCard label="Reverse" A={B} /></div>
        {pair && (
          <div className="stat">
            <span>ΔTm <Chip status={pair.dTm <= 5 ? 'ok' : 'warn'}>{pair.dTm.toFixed(1)} °C</Chip></span>
            <span>3′ cross-dimer <Chip status={pair.cross >= 5 ? 'bad' : pair.cross >= 4 ? 'warn' : 'ok'}>{pair.cross ? `${pair.cross} nt` : 'none'}</Chip></span>
            <span>Suggested Ta for Taq: <b>{pair.taHigh.toFixed(0)}–{pair.taLow.toFixed(0)} °C</b> (Tm of the cooler primer − 3 to 5)</span>
          </div>
        )}
        <p className="note" style={{ marginTop: 10 }}>Defaults are an example pair that passes every check. Paste the M13 universal primers, GTAAAACGACGGCCAGT and CAGGAAACAGCTATGAC, to see a real pair with a 5.6 °C Tm gap. Tm uses nearest-neighbour thermodynamics (SantaLucia 1998) at 0.5 µM primer and 50 mM monovalent salt; Mg²⁺ and additives shift it, so confirm with the enzyme maker's calculator. Dimer and hairpin flags are sequence heuristics, not ΔG.</p>
      </div>
      <h2>Rules and the reason for each</h2>
      <ul className={s.ruleset}>{RULES.map(([rule, why]) => <li key={rule}><b>{rule}</b><span>{why}</span></li>)}</ul>
      <Details summary="How Tm is calculated here">
        <p>Nearest-neighbour model: every adjacent base pair contributes an enthalpy and entropy term (ΔH°, ΔS°) from SantaLucia's unified table, plus an initiation term for each end. Tm = ΔH° / (ΔS° + R ln(C/4)) − 273.15, where C is primer concentration and the /4 applies to two different strands. Salt is handled by ΔS° + 0.368 × (N − 1) × ln[Na⁺]. The Wallace rule, 2(A+T) + 4(G+C), is only a rough guide for short oligos.</p>
      </Details>
      <Details summary="Adding tails: restriction sites, overhangs, adapters">
        <p>Only the 3′ portion (about 18–24 nt) must match the template; anything 5′ of it rides along and is copied into every product from cycle 2 onward. Add 4–6 extra bases beyond a restriction site so the enzyme can cut near the end. Compute Tm and Ta from the template-matching part for the first 5 cycles, then optionally raise Ta since the full-length primer now matches the product.</p>
      </Details>
      <Sources keys={['santalucia', 'addgene_primer', 'pblast', 'primer3', 'idt', 'neb_tm', 'rychlik']} />
    </>
  );
}
