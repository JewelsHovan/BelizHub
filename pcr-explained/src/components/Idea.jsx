import { useState } from 'react';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import s from './Idea.module.css';

// Stage index → tab index in App: RNA & reagents = 1, cDNA synthesis = 2, PCR cycle = 3, Readout = 4.
const STAGES = [
  { k: 'rna', label: 'Extract RNA', time: '30–60 min', tab: 1, color: 'var(--rev)',
    body: <>Lyse cells or tissue in a chaotropic buffer, bind RNA to a column or precipitate it, wash, elute in RNase-free water. <b>Treat with DNase</b>, then measure concentration and purity. Everything from here on assumes the RNA is <b>intact and free of genomic DNA</b>.</> },
  { k: 'rt', label: 'Reverse-transcribe', time: '15–60 min', tab: 2, color: 'var(--cool)',
    body: <>A primer anneals to the RNA and a reverse transcriptase extends it, writing a DNA copy (<b>cDNA</b>) of every transcript the primer reached. One reaction per sample, plus a matching tube with no enzyme: the <b>−RT control</b>. The cDNA is now an ordinary DNA template.</> },
  { k: 'pcr', label: 'Amplify', time: '1–2 h', tab: 3, color: 'var(--warm)',
    body: <>Two <b>gene-specific primers</b> pick one region of the cDNA. Denature, anneal, extend, <b>30–40 times</b>. Every product carries the primer sites, so the count doubles each cycle until reagents or re-annealing stop it.</> },
  { k: 'read', label: 'Read', time: '20 min or live', tab: 4, color: 'var(--ok)',
    body: <><b>Endpoint:</b> run 5 µL on an agarose gel and look for <b>one band of the expected size</b>, with nothing in the −RT and no-template lanes. <b>Real time:</b> a dye or probe reports product every cycle, and the cycle at which it crosses a threshold (<b>Cq</b>) tells you how much template you started with, relative to a reference gene.</> },
];

function StageIcon({ k }) {
  if (k === 'rna') return <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M4 20c6-10 12-10 18 0s12 10 16 0" fill="none" stroke="#B8336A" strokeWidth="3" strokeLinecap="round" /><text x="22" y="37" textAnchor="middle" fontFamily="ui-monospace,Menlo,monospace" fontSize="9" fontWeight="700" fill="#B8336A">AAAAA</text></svg>;
  if (k === 'rt') return <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M4 16c6-8 12-8 18 0s12 8 16 0" fill="none" stroke="#B8336A" strokeWidth="3" strokeLinecap="round" opacity=".5" /><path d="M6 30h32" stroke="#2F6FB5" strokeWidth="4" strokeLinecap="round" /><circle cx="32" cy="23" r="7" fill="#2F6FB5" /></svg>;
  if (k === 'pcr') return <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M6 12h32M6 22h32M6 32h32" stroke="#1B2430" strokeWidth="3" strokeLinecap="round" /><path d="M6 17h32M6 27h32M6 37h32" stroke="#7A8797" strokeWidth="3" strokeLinecap="round" /></svg>;
  return <svg viewBox="0 0 44 44" aria-hidden="true"><path d="M6 36C14 36 18 8 24 8s8 28 14 28" fill="none" stroke="#2E8B57" strokeWidth="3" strokeLinecap="round" /><path d="M6 24h32" stroke="#C98A1B" strokeWidth="2" strokeDasharray="3 3" /></svg>;
}

