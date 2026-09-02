// One PCR cycle as a normalised timeline t ∈ [0, 1]. Segment fractions are real-time proportions of a
// 144 s cycle: 8 s ramp, 30 s at 95 °C, 10 s ramp, 30 s at 58 °C, 6 s ramp, 60 s at 72 °C.
export const SEGS = [
  { k: 'ramp', a: 72, b: 95, f: 0.056 },
  { k: 'hold', T: 95, f: 0.208 },
  { k: 'ramp', a: 95, b: 58, f: 0.069 },
  { k: 'hold', T: 58, f: 0.208 },
  { k: 'ramp', a: 58, b: 72, f: 0.042 },
  { k: 'hold', T: 72, f: 0.417 },
];
export const TOTAL_S = 144;
export const CYCLE_MS = 11000;
export const BOUNDARIES = [0, 0.056, 0.264, 0.333, 0.541, 0.583, 1];
export const BOUNDARY_T = [72, 95, 95, 58, 58, 72, 72];

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const smooth = (u) => u * u * (3 - 2 * u);

export function tempAt(t) {
  let acc = 0;
  for (let i = 0; i < SEGS.length; i++) {
    const s = SEGS[i];
    if (t <= acc + s.f + 1e-9 || i === SEGS.length - 1) {
      const u = clamp((t - acc) / s.f);
      return s.k === 'hold' ? s.T : s.a + (s.b - s.a) * u;
    }
    acc += s.f;
  }
  return 72;
}

export const phaseAt = (t) => (t < 0.264 ? 'denature' : t < 0.541 ? 'anneal' : 'extend');

export const PHASE = {
  denature: {
    cls: 'heat',
    title: 'Denaturation, 95 °C',
    jump: 0,
    body: 'Heat breaks the hydrogen bonds between the two strands; the covalent backbone of each strand is untouched. Both strands are now single and can be read. Primers are already in the tube but cannot bind at this temperature.',
  },
  anneal: {
    cls: 'cool',
    title: 'Annealing, 58 °C (Tm − 3 to 5 °C)',
    jump: 0.3,
    body: 'Fast cooling lets the primers, in enormous excess, base-pair to their complementary sites before the long strands can find each other. The forward primer sits on the bottom strand, the reverse primer on the top strand, each with its 3′ end pointing into the target.',
  },
  extend: {
    cls: 'warm',
    title: 'Extension, 72 °C',
    jump: 0.575,
    body: 'The polymerase clamps onto each primer–template junction and adds dNTPs to the 3′-OH, one per matched template base, about a thousand per minute. Pyrophosphate is released with each addition. At the end of the phase each original strand is part of a new duplex: one has become two.',
  },
};

/** Everything the molecular view needs at time t, in the 360×230 viewBox. */
export function geometry(t) {
  const sep = smooth(clamp((t - 0.03) / 0.12));
  const dock = smooth(clamp((t - 0.36) / 0.12));
  const ext = clamp((t - 0.6) / 0.38);
  const yt = 115 - 8 - 42 * sep;
  const yb = 115 + 8 + 42 * sep;
  const fx = 110 + 8 * Math.sin(t * 12);
  const fy = 205 + 4 * Math.cos(t * 9);
  const rx = 230 + 8 * Math.cos(t * 11);
  const ry = 22 + 4 * Math.sin(t * 8);
  const pv = t < 0.58 ? 0 : t < 0.62 ? (t - 0.58) / 0.04 : t > 0.965 ? clamp((1 - t) / 0.035) : 1;
  return {
    T: tempAt(t),
    phase: phaseAt(t),
    sep, dock, ext, yt, yb,
    fwdPrimer: { x: fx + (30 - fx) * dock, y: fy + (yb - 12 - fy) * dock },
    revPrimer: { x: rx + (330 - rx) * dock, y: ry + (yt + 12 - ry) * dock },
    fEnd: 70 + 260 * ext,
    rEnd: 290 - 260 * ext,
    polVisible: pv,
  };
}

export function caption(t, g, cycleNo) {
  if (t > 0.985) return `Cycle ${cycleNo} done: 1 duplex became 2`;
  if (g.phase === 'extend' && g.ext > 0) return `new strand: ${Math.round(g.ext * 800)} of 800 nt`;
  if (g.phase === 'anneal' && g.dock > 0.9) return 'primers paired, 3′ ends face inward';
  if (g.phase === 'denature' && g.sep > 0.9) return 'strands apart; primers still free';
  return '';
}
