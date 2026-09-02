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
