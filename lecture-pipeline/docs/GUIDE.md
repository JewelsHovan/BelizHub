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
signed URL ─► fetch_lecture.py ─► lectures/<slug>.mp4 ─┬─► run.py ─► segments.json ─┐
                                                       │                             ├─► slidedoc.py ─► .slides.docx / .md / .json
                                                       └─────────────────────────────┘                          │
                                                                        slidenotes.py (notes per slide) ◄───────┤
                                                                        studypage.py ─────────────────────────► .study.html
```

## 0. One-time setup

```bash
cd lecture-pipeline
just setup            # creates .venv, installs requirements.txt
brew install ffmpeg tesseract jq   # tesseract reads slide text; jq reads course profiles
```

You also need, in your shell environment, an `OPENAI_API_KEY` for the `best`
transcription backend (or use `backend := "local"` in the `justfile` to stay
fully offline). Optional `GEMINI_API_KEY` adds a cross-check engine.

Set your default course once at the top of the `justfile` (`course`,
`default_course_full`, `default_lecturer`, `course_id`). For another course,
prefix any command with `course=<CODE>` (e.g. `just course=BTEC501 lecture …`):
the full title and lecturer then come from `courses/<code>.json` (`"title"`,
`"lecturer"` — see the README's *Course profiles*). The `course_id` is the number in the LRSWAPI calls —
find it by running `just urls` (it's baked into the snippet) or from the Network
tab (`.../api/MediaRecordings/dto/<course_id>`).

## 1. Get the signed URL

**Easiest: the Chrome extension** — click its icon on the Lecture Recordings
page, hit **Copy**, paste into the terminal. See the main
[README](../README.md#chrome-extension-optional) for the one-time install.
Everything below is the manual DevTools route.

The recording streams from a URL that carries **your** session token, so you copy
it from your own browser — the tools never handle your login.

```bash
just urls        # prints a console snippet
```

- Open **myCourses → your course → Lecture Recordings**, let the list load.
- Press **F12 → Console**, paste the snippet, Enter.
- It prints a dated list of `.m3u8` URLs and copies them to your clipboard.

(Prefer clicking? F12 → **Network** tab → filter `hls` → click the recording →
copy the request URL. Same thing.)

Each URL is valid for a few hours. Treat it like a password.

## 2. Run it — one command

```bash
just lecture '<paste one signed .m3u8 url>' lecture-3 \
     "Lecture 3 — Production via Microbial Fermentation" 2026-09-18
```

Arguments: **URL**, a short **slug** (used for every output filename), a human
**title** (shown on the doc), and the **date**. That runs every stage and
leaves you `out/lecture-3.study.html` and `out/lecture-3.slides.docx`.

```bash
just open lecture-3      # the study page (macOS)
just open-doc lecture-3  # the Word document
```

Two study pages are written per lecture:

- `out/<slug>.study.html` — lean (5–15 MB), the one to email. Timestamps play
  the lecture only on your machine, while the recording is still at
  `lectures/<slug>.mp4`; a shared copy just shows the times.
- `out/<slug>.study-audio.html` — the lecture audio is inside (~11 MB per hour
  of lecture on top, speech-grade HE-AAC), so playback works anywhere. Too big
  for most email; share it via Drive/AirDrop.

On either page: <kbd>←</kbd>/<kbd>→</kbd> change slide, <kbd>T</kbd> flips notes ↔
transcript, <kbd>/</kbd> searches, <kbd>P</kbd> plays/pauses. A slide's ▶ plays just
that slide and stops at its end; press play again to keep listening, and with
*Follow slides* on the page turns to each slide as the lecture reaches it and
highlights the sentence being spoken. Navigating yourself switches follow off.

## Or run the stages individually

```bash
just fetch '<url>' lecture-3                                   # -> lectures/lecture-3.mp4
just transcribe lectures/lecture-3.mp4 lecture-3 "Lecture 3" 2026-09-18
just slides     lectures/lecture-3.mp4 lecture-3 "Lecture 3" 2026-09-18
just notes      lecture-3                                      # succinct notes per slide
just study      lecture-3                                      # -> out/lecture-3.study.html
```

Tweak the doc and page later without re-downloading or re-transcribing (notes
are cached per slide, so only changed slides are re-written):

```bash
just redoc lecture-3 "Lecture 3 — new title" 2026-09-18
```

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

- **`Assembled size != expected` / 403s** — the URL's token expired; grab a fresh
  one (`just urls`) and re-run `just fetch`.
- **A slide still appears twice** — grouping compares OCR'd slide text and the
  slide pixels with the webcam masked out. Live demos (scrolling a web page) are
  genuinely different screens and stay separate. Without `tesseract` installed
  it falls back to pixels only, which merges less.
- **Want higher transcription accuracy** — the pipeline is on OpenAI's current
  `gpt-transcribe`; ElevenLabs Scribe v2 and Gemini 3 Pro score a bit lower WER.
  See `pipeline/asr_api.py`.
