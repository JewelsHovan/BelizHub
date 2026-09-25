# Lecture → notes: the end-to-end guide

Turn a McGill lecture recording into two things, one entry per distinct slide:

- **a study page** (`out/<slug>.study.html`) — the slide, with a toggle between
  succinct notes and the raw transcript. One self-contained file: open it in any
  browser, or send it to someone.
- **a context document** (`out/<slug>.slides.docx`, plus a lighter `.slides.md`)
  — slide image, the text on the slide, and the transcript, to hand to an AI.

Everything runs locally except the API calls; nothing you download is committed
(this repo is public).

```
./lp run ─► fetch_lecture.py ─► lectures/<slug>.mp4 ─┬─► run.py ─► segments.json ─┐
                                                       │                             ├─► slidedoc.py ─► .slides.docx / .md / .json
                                                       └─────────────────────────────┘                          │
                                                                        slidenotes.py (notes per slide) ◄───────┤
                                                                        studypage.py ─────────────────────────► .study.html
```

## 0. One-time setup

```bash
cd lecture-pipeline
brew install ffmpeg tesseract   # video tools; tesseract reads slide text
just setup                      # creates .venv, installs requirements, runs ./lp check
```

Your shell needs `OPENAI_API_KEY` (transcription, review, notes). `GEMINI_API_KEY`
is optional and adds a cross-check engine. `./lp check` says what's missing.

Load the Chrome extension once: `just ext-dev` → *Developer mode* → *Load
unpacked* → `lecture-pipeline/extension/`.

**Everything is driven by `./lp`** (`./lp --help`); the `justfile` only holds
shortcuts to it.

## 1. Tell it about the course (once per course)

```bash
./lp course BTEC501 --title "BTEC 501 — Bioinformatics" --lecturer "Dr. …" \
    --id <LRSWAPI course id> --subject "bioinformatics: sequence alignment, BLAST"
./lp courses                     # what's set up; * marks the default
```

This writes `courses/<code>.json` (gitignored). The **id** lets `lp` recognise the
course from what the extension copies — if you don't know it, just run a lecture:
`lp` stops and prints the exact `./lp course … --id …` line to run. `--subject`
tells the transcriber and the review pass what the lecture is about; without a
profile they assume a molecular-biology lab course. `--default` makes a course
the one used when a command names none. More keys (unusual terms, a lexicon) are
in the README's *Course profiles*.

## 2. Run a lecture

On myCourses → **Lecture Recordings**, click the extension icon, then **Copy** on
the lecture. Paste into the terminal (in `lecture-pipeline/`):

```bash
./lp run '<signed url>' --date 2026-10-01 --course-id 97394
```

That's the whole thing: download → transcript (+ review) → slides → notes → both
study pages, ~20–30 min for a 2–3 h recording. The slug defaults to
`<course>-<date>` (`--slug` to choose), and with no `--title` the lecture is
named from its slides once the notes exist. You can also name the course
directly: `--course BTEC501`. The URL is valid for a few hours — run it soon.
Several lectures can run at once in separate terminals.

```bash
./lp list                     # every lecture: slides, review status, which files exist
./lp open btec501-2026-10-01  # the study page       (--audio / --doc / --md / --review)
```

No extension? `./lp urls --course BTEC501` prints a DevTools console snippet:
paste it into the Lecture Recordings tab's console (F12) and it copies the
signed URLs. Treat them like passwords.

## 3. Study, share, fix

Two study pages are written per lecture:

- `out/<slug>.study.html` — lean (5–15 MB), the one to email. Timestamps play
  the lecture only on your machine, while the recording is still at
  `lectures/<slug>.mp4`; a shared copy just shows the times.
- `out/<slug>.study-audio.html` — the lecture audio is inside (~11 MB per hour
  of lecture on top, speech-grade HE-AAC), so playback works anywhere. Too big
  for most email; share it via Drive/AirDrop. Recipients should download it and
  open it in a browser (Drive/Dropbox previews show code; iPhone previews are blank).

