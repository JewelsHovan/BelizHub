import { describe, it, expect } from 'vitest';
import { rtMix, rtProgram, rtText, DEFAULT_RT } from '../rt.js';

describe('rt', () => {
  it('computes RNA volume from mass and concentration and fills mix 1 to 13 µL', () => {
    const m = rtMix(DEFAULT_RT);
    expect(m.rnaVol).toBeCloseTo(5);
    expect(m.mix1Target).toBe(13);
    expect(m.water1).toBeCloseTo(13 - 2 - 1 - 5);
    expect(m.mix2Total).toBe(7);
    expect(m.nMinus).toBe(6);
    expect(m.nEffPlus).toBeCloseTo(6.6);
  });
  it('flags RNA that is too dilute to fit', () => {
    expect(rtMix({ ...DEFAULT_RT, rnaConc: 20 }).rnaTooDilute).toBe(true);
    expect(rtMix({ ...DEFAULT_RT, rnaConc: 20, rnaNg: 100 }).rnaTooDilute).toBe(false);
  });
  it('adds a hexamer annealing step only for random priming', () => {
    const names = (s) => rtProgram(s).steps.map((x) => x.name);
    expect(names(DEFAULT_RT)).toContain('Primer annealing');
    expect(names({ ...DEFAULT_RT, priming: 'dt' })).not.toContain('Primer annealing');
    expect(rtProgram({ ...DEFAULT_RT, enzyme: 'fast' }).steps.find((x) => x.name === 'Reverse transcription').T).toBe(55);
    expect(rtProgram({ ...DEFAULT_RT, enzyme: 'onestep' }).oneStep).toBe(true);
  });
  it('renders text with both mixes and the −RT control', () => {
    const m = rtMix(DEFAULT_RT);
    const txt = rtText(DEFAULT_RT, m, rtProgram(DEFAULT_RT));
    expect(txt).toContain('Mix 1');
    expect(txt).toContain('−RT mix');
    expect(txt).toContain('Reverse transcription: 42 °C, 50:00');
  });
});
