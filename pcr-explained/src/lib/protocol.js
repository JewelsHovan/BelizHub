import { clamp } from './cycle.js';
import { fmtV, mmss } from './units.js';

export const DEFAULT_COMPONENTS = [
  { id: 'buffer', name: '10× reaction buffer', hint: 'standard Taq buffer includes 15 mM MgCl₂', stock: 10, final: 1, unit: '×' },
  { id: 'dntp', name: 'dNTP mix', hint: '10 mM each stock', stock: 10, final: 0.2, unit: 'mM each' },
  { id: 'fwd', name: 'Forward primer', hint: '10 µM working stock', stock: 10, final: 0.5, unit: 'µM' },
  { id: 'rev', name: 'Reverse primer', hint: '10 µM working stock', stock: 10, final: 0.5, unit: 'µM' },
  { id: 'mg', name: 'MgCl₂, extra', hint: 'only if the buffer lacks Mg²⁺ or when titrating', stock: 25, final: 0, unit: 'mM' },
  { id: 'pol', name: 'DNA polymerase', hint: '5 U/µL stock; 0.025 U/µL is 1.25 U per 50 µL', stock: 5, final: 0.025, unit: 'U/µL' },
];

export const DEFAULT_SETTINGS = { n: 8, V: 25, ov: 10, tpl: 1, len: 800, cyc: 30, tmf: 58, tmr: 58, pol: 'taq' };

/** Per-reaction volumes, pooled volumes and water for a master mix. */
export function masterMix(settings, components = DEFAULT_COMPONENTS) {
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
  };
}

/** Thermal-cycler program derived from polymerase type, primer Tm and amplicon length. */
export function cyclingProgram(settings) {
  const hf = settings.pol === 'hf';
  const cyc = Math.max(1, Math.round(settings.cyc) || 30);
  const len = Math.max(50, Number(settings.len) || 800);
  const lo = Math.min(Number(settings.tmf) || 58, Number(settings.tmr) || 58);
  const ta = Math.round(clamp(hf ? lo + 1 : lo - 3, 48, 72));
  const perKb = hf ? 30 : 60;
  const ext = Math.max(hf ? 15 : 30, Math.ceil(((len / 1000) * perKb) / 5) * 5);
  const steps = [
    { name: 'Initial denaturation', T: hf ? 98 : 95, s: hf ? 30 : 120, why: 'Fully melts complex template; longer for genomic or crude DNA, 30 s is enough for pure plasmid.' },
    { name: `Denaturation (×${cyc})`, T: hf ? 98 : 95, s: hf ? 10 : 30, why: 'Opens every duplex, including newly made product, each cycle.' },
    { name: `Annealing (×${cyc})`, T: ta, s: hf ? 20 : 30, why: hf ? "Proofreading enzymes and their buffers usually tolerate Ta at or slightly above Tm; confirm with the maker's calculator." : 'Tm of the cooler primer minus 3 °C; run a gradient for new primers.' },
    { name: `Extension (×${cyc})`, T: 72, s: ext, why: `${perKb} s per kb for a ${len} bp amplicon, rounded up.` },
    { name: 'Final extension', T: 72, s: 300, why: 'Completes partial strands; Taq adds the 3′ A overhang here.' },
    { name: 'Hold', T: 4, s: null, why: 'Keeps product stable until the tubes come out; 10 °C is kinder to the cycler.' },
  ];
  const total = steps[0].s + cyc * (steps[1].s + steps[2].s + steps[3].s + 25) + steps[4].s;
  return { steps, ta, ext, total, cyc, len, hf };
}

/** Bench steps with the reason for each, as [action, why]. */
export function benchSteps(mix, program) {
  const hasMg = mix.rows.find((c) => c.id === 'mg')?.vol > 0;
  return [
    ['Thaw buffer, dNTPs and primers on ice; vortex the buffer briefly and spin everything down. Keep the polymerase in a cold block.', 'Cold keeps the enzyme from extending mis-annealed primers during setup, which is where primer-dimers are born. Vortexing the buffer re-mixes salts that stratify on freezing.'],
    [`Prepare the master mix for ${mix.nEff.toFixed(1)} reactions in a 1.5 mL tube on ice: water first, then buffer, dNTPs, both primers${hasMg ? ', MgCl₂' : ''}, and the polymerase last. Mix by pipetting up and down; do not vortex the enzyme.`, 'One mix means every tube has identical composition and each sub-microlitre volume is pipetted once, at a pipettable scale. Enzyme goes last so it never sits in unbuffered water.'],
    [`Dispense ${fmtV(mix.perTube)} µL into each PCR tube or well.`, 'Thin-walled tubes; keep them on a cold rack.'],
    [`Add ${fmtV(mix.tpl)} µL template to each sample tube. Add ${fmtV(mix.tpl)} µL water to the no-template control and known template to the positive control. Cap immediately.`, 'Template last, in a different pipette and tip, keeps the mix and the water stock uncontaminated. The two controls are what let you interpret a failure.'],
    ['Flick to mix, spin briefly, load into the thermal cycler with the heated lid on, and start the program above.', 'The lid stops evaporation; without it condensation on the cap changes every concentration below.'],
    ['Run 5 µL of each reaction on a 1–2 % agarose gel beside a ladder. Store the rest at −20 °C.', `Expect one band at ${program.len} bp, a clean no-template lane and a positive control band.`],
  ];
}

/** Plain-text protocol for the clipboard or a lab notebook. */
export function protocolText(settings, mix, program) {
  const L = [];
  L.push(`PCR protocol: ${mix.n} reactions × ${mix.V} µL, ${program.hf ? 'high-fidelity polymerase' : 'Taq DNA polymerase'}, amplicon ${program.len} bp`);
  L.push('', `Master mix (per reaction / mix for ${mix.nEff.toFixed(1)} reactions):`);
  L.push(`  Nuclease-free water: ${fmtV(mix.water)} / ${fmtV(mix.water * mix.nEff)} µL`);
  mix.rows.forEach((c) => L.push(`  ${c.name} (${c.stock} ${c.unit} stock, ${c.final} ${c.unit} final): ${fmtV(c.vol)} / ${fmtV(c.vol * mix.nEff)} µL`));
  L.push(`  Dispense ${fmtV(mix.perTube)} µL per tube, then add ${fmtV(mix.tpl)} µL template (water in the NTC).`);
  L.push('', 'Cycling program:');
  program.steps.forEach((s) => L.push(`  ${s.name}: ${s.T} °C, ${s.s === null ? 'hold' : mmss(s.s)}`));
  L.push(`  Estimated run time ~${Math.round(program.total / 60)} min.`);
  L.push('', 'Steps:');
  benchSteps(mix, program).forEach(([a], i) => L.push(`  ${i + 1}. ${a}`));
  L.push('', `Primer Tm: fwd ${settings.tmf} °C, rev ${settings.tmr} °C. Verify Ta with the enzyme maker's calculator.`);
  return L.join('\n');
}
