import { describe, it, expect } from 'vitest';
import { duplexesAt, counts, amplification } from '../copies.js';

describe('copies', () => {
  it('cycle 1 gives two duplexes, each with one long product', () => {
    expect(duplexesAt(1)).toEqual([['T', 'Lr'], ['B', 'Lf']]);
  });
  it('the first exact-length duplex appears at cycle 3', () => {
    const exact = (n) => duplexesAt(n).filter(([a, b]) => a[0] === 'S' && b[0] === 'S').length;
    expect(exact(2)).toBe(0);
    expect(exact(3)).toBe(2);
    expect(exact(4)).toBe(8);
  });
  it('counts follow 2^n duplexes, 2^n − 2n exact, 2n long strands', () => {
    expect(counts(0)).toEqual({ duplexes: 1, exact: 0, shortStrands: 0, longs: 0 });
    expect(counts(3)).toEqual({ duplexes: 8, exact: 2, shortStrands: 8, longs: 6 });
    expect(counts(4).exact).toBe(8);
    expect(counts(5).longs).toBe(10);
  });
  it('amplification is exponential then plateaus at Nmax', () => {
    const a = amplification({ E: 1, N0: 1, Nmax: 1e12, cycles: 60 });
    expect(a[10][1]).toBeCloseTo(1024, 0);
    expect(a[60][1]).toBeLessThanOrEqual(1e12 + 1);
    expect(a[60][1]).toBeGreaterThan(9.9e11);
  });
});
