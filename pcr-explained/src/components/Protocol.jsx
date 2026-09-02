import { useContext, useMemo, useState } from 'react';
import { PrimerContext } from '../context.js';
import { DEFAULT_COMPONENTS, SYBR_COMPONENTS, PROBE_COMPONENTS, DEFAULT_SETTINGS, QPCR_PRESET, GEL_PRESET, READOUTS, isRealTime, masterMix, cyclingProgram, benchSteps, protocolText } from '../lib/protocol.js';
import { RT_ENZYMES, RT_PRIMING, DEFAULT_RT, rtMix, rtProgram, rtText } from '../lib/rt.js';
import { plateCount } from '../lib/qpcr.js';
import { fmtV, mmss } from '../lib/units.js';
import { useLocalState, clearLocalState } from '../hooks/useLocalState.js';
import Chip from './Chip.jsx';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import Videos from './Videos.jsx';
import s from './Protocol.module.css';

const COMPS = { gel: DEFAULT_COMPONENTS, sybr: SYBR_COMPONENTS, probe: PROBE_COMPONENTS };
const DEFAULT_PLAN = { samples: 6, targets: 2, replicates: 3, standards: 0 };

function NumField({ label, k, settings, set, ...rest }) {
  return <label>{label}<input type="number" value={settings[k]} onChange={(e) => set(k, e.target.value)} {...rest} /></label>;
}

