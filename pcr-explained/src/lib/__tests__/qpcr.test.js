import { describe, it, expect } from 'vitest';
import { cqFromCurve, efficiencyFromSlope, slopeFromEfficiency, ddCq, pfaffl, plateCount } from '../qpcr.js';
import { amplification } from '../copies.js';

describe('qpcr', () => {
  it('Cq is where the curve crosses the threshold; 1000× more input is ~10 cycles earlier at 100 %', () => {
    const a = amplification({ E: 1, N0: 1e3, Nmax: 1e13, cycles: 45 });
    const b = amplification({ E: 1, N0: 1e6, Nmax: 1e13, cycles: 45 });
    const cqA = cqFromCurve(a, 1e9);
    const cqB = cqFromCurve(b, 1e9);
    expect(cqA).toBeCloseTo(Math.log2(1e6), 1);
    expect(cqA - cqB).toBeCloseTo(Math.log2(1e3), 1);
    expect(cqFromCurve(a, 1e20)).toBeNull();
  });
  it('slope −3.32 is 100 % efficiency and the inverse agrees', () => {
    expect(efficiencyFromSlope(-3.3219)).toBeCloseTo(1, 3);
    expect(slopeFromEfficiency(0.9)).toBeCloseTo(-3.59, 2);
  });
  it('2^−ΔΔCq gives an 8-fold increase for a 3-cycle shift', () => {
    const r = ddCq({ tC: 25, rC: 20, tT: 22, rT: 20 });
    expect(r.dC).toBe(5);
    expect(r.dT).toBe(2);
    expect(r.dd).toBe(-3);
    expect(r.fold).toBeCloseTo(8);
  });
  it('Pfaffl equals Livak when both efficiencies are 100 %', () => {
    expect(pfaffl({ Et: 1, Er: 1, dCqT: 3, dCqR: 0 })).toBeCloseTo(8);
    expect(pfaffl({ Et: 0.9, Er: 1, dCqT: 3, dCqR: 0 })).toBeCloseTo(1.9 ** 3);
  });
  it('counts wells including controls', () => {
    const p = plateCount({ samples: 3, targets: 2, replicates: 3 });
    expect(p.unknowns).toBe(18);
    expect(p.ntcWells).toBe(2);
    expect(p.minusRtWells).toBe(6);
    expect(p.total).toBe(26);
    expect(plateCount({ samples: 20, targets: 3, replicates: 3, standards: 5 }).plates96).toBe(3);
  });
});
