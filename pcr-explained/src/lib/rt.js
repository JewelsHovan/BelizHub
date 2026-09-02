// Two-step reverse transcription: reaction assembly and the thermal program, for a generic 20 µL first-strand reaction.
// Volumes follow the common SuperScript / ProtoScript II layout: an RNA + primer + dNTP mix that is heat-denatured,
// then buffer, DTT, RNase inhibitor and enzyme. The enzyme datasheet wins where it differs.
import { fmtV, mmss } from './units.js';

export const RT_ENZYMES = {
  mmlv: {
    name: 'M-MLV RNase H⁻ (SuperScript II/III, ProtoScript II, M-MLV RT)',
    rt: { T: 42, s: 3000 }, inact: { T: 80, s: 300 }, hexAnneal: { T: 25, s: 600 },
    note: 'Classic engineered M-MLV: 42 °C for oligo(dT) and gene-specific priming, up to 50 °C for structured RNA. 50 min is standard; 15 min already gives most of the yield.',
  },
  fast: {
    name: 'Thermostable engineered RT (SuperScript IV, LunaScript, Maxima H⁻)',
    rt: { T: 55, s: 600 }, inact: { T: 95, s: 60 }, hexAnneal: { T: 25, s: 120 },
    note: 'Higher temperature melts secondary structure and improves priming specificity; 10 min is enough. Many of these ship as a 5× SuperMix with primers included.',
  },
  onestep: {
    name: 'One-step RT-qPCR mix (RT and PCR in one tube)',
    rt: { T: 55, s: 600 }, inact: { T: 95, s: 60 }, hexAnneal: null,
    note: 'RT happens inside the PCR program with gene-specific primers only. Fewer pipetting steps and no cDNA to store, but no −RT control per sample unless you run a separate reaction without the RT enzyme.',
  },
};

export const RT_PRIMING = {
  dt: { name: 'Oligo(dT)18', vol: 1, hint: '50 µM stock; 3′ bias, mRNA only' },
  hex: { name: 'Random hexamers', vol: 1, hint: '50 ng/µL stock; whole transcriptome, needs an annealing step' },
  both: { name: 'Oligo(dT) + random hexamers', vol: 2, hint: '1 µL each; the usual default for gene expression' },
  gsp: { name: 'Gene-specific primer', vol: 1, hint: '2 µM stock; one target, highest sensitivity' },
};

export const DEFAULT_RT = { samples: 6, rnaNg: 500, rnaConc: 100, V: 20, ov: 10, enzyme: 'mmlv', priming: 'both', minusRt: true, dnase: true };

/** Per-reaction and pooled volumes for the two RT mixes, plus the −RT control mix. */
export function rtMix(s) {
  const n = Math.max(1, Math.round(s.samples) || 1);
  const V = Number(s.V) || 20;
  const k = V / 20;
  const ov = Math.max(0, Number(s.ov) || 0);
  const rnaNg = Math.max(0, Number(s.rnaNg) || 0);
  const rnaConc = Math.max(0, Number(s.rnaConc) || 0);
  const priming = RT_PRIMING[s.priming] || RT_PRIMING.both;
  const rnaVol = rnaConc > 0 ? rnaNg / rnaConc : 0;
  const mix1Fixed = [
    { id: 'primer', name: priming.name, hint: priming.hint, vol: priming.vol * k },
    { id: 'dntp', name: 'dNTP mix', hint: '10 mM each; 0.5 mM each final', vol: 1 * k },
  ];
  const mix1Target = 13 * k;
  const mix1Used = mix1Fixed.reduce((a, c) => a + c.vol, 0);
  const rnaMax = mix1Target - mix1Used;
  const water1 = mix1Target - mix1Used - rnaVol;
  const mix2 = [
    { id: 'buffer', name: '5× RT buffer', hint: 'Tris, KCl, MgCl₂; 1× final', vol: 4 * k },
    { id: 'dtt', name: '0.1 M DTT', hint: '5 mM final; keeps the enzyme reduced', vol: 1 * k },
    { id: 'rnasin', name: 'RNase inhibitor', hint: '40 U/µL; 40 U per reaction', vol: 1 * k },
    { id: 'rt', name: 'Reverse transcriptase', hint: '200 U/µL; 200 U per reaction', vol: 1 * k },
  ];
  const minusRt = !!s.minusRt;
  const nRt = n; // one +RT reaction per sample
  const nMinus = minusRt ? n : 0; // one −RT reaction per sample, enzyme replaced by water
  const nEff = (nRt + nMinus) * (1 + ov / 100);
  return {
    n, V, ov, rnaNg, rnaConc, rnaVol, rnaMax, water1, priming: s.priming,
    mix1: mix1Fixed, mix1Target,
    mix2, mix2Total: mix2.reduce((a, c) => a + c.vol, 0),
    nRt, nMinus, nEff,
    nEffPlus: nRt * (1 + ov / 100),
    nEffMinus: nMinus * (1 + ov / 100),
    rnaTooDilute: rnaVol > rnaMax,
    rnaHigh: rnaNg > 1000 * k,
    rnaLow: rnaNg > 0 && rnaNg < 10 * k,
  };
}

