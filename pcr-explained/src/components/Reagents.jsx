import { useState } from 'react';
import { REAGENTS } from '../data/reagents.js';
import Glyph from './Glyphs.jsx';
import Rich from './Rich.jsx';
import Chip from './Chip.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import { rnaCopiesFromNg, fmtCount } from '../lib/units.js';
import s from './Reagents.module.css';

function ReagentItem({ r }) {
  return (
    <li className={s.item}>
      <details>
        <summary>
          <Glyph name={r.glyph} />
          <span><span className={s.name}>{r.name}</span><span className={s.role}>{r.role}</span></span>
          <Chip>{r.chip}</Chip>
        </summary>
        <div className="body">
          <Rich text={r.does} />
          <dl className={s.kv}>
            <dt>Amount</dt><Rich as="dd" text={r.amount} />
            <dt>Too little</dt><Rich as="dd" text={r.low} />
            <dt>Too much</dt><Rich as="dd" text={r.high} />
          </dl>
          <Rich text={r.bench} />
        </div>
      </details>
    </li>
  );
}

const QUALITY = [
  ['A260/280', '≈ 2.0 for RNA', <><b>Below 1.8:</b> protein or phenol carried over. RNA reads higher than DNA (1.8) because of the extra uracil absorbance.</>],
  ['A260/230', '≥ 1.8', <>Low values mean <b>guanidine salts, phenol or ethanol</b> from the prep; all inhibit reverse transcriptase. <b>Re-wash or re-precipitate.</b></>],
  ['Integrity', 'RIN ≥ 7, or 28S:18S ≈ 2:1', <>On a denaturing gel intact total RNA shows <b>two sharp ribosomal bands</b>; a smear towards small sizes is degradation. Bioanalyzer/TapeStation reports a <b>RIN</b> from 1 (gone) to 10 (intact).</>],
  ['Genomic DNA', 'DNase-treated', <>RNA preps <b>always carry some DNA</b>. DNase I on the column or in solution, then inactivate (EDTA plus 65 °C, or the kit's inactivation reagent). The <b>−RT control</b> tells you whether enough was removed.</>],
];

function RnaCalculator() {
  const [ng, setNg] = useState(500);
  const [frac, setFrac] = useState(2);
  const [nt, setNt] = useState(2000);
  const mrnaNg = (Number(ng) || 0) * ((Number(frac) || 0) / 100);
  const molecules = rnaCopiesFromNg(mrnaNg, Number(nt) || 1);
  return (
    <div className="panel">
      <div className="form">
        <label>Total RNA in the RT (ng)<input type="number" value={ng} step="50" min="0" onChange={(e) => setNg(e.target.value)} /></label>
        <label>mRNA fraction (%)<input type="number" value={frac} step="0.5" min="0" max="100" onChange={(e) => setFrac(e.target.value)} /></label>
        <label className="wide">Average transcript length (nt)<input type="number" value={nt} step="100" min="1" onChange={(e) => setNt(e.target.value)} /></label>
      </div>
      <div className="stat">
        <span><b>{fmtCount(mrnaNg)}</b> ng mRNA</span>
        <span><b>{fmtCount(molecules)}</b> mRNA molecules in the tube</span>
        <span>a transcript at 1 in 10⁴ of them: <b>{fmtCount(molecules / 1e4)}</b> copies</span>
      </div>
      <p className="note" style={{ marginTop: 8 }}>molecules = mass × 6.022 × 10²³ ÷ (length × 340 g/mol per nt). Ribosomal RNA is <b>80–90 %</b> of total RNA; mRNA is <b>1–5 %</b>. Only a few percent of the total goes into each PCR, so rare transcripts start from <b>tens of copies</b>: this is why replicates scatter at high Cq.</p>
    </div>
  );
}

export default function Reagents() {
  const rt = REAGENTS.filter((r) => r.stage === 'rt');
  const pcr = REAGENTS.filter((r) => r.stage === 'pcr');
  return (
    <>
      <h1>RNA first. Then the ingredients of the RT reaction.</h1>
      <p className="lede"><b>RNA is the fragile input</b>; everything else in the tube is there to protect it or to copy it. Open a reagent for what it does, why that amount, and what goes wrong when it is off.</p>
      <h2>Keeping RNA intact</h2>
      <p>RNases are stable, need no cofactors, <b>survive autoclaving</b>, and live on skin and dust. The habits that matter: <b>gloves changed often</b>, RNase-free tips and tubes, a dedicated bench and pipettes, <b>RNA on ice</b> and back at −80 °C quickly, and no more than a few freeze–thaw cycles. Then <b>check what you have</b> before you spend enzyme on it.</p>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Check</th><th>Want</th><th>What it means</th></tr></thead>
          <tbody>{QUALITY.map(([k, v, w]) => <tr key={k}><td><b>{k}</b></td><td className={s.nowrap}>{v}</td><td className="note">{w}</td></tr>)}</tbody>
        </table>
      </div>
      <h2>The RT reaction</h2>
      <ul className={s.list}>{rt.map((r) => <ReagentItem key={r.name} r={r} />)}</ul>
      <h2>The PCR stage</h2>
      <p>The cDNA is DNA, so the PCR ingredients are the ones from conventional PCR. What changes is the <b>template</b> and, for a real-time readout, the <b>detection chemistry</b>.</p>
      <ul className={s.list}>{pcr.map((r) => <ReagentItem key={r.name} r={r} />)}</ul>
      <h2>How many molecules is "500 ng of total RNA"?</h2>
      <p>Mass is what you pipette; <b>molecules are what the enzyme sees</b>. Most of the mass is ribosomal RNA. Use the calculator to see <b>how few copies</b> of a rare transcript actually enter the reaction.</p>
      <RnaCalculator />
      <Videos topics={['rna']} label="Watch: extracting and checking RNA" />
      <Sources keys={['tf_rna', 'fleige', 'schroeder', 'tf_rt', 'neb_rt', 'stahlberg', 'kotewicz', 'tf_setup', 'miqe']} />
    </>
  );
}
