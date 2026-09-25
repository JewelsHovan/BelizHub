# Lecture → notes: the end-to-end guide

Turn a McGill lecture recording into a **Word document with each slide and the
transcript spoken over it**, timestamped. Everything runs locally; nothing you
download is committed (this repo is public).

```
signed URL ──► fetch_lecture.py ──► lectures/<slug>.mp4 ──┬─► run.py ──► out/<slug>.segments.json ─┐
 (from your      (download+trim)      (trimmed video)      │                                        ├─► slidedoc.py ─► out/<slug>.slides.docx
  browser)                                                 └────────────────────────────────────────┘
```

## 0. One-time setup

```bash
cd lecture-pipeline
just setup            # creates .venv, installs requirements.txt
brew install ffmpeg   # if you don't have it
```

You also need, in your shell environment, an `OPENAI_API_KEY` for the `best`
transcription backend (or use `backend := "local"` in the `justfile` to stay
fully offline). Optional `GEMINI_API_KEY` adds a cross-check engine.

Set your course once at the top of the `justfile` (`course`, `course_full`,
`lecturer`, `course_id`). The `course_id` is the number in the LRSWAPI calls —
find it by running `just urls` (it's baked into the snippet) or from the Network
tab (`.../api/MediaRecordings/dto/<course_id>`).

## 1. Get the signed URL (the only manual step)

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
**title** (shown on the doc), and the **date**. That runs all three stages and
leaves you `out/lecture-3.slides.docx`.

```bash
just open lecture-3      # open the doc (macOS)
```

## Or run the stages individually

```bash
just fetch '<url>' lecture-3                                   # -> lectures/lecture-3.mp4
just transcribe lectures/lecture-3.mp4 lecture-3 "Lecture 3" 2026-09-18
just slides     lectures/lecture-3.mp4 lecture-3 "Lecture 3" 2026-09-18
```

Tweak the doc later without re-downloading or re-transcribing:

```bash
just redoc lecture-3 "Lecture 3 — new title" 2026-09-18
```

## What each stage does

| Stage | Tool | Notes |
| --- | --- | --- |
| **fetch** | `fetch_lecture.py` | Parses the HLS playlist, pulls the single ~3 GB TS file with parallel ranged requests (~10× one connection), remuxes to MP4 losslessly, and trims trailing dead air (a 3-h recording is often ~1 h of class). `--no-trim` keeps it all. |
| **transcribe** | `pipeline/run.py` | `best` backend = `gpt-transcribe` wording on `whisper-1` timings, cross-checked, primed with the course's verified vocabulary. See the main [README](../README.md). |
| **slides** | `slidedoc.py` | Detects slide changes by frame-differencing (robust for text slides), grabs a 720p frame per slide, de-duplicates pointer-only repeats, and aligns each transcript cue to the slide that was up. Passages the engines disagreed on are italic-orange. |

## Outputs (all gitignored)

```
lectures/<slug>.mp4          trimmed video
out/<slug>.vtt               transcript (import into the Lecture Desk)
out/<slug>.txt               plain transcript
out/<slug>.readable.md       readable transcript with timestamps
out/<slug>.notes.md          section map
out/<slug>.segments.json     cues (used by slidedoc)
out/<slug>.slides.docx       ← the slide-aligned document
```

## Troubleshooting

- **`Assembled size != expected` / 403s** — the URL's token expired; grab a fresh
  one (`just urls`) and re-run `just fetch`.
- **Slides look split on one topic** — a moving laser-pointer dot can trip the
  detector; `slidedoc.py`'s perceptual-hash dedup already merges near-identical
  frames. Genuine animation builds are kept as separate steps on purpose.
- **Want higher transcription accuracy** — the pipeline is on OpenAI's current
  `gpt-transcribe`; ElevenLabs Scribe v2 and Gemini 3 Pro score a bit lower WER.
  See `pipeline/asr_api.py`.
