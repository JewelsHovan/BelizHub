import { describe, it, expect } from 'vitest';
import { masterMix, cyclingProgram, protocolText, DEFAULT_SETTINGS } from '../protocol.js';

describe('protocol', () => {
  it('computes per-reaction and pooled volumes for a 25 µL Taq reaction', () => {
    const m = masterMix(DEFAULT_SETTINGS);
    const vol = (id) => m.rows.find((r) => r.id === id).vol;
    expect(vol('buffer')).toBeCloseTo(2.5);
    expect(vol('dntp')).toBeCloseTo(0.5);
    expect(vol('fwd')).toBeCloseTo(1.25);
    expect(vol('pol')).toBeCloseTo(0.125);
    expect(m.water).toBeCloseTo(25 - 2.5 - 0.5 - 1.25 - 1.25 - 0 - 0.125 - 1);
    expect(m.nEff).toBeCloseTo(8.8);
    expect(m.tiny).toEqual(['DNA polymerase']);
    expect(m.overVolume).toBe(false);
  });
  it('flags over-volume mixes', () => {
    expect(masterMix({ ...DEFAULT_SETTINGS, tpl: 30 }).overVolume).toBe(true);
  });
  it('derives Ta and extension time per polymerase', () => {
    const taq = cyclingProgram(DEFAULT_SETTINGS);
    expect(taq.ta).toBe(55);
    expect(taq.ext).toBe(50); // 800 bp at 60 s/kb rounded up to 5 s
    const hf = cyclingProgram({ ...DEFAULT_SETTINGS, pol: 'hf', len: 2500 });
    expect(hf.ta).toBe(59);
    expect(hf.ext).toBe(75);
    expect(hf.steps[0].T).toBe(98);
  });
  it('clamps Ta to a sane range', () => {
    expect(cyclingProgram({ ...DEFAULT_SETTINGS, tmf: 40, tmr: 40 }).ta).toBe(48);
  });
  it('renders a text protocol with mix, program and steps', () => {
    const m = masterMix(DEFAULT_SETTINGS);
    const p = cyclingProgram(DEFAULT_SETTINGS);
    const txt = protocolText(DEFAULT_SETTINGS, m, p);
    expect(txt).toContain('Master mix');
    expect(txt).toContain('Annealing (×30): 55 °C, 0:30');
    expect(txt).toContain('6. Run 5 µL');
  });
});

describe('protocol, real-time readout', () => {
  const q = { ...DEFAULT_SETTINGS, readout: 'sybr', V: 20, tpl: 2, len: 120, cyc: 40, tmf: 60, tmr: 60 };
  it('uses the 2× mix components and flags cDNA above 10 % of the volume', () => {
    const m = masterMix(q);
    expect(m.rows.map((r) => r.id)).toEqual(['mix2x', 'fwd', 'rev']);
    expect(m.rows[0].vol).toBeCloseTo(10);
    expect(m.tplHigh).toBe(false);
    expect(masterMix({ ...q, tpl: 4 }).tplHigh).toBe(true);
  });
  it('builds a two-step program with a melt curve for SYBR only', () => {
    const s = cyclingProgram(q);
    expect(s.realTime).toBe(true);
    expect(s.ta).toBe(60);
    expect(s.steps.some((x) => x.name.startsWith('Melt curve'))).toBe(true);
    const p = cyclingProgram({ ...q, readout: 'probe' });
    expect(p.steps.some((x) => x.name.startsWith('Melt curve'))).toBe(false);
    expect(cyclingProgram({ ...q, tmf: 55, tmr: 56 }).ta).toBe(55);
  });
  it('text mentions the plate and the −RT control', () => {
    const m = masterMix(q);
    const txt = protocolText(q, m, cyclingProgram(q));
    expect(txt).toContain('SYBR');
    expect(txt).toContain('−RT');
  });
});