On either page: <kbd>←</kbd>/<kbd>→</kbd> change slide, <kbd>T</kbd> flips notes ↔
transcript, <kbd>/</kbd> searches, <kbd>P</kbd> plays/pauses. A slide's ▶ plays just
that slide and stops at its end; press play again to keep listening, and with
*Follow slides* on the page turns to each slide as the lecture reaches it and
highlights the sentence being spoken. Navigating yourself switches follow off.

`out/<slug>.review.md` lists what the review pass fixed and the passages it
wants a human ear on. A term the transcript keeps getting wrong — typically a
homophone the review can't confirm by re-listening ("blossom" for BLOSUM) — goes
into the course's lexicon, then rebuild from the transcript:

```bash
./lp fix BTEC501 BLOSUM blossom blossum
./lp redo btec501-2026-10-01 --from transcribe
```

`./lp redo <slug> --from <stage>` rebuilds from any stage (fetch, transcribe,
slides, notes, study) with the lecture's remembered course/title/date; cached
work is reused, so only what changed costs time or API calls. `--title "…"` or
`--auto-title` renames it.

## What each stage does

| Stage | Tool | Notes |
| --- | --- | --- |
| **fetch** | `fetch_lecture.py` | Parses the HLS playlist, pulls the single ~3 GB TS file with parallel ranged requests (~10× one connection), remuxes to MP4 losslessly, and trims trailing dead air (a 3-h recording is often ~1 h of class). `--no-trim` keeps it all. |
| **transcribe** | `pipeline/run.py` | `best` backend = `gpt-transcribe` wording on `whisper-1` timings, cross-checked, primed with the course's verified vocabulary. See the main [README](../README.md). |
| **slides** | `slidedoc.py` | Detects slide changes by frame-differencing, grabs a frame per change, OCRs it, then groups frames into **one entry per distinct slide**: webcam/pointer-only changes and animation builds merge (the fully built slide is kept), a slide the lecturer returns to gets the later visit added to its entry, and brief frames (flipping past slides, the PowerPoint editor) fold into the slide around them. Each transcript cue goes to the slide visit it was spoken in. |
| **notes** | `slidenotes.py` | Per slide: a short title, 3–6 bullet notes, key terms, and anything the lecturer stressed — written from that slide's text and transcript only. Cached in `work/<slug>/slidenotes.json`. |
| **study** | `studypage.py` | Builds the self-contained HTML study pages (images embedded; `--embed-audio` also writes the version with the lecture audio inside). |

## Outputs (all gitignored)

```
lectures/<slug>.mp4          trimmed video
out/<slug>.vtt               transcript (import into the Lecture Desk)
out/<slug>.txt               plain transcript
out/<slug>.readable.md       readable transcript with timestamps
out/<slug>.notes.md          section map
out/<slug>.segments.json     cues (used by slidedoc)
out/<slug>.slides.docx       ← context doc: per slide image, slide text, transcript
out/<slug>.slides.md         the same without images (lightest AI context)
out/<slug>.slides.json       slide records + notes (feeds the study page)
out/<slug>.study.html        ← the study page (lean, to share)
out/<slug>.study-audio.html  ← the same with the lecture audio inside
```

## Troubleshooting

- **`Assembled size != expected` / 403s** — the URL's token expired; copy a fresh
  one and `./lp run` again (or `./lp redo <slug> --from fetch --url '<url>'`).
- **"No course profile has course_id …"** — first lecture of a new course: run
  the `./lp course …` line it prints.
- **Wrong course/lecturer on a doc** — `./lp redo <slug> --course CODE --from transcribe`.
- **A stage failed** — fix the cause and `./lp redo <slug> --from <that stage>`.
- **A slide still appears twice** — grouping compares OCR'd slide text and the
  slide pixels with the webcam masked out. Live demos (scrolling a web page) are
  genuinely different screens and stay separate. Without `tesseract` installed
  it falls back to pixels only, which merges less.
- **Want higher transcription accuracy** — the pipeline is on OpenAI's current
  `gpt-transcribe`; ElevenLabs Scribe v2 and Gemini 3 Pro score a bit lower WER.
  See `pipeline/asr_api.py`.
