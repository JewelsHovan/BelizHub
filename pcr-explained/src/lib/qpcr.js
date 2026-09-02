// Real-time readout: Cq from an amplification curve, relative quantification, efficiency from a standard curve,
// and how many wells an experiment needs. Pure functions, unit-tested.

/** Fractional cycle at which `curve` ([[cycle, copies], ...]) first crosses `threshold`, by log-linear interpolation. Null if never. */
export function cqFromCurve(curve, threshold) {
  for (let i = 1; i < curve.length; i++) {
    const [c0, y0] = curve[i - 1];
    const [c1, y1] = curve[i];
    if (y0 < threshold && y1 >= threshold) {
      const f = (Math.log10(threshold) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0));
      return c0 + f * (c1 - c0);
    }
  }
  return null;
}

/** Amplification efficiency (0..1) from the slope of Cq versus log10(input). −3.32 is 100 %. */
export const efficiencyFromSlope = (slope) => 10 ** (-1 / slope) - 1;
export const slopeFromEfficiency = (E) => -1 / Math.log10(1 + E);

/** Livak 2^−ΔΔCq. t = target Cq, r = reference Cq; C = control (calibrator) sample, T = treated sample. */
export function ddCq({ tC, rC, tT, rT }) {
  const dC = tC - rC;
  const dT = tT - rT;
  const dd = dT - dC;
  return { dC, dT, dd, fold: 2 ** -dd };
}

/** Pfaffl ratio with per-assay efficiencies. ΔCq values are control − treated. */
export function pfaffl({ Et, Er, dCqT, dCqR }) {
  return (1 + Et) ** dCqT / (1 + Er) ** dCqR;
}

/** Wells for a plate: samples × targets × replicates, plus NTC per target, −RT per sample per target, and standards. */
export function plateCount({ samples, targets, replicates = 3, ntc = true, minusRt = true, standards = 0, standardReps = 2 }) {
  const s = Math.max(0, Math.round(samples) || 0);
  const t = Math.max(1, Math.round(targets) || 1);
  const r = Math.max(1, Math.round(replicates) || 1);
  const unknowns = s * t * r;
  const ntcWells = ntc ? t : 0;
  const minusRtWells = minusRt ? s * t : 0;
  const stdWells = Math.max(0, standards) * t * standardReps;
  const total = unknowns + ntcWells + minusRtWells + stdWells;
  return { unknowns, ntcWells, minusRtWells, stdWells, total, plates96: Math.ceil(total / 96) };
}
