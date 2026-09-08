# Lecture pipeline

Turns a lecture recording into a timestamped transcript, a study map, and a
`.vtt` the [Lecture Desk](../lecture-desk/) imports directly.

**Nothing it produces is committed.** `work/` and `out/` are ignored; the repo is
public and lecture recordings are not.

## Use it

```bash
uv venv --python 3.12 && uv pip install mlx-whisper openai google-genai jiwer
python pipeline/run.py "BTEC620 lecture 1.m4a" \
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

## Measuring it

```bash
python eval/sweep.py       # decode-config comparison, local
python eval/benchmark.py   # 11-engine accuracy comparison (uploads audio)
```

`eval/metrics.py` scores transcripts without a reference: contiguous-repetition
rate, degenerate lines, and a course-term audit. Repetition is measured
*contiguously* on purpose — counting raw n-gram frequency mistook this
lecturer's "we are going to be" for a decoding loop.

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
