# RT-PCR, from RNA to result

Interactive explainer for two-step RT-PCR aimed at biotech master's students: keeping RNA intact and the reagents of the RT reaction, a step-through of reverse transcription with the three priming strategies, the PCR cycle animated at the molecular level, the readout (gel, or real time with Cq, ΔΔCq, melt curve and standard-curve efficiency), a primer checker that locates the pair on your transcript and reports the amplicon, a two-stage protocol builder (RT mixes and program, then PCR or qPCR master mix, cycling program, plate planner, bench steps with the reason for each), troubleshooting, a quiz, and verified YouTube videos for every stage. Every section links to its sources.

React 18 + Vite, plain CSS modules, no other runtime dependencies. Inputs are saved in `localStorage` so a protocol survives a reload.

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
    thermo.js     nearest-neighbour Tm (SantaLucia 1998), dimer/hairpin heuristics, verdicts, locatePrimers (pair on a transcript)
    rt.js         reverse-transcription mixes, −RT control, RT program, text export
    protocol.js   PCR-stage master mix (gel, SYBR, probe), cycling program, bench steps, text export
    qpcr.js       Cq from a curve, ΔΔCq and Pfaffl, efficiency from slope, plate well count
    copies.js     strand bookkeeping for cycles 0–4, efficiency/plateau model
    cycle.js      temperature profile and molecular-view geometry for one cycle
    units.js      copies-from-ng (DNA and RNA), superscripts, formatting
  data/         content only: reagents, sources registry, troubleshooting, quiz, verified videos
  components/   one per tab plus shared bits (Tabs, Sources, Videos, Details, Chip, Glyphs, Rich)
  hooks/        useHashRoute (#s3 deep links), useCycleClock (rAF), useReducedMotion, useLocalState
  styles/       global.css: design tokens and shared primitives
```

Rules of thumb:

- Anything computed lives in `lib/` and gets a test. Components only render.
- Content edits go in `data/`. To cite something new, add it to `data/sources.js` once and reference the key from any `<Sources keys={[...]}/>`. Videos go in `data/videos.js` and must be verified against YouTube's oEmbed endpoint before being listed; `<Videos topics={[...]}/>` filters by tag.
- Fields rendered through `<Rich/>` may contain `<b>` and `<em>` only. Key phrases are bolded on purpose so the text can be skimmed.
- Every section stays mounted; switching tabs hides the others so inputs, quiz progress and animation position survive.
- The cycle animation only runs while its tab is active and respects `prefers-reduced-motion`.

## Deploy

**Vercel / Netlify / any static host**: build command `npm run build`, output `dist`. No config needed.

**GitHub Pages**: this app is deployed as part of the [Beliz Hub](../README.md). The root `.github/workflows/pages.yml` runs the tests, builds with `VITE_BASE=/BelizHub/pcr-explained/`, and publishes on push to `main`. Live at https://julienhovan.com/BelizHub/pcr-explained/

**Single-file artifact**: `npm run build:single`, then share `dist-single/index.html`. It uses relative asset paths and inlines JS and CSS; only the Google Fonts request goes to the network, and the fallback fonts are fine without it.

## Caveats baked into the content

- Tm ignores Mg²⁺ and additives; the app says so and links the NEB calculator. Dimer and hairpin checks are complementary-run heuristics, not ΔG.
- RT volumes follow the generic SuperScript / ProtoScript II layout (13 µL RNA-primer-dNTP mix heated to 65 °C, then 7 µL enzyme mix); the enzyme datasheet wins. One-step kits are represented by adding the RT step to the PCR program.
- qPCR programs assume a combined 60 °C anneal/extend and a 2× master mix; probe and SYBR primer concentrations are typical, not universal.
- The transcript check requires exact matches and does not check specificity; Primer-BLAST does.
