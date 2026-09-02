import { useContext, useMemo, useState } from 'react';
import { PrimerContext } from '../context.js';
import { DEFAULT_COMPONENTS, DEFAULT_SETTINGS, masterMix, cyclingProgram, benchSteps, protocolText } from '../lib/protocol.js';
import { fmtV, mmss } from '../lib/units.js';
import Chip from './Chip.jsx';
import Details from './Details.jsx';
import Sources from './Sources.jsx';
import s from './Protocol.module.css';

function NumField({ label, k, settings, set, ...rest }) {
  return <label>{label}<input type="number" value={settings[k]} onChange={(e) => set(k, e.target.value)} {...rest} /></label>;
}

export default function Protocol() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [components, setComponents] = useState(DEFAULT_COMPONENTS);
  const [msg, setMsg] = useState('');
  const { primerTm } = useContext(PrimerContext);
  const set = (k, v) => setSettings((prev) => ({ ...prev, [k]: v }));
  const setComp = (id, k, v) => setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, [k]: Math.max(0, parseFloat(v) || 0) } : c)));

  const mix = useMemo(() => masterMix(settings, components), [settings, components]);
  const program = useMemo(() => cyclingProgram(settings), [settings]);
  const steps = useMemo(() => benchSteps(mix, program), [mix, program]);
  const perL = `per ${mix.V} µL`;
  const mixL = `mix for ${mix.nEff.toFixed(1)} rxn`;

  const pullTm = () => {
    if (primerTm) { set('tmf', primerTm.f.toFixed(1)); set('tmr', primerTm.r.toFixed(1)); setMsg('Tm updated from the Primers tab'); }
    else setMsg('Enter both primers on the Primers tab first');
  };
  const copy = async () => {
    const text = protocolText(settings, mix, program);
    try { await navigator.clipboard.writeText(text); setMsg('Copied'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); setMsg('Copied'); } catch { setMsg('Copy blocked; select the tables and copy manually'); }
      ta.remove();
    }
  };
  const print = () => { try { window.print(); } catch { setMsg('Printing is blocked here; open the page in a browser tab to print'); } };

  return (
    <>
      <h1>Build the protocol.</h1>
      <p className="lede">Set the reaction, get a master-mix table, a cycling program and the step-by-step with the reason behind each step. Copy it into your lab notebook.</p>
      <div className="panel noprint">
        <div className="form">
          <NumField label="Reactions (incl. controls)" k="n" settings={settings} set={set} min="1" step="1" />
          <label>Reaction volume
            <select value={settings.V} onChange={(e) => set('V', Number(e.target.value))}><option value={20}>20</option><option value={25}>25</option><option value={50}>50</option></select>
          </label>
          <NumField label="Overage %" k="ov" settings={settings} set={set} min="0" step="5" />
          <NumField label="Template per reaction (µL)" k="tpl" settings={settings} set={set} min="0" step="0.5" />
          <NumField label="Amplicon length (bp)" k="len" settings={settings} set={set} min="50" step="50" />
          <NumField label="Cycles" k="cyc" settings={settings} set={set} min="15" max="45" step="1" />
          <NumField label="Forward primer Tm (°C)" k="tmf" settings={settings} set={set} step="0.5" />
          <NumField label="Reverse primer Tm (°C)" k="tmr" settings={settings} set={set} step="0.5" />
          <label className="wide">Polymerase
            <select value={settings.pol} onChange={(e) => set('pol', e.target.value)}>
              <option value="taq">Taq, standard buffer (1 min/kb, 72 °C)</option>
              <option value="hf">High-fidelity, proofreading (e.g. Q5, Phusion: 30 s/kb, 98 °C denaturation)</option>
            </select>
          </label>
        </div>
        <div className="controls">
          <button className="btn small" onClick={pullTm}>Use Tm from the Primers tab</button>
          <button className="btn small" onClick={copy}>Copy protocol as text</button>
          <button className="btn small" onClick={print}>Print</button>
          <span className="readout">{msg}</span>
        </div>
      </div>

      <h2>Master mix</h2>
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
            <tr><td>Template DNA<div className="note">added to each tube, not to the mix</div></td><td className="num" /><td className="num" /><td className="num" data-label={perL}>{fmtV(mix.tpl)}</td><td className="num" data-label={mixL}>{fmtV(mix.tpl)} each</td></tr>
            <tr><td><b>Total</b></td><td /><td /><td className="num" data-label={perL}><b>{mix.V}</b></td><td className="num" data-label={mixL}><b>{fmtV(mix.perTube * mix.nEff)}</b> mix, {fmtV(mix.perTube)} per tube</td></tr>
          </tbody>
        </table>
      </div>
      <div className="stat">
        <span>{mix.n} reactions + {mix.ov} % overage = {mix.nEff.toFixed(1)} reaction volumes</span>
        {mix.tiny.length > 0 && <span><Chip status="warn">below 0.5 µL per reaction</Chip> {mix.tiny.join(', ')}: this is why the master mix exists; the pooled volume is pipettable.</span>}
        {mix.overVolume && <span><Chip status="bad">over volume</Chip> components exceed {mix.V} µL; reduce template or use more concentrated stocks.</span>}
      </div>

      <h2>Cycling program</h2>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Step</th><th className="num">°C</th><th className="num">Time</th><th>Why</th></tr></thead>
          <tbody>
            {program.steps.map((st) => <tr key={st.name}><td>{st.name}</td><td className="num">{st.T}</td><td className="num">{st.s === null ? 'hold' : mmss(st.s)}</td><td className="note">{st.why}</td></tr>)}
          </tbody>
        </table>
      </div>
      <div className="stat">
        <span>Ta <b>{program.ta} °C</b></span><span>extension <b>{mmss(program.ext)}</b></span><span>estimated run <b>{Math.round(program.total / 60)} min</b> including ramps</span>
      </div>

      <h2>Steps, with the why</h2>
      <div>
        {steps.map(([action, why], i) => (
          <div className={s.step} key={i}><div className={s.num}>{i + 1}</div><div>{action}<div className={s.why}>{why}</div></div></div>
        ))}
      </div>

      <Details summary="Controls to include every time">
        <p><b>No-template control</b> (water instead of template): any band means contamination and the run is not interpretable. <b>Positive control</b> (a template and primer pair known to work): separates "my primers failed" from "my reaction failed". For new primers, a <b>gradient</b> across annealing temperatures (e.g. Tm − 6 to Tm + 4) finds the specific, high-yield window in one run.</p>
      </Details>
      <Details summary="Reading the gel">
        <p>Load 5 µL of product next to a size ladder on a 1–2 % agarose gel (higher percentage for shorter products). Expect one band at the predicted size, nothing in the NTC, and a band in the positive control. A faint diffuse band near 40–80 bp is primer-dimer. Product can be stored at −20 °C; for cloning or sequencing, clean it up first to remove primers, dNTPs and enzyme.</p>
      </Details>
      <Sources keys={['neb_taq', 'addgene_pcr', 'lorenz', 'tf_setup']} />
    </>
  );
}
