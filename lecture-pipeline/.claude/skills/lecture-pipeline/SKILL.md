---
name: lecture-pipeline
description: Pilot the BelizHub lecture pipeline, which turns a McGill lecture recording into a per-slide study page (notes/transcript toggle, optional embedded audio) and a Word/Markdown doc used as AI context. Use when the user pastes a signed LRS .m3u8 URL or an `./lp run` / `just lecture` command, asks to process, transcribe or "run" a lecture, rebuild, retitle or fix a lecture's outputs, add a course, correct a mis-transcribed term, or asks which lectures exist. Covers the ./lp CLI, monitoring long runs, sanity-checking results, and the fix loop.
---

# Piloting the lecture pipeline

Everything runs from `lecture-pipeline/` through **`./lp`** (`cli.py`). The
justfile only holds shortcuts. `docs/GUIDE.md` is the user-facing guide. This
file covers how to drive the pipeline well.

Stages: `fetch → transcribe → slides → notes → study`. Per lecture, the outputs
are in `out/<slug>.*`:

| File | For |
|---|---|
| `.study.html` | studying and emailing (lean, 5–15 MB) |
| `.study-audio.html` | the same with the lecture audio embedded (~45–50 MB), plays anywhere |
| `.slides.docx` / `.slides.md` | AI context: per slide, the summary, OCR'd slide text and transcript |
| `.review.md` | what the LLM review fixed and what "needs a human ear" |

Each lecture's course, title and date are kept in `work/<slug>/lecture.json`,
so `./lp redo` never needs them retyped.

## 1. Preflight

```bash
./lp check      # tools, venv, API keys, profiles
./lp courses    # known courses; * = default
./lp list       # existing lectures
```

## 2. Running lectures from signed URLs

- **URLs expire.** `etime=YYYYMMDDHHMM` in the URL is the deadline, usually a
  few hours out. Start every download **immediately and in parallel**, one
  background Bash job per lecture, with the log in the scratchpad:
  `./lp run '<url>' --date D --course-id ID > $SCRATCH/<slug>.log 2>&1`.
  Only fetch needs the URL. Everything after it works from the local copy.
- **Course resolution** order: `--course CODE`, then `--course-id` (mapped via a
  profile's `course_id`), then the default course. An unknown id makes `lp`
  stop and print the `./lp course … --id …` line to run.
- **Course unknown?** Don't guess from the default. Fetch first (it needs no
  course): `uv run python fetch_lecture.py --url '<url>' --name <slug>`.
  Identify the course from the title slide: extract a frame, or run slides and
  read OCR/contact sheets. Look for "Bioinformatics (BTEC501)", a lecturer
  name, or the Zoom name tag. Then create the profile and run
  `./lp run '<url>' --slug <slug> --date D --course CODE --skip-fetch`.
- **No real title?** Omit `--title`. `lp` names the lecture from its slides
  after the notes step. The extension sends none when LRS has none.
- **Monitor** with one Monitor per batch:
  `tail -F log | grep -E --line-buffered "^\[|Done|Stage failed|Traceback|Error"`.
  Match failures too, not just success. Timing for a 2–3 h recording: fetch
  5–8 min, transcribe 8–12 min (the Gemini cross-check is the slow part),
  slides, notes and study about 5 min in total.
- **Processes:** `ps` output is filtered in this sandbox, so use
  `pgrep -fl "pipeline/run.py"`. **Never** run two jobs on the same slug. They
  share `work/<slug>/` caches and corrupt each other. If an earlier attempt
  "seems dead", confirm with pgrep before relaunching.

## 3. Sanity-check every result (don't skip)

1. `./lp list`: the slide count and the review line ("N fixed, M ear").
2. **Does the content match the course?** Read the head of
   `out/<slug>.notes.md` or the first slide titles. A bioinformatics lecture
   once got labelled with the biotech default course. If it's wrong:
   `./lp redo <slug> --course CODE --from transcribe`.
