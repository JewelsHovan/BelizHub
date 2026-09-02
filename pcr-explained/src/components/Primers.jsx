import { useContext, useEffect, useMemo, useState } from 'react';
import { PrimerContext } from '../context.js';
import { analyze, clean, pairAnalysis, verdicts, locatePrimers } from '../lib/thermo.js';
import { useLocalState } from '../hooks/useLocalState.js';
import Chip from './Chip.jsx';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import s from './Primers.module.css';

const EXAMPLE = {
  f: 'TGCCATGCACCAGGTTGTTG',
  r: 'ATGTGGCACACTGCGTTGTC',
  // Synthetic demo transcript (not a real gene): 40 nt, the forward site, 150 nt, the reverse site, 30 nt.
  tpl: 'GCTAAAGACAATTACATAACATACACGTCAGCACGAAACTTGCCATGCACCAGGTTGTTGTGTTGGCCCAGTGTGAATCGCTTAAGGGTTAAGTAAGTGTGATGCATACGCCTTTACTTGCTGTGTCCACCCCATCGGACTGGCATTTTTATTACACTCAGAAACAGAACTCGGGTAATTTTGACAGGTCACGCAGAGGCGCGCCCTCCTGACAACGCAGTGTGCCACATGAAGTGCGTGGACACTCGCTATGAATCTCT',
};

const RULES = {
  qpcr: [
    ['Span an exon–exon junction', <>One primer <b>sits across the join between two exons</b>, so it cannot pair with genomic DNA where an intron interrupts that sequence. If that is impossible, <b>flank an intron of at least 1 kb</b>: genomic product is then too long to amplify in a 30 s extension. Pseudogenes lack introns, so <b>keep the −RT control</b> regardless.</>],
    ['Amplicon 70–200 bp', <>Short products amplify at <b>near-100 % efficiency</b> in a combined 60 °C anneal/extend step and <b>survive partly degraded RNA</b>. Above 200 bp efficiency drops and the melt peak broadens.</>],
    ['Tm 58–62 °C, pair within 2 °C', <>Every qPCR assay <b>runs at 60 °C</b> so all assays share one plate and one program. Both primers must be fully bound at 60 °C and not much below.</>],
    ['GC 40–60 %, no runs ≥4, 3′ end ends in 1–2 G/C but not GGG/CCC', <>The usual rules; the 3′ clamp matters more here because <b>mispriming products fluoresce exactly like the real one</b> with SYBR.</>],
    ['No 3′ complementarity, self or cross', <><b>Primer-dimer is the main artefact</b> of SYBR assays: it forms in the NTC, shows as a <b>low-temperature melt peak</b> and inflates signal in low-template wells.</>],
    ['Avoid SNPs and repeats; check splice variants', <>A <b>SNP under the 3′ end</b> abolishes amplification in some samples. Decide whether the amplicon should be <b>shared by all isoforms or specific to one</b>, and check the alignment.</>],
    ['Validate before you trust it', <>A 5-point standard curve with <b>efficiency 90–110 %</b> and R² > 0.98, a <b>single melt peak</b>, no signal in NTC and −RT, and the product once on a gel or sequenced.</>],
    ['Pick reference genes on evidence', <>Test <b>two or three candidates</b> (GAPDH, ACTB, HPRT1, TBP, RPLP0 …) across your actual conditions; use geNorm or NormFinder to choose the stable ones. A reference that <b>moves with treatment</b> silently rewrites your result.</>],
    ['Start from validated pairs', <><b>PrimerBank</b> lists tested human and mouse assays with the exact sequences. <b>Primer-BLAST</b> designs new ones with the exon-junction option and checks specificity against the transcriptome in one go.</>],
  ],
  gel: [
    ['Flank an intron, or span a junction', <>On a gel a genomic product of a different size is itself a control: a <b>larger band in the −RT lane</b> means DNA got through. Junction-spanning primers give no genomic product at all.</>],
    ['Amplicon 100–500 bp', <>Big enough to <b>see and size cleanly</b>, short enough to be efficient and tolerant of partly degraded RNA; go longer only for cloning a whole coding sequence.</>],
    ['Tm 55–65 °C, pair within 5 °C', <>Both primers work at one annealing temperature; <b>the cooler primer sets it</b>.</>],
    ['GC 40–60 %, no runs ≥4, 1–2 G/C in the last five', <>The polymerase <b>starts at the 3′ end</b>; a G/C clamp keeps it seated without making mispriming stable.</>],
    ['No 3′ complementarity, no 3′ hairpins', <><b>Primer-dimer</b> soaks up enzyme and primer every cycle and shows as a <b>smear near 50 bp</b>.</>],
    ['Check specificity and isoforms', <><b>Primer-BLAST</b> against the transcriptome; decide whether the band should be common to all splice forms or specific to one.</>],
    ['Include the controls in the lane plan', <>Sample, <b>−RT, no-template</b>, and a positive control if you have one; the gel is only interpretable with the empty lanes present.</>],
  ],
};

