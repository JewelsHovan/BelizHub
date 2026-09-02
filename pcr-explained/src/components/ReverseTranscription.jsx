import { useEffect, useState } from 'react';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import { useReducedMotion } from '../hooks/useReducedMotion.js';
import s from './ReverseTranscription.module.css';

const RNA = '#B8336A';
const CDNA = '#2F6FB5';
const PRIMER = '#6A4C9C';
const FWD = '#6A4C9C';

const STEPS = [
  { title: 'Total RNA and the primer', T: 'on ice', body: <>The tube holds all the RNA: ribosomal, transfer, and <b>1–5 % messenger RNA</b>, each mRNA with a 5′ cap and a poly(A) tail. Choose how to prime. <b>Oligo(dT)</b> pairs with every poly(A) tail; <b>random hexamers</b> pair everywhere, including on rRNA; a <b>gene-specific primer</b> pairs with one transcript only.</> },
  { title: '65 °C for 5 min, then ice', T: '65 °C', body: <><b>Heat melts secondary structure</b>, the hairpins that would stop the enzyme, and lets the primer find its site. <b>Snap-cooling on ice</b> keeps it that way. Only RNA, primer, dNTPs and water are in the tube so far; <b>the enzyme would not survive</b> this step.</> },
  { title: 'Add the enzyme, 42–55 °C', T: '42–55 °C', body: <>Buffer, DTT, RNase inhibitor and reverse transcriptase go in. The enzyme grips the primer–RNA junction and <b>adds dNTPs to the primer's 3′ end</b>, reading the RNA 3′→5′ and writing DNA 5′→3′. Roughly <b>1 kb in 3–10 min</b> depending on the enzyme; 10–50 min covers most transcripts.</> },
  { title: 'Full-length cDNA:RNA hybrid', T: '42–55 °C', body: <>The product is one DNA strand base-paired to the RNA: <b>first-strand cDNA</b>, antisense to the mRNA. <b>RNase H-minus</b> enzymes leave the RNA alone so they can keep going on long transcripts; wild-type reverse transcriptase would nick the RNA it has already copied.</> },
  { title: 'Inactivate, then PCR', T: '80–95 °C', body: <><b>80–95 °C kills the enzyme</b> so it cannot act in the PCR. The hybrid melts in the first PCR denaturation and the cDNA strand is the template. In <b>cycle 1 only the forward primer</b>, which reads like the mRNA, can pair with it; from cycle 2 both primers work and the count doubles.</> },
];

const PRIMING = {
  dt: { name: 'Oligo(dT)', sites: [[300, 340]], label: 'TTTTT' },
  hex: { name: 'Random hexamers', sites: [[96, 116], [176, 196], [256, 276]], label: 'N₆' },
  gsp: { name: 'Gene-specific', sites: [[196, 232]], label: 'GSP' },
};

function Diagram({ step, priming, reduced }) {
  const P = PRIMING[priming];
  const yR = 70;
  const yC = 86;
  const annealed = step >= 1;
  const ext = step === 2 ? 0.55 : step >= 3 ? 1 : 0;
  const faded = step === 4;
  const tr = reduced ? 'none' : 'opacity 0.4s';
  // Each primer site extends leftwards until the previous site (or the RNA's 5′ end).
  const segs = P.sites.map(([a], i) => {
    const stop = i === 0 ? 30 : P.sites[i - 1][1];
    const full = a - stop;
    return { x: a - full * ext, w: full * ext, a, stop, full };
  });
  const dashTr = reduced ? 'none' : 'stroke-dashoffset 0.6s ease';
  return (
    <svg viewBox="0 0 360 200" role="img" aria-label="Reverse transcription: an RNA template, a primer, and the growing cDNA strand">
      <text x="30" y="52" fontSize="10" fill="#5A6470">mRNA 5′</text>
      <text x="300" y="52" fontSize="10" fill="#5A6470" textAnchor="end">3′</text>
      <g opacity={faded ? 0.3 : 1} style={{ transition: tr }}>
        <circle cx="30" cy={yR} r="5" fill={RNA} />
        {step === 0 ? (
          <path d={`M30 ${yR}H150c5-20 15-28 20-28s15 8 20 28H300`} fill="none" stroke={RNA} strokeWidth="4" strokeLinecap="round" />
        ) : (
          <line x1="30" x2="300" y1={yR} y2={yR} stroke={RNA} strokeWidth="4" strokeLinecap="round" strokeDasharray={faded ? '4 5' : undefined} />
        )}
        <text x="322" y={yR + 4} fontSize="11" fontFamily="ui-monospace,Menlo,monospace" fontWeight="700" fill={RNA} textAnchor="middle">AAAAA</text>
      </g>
      {/* base-pair ticks under the copied region */}
      {ext > 0 && segs.map((g, i) => (
        <g key={i} opacity="0.7">
          {Array.from({ length: Math.floor(g.w / 10) }, (_, k) => <line key={k} x1={g.x + 5 + k * 10} x2={g.x + 5 + k * 10} y1={yR + 3} y2={yC - 3} stroke="#C9D0D8" strokeWidth="2" />)}
        </g>
      ))}
      {/* cDNA: a dashed line revealed from the primer leftwards, so the growth animates reliably */}
      {ext > 0 && segs.map((g, i) => (
        <line key={i} x1={g.a} x2={g.stop} y1={yC} y2={yC} stroke={CDNA} strokeWidth="4" strokeLinecap="round"
          strokeDasharray={g.full} strokeDashoffset={g.full * (1 - ext)} style={{ transition: dashTr }} />
      ))}
      {/* primer(s) */}
      <g transform={annealed ? undefined : 'translate(0,40)'}>
        {P.sites.map(([a, b], i) => (
          <g key={i}>
            <line x1={b} x2={a + 6} y1={yC} y2={yC} stroke={PRIMER} strokeWidth="5" strokeLinecap="round" />
            <path d={`M${a + 8} ${yC - 5}l-8 5 8 5z`} fill={PRIMER} />
            {i === P.sites.length - 1 && <text x={b} y={yC + 16} fontSize="9" fill={PRIMER} textAnchor="end">{P.label} 5′</text>}
          </g>
        ))}
      </g>
      {/* enzyme at the growing 3′ end of each strand */}
      {step >= 2 && step <= 3 && segs.map((g, i) => (
        <g key={i} transform={`translate(${g.x - 2},${yC + 10})`} style={{ transition: tr }}>
          <path d="M-9 0c0-8 5-12 10-12s10 4 10 12c0 3-2 5-2 8s3 5-2 6c-4 1-16 0-16-6 0-3 0-5 0-8z" fill={CDNA} />
          <circle cx="1" cy="0" r="2" fill="#fff" opacity=".8" />
        </g>
      ))}
      {step >= 3 && <text x="30" y={yC + 30} fontSize="10" fill="#5A6470">cDNA 3′</text>}
      {step >= 3 && <text x={P.sites[P.sites.length - 1][1]} y={yC + 30} fontSize="10" fill="#5A6470" textAnchor="end">5′</text>}
      {/* step 4: forward primer lands on the cDNA */}
      {step === 4 && (
        <g>
          <line x1="90" x2="126" y1={yC + 14} y2={yC + 14} stroke={FWD} strokeWidth="5" strokeLinecap="round" />
          <path d="M124 100l8 5-8 5z" fill={FWD} />
          <text x="90" y={yC + 42} fontSize="9" fill={FWD} fontWeight="600">fwd primer (sense)</text>
          <text x="90" y={yC + 54} fontSize="9" fill={FWD}>the only primer with a template in cycle 1</text>
        </g>
      )}
      <text x="180" y="158" textAnchor="middle" fontSize="11" fill="#5A6470">
        {step === 0 && `${P.name} priming: primer free in solution, RNA folded`}
        {step === 1 && 'RNA opened by heat, primer paired at its site'}
        {step === 2 && 'enzyme extends the primer 5′→3′, leftwards along the RNA'}
        {step === 3 && 'first-strand cDNA paired with its RNA template'}
        {step === 4 && 'RNA no longer needed; the cDNA strand is the PCR template'}
      </text>
      <g fontSize="9" fill="#5A6470">
        <rect x="30" y="172" width="14" height="4" rx="2" fill={RNA} /><text x="48" y="176">RNA</text>
        <rect x="84" y="172" width="14" height="4" rx="2" fill={PRIMER} /><text x="102" y="176">RT primer</text>
        <rect x="156" y="172" width="14" height="4" rx="2" fill={CDNA} /><text x="174" y="176">cDNA</text>
        <circle cx="222" cy="174" r="4" fill={CDNA} /><text x="230" y="176">reverse transcriptase</text>
      </g>
    </svg>
  );
}

const COMPARE = [
  ['Pairs with', 'the poly(A) tail of every mRNA', 'anywhere, on every RNA species', 'one site on one transcript'],
  ['Good for', 'mRNA-only cDNA; assays near the 3′ end; the usual default', 'degraded or non-polyadenylated RNA; assays near the 5′ end; rRNA/viral targets', 'one target at maximum sensitivity; one-step kits'],
  ['Watch out', '3′ bias: sites more than 2–3 kb from the tail, or in partly degraded RNA, give less cDNA; misses histone and many bacterial mRNAs', 'most of the cDNA is rRNA; needs a 25 °C annealing step; yield per transcript varies', 'a separate RT for every target; no reference gene from the same tube unless multiplexed'],
  ['Typical', '1 µL of 50 µM oligo(dT)18', '50–250 ng hexamers per reaction', '2 pmol of the reverse PCR primer'],
];

export default function ReverseTranscription({ active }) {
  const reduced = useReducedMotion();
  const [step, setStep] = useState(0);
  const [priming, setPriming] = useState('dt');
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !active) return undefined;
    const id = setInterval(() => setStep((v) => (v + 1) % STEPS.length), 2800);
    return () => clearInterval(id);
  }, [playing, active]);
  const st = STEPS[step];
  return (
    <>
      <h1>One strand of RNA becomes one strand of DNA.</h1>
      <p className="lede">Step through the reaction. The <b>primer</b> decides where copying starts, the <b>enzyme</b> decides how hot you can run it, and the <b>tube without enzyme</b> decides whether you can trust the result.</p>
      <div className="panel">
        <Diagram step={step} priming={priming} reduced={reduced} />
        <div className="controls">
          <button className="btn" onClick={() => { setPlaying(false); setStep((v) => Math.max(0, v - 1)); }} disabled={step === 0}>Back</button>
          <button className="btn primary" onClick={() => { setPlaying(false); setStep((v) => Math.min(STEPS.length - 1, v + 1)); }} disabled={step === STEPS.length - 1}>Next step</button>
          <button className="btn" onClick={() => setPlaying((p) => !p)}>{playing ? 'Pause' : 'Play through'}</button>
          <div className="seg" role="group" aria-label="Priming strategy">
            {Object.entries(PRIMING).map(([k, v]) => <button key={k} className={k === priming ? 'on' : ''} onClick={() => setPriming(k)}>{v.name}</button>)}
          </div>
        </div>
        <div className={s.steps} role="group" aria-label="Steps">
          {STEPS.map((x, i) => <button key={i} className={`${s.dot} ${i === step ? s.cur : ''} ${i < step ? s.done : ''}`} onClick={() => { setPlaying(false); setStep(i); }} aria-current={i === step ? 'step' : undefined}>{i + 1}</button>)}
        </div>
      </div>
      <div className={s.box}>
        <h3>{step + 1}. {st.title}</h3>
        <p>{st.body}</p>
      </div>
      <h2>Choosing the RT primer</h2>
      <div className="tablewrap">
        <table className={s.compare}>
          <thead><tr><th /><th>Oligo(dT)</th><th>Random hexamers</th><th>Gene-specific</th></tr></thead>
          <tbody>{COMPARE.map(([k, a, b, c]) => <tr key={k}><td><b>{k}</b></td><td data-label="Oligo(dT)">{a}</td><td data-label="Random hexamers">{b}</td><td data-label="Gene-specific">{c}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="note">Many kits <b>mix oligo(dT) and hexamers</b>, which covers both ends of long transcripts and is the sensible default for gene-expression work. Whatever you choose, <b>use the same priming for every sample</b> you will compare.</p>
      <Details summary="Two-step or one-step">
        <svg viewBox="0 0 360 120" role="img" aria-label="Two-step versus one-step RT-PCR" style={{ maxWidth: 520 }}>
          <g fontSize="10" fill="#1B2430">
            <text x="8" y="14" fontWeight="600">Two-step</text>
            <rect x="8" y="22" width="70" height="30" rx="6" fill="#F8DED5" /><text x="43" y="41" textAnchor="middle">RNA + RT</text>
            <path d="M80 37h18" stroke="#5A6470" strokeWidth="1.5" markerEnd="url(#arr)" />
            <rect x="100" y="22" width="60" height="30" rx="6" fill="#D8E5F4" /><text x="130" y="41" textAnchor="middle">cDNA</text>
            <path d="M162 30l18-12M162 37h18M162 44l18 12" stroke="#5A6470" strokeWidth="1.5" fill="none" />
            <rect x="182" y="8" width="52" height="20" rx="5" fill="#F6E7C9" /><text x="208" y="22" textAnchor="middle">gene A</text>
            <rect x="182" y="28" width="52" height="20" rx="5" fill="#F6E7C9" /><text x="208" y="42" textAnchor="middle">gene B</text>
            <rect x="182" y="48" width="52" height="20" rx="5" fill="#F6E7C9" /><text x="208" y="62" textAnchor="middle">reference</text>
            <text x="244" y="41" fill="#5A6470">… any day, any gene</text>
            <text x="8" y="92" fontWeight="600">One-step</text>
            <rect x="8" y="100" width="152" height="18" rx="6" fill="#F8DED5" /><text x="84" y="113" textAnchor="middle">RNA + one-step mix + gene primers</text>
            <path d="M162 109h18" stroke="#5A6470" strokeWidth="1.5" />
            <rect x="182" y="100" width="52" height="18" rx="5" fill="#F6E7C9" /><text x="208" y="113" textAnchor="middle">one gene</text>
            <text x="244" y="113" fill="#5A6470">fewer steps, one target per tube</text>
          </g>
        </svg>
        <p><b>Two-step</b> separates the risky RNA work from the PCR: you make cDNA once, check it, store it, and <b>run many assays from it</b> with the same reference gene. <b>One-step</b> puts RNA straight into a combined mix; the RT runs as the first line of the cycler program with the PCR's own gene-specific primers. It is faster and has fewer contamination openings, which is why <b>diagnostic assays</b> use it, but each tube gives you one target and there is <b>no −RT control</b> unless you set one up separately.</p>
      </Details>
      <Details summary="How much RNA in, how much cDNA into the PCR">
        <p><b>10 pg to 1 µg</b> of total RNA per 20 µL reaction; 0.5–1 µg is typical for expression work. Put the <b>same mass</b> into every sample's RT, because the RT is the step that varies most and equal input is the only thing that makes Cq values comparable. The cDNA yield is not measurable in practice, and the reaction contains buffer, DTT, RNA and enzyme that all inhibit PCR, so use <b>1–2 µL per PCR</b> and keep it at or below <b>10 % of the PCR volume</b>. For qPCR, <b>dilute the RT reaction 1:5 to 1:10</b> first; it costs nothing in Cq terms compared with the inhibition it avoids.</p>
      </Details>
      <Details summary="The −RT control, and why DNase is not enough">
        <p>Genomic DNA co-purifies with RNA and <b>carries the same sequences your primers target</b>. DNase I removes most of it; the <b>−RT tube shows what is left</b>: an identical reaction with water instead of enzyme, carried through the PCR alongside the sample. Any product there <b>came from DNA, not RNA</b>. A common rule of thumb is to accept a −RT signal that is <b>more than 5 cycles later</b> than the sample (under 3 % of it). Primers that span an exon–exon junction cannot amplify intact genomic DNA, which helps, but <b>processed pseudogenes</b> and retained introns mean the control still earns its place.</p>
      </Details>
      <Details summary="Storing cDNA">
        <p>cDNA is DNA: <b>−20 °C for months</b>, 4 °C for a week. <b>Aliquot</b> a diluted working stock so the undiluted reaction is not freeze-thawed for every plate. Label with RNA sample, date, input mass and priming; these are the things you will need to report.</p>
      </Details>
      <Videos topics={['rt']} label="Watch: the RT reaction, mechanism and bench" />
      <Sources keys={['tf_rt', 'neb_rt', 'neb_luna', 'stahlberg', 'kotewicz', 'fleige', 'miqe', 'nolan']} />
    </>
  );
}
