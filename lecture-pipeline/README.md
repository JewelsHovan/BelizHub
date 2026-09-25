# Lecture pipeline

Turns a lecture recording into a timestamped transcript, a study map, a `.vtt` the
[Lecture Desk](../lecture-desk/) imports directly, and a **Word document with each
slide and the transcript spoken over it**.

**Nothing it produces is committed.** `work/`, `out/`, `lectures/` and downloaded
video are ignored; the repo is public and lecture recordings are not.

## Quick start

Everything is driven by **`./lp`** (`./lp --help`). See **[docs/GUIDE.md](docs/GUIDE.md)**
for the full walkthrough.

```bash
just setup                                                  # venv + requirements (once)
./lp course BTEC501 --title "…" --lecturer "…" --id <id>    # once per course
./lp run '<signed url>' --date 2026-10-01 --course-id <id>  # what the Chrome extension copies
./lp list                                                   # every lecture and what it has
./lp open <slug>                                            # the study page
```

`./lp run` downloads the recording, trims the dead air, transcribes and reviews
it, and writes `out/<slug>.study.html` (slide-by-slide study page with a
notes/transcript toggle; `.study-audio.html` has the lecture audio inside) and
`out/<slug>.slides.docx` / `.slides.md` (the same material as context for an AI).

Pieces, if you want them separately:

- **`cli.py`** (`./lp`) — runs the stages below, remembers each lecture, manages course profiles.
- **`fetch_lecture.py`** — download a recording from its signed HLS URL (parallel
  ranged fetch → lossless MP4 → trims trailing dead air).
- **`pipeline/run.py`** — audio/video → transcript, study map, `.vtt` (below).
- **`slidedoc.py`** — video + transcript → one entry per distinct slide (Word, Markdown, JSON).
- **`slidenotes.py`** — succinct study notes per slide, from its text and transcript only.
- **`studypage.py`** — the self-contained HTML study page.

## The transcription pipeline

```bash
uv run python pipeline/run.py "BTEC620 lecture 1.m4a" \
  --course BTEC620 --title "Lecture 1" --date 2026-09-03 --backend best
```

Then import `out/<slug>.vtt` in the Lecture Desk under **Add lecture**.

### Backends

| Backend | What it does | Audio leaves the machine |
| --- | --- | --- |
| `local` | `whisper-large-v3-turbo` via MLX | no |
| `api` | `whisper-1`, cross-checked by `gpt-transcribe` | yes |
| `both` | `api` plus a local cross-check | yes |
| `best` | `gpt-transcribe` wording fused onto `whisper-1` timings | yes |

`local` is the private default. `best` is the most accurate and is what produced
the current BTEC620 transcript.

## Why these settings

Every value was chosen from a measured sweep (`eval/`), not from defaults.

**Decoding loops and hallucination.** The first local decode collapsed into
`"and I have a lab"` fifty times, inflating the word rate from 137 to 212 wpm.
A second run of the *same config* instead produced fluent invention — "an Academy
Award or financial scientist". Two fixes: `condition_on_previous_text=False`
stops one bad window poisoning the rest, and `temperature=0.0` disables the
temperature-fallback resampling that made failures random. Decoding is now
deterministic, so a re-run reproduces the transcript exactly.

**Course vocabulary.** Priming the decoder with a domain prompt cut mis-heard
terms from 10 to 2 across the probe set. `pipeline/lexicon.py` then repairs known
mis-hearings, conservatively — a wrong "correction" fabricates content, which is
worse than the raw error. One entry in this file was itself wrong (`HeLa` for
what the cross-check showed to be `HEK`); it was caught by the cross-engine
comparison, not by review.

**Engine choice.** Eleven engines were benchmarked on matched slices
(`eval/benchmark.py`). `gpt-transcribe` scored zero mis-heard course terms and
the lowest mean WER to the multi-engine consensus. It cannot return timestamps,
so `fuse.py` maps its wording onto `whisper-1`'s clock.

**LLM transcribers silently drop content.** `gpt-4o-mini-transcribe` omitted ~30
seconds of a ten-minute chunk; in another run `gpt-4o-transcribe` returned 539
words where its peers returned ~780. `fuse.py` keeps `whisper-1`'s words wherever
the accurate engine dropped a stretch, so content is never lost — only re-worded.

**Confidence does not detect errors.** Whisper's `avg_logprob` flagged *none* of
the passages where the local model corrupted meaning ("releases the receptor"
for "releases the repressor", "laxative" for "lacZ"). Cross-engine disagreement
did. So `agree.py` decides what gets flagged for re-listening, and self-reported
confidence is only a fallback for single-engine runs.

## The review pass (`--review`)

A language model proof-reads the transcript for biology and lab-method errors the
lexicon cannot catch, then **every proposal is checked against the recording**
before anything is applied: the disputed moment is re-transcribed by independent
engines, and a correction is kept only if an engine that never saw the suggestion
actually heard it.

This matters more than it sounds. On this lecture the model made 18 proposals and
**10 were contradicted by the audio** - it was correcting toward the textbook
where the instructor had said something else. Applying them unchecked would have
put fabrications into a study aid, including flipping "exons" to "introns" in a
sentence where she really did say exons. Verdicts:

- `CONFIRMED` - an independent engine heard the proposed wording. Applied.
- `CONTRADICTED` - the engines agree with the original. Left as spoken.
- `UNRESOLVED` - neither could be confirmed. Listed for a human to listen to.

Guards on the model itself: it may only replace spans of at most six words, must
quote them verbatim, and any span not found in the real text is dropped. Applied
edits are scoped to the timestamp that was verified, so a short generic phrase is
not rewritten elsewhere in the lecture.

Everything proposed, applied and rejected is written to `<slug>.review.md`.