function PrimerCard({ label, A, mode }) {
  if (A.len < 8) {
    return <div className={s.card}><div className={s.title}>{label}</div><div className="note">Enter at least 8 bases (A, C, G, T).</div></div>;
  }
  const rows = verdicts(A).map(([k, v, status]) => {
    if (mode === 'qpcr' && k.startsWith('Tm')) return [k, v, A.tm >= 58 && A.tm <= 62 ? 'ok' : 'warn'];
    return [k, v, status];
  });
  return (
    <div className={s.card}>
      <div className={s.title}>{label}</div>
      {rows.map(([k, v, status]) => (
        <div className={s.row} key={k}><span>{k}</span><span><Chip status={status}>{v}</Chip></span></div>
      ))}
    </div>
  );
}

function ampliconVerdict(len, mode) {
  if (mode === 'qpcr') return len >= 70 && len <= 200 ? 'ok' : len <= 300 ? 'warn' : 'bad';
  return len >= 100 && len <= 500 ? 'ok' : len <= 1500 ? 'warn' : 'bad';
}

function Map({ loc, F, R }) {
  const L = loc.len;
  const x = (p) => 10 + (p / L) * 340;
  return (
    <svg viewBox="0 0 360 60" role="img" aria-label="Positions of the primers on the transcript">
      <line x1="10" x2="350" y1="30" y2="30" stroke="#B8336A" strokeWidth="4" strokeLinecap="round" />
      <text x="10" y="18" fontSize="9" fill="#5A6470">5′</text><text x="350" y="18" fontSize="9" fill="#5A6470" textAnchor="end">3′ ({L} nt)</text>
      {loc.amplicon && <rect x={x(loc.fwd)} y="24" width={x(loc.revEnd) - x(loc.fwd)} height="12" fill="#F6E7C9" />}
      {loc.fwd !== null && <g><line x1={x(loc.fwd)} x2={x(loc.fwd + F.length)} y1="22" y2="22" stroke="#6A4C9C" strokeWidth="4" strokeLinecap="round" /><text x={x(loc.fwd)} y="14" fontSize="9" fill="#6A4C9C">fwd {loc.fwd + 1}</text></g>}
      {loc.rev !== null && <g><line x1={x(loc.revEnd)} x2={x(loc.rev)} y1="38" y2="38" stroke="#B8336A" strokeWidth="4" strokeLinecap="round" /><text x={x(loc.revEnd)} y="52" fontSize="9" fill="#B8336A" textAnchor="end">rev {loc.revEnd}</text></g>}
      {loc.amplicon && <text x={(x(loc.fwd) + x(loc.revEnd)) / 2} y="52" fontSize="9" fill="#8a5a08" textAnchor="middle">{loc.amplicon} bp</text>}
    </svg>
  );
}

