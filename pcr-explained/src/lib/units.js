export const AVOGADRO = 6.022e23;
export const G_PER_BP = 660;

/** Copies of a double-stranded molecule from mass in ng and length in bp. */
export const copiesFromNg = (ng, bp) => (ng * 1e-9 * AVOGADRO) / (bp * G_PER_BP);
export const fmolFromNg = (ng, bp) => (ng * 1e-9 / (bp * G_PER_BP)) * 1e15;

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
/** Integer as Unicode superscript digits, so "10" + sup(9) reads 10⁹ in plain text and SVG alike. */
export const sup = (n) => String(n).replace(/[-0-9]/g, (c) => SUP[c]);

/** Scientific notation as "1.07 × 10⁹". */
export const sci = (x, digits = 2) => {
  const [m, e] = x.toExponential(digits).split('e');
  return `${m} × 10${sup(Number(e))}`;
};
export const fmtCount = (x) => (x >= 1e4 ? sci(x) : Math.round(x).toLocaleString('en-US'));
/** Volume in µL, trimmed to 2 decimals without trailing zeros. */
export const fmtV = (v) => v.toFixed(2).replace(/\.?0+$/, '');
export const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
