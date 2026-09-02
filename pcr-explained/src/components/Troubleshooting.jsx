import { TROUBLESHOOTING } from '../data/troubleshooting.js';
import Chip from './Chip.jsx';
import Rich from './Rich.jsx';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';

export default function Troubleshooting() {
  return (
    <>
      <h1>When the result disagrees with you.</h1>
      <p className="lede">Each symptom points back to the RNA, the RT, a reagent or a step. <b>Change one variable at a time</b>, and keep the −RT, no-template and positive controls in every run.</p>
      <div>
        {TROUBLESHOOTING.map((t) => (
          <Details key={t.s} summary={<span>{t.s}</span>}>
            <div style={{ marginBottom: 6 }}>{t.tags.map((x) => <Chip key={x}>{x}</Chip>).reduce((acc, el, i) => (i ? [...acc, ' ', el] : [el]), [])}</div>
            <b>Likely causes</b>
            <ul>{t.c.map((x) => <Rich as="li" key={x} text={x} />)}</ul>
            <b>Fixes, in order</b>
            <ul>{t.f.map((x) => <Rich as="li" key={x} text={x} />)}</ul>
          </Details>
        ))}
      </div>
      <Details summary="A systematic order for fixing a failed reaction">
        <ol>
          <li><b>Positive control first.</b> If it failed too, the problem is reagents, cycler or cDNA, not your new primers.</li>
          <li><b>Check the NTC and −RT.</b> Product in the NTC means contamination: fresh water, dNTP and primer aliquots. Product in −RT means genomic DNA: DNase again, or junction-spanning primers.</li>
          <li><b>Check the RNA</b> (A260 ratios, a gel or RIN) and the RT input; rerun the RT if in doubt.</li>
          <li><b>Dilute the cDNA</b> 1:10 and see whether Cq drops by less than 3.3 cycles: inhibition.</li>
          <li><b>Then the PCR itself:</b> annealing gradient, primer concentration, a fresh master mix.</li>
          <li><b>Only then</b> redesign primers or change enzyme.</li>
        </ol>
      </Details>
      <Videos topics={['protocol', 'qpcr']} label="Watch: reproducibility and melt-curve problems" />
      <Sources keys={['neb_rtqpcr_tips', 'neb_ts', 'bustin_nolan', 'nolan', 'fleige', 'lorenz', 'tf_rtqpcr']} />
    </>
  );
}