/** Thermal program for the first-strand reaction. One-step kits return only the note; their RT lives in the PCR program. */
export function rtProgram(s) {
  const enz = RT_ENZYMES[s.enzyme] || RT_ENZYMES.mmlv;
  const priming = s.priming || 'both';
  if (s.enzyme === 'onestep') return { enzyme: enz, steps: [], total: 0, oneStep: true };
  const steps = [
    { name: 'Denature RNA + primer', T: 65, s: 300, why: 'Melts RNA secondary structure so the primer can reach its site. Mix 1 only; the enzyme is not in the tube yet.' },
    { name: 'Snap-cool', T: 4, s: 60, why: 'On ice at least 1 min. Keeps the RNA open and the primer paired; then add mix 2.' },
  ];
  if ((priming === 'hex' || priming === 'both') && enz.hexAnneal) {
    steps.push({ name: 'Primer annealing', T: enz.hexAnneal.T, s: enz.hexAnneal.s, why: 'Random hexamers are short (Tm ≈ 20 °C) and need a low-temperature step to pair before the enzyme extends them.' });
  }
  steps.push({ name: 'Reverse transcription', T: enz.rt.T, s: enz.rt.s, why: enz.note });
  steps.push({ name: 'Inactivate RT', T: enz.inact.T, s: enz.inact.s, why: 'Kills the enzyme so it cannot act in the PCR. Some protocols add RNase H here to remove the RNA strand; usually unnecessary.' });
  steps.push({ name: 'Hold', T: 4, s: null, why: 'cDNA is DNA: stable at 4 °C for the day, −20 °C for months. Dilute 1:5 to 1:10 for qPCR.' });
  const total = steps.reduce((a, st) => a + (st.s || 0), 0);
  return { enzyme: enz, steps, total, oneStep: false };
}

/** Plain-text RT section for the clipboard. */
export function rtText(s, mix, program) {
  const L = [];
  L.push(`Reverse transcription: ${mix.n} RNA samples${mix.nMinus ? ` + ${mix.nMinus} −RT controls` : ''}, ${mix.V} µL each, ${program.enzyme.name}`);
  if (program.oneStep) {
    L.push('  One-step chemistry: add RNA directly to the RT-qPCR master mix; the RT step is the first line of the PCR program.');
    return L.join('\n');
  }
  L.push(`  RNA input ${mix.rnaNg} ng at ${mix.rnaConc} ng/µL = ${fmtV(mix.rnaVol)} µL per reaction (adjust per sample)`);
  L.push(`  Mix 1 per reaction (to ${fmtV(mix.mix1Target)} µL): ${mix.mix1.map((c) => `${c.name} ${fmtV(c.vol)} µL`).join(', ')}, RNA ${fmtV(mix.rnaVol)} µL, water ${fmtV(Math.max(0, mix.water1))} µL`);
  L.push(`  Mix 2 per reaction (${fmtV(mix.mix2Total)} µL): ${mix.mix2.map((c) => `${c.name} ${fmtV(c.vol)} µL`).join(', ')}`);
  L.push(`  Mix 2 pooled for ${mix.nEffPlus.toFixed(1)} +RT reactions: ${mix.mix2.map((c) => `${c.name} ${fmtV(c.vol * mix.nEffPlus)} µL`).join(', ')}`);
  if (mix.nMinus) L.push(`  −RT mix pooled for ${mix.nEffMinus.toFixed(1)} reactions: same, with ${fmtV(mix.mix2[3].vol * mix.nEffMinus)} µL water instead of enzyme`);
  L.push('  Program:');
  program.steps.forEach((st) => L.push(`    ${st.name}: ${st.T} °C, ${st.s === null ? 'hold' : mmss(st.s)}`));
  return L.join('\n');
}