export default function Primers() {
  const [st, setSt] = useLocalState('primers', { f: '', r: '', tpl: '', mode: 'qpcr' });
  const { f, r, tpl, mode } = st;
  const set = (k) => (e) => setSt((p) => ({ ...p, [k]: e.target.value }));
  const { setPrimerTm, setAmplicon, amplicon } = useContext(PrimerContext);
  const [msg, setMsg] = useState('');
  const A = useMemo(() => analyze(clean(f)), [f]);
  const B = useMemo(() => analyze(clean(r)), [r]);
  const pair = useMemo(() => pairAnalysis(A, B), [A, B]);
  const loc = useMemo(() => locatePrimers(tpl, f, r), [tpl, f, r]);
  useEffect(() => { setPrimerTm(pair ? { f: A.tm, r: B.tm } : null); }, [pair, A.tm, B.tm, setPrimerTm]);
  const dTmMax = mode === 'qpcr' ? 2 : 5;
  const loadExample = () => { setSt((p) => ({ ...p, ...EXAMPLE })); setMsg('Example pair and a synthetic demo transcript loaded'); };
  const clear = () => { setSt((p) => ({ ...p, f: '', r: '', tpl: '' })); setAmplicon(null); setMsg(''); };
  return (
    <>
      <h1>Primers decide everything. Here they must also ignore genomic DNA.</h1>
      <p className="lede">Polymerase only extends a 3′-OH that is paired to a template, so <b>the primers choose what is copied</b> and how specifically. For RT-PCR they have one more job: to amplify <b>cDNA and not the genomic copy</b> of the same gene.</p>
      <div className="panel">
        <div className={s.modebar}>
          <span className="note">Designing for</span>
          <div className="seg" role="group" aria-label="Design target">
            <button className={mode === 'qpcr' ? 'on' : ''} onClick={() => setSt((p) => ({ ...p, mode: 'qpcr' }))}>Real-time qPCR</button>
            <button className={mode === 'gel' ? 'on' : ''} onClick={() => setSt((p) => ({ ...p, mode: 'gel' }))}>Endpoint gel</button>
          </div>
        </div>
        <div className="form">
          <label className="wide">Forward primer, 5′→3′ (same sequence as the mRNA)<input className="mono" type="text" value={f} placeholder="e.g. GAAGGTGAAGGTCGGAGTC" spellCheck={false} autoComplete="off" onChange={set('f')} /></label>
          <label className="wide">Reverse primer, 5′→3′ (reverse complement of the mRNA)<input className="mono" type="text" value={r} placeholder="e.g. GAAGATGGTGATGGGATTTC" spellCheck={false} autoComplete="off" onChange={set('r')} /></label>
        </div>
        <div className="controls">
          <button className="btn small" onClick={loadExample}>Load an example pair</button>
          <button className="btn small" onClick={clear} disabled={!f && !r && !tpl}>Clear</button>
          <span className="readout">{msg}</span>
        </div>
        <div className={s.res}><PrimerCard label="Forward" A={A} mode={mode} /><PrimerCard label="Reverse" A={B} mode={mode} /></div>
        {pair && (
          <div className="stat">
            <span>ΔTm <Chip status={pair.dTm <= dTmMax ? 'ok' : 'warn'}>{pair.dTm.toFixed(1)} °C</Chip> (≤ {dTmMax} for {mode === 'qpcr' ? 'qPCR' : 'a gel'})</span>
            <span>3′ cross-dimer <Chip status={pair.cross >= 5 ? 'bad' : pair.cross >= 4 ? 'warn' : 'ok'}>{pair.cross ? `${pair.cross} nt` : 'none'}</Chip></span>
            {mode === 'qpcr'
              ? <span>anneal/extend at <b>60 °C</b>{pair.lo < 58 ? ', or 58 °C for this cooler primer' : ''}</span>
              : <span>Ta for Taq: <b>{pair.taHigh.toFixed(0)}–{pair.taLow.toFixed(0)} °C</b> (cooler primer − 3 to 5)</span>}
          </div>
        )}
        <p className="note" style={{ marginTop: 10 }}>Tm uses nearest-neighbour thermodynamics (SantaLucia 1998) at 0.5 µM primer and 50 mM monovalent salt, without Mg²⁺, so it <b>runs 2–5 °C below vendor calculators</b> that include the buffer. Use it to <b>compare primers with each other</b>; take the final annealing temperature from the enzyme maker's calculator. Dimer and hairpin flags are sequence heuristics, not ΔG.</p>
      </div>

      <h2>Check them against your transcript</h2>
      <p>Paste the mRNA or coding sequence (<b>sense strand, 5′→3′</b>, from NCBI RefSeq or Ensembl). The check finds where each primer binds, tells you the <b>amplicon length</b>, and catches the classic mistake: a <b>reverse primer written on the wrong strand</b>.</p>
      <div className="panel">
        <label className={s.tpl}>Transcript sequence, 5′→3′
          <textarea value={tpl} onChange={set('tpl')} rows={5} spellCheck={false} placeholder="ACGT… (whitespace, numbers and FASTA headers are ignored)" />
        </label>
        {loc === null && <p className="note">Needs both primers (≥ 8 nt) and at least 20 nt of template.</p>}
        {loc && (
          <>
            <Map loc={loc} F={clean(f)} R={clean(r)} />
            {loc.issues.length > 0 && <ul className={s.issues}>{loc.issues.map((x) => <li key={x}><Chip status="bad">check</Chip> {x}</li>)}</ul>}
            {loc.amplicon && (
              <div className="stat">
                <span>forward at <b>{loc.fwd + 1}–{loc.fwd + clean(f).length}</b></span>
                <span>reverse at <b>{loc.rev + 1}–{loc.revEnd}</b></span>
                <span>amplicon <Chip status={ampliconVerdict(loc.amplicon, mode)}>{loc.amplicon} bp</Chip> ({mode === 'qpcr' ? '70–200 for qPCR' : '100–500 for a gel'})</span>
                <button className="btn small" onClick={() => { setAmplicon(loc.amplicon); setMsg(`${loc.amplicon} bp sent to the Protocol tab`); }}>{amplicon === loc.amplicon ? 'Sent to Protocol' : 'Use in the Protocol tab'}</button>
              </div>
            )}
          </>
        )}
        <p className="note" style={{ marginTop: 8 }}>Exact matches only. This does not check specificity against the rest of the genome, or whether the amplicon crosses an exon junction; Primer-BLAST does both.</p>
      </div>

      <h2>Rules and the reason for each{mode === 'qpcr' ? ', real-time' : ', endpoint'}</h2>
      <ul className={s.ruleset}>{RULES[mode].map(([rule, why]) => <li key={rule}><b>{rule}</b><span>{why}</span></li>)}</ul>
      <Details summary="Primer-BLAST settings for RT-(q)PCR">
        <ul>
          <li>Template: the RefSeq mRNA accession (NM_…), not a genomic region.</li>
          <li>PCR product size: 70–200 (qPCR) or 100–500 (gel). Primer melting temperatures: 58–62, max difference 2.</li>
          <li>Exon/intron selection: <b>"Primer must span an exon-exon junction"</b>, or "primer pair must be separated by at least one intron" with a minimum intron length of 1000.</li>
          <li>Specificity check: database "RefSeq mRNA", organism set to yours, so off-target hits in other transcripts are reported.</li>
          <li>Then paste the pair back here and into the transcript check.</li>
        </ul>
      </Details>
      <Details summary="Hydrolysis probes, in brief">
        <p>A probe is a <b>third oligo</b> that binds between the primers, with a fluorophore at the 5′ end and a quencher at the 3′ end. During extension the polymerase's 5′→3′ exonuclease chews it up, separating the two, and <b>fluorescence rises only when this specific sequence was copied</b>. Design: <b>Tm 8–10 °C above the primers</b>, 15–30 nt, no G at the 5′ end (it quenches), more C than G, on the strand that gives that. Probes cost more and take longer to design but <b>tolerate primer-dimer</b>, allow multiplexing by colour, and need no melt curve.</p>
      </Details>
      <Details summary="How Tm is calculated here">
        <p>Nearest-neighbour model: every adjacent base pair contributes an enthalpy and entropy term (ΔH°, ΔS°) from SantaLucia's unified table, plus an initiation term for each end. Tm = ΔH° / (ΔS° + R ln(C/4)) − 273.15, where C is primer concentration and the /4 applies to two different strands. Salt is handled by ΔS° + 0.368 × (N − 1) × ln[Na⁺]. Mg²⁺ is not included, which is why vendor calculators for a specific buffer read higher.</p>
      </Details>
      <Videos topics={['primers']} label="Watch: designing an exon-junction assay" />
      <Sources keys={['pblast', 'primerbank', 'santalucia', 'idt', 'neb_tm', 'miqe', 'taylor', 'vandesompele', 'addgene_primer', 'primer3']} />
    </>
  );
}
