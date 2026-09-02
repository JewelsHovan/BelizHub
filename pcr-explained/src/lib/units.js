export const AVOGADRO = 6.022e23;
export const G_PER_BP = 660;

/** Copies of a double-stranded molecule from mass in ng and length in bp. */
export const copiesFromNg = (ng, bp) => (ng * 1e-9 * AVOGADRO) / (bp * G_PER_BP);
export const fmolFromNg = (ng, bp) => (ng * 1e-9 / (bp * G_PER_BP)) * 1e15;

export const sci = (x, digits = 2) => x.toExponential(digits).replace('e+', ' × 10^');
export const fmtCount = (x) => (x >= 1e4 ? sci(x) : Math.round(x).toLocaleString('en-US'));
/** Volume in µL, trimmed to 2 decimals without trailing zeros. */
export const fmtV = (v) => v.toFixed(2).replace(/\.?0+$/, '');
export const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
