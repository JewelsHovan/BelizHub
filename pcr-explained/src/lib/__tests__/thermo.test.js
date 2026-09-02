import { describe, it, expect } from 'vitest';
import { tmNN, revcomp, comp3, hairpin, analyze, pairAnalysis, clean, wallace } from '../thermo.js';

describe('thermo', () => {
  it('cleans input to A/C/G/T uppercase', () => {
    expect(clean(' gt aa-acg\n')).toBe('GTAAACG');
  });
  it('reverse-complements', () => {
    expect(revcomp('ATGC')).toBe('GCAT');
  });
  it('nearest-neighbour Tm matches reference values for the M13 primers', () => {
    // SantaLucia 1998, 0.5 µM oligo, 50 mM Na+; agrees with IDT OligoAnalyzer within ~1 °C
    expect(tmNN('GTAAAACGACGGCCAGT')).toBeCloseTo(52.8, 0);
    expect(tmNN('CAGGAAACAGCTATGAC')).toBeCloseTo(47.2, 0);
  });
  it('returns null below 8 nt', () => {
    expect(tmNN('ACGTACG')).toBeNull();
  });
  it('Wallace rule', () => {
    expect(wallace('AACCGGTT')).toBe(24);
  });
  it('detects 3′ complementarity between primers', () => {
    // F ends GGATGC, R ends GCATC = revcomp(GATGC)
    expect(comp3('CTGAGTGCCTTCAAGGATGC', 'GACCTTGAGCACTGTGCATC')).toBe(5);
    expect(comp3('TGCCATGCACCAGGTTGTTG', 'ATGTGGCACACTGCGTTGTC')).toBe(0);
  });
  it('detects a 3′ hairpin', () => {
    expect(hairpin('TGCAGCTTCACCAGTGAAGC')).toBe(6);
    expect(hairpin('TGCCATGCACCAGGTTGTTG')).toBe(0);
  });
  it('flags runs, repeats and GC-run 3′ ends', () => {
    const a = analyze('ATATATATGGGGCCTTAACCC');
    expect(a.dinuc).toBe(true);
    expect(a.runs).toBe(true);
    expect(a.gcc3).toBe(true);
  });
  it('pair analysis suggests Ta from the cooler primer', () => {
    const p = pairAnalysis(analyze('TGCCATGCACCAGGTTGTTG'), analyze('ATGTGGCACACTGCGTTGTC'));
    expect(p.dTm).toBeLessThan(1);
    expect(p.taHigh).toBeCloseTo(p.lo - 3, 5);
    expect(p.cross).toBe(0);
  });
});
