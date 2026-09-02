import { useState } from 'react';
import { REAGENTS } from '../data/reagents.js';
import Glyph from './Glyphs.jsx';
import Rich from './Rich.jsx';
import Chip from './Chip.jsx';
import Sources from './Sources.jsx';
import { copiesFromNg, fmolFromNg, fmtCount } from '../lib/units.js';
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
            <dt>Amount</dt><dd>{r.amount}</dd>
            <dt>Too little</dt><dd>{r.low}</dd>
            <dt>Too much</dt><dd>{r.high}</dd>
          </dl>
          <p>{r.bench}</p>
        </div>
      </details>
    </li>
  );
}

function CopiesCalculator() {
  const [ng, setNg] = useState(1);
  const [bp, setBp] = useState(5000);
  const copies = copiesFromNg(Number(ng) || 0, Number(bp) || 1);
  const fmol = fmolFromNg(Number(ng) || 0, Number(bp) || 1);
  return (
    <div className="panel">
      <div className="form">
        <label>Mass (ng)<input type="number" value={ng} step="0.1" min="0" onChange={(e) => setNg(e.target.value)} /></label>
        <label>Molecule length (bp)<input type="number" value={bp} step="100" min="1" onChange={(e) => setBp(e.target.value)} /></label>
      </div>
      <div className="stat"><span><b>{fmtCount(copies)}</b> copies</span><span>{fmol.toPrecision(3)} fmol</span></div>
      <p className="note" style={{ marginTop: 8 }}>copies = mass × 6.022 × 10²³ ÷ (length × 660 g/mol per bp). Try 5,000 bp (plasmid) versus 3.1 × 10⁹ bp (human genome).</p>
    </div>
  );
}

export default function Reagents() {
  return (
    <>
      <h1>Seven ingredients, one job each.</h1>
      <p className="lede">Open a reagent for what it does, why that amount, and what goes wrong when it is off. Final concentrations are for a standard 50 µL Taq reaction; your enzyme's datasheet wins if it differs.</p>
      <ul className={s.list}>{REAGENTS.map((r) => <ReagentItem key={r.name} r={r} />)}</ul>
      <h2>How much template is "1 ng"?</h2>
      <p>Mass is what you pipette; copies are what the reaction sees. A nanogram of plasmid is far more target copies than a nanogram of genomic DNA, because the target is a tiny fraction of the genome.</p>
      <CopiesCalculator />
      <Sources keys={['neb_taq', 'neb_prod', 'tf_setup', 'steitz', 'tindall', 'potapov', 'lorenz']} />
    </>
  );
}