export default function Idea({ onGo }) {
  const [i, setI] = useState(1);
  const st = STAGES[i];
  return (
    <>
      <h1>Taq cannot read RNA. So make DNA first.</h1>
      <p className="lede"><b>Reverse transcriptase</b> reads an RNA template and writes a DNA copy, <b>cDNA</b>. From there it is ordinary PCR: two primers choose the region, the count <b>doubles each cycle</b>, and you read the result on a gel or, in real time, as fluorescence.</p>
      <div className="panel">
        <ol className={s.flow} aria-label="Workflow">
          {STAGES.map((x, j) => (
            <li key={x.k}>
              <button className={`${s.stage} ${j === i ? s.on : ''}`} style={{ '--c': x.color }} onClick={() => setI(j)} aria-current={j === i ? 'step' : undefined}>
                <StageIcon k={x.k} />
                <span className={s.lab}>{x.label}</span>
                <span className={s.time}>{x.time}</span>
              </button>
            </li>
          ))}
        </ol>
        <div className={s.body} style={{ '--c': st.color }}>
          <p>{st.body}</p>
          <button className="btn small" onClick={() => onGo?.(st.tab)}>Go to that section</button>
        </div>
      </div>
      <p><b>PCR needs a DNA template</b>; Taq and its relatives cannot copy RNA. Reverse transcriptase, the enzyme retroviruses use to turn their RNA genome into DNA, can. Temin and Baltimore found it independently in <b>1970</b> and shared the 1975 Nobel Prize for it. Paired with PCR from the late 1980s, it became the standard way to ask <b>how much of a particular mRNA</b> a sample contains.</p>
      <p><b>Two-step</b> is what most labs do: one reverse-transcription reaction per RNA sample makes cDNA, and that cDNA serves <b>many PCRs</b>, for several genes and the reference gene, on different days. <b>One-step</b> kits do both in a single tube with gene-specific primers: fewer pipetting steps, no cDNA to store, less flexibility. This app builds the <b>two-step protocol</b> and shows where one-step differs.</p>
      <p><b>Two ways to read.</b> Endpoint on a <b>gel</b> answers "is the transcript there, and which splice form?". <b>Real time</b> (RT-qPCR) answers "how much, compared with a control?" from the cycle at which fluorescence appears. The chemistry is the same; the machine and the primer-design constraints differ. The Readout and Protocol tabs cover both.</p>
      <p><b>What makes RT-PCR harder than PCR.</b> RNA is fragile and <b>RNases are everywhere</b>, including on your hands. <b>Genomic DNA</b> co-purifies with RNA and is a perfectly good template for your primers, so you need DNase treatment and a <b>−RT control</b>. And the RT step is the <b>least efficient, most variable step</b> in the chain, which is why every result is compared with a <b>reference gene</b> that went through the same RT.</p>
      <Details summary="What RT-PCR is used for">
        <p><b>Measuring gene expression</b> (is this gene up or down after treatment, in this tissue, in this mutant?), confirming RNA-seq or microarray hits, <b>detecting RNA viruses</b> (the SARS-CoV-2 diagnostic panels were RT-qPCR assays), checking <b>splice variants</b>, <b>cloning a coding sequence</b> from cDNA without its introns, and verifying that a knockdown or knockout actually removed the transcript.</p>
      </Details>
      <Details summary="Timeline in five lines">
        <p><b>1970:</b> Temin and Baltimore describe an RNA-dependent DNA polymerase in retrovirus particles, overturning the idea that information flows only from DNA to RNA. <b>1975:</b> Nobel Prize in Physiology or Medicine. <b>1988:</b> Kotewicz and colleagues engineer an <b>RNase H-deficient</b> M-MLV reverse transcriptase, the ancestor of most enzymes in use today, which makes longer cDNA because it no longer chews up its own template. <b>1990s:</b> real-time detection makes the reaction quantitative. <b>2009:</b> the <b>MIQE guidelines</b> set the minimum a published RT-qPCR experiment must report.</p>
      </Details>
      <Details summary="Endpoint or real time: which do you need?">
        <ul>
          <li><b>Gel</b> when the question is <b>yes/no or which size</b>: presence of a transcript, a splice form, an insert for cloning. Amplicons <b>100–500 bp</b>, 30–35 cycles, 5 µL on a 1.5–2 % gel.</li>
          <li><b>Real time</b> when the question is <b>how much</b>: fold-change after treatment, viral load, knockdown efficiency. Amplicons <b>70–200 bp</b>, 40 cycles, <b>technical triplicates</b>, a reference gene, and a plate map before you touch a pipette.</li>
          <li>Both need the same RNA care, the same RT, and the same two controls: <b>−RT and no template</b>.</li>
        </ul>
      </Details>
      <Videos topics={['rt', 'pcr']} label="Watch: the reaction in motion" />
      <Sources keys={['temin', 'baltimore', 'nobel1975', 'kotewicz', 'stahlberg', 'miqe', 'tf_rt', 'tf_rtqpcr', 'cdc_sars']} />
    </>
  );
}
