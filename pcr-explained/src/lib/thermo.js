// Primer thermodynamics and sequence heuristics.
// Tm: nearest-neighbour model with SantaLucia (1998) unified parameters, kcal/mol and cal/(K·mol).
// Dimer/hairpin checks are sequence heuristics (complementary runs), not ΔG minimisation.

export const NN = {
  AA: [-7.9, -22.2], TT: [-7.9, -22.2],
  AT: [-7.2, -20.4],
  TA: [-7.2, -21.3],
  CA: [-8.5, -22.7], TG: [-8.5, -22.7],
  GT: [-8.4, -22.4], AC: [-8.4, -22.4],
  CT: [-7.8, -21.0], AG: [-7.8, -21.0],
  GA: [-8.2, -22.2], TC: [-8.2, -22.2],
  CG: [-10.6, -27.2],
  GC: [-9.8, -24.4],
  GG: [-8.0, -19.9], CC: [-8.0, -19.9],
};

const COMP = { A: 'T', T: 'A', C: 'G', G: 'C' };
const R = 1.987; // cal/(K·mol)

export const clean = (s) => (s || '').toUpperCase().replace(/[^ACGT]/g, '');
export const revcomp = (s) => s.split('').reverse().map((c) => COMP[c]).join('');
export const gcFraction = (s) => (s.length ? [...s].filter((c) => c === 'G' || c === 'C').length / s.length : 0);

/** Wallace rule, only a rough guide for short oligos. */
export const wallace = (s) => [...s].reduce((t, c) => t + (c === 'G' || c === 'C' ? 4 : 2), 0);

/**
 * Nearest-neighbour Tm in °C.
 * @param seq  A/C/G/T string, 5'→3'
 * @param C    total oligo concentration in M (default 0.5 µM)
 * @param Na   monovalent cation concentration in M (default 50 mM)
 */
export function tmNN(seq, C = 5e-7, Na = 0.05) {
  if (seq.length < 8) return null;
  let dH = 0;
  let dS = 0;
  for (let i = 0; i < seq.length - 1; i++) {
    const p = NN[seq.substr(i, 2)];
    dH += p[0];
    dS += p[1];
  }
  for (const e of [seq[0], seq[seq.length - 1]]) {
    if (e === 'G' || e === 'C') { dH += 0.1; dS += -2.8; } else { dH += 2.3; dS += 4.1; }
  }
  const selfc = seq === revcomp(seq);
  if (selfc) dS += -1.4;
  dS += 0.368 * (seq.length - 1) * Math.log(Na);
  return (dH * 1000) / (dS + R * Math.log(selfc ? C : C / 4)) - 273.15;
}

/** Longest 3' suffix of `a` (3..8 nt) whose reverse complement occurs anywhere in `b`. 0 if none. */
export function comp3(a, b, min = 3) {
  for (let k = Math.min(8, a.length); k >= min; k--) {
    if (b.includes(revcomp(a.slice(-k)))) return k;
  }
  return 0;
}

/** 3' hairpin: reverse complement of the last 4–6 nt found upstream with at least a 3-nt loop. Returns stem length or 0. */
export function hairpin(a) {
  for (let k = 6; k >= 4; k--) {
    const rc = revcomp(a.slice(-k));
    if (a.slice(0, a.length - k - 3).includes(rc)) return k;
  }
  return 0;
}

export function analyze(seq) {
  const len = seq.length;
  const last5 = seq.slice(-5);
  return {
    seq,
    len,
    gc: gcFraction(seq) * 100,
    tm: tmNN(seq),
    clampN: [...last5].filter((c) => c === 'G' || c === 'C').length,
    runs: /(A{4,}|C{4,}|G{4,}|T{4,})/.test(seq),
    dinuc: /(..)\1{3,}/.test(seq),
    gcc3: /(G|C){3,}$/.test(seq),
    self3: comp3(seq, seq),
    hp: hairpin(seq),
  };
}

