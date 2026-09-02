import { TROUBLESHOOTING } from '../data/troubleshooting.js';
import Chip from './Chip.jsx';
import Details from './Details.jsx';
import Sources from './Sources.jsx';

export default function Troubleshooting() {
  return (
    <>
      <h1>When the gel disagrees.</h1>
      <p className="lede">Each symptom points back to a reagent or a step. Change one variable at a time, and keep the positive and no-template controls in every run.</p>
      <div>
        {TROUBLESHOOTING.map((t) => (
          <Details key={t.s} summary={<span>{t.s}</span>}>
            <div style={{ marginBottom: 6 }}>{t.tags.map((x) => <Chip key={x}>{x}</Chip>).reduce((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}</div>
            <b>Likely causes</b>
            <ul>{t.c.map((x) => <li key={x}>{x}</li>)}</ul>
            <b>Fixes, in order</b>
            <ul>{t.f.map((x) => <li key={x}>{x}</li>)}</ul>
          </Details>
        ))}
      </div>
      <Details summary="A systematic order for fixing a failed reaction">
        <ol>
          <li>Confirm the positive control worked. If not, the problem is reagents or cycler, not your primers.</li>
          <li>Check the NTC is clean. If not, replace water, dNTPs and primer aliquots before anything else.</li>
          <li>Run an annealing-temperature gradient with the existing mix.</li>
          <li>Titrate Mg²⁺ (1.5 → 2.0 → 2.5 mM) and template (10× dilution series).</li>
          <li>Only then redesign primers or change enzyme.</li>
        </ol>
      </Details>
      <Sources keys={['neb_ts', 'lorenz', 'addgene_pcr', 'tf_setup']} />
    </>
  );
}
