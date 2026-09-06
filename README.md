# Beliz Hub

A personal biotechnology study hub: public interactive explainers, plus a **private local Lecture Desk** for returning to lectures and practising ideas.

**Public hub:** https://julienhovan.com/BelizHub/

## Open the private workspace

Requires Python 3.10+, with no additional runtime packages. From this folder:

```bash
python3 lecture-desk/server.py
```

Then open **http://127.0.0.1:4317/**. On macOS, `Start Lecture Desk.command` is a double-click launcher. Try the authored sample, or add a permitted transcript and optional recording/PDF slides.

Lecture Desk supports source-linked notes, bookmarks, saved playback position, course filtering, short self-review sessions, and export/delete. Data stays outside this repo in `~/.local/share/beliz-hub/` by default. **No AI processing or automatic transcription is connected yet.**

See **[`lecture-desk/README.md`](lecture-desk/README.md)** for setup, privacy limitations, backup/restore, supported files, and tests.

## Apps

| App | Location | Runs where |
| --- | --- | --- |
| Lecture Desk | [`lecture-desk/`](lecture-desk/) | On her laptop only |
| RT-PCR, from RNA to result | [`pcr-explained/`](pcr-explained/) | [Public site](https://julienhovan.com/BelizHub/pcr-explained/) or a local build |

The root `index.html` is the public hub. `assets/hub.css` and locally bundled, OFL-licensed fonts provide the shared visual language. The public page explains how to open the separate local workspace; it does not fetch, receive, or display private lecture data.

## Working on the visual lab

```bash
cd pcr-explained
npm ci
npm run dev
npm test
npm run build
```

After building, the local Lecture Desk serves the lab at `/pcr-explained/`. Relative asset paths support that location; production deployments use `VITE_BASE` explicitly. The existing lab can load external fonts/video thumbnails and open third-party videos and sources.

## Verification

```bash
python3 -m unittest discover -s lecture-desk/tests -v
cd lecture-desk
npm ci
npx playwright install chromium
npm run test:browser
```

Build the PCR app first for the browser tests. Those tests use temporary synthetic data and disposable local servers, not real study files.

## Deployment

`.github/workflows/pages.yml` runs on pushes to `main`:

1. Tests the local Python app.
2. Installs, tests, and builds the PCR app for local browser checks.
3. Runs browser workflow, accessibility, and subpath checks, then rebuilds PCR with `VITE_BASE=/BelizHub/pcr-explained/` (derived from the repository name).
4. Copies **only** the root `index.html`, `assets/`, and the production PCR build into `site/`.
5. Publishes that public-only artifact to GitHub Pages.

There is no cloud Lecture Desk backend and no private study data in the deployment. Never commit recordings, slides, transcripts, database backups, or private exports.

## Adding another public visual tool

Give it a separate folder, README, tests, and build. Add its build/copy steps to the workflow and link it from the hub. Connect it to a real study need before adding more modules. Do not turn future-feature cards into non-working navigation.