function ProgramTable({ steps, label }) {
  return (
    <div className="tablewrap">
      <table aria-label={label}>
        <thead><tr><th>Step</th><th className="num">°C</th><th className="num">Time</th><th>Why</th></tr></thead>
        <tbody>
          {steps.map((st) => <tr key={st.name}><td>{st.name}</td><td className="num">{st.T}</td><td className="num">{st.s === null ? 'hold' : mmss(st.s)}</td><td className="note">{st.why}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Steps({ list }) {
  return (
    <div>
      {list.map(([action, why], i) => (
        <div className={s.step} key={i}><div className={s.num}>{i + 1}</div><div>{action}<div className={s.why}>{why}</div></div></div>
      ))}
    </div>
  );
}

function rtBenchSteps(rt, mix, program) {
  const L = [];
  if (rt.dnase) L.push(['Treat each RNA sample with DNase I (about 1 U per µg RNA, 15–30 min at room temperature or 37 °C), then inactivate as the kit says: EDTA plus 65–75 °C for 10 min, or the inactivation resin.', 'Genomic DNA in the prep is a template for your PCR primers. EDTA chelates the Mg²⁺ before the heat step, because Mg²⁺ at 70 °C would hydrolyse the RNA you are trying to keep.']);
  L.push(['Measure every RNA (A260, A260/280, A260/230) and dilute so that the same mass goes into each RT. Keep everything on ice, gloves on, RNase-free tips and tubes.', 'Equal input is what makes Cq values comparable between samples; the RT step is the least reproducible in the chain, so do not let the input vary as well.']);
  if (program.oneStep) {
    L.push(['Skip the separate RT. Add RNA directly to the one-step master mix in Stage B; 10 pg–100 ng per reaction is the usual range.', 'The one-step mix contains the reverse transcriptase; the RT runs as the first line of the cycler program with the gene-specific primers as RT primers.']);
    L.push(['For a −RT control, run the same RNA in a mix without the RT enzyme, or in a plain qPCR mix.', 'It is the only way to know that signal came from RNA rather than genomic DNA.']);
    return L;
  }
  L.push([`Mix 1, one tube per sample${mix.nMinus ? ' and one −RT tube per sample' : ''}, on ice: ${fmtV(mix.rnaVol)} µL RNA (${mix.rnaNg} ng), ${mix.mix1.map((c) => `${fmtV(c.vol)} µL ${c.name.toLowerCase()}`).join(', ')}, water to ${fmtV(mix.mix1Target)} µL.`, 'Only the things that survive 65 °C go in now. The primer and dNTPs are with the RNA when it is opened up, so annealing happens as it cools.']);
  L.push(['65 °C for 5 min, then straight onto ice for at least 1 min. Spin briefly.', 'Melts RNA secondary structure; snap-cooling stops it re-forming before the primer has paired.']);
  L.push([`Prepare mix 2 for ${mix.nEffPlus.toFixed(1)} reactions on ice: ${mix.mix2.map((c) => `${fmtV(c.vol * mix.nEffPlus)} µL ${c.name}`).join(', ')}.${mix.nMinus ? ` Prepare the −RT mix for ${mix.nEffMinus.toFixed(1)} reactions the same way with ${fmtV(mix.mix2[3].vol * mix.nEffMinus)} µL water in place of the enzyme.` : ''} Add ${fmtV(mix.mix2Total)} µL to each tube and mix by pipetting.`, 'Enzyme last, never vortexed. The −RT tube gets everything except the reverse transcriptase, so any product it later gives came from DNA.']);
  L.push([`Run the RT program: ${program.steps.filter((x) => x.s !== null).map((x) => `${x.T} °C ${mmss(x.s)}`).join(', ')}.`, 'The annealing step matters for random hexamers; the inactivation step matters for everything after, because live RT in the PCR makes artefacts.']);
  L.push(['Dilute the cDNA 1:5 to 1:10 in water for qPCR (use it neat for a gel), aliquot, label with sample, date, input mass and priming, and store at −20 °C.', 'Dilution avoids inhibition by RT buffer and RNA in the PCR; the label is what MIQE will ask you for.']);
  return L;
}

export default function Protocol() {
  const [rt, setRt] = useLocalState('rt', DEFAULT_RT);
  const [settings, setSettings] = useLocalState('pcr', DEFAULT_SETTINGS);
  const [comps, setComps] = useLocalState('pcr-comps', COMPS);
  const [plan, setPlan] = useLocalState('plan', DEFAULT_PLAN);
  const [msg, setMsg] = useState('');
  const { primerTm, amplicon } = useContext(PrimerContext);
  const readout = settings.readout || 'gel';
  const realTime = isRealTime(readout);
  const components = comps[readout] || COMPS[readout];

  const setR = (k, v) => setRt((p) => ({ ...p, [k]: v }));
  const set = (k, v) => setSettings((p) => ({ ...p, [k]: v }));
  const setP = (k, v) => setPlan((p) => ({ ...p, [k]: v }));
  const setComp = (id, k, v) => setComps((prev) => ({ ...prev, [readout]: (prev[readout] || COMPS[readout]).map((c) => (c.id === id ? { ...c, [k]: Math.max(0, parseFloat(v) || 0) } : c)) }));
  const setReadout = (r) => setSettings((p) => ({ ...p, readout: r, ...(isRealTime(r) === isRealTime(p.readout) ? {} : isRealTime(r) ? QPCR_PRESET : GEL_PRESET) }));

  const rmix = useMemo(() => rtMix(rt), [rt]);
  const rprog = useMemo(() => rtProgram(rt), [rt]);
  const rsteps = useMemo(() => rtBenchSteps(rt, rmix, rprog), [rt, rmix, rprog]);
  const mix = useMemo(() => masterMix(settings, components), [settings, components]);
  const program = useMemo(() => {
    const p = cyclingProgram(settings);
    if (rt.enzyme !== 'onestep') return p;
    const e = RT_ENZYMES.onestep;
    return { ...p, steps: [{ name: 'Reverse transcription (one-step)', T: e.rt.T, s: e.rt.s, why: 'The RT enzyme in the one-step mix copies RNA to cDNA using the gene-specific primers, before the polymerase is activated.' }, ...p.steps], total: p.total + e.rt.s };
  }, [settings, rt.enzyme]);
  const steps = useMemo(() => benchSteps(mix, program), [mix, program]);
  const wells = useMemo(() => plateCount(plan), [plan]);
  const perL = `per ${mix.V} µL`;
  const mixL = `mix for ${mix.nEff.toFixed(1)} rxn`;

  const pullTm = () => {
    if (primerTm) { set('tmf', primerTm.f.toFixed(1)); set('tmr', primerTm.r.toFixed(1)); setMsg('Tm updated from the Primers tab'); }
    else setMsg('Enter both primers on the Primers tab first');
  };
  const pullLen = () => { if (amplicon) { set('len', amplicon); setMsg(`Amplicon set to ${amplicon} bp`); } };
  const fullText = () => `${rtText(rt, rmix, rprog)}\n\n${protocolText(settings, mix, program)}${realTime ? `\n\nPlate: ${plan.samples} samples × ${plan.targets} targets × ${plan.replicates} replicates = ${wells.unknowns} wells, + ${wells.ntcWells} NTC + ${wells.minusRtWells} −RT${wells.stdWells ? ` + ${wells.stdWells} standards` : ''} = ${wells.total} wells.` : ''}`;
  const copy = async () => {
    const text = fullText();
    try { await navigator.clipboard.writeText(text); setMsg('Copied both stages'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setMsg('Copied both stages'); } catch { setMsg('Copy blocked; select the tables and copy manually'); }
      ta.remove();
    }
  };
  const print = () => { try { window.print(); } catch { setMsg('Printing is blocked here; open the page in a browser tab to print'); } };
  const reset = () => { setRt(DEFAULT_RT); setSettings(DEFAULT_SETTINGS); setComps(COMPS); setPlan(DEFAULT_PLAN); clearLocalState(); setMsg('Reset to defaults'); };

  return (
    <>
      <h1>Build both stages.</h1>
      <p className="lede"><b>Stage A</b> makes cDNA from every RNA sample, with a −RT control each. <b>Stage B</b> is the PCR, read on a gel or in real time. Everything you type here is <b>kept on this device</b>; copy the whole thing into your notebook when it is right.</p>

      <h2>Stage A: reverse transcription</h2>
      <div className="panel noprint">
        <div className="form">
          <NumField label="RNA samples" k="samples" settings={rt} set={setR} min="1" step="1" />
          <label>RT volume (µL)
            <select value={rt.V} onChange={(e) => setR('V', Number(e.target.value))}><option value={10}>10</option><option value={20}>20</option></select>
          </label>
          <NumField label="RNA per reaction (ng)" k="rnaNg" settings={rt} set={setR} min="0" step="50" />
          <NumField label="RNA concentration (ng/µL)" k="rnaConc" settings={rt} set={setR} min="0" step="10" />
          <label className="wide">Reverse transcriptase
            <select value={rt.enzyme} onChange={(e) => setR('enzyme', e.target.value)}>{Object.entries(RT_ENZYMES).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
          </label>
          <label>RT priming
            <select value={rt.priming} onChange={(e) => setR('priming', e.target.value)} disabled={rt.enzyme === 'onestep'}>{Object.entries(RT_PRIMING).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}</select>
          </label>
          <NumField label="Overage %" k="ov" settings={rt} set={setR} min="0" step="5" />
          <label className={s.chk}><input type="checkbox" checked={!!rt.minusRt} onChange={(e) => setR('minusRt', e.target.checked)} disabled={rt.enzyme === 'onestep'} /> −RT control for every sample</label>
          <label className={s.chk}><input type="checkbox" checked={!!rt.dnase} onChange={(e) => setR('dnase', e.target.checked)} /> DNase-treat the RNA first</label>
        </div>
        {!rprog.oneStep && (
          <div className="stat">
            <span>per sample: <b>{fmtV(rmix.rnaVol)} µL</b> RNA + <b>{fmtV(Math.max(0, rmix.water1))} µL</b> water (up to {fmtV(rmix.rnaMax)} µL RNA fits)</span>
            {rmix.rnaTooDilute && <span><Chip status="bad">too dilute</Chip> {fmtV(rmix.rnaVol)} µL does not fit; concentrate the RNA or lower the input</span>}
            {rmix.rnaHigh && <span><Chip status="warn">above 1 µg</Chip> most kits saturate; check the datasheet</span>}
            {rmix.rnaLow && <span><Chip status="warn">below 10 ng</Chip> fine for abundant transcripts, noisy for rare ones</span>}
          </div>
        )}
        {rprog.oneStep && <p className="note" style={{ marginTop: 10 }}>{RT_ENZYMES.onestep.note} Stage B below becomes the whole protocol; RNA goes in where cDNA would.</p>}
      </div>

      {!rprog.oneStep && (
        <>
          <h3>Mix 1, per reaction: RNA, primer, dNTPs</h3>
          <div className="tablewrap">
            <table className={s.mix}>
              <thead><tr><th>Component</th><th className="num">per {rmix.V} µL</th></tr></thead>
              <tbody>
                <tr><td>Total RNA<div className="note">{rmix.rnaNg} ng at {rmix.rnaConc} ng/µL; adjust per sample</div></td><td className="num" data-label="per reaction">{fmtV(rmix.rnaVol)}</td></tr>
                {rmix.mix1.map((c) => <tr key={c.id}><td>{c.name}<div className="note">{c.hint}</div></td><td className="num" data-label="per reaction">{fmtV(c.vol)}</td></tr>)}
                <tr><td>Nuclease-free water<div className="note">to {fmtV(rmix.mix1Target)} µL</div></td><td className="num" data-label="per reaction">{fmtV(Math.max(0, rmix.water1))}</td></tr>
              </tbody>
            </table>
          </div>
          <h3>Mix 2: buffer, DTT, inhibitor, enzyme</h3>
          <div className="tablewrap">
            <table className={s.mix}>
              <thead><tr><th>Component</th><th className="num">per {rmix.V} µL</th><th className="num">+RT mix, {rmix.nEffPlus.toFixed(1)} rxn</th>{rmix.nMinus > 0 && <th className="num">−RT mix, {rmix.nEffMinus.toFixed(1)} rxn</th>}</tr></thead>
              <tbody>
                {rmix.mix2.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}<div className="note">{c.hint}</div></td>
                    <td className="num" data-label="per reaction">{fmtV(c.vol)}</td>
                    <td className="num" data-label="+RT mix">{fmtV(c.vol * rmix.nEffPlus)}</td>
                    {rmix.nMinus > 0 && <td className="num" data-label="−RT mix">{c.id === 'rt' ? `${fmtV(c.vol * rmix.nEffMinus)} water` : fmtV(c.vol * rmix.nEffMinus)}</td>}
                  </tr>
                ))}
                <tr><td><b>Add to each tube</b></td><td className="num" data-label="per reaction"><b>{fmtV(rmix.mix2Total)}</b></td><td className="num" data-label="+RT mix"><b>{fmtV(rmix.mix2Total * rmix.nEffPlus)}</b></td>{rmix.nMinus > 0 && <td className="num" data-label="−RT mix"><b>{fmtV(rmix.mix2Total * rmix.nEffMinus)}</b></td>}</tr>
              </tbody>
            </table>
          </div>
          <h3>RT program</h3>
          <ProgramTable steps={rprog.steps} label="Reverse transcription program" />
          <div className="stat"><span>about <b>{Math.round(rprog.total / 60)} min</b> in the block, plus DNase and setup</span></div>
        </>
      )}
      <h3>Stage A steps, with the why</h3>
      <Steps list={rsteps} />

      <h2>Stage B: PCR</h2>
      <div className="panel noprint">
        <div className="form">
          <label className="wide">Readout
            <select value={readout} onChange={(e) => setReadout(e.target.value)}>{Object.entries(READOUTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          {realTime && (
            <div className={`wide ${s.planner}`}>
              <div className={s.plannerh}>Plate planner</div>
              <div className="form" style={{ margin: '6px 0' }}>
                <NumField label="Samples (cDNAs)" k="samples" settings={plan} set={setP} min="0" step="1" />
                <NumField label="Targets incl. reference" k="targets" settings={plan} set={setP} min="1" step="1" />
                <NumField label="Technical replicates" k="replicates" settings={plan} set={setP} min="1" max="4" step="1" />
                <NumField label="Standard-curve points" k="standards" settings={plan} set={setP} min="0" step="1" />
              </div>
              <div className="stat">
                <span><b>{wells.unknowns}</b> unknown wells</span><span><b>{wells.ntcWells}</b> NTC</span><span><b>{wells.minusRtWells}</b> −RT</span>{wells.stdWells > 0 && <span><b>{wells.stdWells}</b> standards</span>}
                <span>= <b>{wells.total}</b> wells{wells.plates96 > 1 ? ` (${wells.plates96} plates)` : ''}</span>
                <button className="btn small" onClick={() => { set('n', wells.total); setMsg(`Reactions set to ${wells.total}`); }}>Set reactions to {wells.total}</button>
              </div>
              <p className="note" style={{ margin: '6px 0 0' }}>One master mix per target; the reaction count below is the plate total, so scale each target's mix by its own share.</p>
            </div>
          )}
          <NumField label="Reactions (incl. controls)" k="n" settings={settings} set={set} min="1" step="1" />
          <label>Reaction volume (µL)
            <select value={settings.V} onChange={(e) => set('V', Number(e.target.value))}><option value={10}>10</option><option value={20}>20</option><option value={25}>25</option><option value={50}>50</option></select>
          </label>
          <NumField label="Overage %" k="ov" settings={settings} set={set} min="0" step="5" />
          <label>{rt.enzyme === 'onestep' ? 'RNA' : 'cDNA'} per reaction (µL)
            <input type="number" value={settings.tpl} min="0" step="0.5" onChange={(e) => set('tpl', e.target.value)} />
          </label>
          <label>Amplicon length (bp)
            <input type="number" value={settings.len} min="50" step="10" onChange={(e) => set('len', e.target.value)} />
          </label>
          <NumField label="Cycles" k="cyc" settings={settings} set={set} min="15" max="50" step="1" />
          <NumField label="Forward primer Tm (°C)" k="tmf" settings={settings} set={set} step="0.5" />
          <NumField label="Reverse primer Tm (°C)" k="tmr" settings={settings} set={set} step="0.5" />
          {!realTime && (
            <label className="wide">Polymerase
              <select value={settings.pol} onChange={(e) => set('pol', e.target.value)}>
                <option value="taq">Taq, standard buffer (1 min/kb, 72 °C)</option>
                <option value="hf">High-fidelity, proofreading (Q5, Phusion: 30 s/kb, 98 °C denaturation)</option>
              </select>
            </label>
          )}
        </div>
        <div className="controls">
          <button className="btn small" onClick={pullTm}>Use Tm from the Primers tab</button>
          <button className="btn small" onClick={pullLen} disabled={!amplicon}>{amplicon ? `Use ${amplicon} bp from the Primers tab` : 'No amplicon from the Primers tab yet'}</button>
          <button className="btn small" onClick={copy}>Copy protocol as text</button>
          <button className="btn small" onClick={print}>Print</button>
          <button className="btn small" onClick={reset}>Reset</button>
          <span className="readout">{msg}</span>
        </div>
        <div className="stat">
          <span>template is <b>{(100 * mix.tplFrac).toFixed(0)} %</b> of the reaction</span>
          {mix.tplHigh && <span><Chip status="warn">above 10 %</Chip> RT buffer, DTT and RNA inhibit the polymerase; dilute the cDNA instead</span>}
        </div>
      </div>

      <h3>Master mix</h3>
      <p className="note">Edit stock or final concentrations to match your reagents. Volumes update.</p>
      <div className="tablewrap">
        <table className={s.mix}>
          <thead>
            <tr><th>Component</th><th className="num">Stock</th><th className="num">Final</th><th className="num">{perL}</th><th className="num">{mixL}</th></tr>
          </thead>
          <tbody>
            <tr><td>Nuclease-free water<div className="note">to volume</div></td><td className="num" /><td className="num" /><td className="num" data-label={perL}>{fmtV(mix.water)}</td><td className="num" data-label={mixL}>{fmtV(mix.water * mix.nEff)}</td></tr>
            {mix.rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}<div className="note">{c.hint}</div></td>
                <td className="num" data-label="Stock"><input type="number" value={c.stock} step="any" min="0" onChange={(e) => setComp(c.id, 'stock', e.target.value)} /> {c.unit}</td>
                <td className="num" data-label="Final"><input type="number" value={c.final} step="any" min="0" onChange={(e) => setComp(c.id, 'final', e.target.value)} /> {c.unit}</td>
                <td className="num" data-label={perL}>{fmtV(c.vol)}</td>
                <td className="num" data-label={mixL}>{fmtV(c.vol * mix.nEff)}</td>
              </tr>
            ))}
            <tr><td>{rt.enzyme === 'onestep' ? 'RNA' : 'cDNA'}<div className="note">added to each tube or well, not to the mix</div></td><td className="num" /><td className="num" /><td className="num" data-label={perL}>{fmtV(mix.tpl)}</td><td className="num" data-label={mixL}>{fmtV(mix.tpl)} each</td></tr>
            <tr><td><b>Total</b></td><td /><td /><td className="num" data-label={perL}><b>{mix.V}</b></td><td className="num" data-label={mixL}><b>{fmtV(mix.perTube * mix.nEff)}</b> mix, {fmtV(mix.perTube)} per tube</td></tr>
          </tbody>
        </table>
      </div>
      <div className="stat">
        <span>{mix.n} reactions + {mix.ov} % overage = {mix.nEff.toFixed(1)} reaction volumes</span>
        {mix.tiny.length > 0 && <span><Chip status="warn">below 0.5 µL per reaction</Chip> {mix.tiny.join(', ')}: this is why the master mix exists; the pooled volume is pipettable.</span>}
        {mix.overVolume && <span><Chip status="bad">over volume</Chip> components exceed {mix.V} µL; reduce template or use more concentrated stocks.</span>}
      </div>

      <h3>Cycling program</h3>
      <ProgramTable steps={program.steps} label="PCR program" />
      <div className="stat">
        <span>{realTime ? 'anneal/extend' : 'Ta'} <b>{program.ta} °C</b></span><span>{realTime ? 'step' : 'extension'} <b>{mmss(program.ext)}</b></span><span>estimated run <b>{Math.round(program.total / 60)} min</b> including ramps</span>
      </div>

      <h3>Stage B steps, with the why</h3>
      <Steps list={steps} />

      <Details summary="Controls to include every time">
        <p><b>−RT</b> (RNA carried through an RT reaction with no enzyme): product here came from genomic DNA. <b>No-template control</b> (water instead of cDNA): product here is contamination or primer-dimer; the run is not interpretable for that assay. <b>Positive control</b> (a cDNA known to contain the target): separates "my primers failed" from "my reaction failed". For real time, add a <b>reference gene</b> for every sample on the same plate and a <b>standard curve</b> for each new assay to measure efficiency; MIQE expects both to be reported.</p>
      </Details>
      <Details summary="Reading the result">
        <p><b>Gel:</b> one band of the expected size in the samples, <b>nothing in −RT and NTC</b>. A larger band in −RT (and faintly in samples) is genomic DNA amplified across an intron. <b>Real time:</b> check the <b>NTC and −RT wells first</b> (no Cq, or more than 5 cycles later than the samples), then the <b>melt curve</b> (one peak per assay), then <b>replicate agreement</b> (within 0.5 cycle), then export mean Cq per sample and assay for ΔΔCq. Wells with <b>Cq above 35</b> are below the limit of quantification; report them as such rather than as numbers.</p>
      </Details>
      <Details summary="Plate layout habits that save runs">
        <ul>
          <li><b>Draw the plate map first</b>, with replicates side by side and every sample's targets in the same row or block.</li>
          <li>Keep <b>NTC wells away from the highest-template wells</b>; keep the standard curve in one block.</li>
          <li><b>Avoid the outer edge</b> for anything that matters if your machine evaporates edge wells; fill unused edge wells with water.</li>
          <li><b>Add cDNA last</b>, with a fresh tip per well, then seal, press, spin.</li>
        </ul>
      </Details>
      <Videos topics={['protocol']} label="Watch: setting up the RT and the plate" />
      <Sources keys={['neb_rt', 'neb_luna', 'neb_taq', 'neb_rtqpcr_tips', 'biorad_qpcr', 'qiagen_qpcr', 'tf_rtqpcr', 'miqe', 'nolan', 'addgene_pcr']} />
    </>
  );
}
