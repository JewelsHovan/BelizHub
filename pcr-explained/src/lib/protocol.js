import { clamp } from './cycle.js';
import { fmtV, mmss } from './units.js';

// PCR stage of a two-step RT-PCR. Template is cDNA from the RT reaction. Three readouts:
// 'gel' (endpoint, discrete Taq or high-fidelity components), 'sybr' and 'probe' (real-time, a 2× qPCR master mix).

export const DEFAULT_COMPONENTS = [
  { id: 'buffer', name: '10× reaction buffer', hint: 'standard Taq buffer includes 15 mM MgCl₂', stock: 10, final: 1, unit: '×' },
  { id: 'dntp', name: 'dNTP mix', hint: '10 mM each stock', stock: 10, final: 0.2, unit: 'mM each' },
  { id: 'fwd', name: 'Forward primer', hint: '10 µM working stock', stock: 10, final: 0.5, unit: 'µM' },
  { id: 'rev', name: 'Reverse primer', hint: '10 µM working stock', stock: 10, final: 0.5, unit: 'µM' },
  { id: 'mg', name: 'MgCl₂, extra', hint: 'only if the buffer lacks Mg²⁺ or when titrating', stock: 25, final: 0, unit: 'mM' },
  { id: 'pol', name: 'DNA polymerase', hint: '5 U/µL stock; 0.025 U/µL is 1.25 U per 50 µL', stock: 5, final: 0.025, unit: 'U/µL' },
];

export const SYBR_COMPONENTS = [
  { id: 'mix2x', name: '2× SYBR qPCR master mix', hint: 'hot-start polymerase, dNTPs, Mg²⁺, buffer and dye in one tube', stock: 2, final: 1, unit: '×' },
  { id: 'fwd', name: 'Forward primer', hint: '10 µM working stock; 0.2–0.5 µM final', stock: 10, final: 0.4, unit: 'µM' },
  { id: 'rev', name: 'Reverse primer', hint: '10 µM working stock', stock: 10, final: 0.4, unit: 'µM' },
];

export const PROBE_COMPONENTS = [
  { id: 'mix2x', name: '2× probe qPCR master mix', hint: 'hot-start polymerase, dNTPs, Mg²⁺, buffer, no dye', stock: 2, final: 1, unit: '×' },
  { id: 'fwd', name: 'Forward primer', hint: '10 µM working stock; probe assays run primers higher', stock: 10, final: 0.9, unit: 'µM' },
  { id: 'rev', name: 'Reverse primer', hint: '10 µM working stock', stock: 10, final: 0.9, unit: 'µM' },
  { id: 'probe', name: 'Hydrolysis probe', hint: '10 µM stock; 0.25 µM final', stock: 10, final: 0.25, unit: 'µM' },
];

export const READOUTS = {
  gel: 'Endpoint: run on a gel',
  sybr: 'Real-time: SYBR Green (melt curve)',
  probe: 'Real-time: hydrolysis (TaqMan-type) probe',
};

export const componentsFor = (readout) => (readout === 'sybr' ? SYBR_COMPONENTS : readout === 'probe' ? PROBE_COMPONENTS : DEFAULT_COMPONENTS);
export const isRealTime = (readout) => readout === 'sybr' || readout === 'probe';

export const DEFAULT_SETTINGS = { n: 8, V: 25, ov: 10, tpl: 1, len: 800, cyc: 30, tmf: 58, tmr: 58, pol: 'taq', readout: 'gel' };
/** Applied on top of the settings when the user switches to a real-time readout. */
export const QPCR_PRESET = { V: 20, tpl: 2, len: 120, cyc: 40, tmf: 60, tmr: 60 };
export const GEL_PRESET = { V: 25, tpl: 1, len: 800, cyc: 30 };

/** Per-reaction volumes, pooled volumes and water for a master mix. */
export function masterMix(settings, components = componentsFor(settings.readout)) {
  const n = Math.max(1, Math.round(settings.n) || 1);
  const V = Number(settings.V) || 25;
  const ov = Math.max(0, Number(settings.ov) || 0);
  const tpl = Math.max(0, Number(settings.tpl) || 0);
  const nEff = n * (1 + ov / 100);
  const rows = components.map((c) => ({ ...c, vol: c.stock > 0 ? (c.final / c.stock) * V : 0 }));
  const water = V - rows.reduce((a, c) => a + c.vol, 0) - tpl;
  return {
    n, V, ov, tpl, nEff, rows, water,
    perTube: V - tpl,
    tiny: rows.filter((c) => c.vol > 0 && c.vol < 0.5).map((c) => c.name),
    overVolume: water < 0,
    tplFrac: tpl / V,
    tplHigh: tpl / V > 0.1,
    readout: settings.readout || 'gel',
  };
}

