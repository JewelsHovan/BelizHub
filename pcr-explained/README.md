# PCR, from molecule to protocol

Interactive explainer for conventional PCR aimed at biotech master's students: reagents and why each is there, an animated cycle at the molecular level, where the exact-length product comes from, a primer checker, a master-mix and cycling-program builder, troubleshooting, and a self-check quiz. Every section links to its sources.

React 18 + Vite, plain CSS modules, no other runtime dependencies.

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | install |
| `npm run dev` | dev server with HMR |
| `npm test` | vitest, unit tests for `src/lib` |
| `npm run build` | static site to `dist/` |
| `npm run build:single` | one self-contained `dist-single/index.html` (share as a Claude artifact, email it, drop it on a USB stick) |
| `npm run build:all` | both |
| `npm run preview` | serve `dist/` locally |

## Layout

```
src/
  lib/          pure functions, unit-tested
    thermo.js     nearest-neighbour Tm (SantaLucia 1998), dimer/hairpin heuristics, verdicts
    protocol.js   master mix volumes, cycling program, bench steps, text export
    copies.js     strand bookkeeping for cycles 0–4, efficiency/plateau model
    cycle.js      temperature profile and molecular-view geometry for one cycle
    units.js      copies-from-ng, formatting
  data/         content only: reagents, sources registry, troubleshooting, quiz
  components/   one per tab plus shared bits (Tabs, Sources, Details, Chip, Glyphs, Rich)
  hooks/        useHashRoute (#s3 deep links), useCycleClock (rAF), useReducedMotion
  styles/       global.css: design tokens and shared primitives
```

Rules of thumb:

- Anything computed lives in `lib/` and gets a test. Components only render.
- Content edits go in `data/`. To cite something new, add it to `data/sources.js` once and reference the key from any `<Sources keys={[...]}/>`.
- Every section stays mounted; switching tabs hides the others so inputs, quiz progress and animation position survive.
- The cycle animation only runs while its tab is active and respects `prefers-reduced-motion`.

## Deploy

**Vercel / Netlify / any static host**: build command `npm run build`, output `dist`. No config needed.

**GitHub Pages**: this app is deployed as part of the [Beliz Hub](../README.md). The root `.github/workflows/pages.yml` runs the tests, builds with `VITE_BASE=/BelizHub/pcr-explained/`, and publishes on push to `main`. Live at https://jewelshovan.github.io/BelizHub/pcr-explained/

**Single-file artifact**: `npm run build:single`, then share `dist-single/index.html`. It uses relative asset paths and inlines JS and CSS; only the Google Fonts request goes to the network, and the fallback fonts are fine without it.

## Caveats baked into the content

- Tm ignores Mg²⁺ and additives; the app says so and links the NEB calculator. Dimer and hairpin checks are complementary-run heuristics, not ΔG.
- The high-fidelity preset uses generic Q5/Phusion-style timings; the enzyme datasheet wins.
- Reagent concentrations are for a standard 50 µL Taq reaction.