/** Pair-level checks; both inputs are `analyze()` results. Returns null if either primer is too short. */
export function pairAnalysis(A, B) {
  if (A.len < 8 || B.len < 8) return null;
  const lo = Math.min(A.tm, B.tm);
  return {
    dTm: Math.abs(A.tm - B.tm),
    cross: Math.max(comp3(A.seq, B.seq), comp3(B.seq, A.seq)),
    lo,
    taHigh: lo - 3,
    taLow: lo - 5,
  };
}

/** Verdict rows for one primer: [label, value, status] with status ok | warn | bad. */
export function verdicts(A) {
  return [
    ['Length', `${A.len} nt`, A.len >= 18 && A.len <= 30 ? 'ok' : 'warn'],
    ['GC content', `${A.gc.toFixed(0)} %`, A.gc >= 40 && A.gc <= 60 ? 'ok' : 'warn'],
    ['Tm (nearest-neighbour)', `${A.tm.toFixed(1)} °C`, A.tm >= 52 && A.tm <= 66 ? 'ok' : 'warn'],
    ['3′ clamp (G/C in last 5)', `${A.clampN}${A.gcc3 ? ', ends in GC run' : ''}`, A.gcc3 ? 'bad' : A.clampN >= 1 && A.clampN <= 3 ? 'ok' : 'warn'],
    ['Runs or repeats', A.runs || A.dinuc ? [A.runs && 'run ≥4', A.dinuc && 'dinucleotide repeat'].filter(Boolean).join(', ') : 'none', A.runs || A.dinuc ? 'warn' : 'ok'],
    ['3′ self-complementarity', A.self3 ? `${A.self3} nt` : 'none', A.self3 >= 5 ? 'bad' : A.self3 >= 4 ? 'warn' : 'ok'],
    ['3′ hairpin', A.hp ? `${A.hp} nt stem` : 'none', A.hp ? 'warn' : 'ok'],
  ];
}

const occurrences = (hay, needle) => {
  let n = 0;
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n++;
  return n;
};

/**
 * Where a primer pair sits on a template written 5'→3' as the sense (mRNA-like) strand.
 * The forward primer must match the sense strand; the reverse primer must match its reverse complement, downstream.
 * Returns null if inputs are too short; otherwise positions (0-based), amplicon length and a list of plain-language issues.
 */
export function locatePrimers(template, fwd, rev) {
  const T = clean(template);
  const F = clean(fwd);
  const R = clean(rev);
  if (T.length < 20 || F.length < 8 || R.length < 8) return null;
  const idx = (s) => { const i = T.indexOf(s); return i < 0 ? null : i; };
  const fSense = idx(F);
  const fAnti = idx(revcomp(F));
  const rAnti = idx(revcomp(R));
  const rSense = idx(R);
  const issues = [];
  let amplicon = null;
  if (fSense === null) {
    issues.push(fAnti !== null
      ? 'The forward primer matches the antisense strand. It is written as a reverse complement; use the sense sequence.'
      : 'The forward primer is not in this template (an exact match is required). Check the sequence, the strand, and that this is the transcript you mean.');
  }
  if (rAnti === null) {
    issues.push(rSense !== null
      ? 'The reverse primer appears in the sense orientation. It must be the reverse complement of the template; reverse-complement it.'
      : 'The reverse-complement of the reverse primer is not in this template. Check the sequence and orientation.');
  }
  if (fSense !== null && rAnti !== null) {
    const end = rAnti + R.length;
    if (end > fSense) amplicon = end - fSense;
    else issues.push('The reverse site lies upstream of the forward site, so nothing between them can be amplified. The primers are swapped or one is on the wrong strand.');
  }
  if (fSense !== null && occurrences(T, F) > 1) issues.push('The forward primer matches more than one site in this template.');
  if (rAnti !== null && occurrences(T, revcomp(R)) > 1) issues.push('The reverse primer matches more than one site in this template.');
  return { fwd: fSense, rev: rAnti, revEnd: rAnti === null ? null : rAnti + R.length, amplicon, issues, len: T.length };
}