/** Thermal-cycler program derived from readout, polymerase type, primer Tm and amplicon length. */
export function cyclingProgram(settings) {
  const readout = settings.readout || 'gel';
  const cyc = Math.max(1, Math.round(settings.cyc) || 30);
  const len = Math.max(50, Number(settings.len) || 800);
  const lo = Math.min(Number(settings.tmf) || 58, Number(settings.tmr) || 58);
  if (isRealTime(readout)) {
    // Two-step cycling: a combined anneal/extend at 60 °C is what qPCR primers are designed for; go lower only if the primers force it.
    const ta = clamp(Math.round(lo < 58 ? lo : 60), 55, 64);
    const ext = len <= 150 ? 30 : 60;
    const steps = [
      { name: 'Polymerase activation', T: 95, s: 120, why: 'Releases the hot-start block; 1–10 min depending on the mix. Some mixes start with 50 °C 2 min for UDG carry-over control.' },
      { name: `Denaturation (×${cyc})`, T: 95, s: 15, why: 'Short amplicons open in seconds.' },
      { name: `Anneal, extend, read (×${cyc})`, T: ta, s: ext, why: 'One step does both for a 70–200 bp amplicon; fluorescence is read at the end of it. 60 °C is the design target for qPCR primers.' },
    ];
    if (readout === 'sybr') steps.push({ name: 'Melt curve, 60 → 95 °C', T: 95, s: 600, why: '0.5 °C steps with a read at each. One sharp peak means one product; a low-temperature shoulder is primer-dimer.' });
    steps.push({ name: 'Hold', T: 4, s: null, why: 'Optional; export the Cq table and the melt peaks before you leave.' });
    const total = steps[0].s + cyc * (15 + ext + 10) + (readout === 'sybr' ? 600 : 0);
    return { steps, ta, ext, total, cyc, len, hf: false, realTime: true, readout };
  }
  const hf = settings.pol === 'hf';
  const ta = Math.round(clamp(hf ? lo + 1 : lo - 3, 48, 72));
  const perKb = hf ? 30 : 60;
  const ext = Math.max(hf ? 15 : 30, Math.ceil(((len / 1000) * perKb) / 5) * 5);
  const steps = [
    { name: 'Initial denaturation', T: hf ? 98 : 95, s: hf ? 30 : 120, why: 'Activates hot-start enzymes and fully melts the cDNA; 30 s is enough for pure template.' },
    { name: `Denaturation (×${cyc})`, T: hf ? 98 : 95, s: hf ? 10 : 30, why: 'Opens every duplex, including newly made product, each cycle.' },
    { name: `Annealing (×${cyc})`, T: ta, s: hf ? 20 : 30, why: hf ? "Proofreading enzymes and their buffers usually tolerate Ta at or slightly above Tm; confirm with the maker's calculator." : 'Tm of the cooler primer minus 3 °C; run a gradient for new primers.' },
    { name: `Extension (×${cyc})`, T: 72, s: ext, why: `${perKb} s per kb for a ${len} bp amplicon, rounded up.` },
    { name: 'Final extension', T: 72, s: hf ? 120 : 300, why: 'Completes partial strands; Taq adds the 3′ A overhang here.' },
    { name: 'Hold', T: 4, s: null, why: 'Keeps product stable until the tubes come out; 10 °C is kinder to the cycler.' },
  ];
  const total = steps[0].s + cyc * (steps[1].s + steps[2].s + steps[3].s + 25) + steps[4].s;
  return { steps, ta, ext, total, cyc, len, hf, realTime: false, readout };
}

