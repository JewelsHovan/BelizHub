# Lecture Desk

Beliz’s private, local study workspace. **Python 3.10+ is the only runtime dependency.** No account, cloud calls, API keys, transcription engine, or model service is connected.

## Open the app

From the BelizHub project folder:

```bash
python3 lecture-desk/server.py
```

Open **http://127.0.0.1:4317/**. Keep the terminal running; stop with Ctrl+C. On macOS, you can also double-click `Start Lecture Desk.command` (downloaded scripts may require granting permission to open them).

Run the same command next time. Your saved lectures and position remain on disk. Closing the browser does not stop the server. If port 4317 is busy, use `--port 4318` and open the address printed in the terminal; the public hub shortcut always uses 4317.

### Optional: bring RT-PCR onto the laptop

The existing visual lab is separate from the Python app. With Node.js 22 installed, build it once:

```bash
cd pcr-explained
npm ci
npm run build
```

The Lecture Desk’s Visual lab link serves that build at `/pcr-explained/`. If it has not been built, the link shows setup instructions and an optional public-site link. Local builds use relative assets; GitHub Pages builds use their explicit deployment prefix. The existing lab uses external video thumbnails, fonts, and video/source links; those are separate from the Lecture Desk’s offline interface.

## Try one lecture

1. **Try the sample** for an explicitly authored, six-passage PCR-controls example. It is not a real lecture or McGill material and has no recording or slides.
2. **Add lecture**: give it a course, title, and date; import a UTF-8 TXT, SRT, or VTT file, or paste plain text. Confirm permission to use and locally process the teaching material.
3. Optionally attach **audio** (MP3, M4A, WAV, OGG, WebM, FLAC) and **PDF slides**. The app copies originals to its data folder. Limits: 5 MB transcript, 500 MB per attachment. Browser audio-codec support varies; MP3/WAV are useful fallbacks.
4. Select a source passage. Add **Lost here**, **Important**, or **Ask about this** markers. Write a source-linked note, or a brief in your own words.
5. The **brief auto-saves** after typing pauses. Notes use an explicit **Save note** button and can be edited. Unsaved forms warn before leaving. Failed saves retain their text on screen for retry. Position saves on source selection, every few seconds during playback, and on pause/leave; an abrupt browser or laptop crash can lose the latest unsaved seconds/text.
6. Write a question with an expected answer and source. **Check it against the source** before it enters practice. The authored sample’s three questions are already checked against its sample transcript.
7. **Practice** asks one question at a time. Try an answer, ask for a hint, reveal the expected explanation, and self-rate. Typed attempts are saved with the rating; skipped/unrated attempts are not saved. Successful recall uses a simple 1-, 3-, then 7-day schedule; “revisit” returns tomorrow. Choose **Just one thing** on the home screen for one question instead of up to three. These are adjustable-by-session starting conventions, not a validated learning intervention or an AI assessment.

The full transcript is always available. TXT uses real paragraph references, not fabricated audio times. SRT/VTT imports preserve source offsets and reject malformed cues rather than silently dropping them. Start/gap/end checks are warnings, **not proof of complete coverage or scientific accuracy**. Overlapping captions are accepted; playback highlights the first matching cue.

## Storage and privacy boundary

Default data location:

```text
~/.local/share/beliz-hub/
├── lectures.sqlite3
└── media/                 # attached originals, addressed by generated IDs
```

Override it with `--data-dir /a/private/folder` or `BELIZ_DATA_DIR`. Startup rejects paths inside this repository **before creating data**. Do not choose a public, shared, or automatically published folder. The startup terminal displays the actual location.

- The server binds **only to 127.0.0.1**, never the LAN. There is deliberately no remote-access setting.
- Exact Host checks resist DNS rebinding. Cross-origin requests are rejected, writes require a non-simple header, and there are no permissive CORS headers.
- Only explicit app assets and the built visual lab are served. The repository and data folder are not static document roots.
- Study pages use a self-only content policy and locally bundled fonts. Untrusted transcript/note content is rendered as text, not HTML or instructions.
- Study responses are not browser-cached. Request paths and lecture data are not written to server logs.
- New app files use owner-only permissions on POSIX systems. SQLite transactions preserve concurrent changes to different lecture fields.
- **Not a hardened multi-user service:** no login or application-level encryption. Other software or people with access to the same computer account can read the data or call the local API. Use a protected account and disk encryption. Do not expose the port through a tunnel or reverse proxy.
- Recording consent and permission to process content are separate questions. Use only permitted personal-study content; keep confidential research or internship material out of the initial pilot.

## Back up, export, delete

**Full backup / restore:** stop the local server, then copy the entire data folder to a private backup location. To restore, stop the server, preserve the current folder if needed, and replace it with the backup. Start with the same `--data-dir` afterward. This includes media and the database; copying only the database omits attachments.

**Portable lecture export:** `Export lecture` downloads a ZIP with:

- unchanged transcript text;
- `notes.md`, including source passages;
- `questions.csv` with source references, hints, and checked state (suitable for mapping into Anki fields; CSV is not an Anki package);
- `lecture.json`, including stable passage IDs, markers, notes, position, question review history, and uncertainty warnings;
- original attached audio/PDF files.

Spreadsheet-formula-looking CSV cells are escaped. Exports contain private material. **ZIP import/one-click restore is not implemented**; use the full-folder backup procedure for restoration.

**Delete:** Manage → Delete lecture removes the database record, notes, reviews, and attached app copies. It does not touch original files outside the app, exports, browser downloads, or backups. This is ordinary deletion, not guaranteed forensic erasure. Replacing an attachment similarly deletes only the previous app copy. Failed attachment imports keep the transcript so the file can be retried under Files & checks.

## Scope of this first version

Working: transcript import, course/title filtering, transcript search, original audio playback with seeking, PDF attachment/open/download, saved place, markers, manual brief and editable source-linked notes, source-checked questions, bounded self-review, export/delete, and the RT-PCR entry point.

Intentionally not connected: automatic transcription, generated notes/questions, slide alignment/OCR, live recording, reminders, sync/accounts, automated scientific grading, new visual modules, and a concept graph. Do not mistake the manual study brief for AI output or an exhaustive account of a lecture. Use instructor-approved protocols, not generated study material, for operational lab work.

Next useful trial: one permitted lecture with Beliz. Can she find a missed passage, leave a useful explanation, and reopen it without extra administration? Let that decide whether local transcription or a new visual module comes next.

## Development and verification

The runtime is Python standard library + SQLite + plain browser modules. Node dependencies are **development-only**.

```bash
# From repo root: parser, persistence, export, and real HTTP/security tests
python3 -m unittest discover -s lecture-desk/tests -v

# Browser tests: use temporary, synthetic data outside the repository
cd lecture-desk
npm ci
npx playwright install chromium
npm run test:browser
```

Build `pcr-explained` first for the visual-lab browser checks. Browser tests launch disposable loopback servers on ports 4318 and 4319, exercise full workflows, verify mobile/tablet layout, check accessibility with axe, test the Pages subpath, and assert that Lecture Desk makes no external requests. Test artifacts are ignored. They do not open or delete the real app data directory.

GitHub Actions runs the Python tests, existing PCR tests/build, and browser checks. Deployment explicitly copies only `index.html`, public `assets/`, and the PCR build into the Pages artifact. It never copies `lecture-desk/` or a study data folder.
