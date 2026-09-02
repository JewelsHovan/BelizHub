// Strand bookkeeping for the first cycles, and an efficiency/plateau model for the rest.
// Strand types: T/B original strands; Lf/Lr "long" products (one end defined); Sf/Sr defined-length products.
export const RULE = { T: 'Lr', B: 'Lf', Lf: 'Sr', Lr: 'Sf', Sf: 'Sr', Sr: 'Sf' };
/** Extent of each strand type along the original template, as fractions of its length. */
export const EXT = { T: [0, 1], B: [0, 1], Lf: [0.25, 1], Lr: [0, 0.75], Sf: [0.25, 0.75], Sr: [0.25, 0.75] };

/** Duplexes present after n cycles, as [template, newlySynthesized] pairs (ideal, 100 % efficiency). */
export function duplexesAt(n) {
  let d = [['T', 'B']];
  for (let i = 0; i < n; i++) {
    const next = [];
    for (const [a, b] of d) {
      next.push([a, RULE[a]]);
      next.push([b, RULE[b]]);
    }
    d = next;
  }
  return d;
}

export function counts(n) {
  return {
    duplexes: 2 ** n,
    exact: n === 0 ? 0 : Math.max(0, 2 ** n - 2 * n),
    shortStrands: Math.max(0, 2 ** (n + 1) - 2 - 2 * n),
    longs: 2 * n,
  };
}

/** Logistic-capped amplification: N_{n+1} = N_n + E·N_n·(1 − N_n/Nmax). Returns [[cycle, copies], ...]. */
export function amplification({ E, N0, Nmax = 1e12, cycles = 35 }) {
  const out = [];
  let N = N0;
  for (let n = 0; n <= cycles; n++) {
    out.push([n, N]);
    N = N + E * N * (1 - N / Nmax);
  }
  return out;
}