3. Skim `out/<slug>.review.md`. The "Rejected" list is often a homophone the
   audio can't settle (blossom/BLOSUM, "a STREAM"/STREME). That's a lexicon
   job, see §4.
4. Report to the user: outputs, slide count, review counts, and anything that
   needs their ear. Don't claim things you haven't checked.

## 4. Fix loop (cheapest stage first; caches make redo cheap)

| Problem | Command |
|---|---|
| Wrong or ugly title | `./lp redo <slug> --title "…" --from notes`, or `--auto-title` |
| Recurring mis-hearing | `./lp fix CODE TERM wrong1 "wrong 2"`, then `./lp redo <slug> --from transcribe` |
| Wrong course or lecturer | fix the profile (`./lp course CODE --lecturer …`) or `redo --course`, `--from transcribe` |
| Page or doc layout changed in code | `./lp redo <slug> --from study` (page) / `--from slides` (doc) |
| A stage crashed | fix the cause, `./lp redo <slug> --from <stage>` |

Lexicon entries must be **observed** mis-hearings. A profile's `lexicon`
*replaces* the built-in BTEC620 rules (those do things like "essay → assay",
which is wrong in other subjects). Changing slide grouping
(`slidedoc.py` → `Matcher`, `group`) is a code change. Tune it against the
frames already in `work/<slug>/slidedoc/slides/` using contact sheets. Current
thresholds:

- same slide: masked-pixel diff < 0.008, or OCR-word Jaccard ≥ 0.85
- build: previous slide's words ⊆ new slide ≥ 0.95; the added pixels ≥ 0.8 on background
- fold: any frame < 8 s

## 5. New course

```bash
./lp course CODE --title "CODE 123 — Name" --lecturer "…" --id <LRSWAPI id> \
    --subject "what it covers" --examples "unusual, terms, it, really, uses" [--default]
```

Do this **before** the first lecture's transcribe stage. Without
`review_context` the review pass assumes a molecular-biology lab course. The
vocabulary then grows by itself with each lecture.

## 6. Verifying the HTML in a browser

- claude-in-chrome can't open `file://`. Serve a copy with
  `uv run --no-project python -m http.server <port> --bind 127.0.0.1` from the
  folder, then stop it afterwards.
- The automation tab reports `document.visibilityState === "hidden"`, so
  `<audio>`/`<video>` never load there. Check the audio with
  `AudioContext.decodeAudioData`. Check player logic by stubbing the element's
  `currentTime`/`paused`/`play` and dispatching `timeupdate`. **Say you couldn't
  hear playback** rather than implying you did.
- Python's http.server has no Range support, so the lean page's local video
  can't seek there. That's fine over `file://`.
- To simulate a shared copy, serve it from a folder with no `lectures/` next to
  it: play controls should be hidden on the lean page and working on the
  `-audio` page.

## Guardrails

- **Public repo.** `out/ work/ courses/ lectures/` are gitignored and must stay
  that way. Signed URLs are credentials: keep them out of committed files.
- Study pages can contain **Zoom gallery frames with classmates' names and
  faces**, plus the whole class transcript. Mention this before the user shares.
- **Never infer the lecturer's pronouns** from their name. Say "the lecturer"
  or "they".
- **API spend:** gpt-transcribe/whisper-1, the gpt-5.5 review and notes, and the
  Gemini cross-check. Rebuild from the latest stage that actually changed.

## Code map

`cli.py` (lp) · `fetch_lecture.py` · `pipeline/run.py` (transcribe; review in
`review.py`, lexicon in `lexicon.py`, course profiles in `course.py`, registry
names in `entities.py`) · `slidedoc.py` (OCR, grouping, docx/md/json) ·
`slidenotes.py` (per-slide notes, auto-title) · `studypage.py` (HTML;
`--embed-audio`) · `extension/` (copies `./lp run` commands).