**This stage is not reproducible.** The ASR config is deterministic; the review
model is not, and proposals vary between runs. Treat `review.md` as a record of
one review, not a fixed property of the transcript.

## Names checked against public registries (`--review`)

Gene, protein, reagent, cell-line and organism names are extracted from the
transcript and looked up in the registries that actually decide the question:

| Registry | Covers |
| --- | --- |
| HGNC | approved human gene symbols, aliases, withdrawn symbols |
| UniProt | proteins and genes in any organism, plus taxonomy |
| PubChem | reagents, buffers, substrates |
| Cellosaurus | cell lines |

All keyless; results cached in `work/ontology_cache.json`.

A model alone cannot do this. It will endorse a gene it invented and reject a
real but unfamiliar one. But a registry alone cannot do it either - it has no
idea that "receptor" in a given sentence is a common noun. So the model decides
*whether a phrase is a name*, and the registry decides *whether that name is
real*.

Precision matters more than recall here, because a false "valid" certifies a
mis-hearing as biology. Every one of these was a real false positive found while
building it, and each is now handled:

- `laxative` matched a UniProt "Laxative peptide" - common nouns are stoplisted.
- `beta-galactosidase` matched glucose, because PubChem lists it as a synonym of
  beta-D-galactose - `-ase` names route to the protein registries first.
- `Taq polymerase` matched gene LEO1 through loose alias scoring - alias hits are
  re-fetched and required to match exactly.
- `HeLa` matched a protein called helA - cell lines resolve before protein names.
- `lacZ gene` matched nothing - descriptor words are stripped and the head name
  retried.

**Absence from a registry is not evidence of an error.** "poly-A tail" and
"silica surface" are correct but catalogued nowhere, so unresolved names are
split into probable mis-hearings (odd single tokens) and ordinary descriptive
phrases. Results go to `<slug>.entities.md`.

## Course profiles: getting better per class

`courses/<course>.json` accumulates every registry-confirmed name from every
lecture in that course. It is **gitignored** - it is derived from her recordings,
and this repository is public. The pipeline rebuilds it as lectures are processed. The next lecture is primed with that vocabulary instead
of a hand-written prompt, so the recogniser improves as more of a course is
transcribed - and because the vocabulary is verified, priming cannot teach it a
word that does not exist.

```bash
python pipeline/run.py lecture2.m4a --course BTEC620 --title "Lecture 2" \
  --backend best --review        # primed by what lecture 1 established
```

This is what generalises the pipeline beyond one recording: nothing in it is
specific to BTEC620 except the contents of that JSON file, which the pipeline
writes itself.

A profile can also describe its course, which matters when the subject changes
(the default prompts assume a molecular-biology lab course). Add these keys by
hand; the pipeline keeps them:

```json
{
  "title": "BTEC 501 — Bioinformatics",
  "lecturer": "Dr. …",
  "decoder_context": "University lecture in bioinformatics: sequence alignment, …",
  "review_context": "a university bioinformatics lecture (…), recorded over Zoom. …",
  "review_examples": "PAM250, BLOSUM62, BLASTP, E-value, …",
  "lexicon": {"BLOSUM": ["blossom"], "k-tuple": ["K-two-POL"]}
}
```

`title`/`lecturer` go on the documents, `decoder_context` primes the recogniser,
and `review_context`/`review_examples` tell the review pass what subject it is
proof-reading and which unusual terms are correct. `lexicon` maps a term to
mis-hearings actually seen in that course; when present it **replaces** the
built-in BTEC620 rules in `pipeline/lexicon.py`, whose fixes (essay → assay,
opera → operon) are wrong in other subjects. It is the place for homophones the
review pass cannot confirm by re-listening ("blossom" and "BLOSUM" sound the same). `pipeline/lexicon.py` remains a hand-written fallback for a
course with no profile yet.

## Measuring it

```bash
python eval/sweep.py       # decode-config comparison, local
python eval/benchmark.py   # 11-engine accuracy comparison (uploads audio)
```

`eval/metrics.py` scores transcripts without a reference: contiguous-repetition
rate, degenerate lines, and a course-term audit. Repetition is measured
*contiguously* on purpose — counting raw n-gram frequency mistook this
lecturer's "we are going to be" for a decoding loop.

## Chrome extension (optional)

`extension/` is a Manifest V3 Chrome extension that replaces the `./lp urls`
console snippet. Click the extension icon on a myCourses **Lecture Recordings**
page and it reads your session token from the LRS app directly, auto-detects
the course, and lists each recording with a **Copy** button that puts a
ready-to-paste `./lp run '<url>' --date … --course-id …` command on your
clipboard (`lp` maps the course id to its course profile). There's also a
**Find my other courses** scanner and a Debug section (endpoints tried, JWT
claims, store shapes) for when McGill changes something.

```bash
# Load it once in Chrome:
just ext-dev          # opens chrome://extensions
# → Enable Developer mode → Load unpacked → select lecture-pipeline/extension/
```

Works on the myCourses page (the LRS is a cross-origin iframe there — the
extension finds and injects into it) or directly on `lrs.mcgill.ca`.

What we learned about the LRS while building it — JWT claims, API map, where
the Vue app hides its data — is written up in
[docs/IDEAS.md](docs/IDEAS.md).

## Known limits

- Section titles are TF-IDF keyword lists, not written summaries. They are
  navigation aids, not descriptions.
- Sections come from lexical cohesion, so a long stretch on one subject stays a
  single long section.
- No speaker separation. Student questions are transcribed but not attributed.
  `gpt-4o-transcribe-diarize` does return speaker labels but scored worse on
  course vocabulary (29 terms vs 41), so it is benchmarked, not used.
- Nothing here summarises or explains content. The notes point at the lecture;
  they do not replace it.