/** Bench steps with the reason for each, as [action, why]. */
export function benchSteps(mix, program) {
  const tpl = fmtV(mix.tpl);
  if (program.realTime) {
    return [
      ['Thaw the 2× master mix and primers on ice, protected from light; vortex the mix briefly and spin everything down.', 'SYBR and probes bleach in light. The mix stratifies on freezing and gives uneven Cq values if not mixed.'],
      [`Prepare one master mix per target for ${mix.nEff.toFixed(1)} wells: water, 2× mix, then both primers${mix.rows.some((c) => c.id === 'probe') ? ' and the probe' : ''}. Pipette to mix; do not vortex.`, 'Every well of a target gets identical chemistry, so differences in Cq come from the template, not the pipetting.'],
      [`Dispense ${fmtV(mix.perTube)} µL into each well of the plate, following your plate map. Include wells for the no-template control and each −RT sample.`, 'A plate map written before you pipette is the single best defence against a wasted run.'],
      [`Add ${tpl} µL cDNA (a 1:5 to 1:10 dilution of the RT reaction) to each sample well, ${tpl} µL of the −RT reaction to its wells, and ${tpl} µL water to the NTC wells. Change tips every time.`, 'cDNA is ≤10 % of the reaction so RT buffer, DTT and RNA do not inhibit the polymerase. The controls tell you whether signal is from mRNA (−RT clean) and from your template at all (NTC clean).'],
      ['Seal with optical film, press every well, spin the plate 1 min, load and start the program.', 'Bubbles and a loose seal change the light path and evaporate wells at the edge; both show up as scattered Cq.'],
      ['Afterwards: check the NTC and −RT wells are empty or ≥5 cycles later than the samples, check the melt curve shows one peak per assay, then export Cq values for ΔΔCq or a standard curve.', 'Replicates should agree within 0.5 cycle. If they do not, the pipetting, not the biology, made the difference.'],
    ];
  }
  const hasMg = mix.rows.find((c) => c.id === 'mg')?.vol > 0;
  return [
    ['Thaw buffer, dNTPs and primers on ice; vortex the buffer briefly and spin everything down. Keep the polymerase in a cold block.', 'Cold keeps the enzyme from extending mis-annealed primers during setup, which is where primer-dimers are born. Vortexing the buffer re-mixes salts that stratify on freezing.'],
    [`Prepare the master mix for ${mix.nEff.toFixed(1)} reactions in a 1.5 mL tube on ice: water first, then buffer, dNTPs, both primers${hasMg ? ', MgCl₂' : ''}, and the polymerase last. Mix by pipetting up and down; do not vortex the enzyme.`, 'One mix means every tube has identical composition and each sub-microlitre volume is pipetted once, at a pipettable scale. Enzyme goes last so it never sits in unbuffered water.'],
    [`Dispense ${fmtV(mix.perTube)} µL into each PCR tube or well.`, 'Thin-walled tubes; keep them on a cold rack.'],
    [`Add ${tpl} µL cDNA to each sample tube, ${tpl} µL of the −RT reaction to its tube, and ${tpl} µL water to the no-template control. Cap immediately.`, 'Template last, in a different pipette and tip, keeps the mix and the water stock clean. −RT shows whether a band comes from genomic DNA; the NTC shows whether it comes from contamination.'],
    ['Flick to mix, spin briefly, load into the thermal cycler with the heated lid on, and start the program above.', 'The lid stops evaporation; without it condensation on the cap changes every concentration below.'],
    ['Run 5 µL of each reaction on a 1.5–2 % agarose gel beside a ladder. Store the rest at −20 °C.', `Expect one band at ${program.len} bp in the samples, nothing in the −RT lane and nothing in the NTC lane.`],
  ];
}

/** Plain-text PCR-stage protocol for the clipboard or a lab notebook. */
export function protocolText(settings, mix, program) {
  const L = [];
  const chem = program.realTime ? READOUTS[program.readout] : program.hf ? 'high-fidelity polymerase' : 'Taq DNA polymerase';
  L.push(`PCR stage: ${mix.n} reactions × ${mix.V} µL, ${chem}, amplicon ${program.len} bp, cDNA template`);
  L.push('', `Master mix (per reaction / mix for ${mix.nEff.toFixed(1)} reactions):`);
  L.push(`  Nuclease-free water: ${fmtV(mix.water)} / ${fmtV(mix.water * mix.nEff)} µL`);
  mix.rows.forEach((c) => L.push(`  ${c.name} (${c.stock} ${c.unit} stock, ${c.final} ${c.unit} final): ${fmtV(c.vol)} / ${fmtV(c.vol * mix.nEff)} µL`));
  L.push(`  Dispense ${fmtV(mix.perTube)} µL per tube or well, then add ${fmtV(mix.tpl)} µL cDNA (water in the NTC, −RT reaction in its tube).`);
  L.push('', 'Cycling program:');
  program.steps.forEach((s) => L.push(`  ${s.name}: ${s.T} °C, ${s.s === null ? 'hold' : mmss(s.s)}`));
  L.push(`  Estimated run time ~${Math.round(program.total / 60)} min.`);
  L.push('', 'Steps:');
  benchSteps(mix, program).forEach(([a], i) => L.push(`  ${i + 1}. ${a}`));
  L.push('', `Primer Tm: fwd ${settings.tmf} °C, rev ${settings.tmr} °C. Verify Ta with the enzyme maker's calculator.`);
  return L.join('\n');
}
