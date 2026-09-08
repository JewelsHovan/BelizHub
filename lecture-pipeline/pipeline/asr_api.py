"""Optional hosted-ASR backends. Uploads audio to a third party by design.

Kept separate from the local path so the privacy boundary is a visible import,
never an accident. Chosen from a measured benchmark (see eval/benchmark.py):
whisper-1 supplies segment timestamps, gpt-4o-mini-transcribe scored best on
course vocabulary and is used as an independent cross-check.
"""

from lexicon import INITIAL_PROMPT

TIMED_MODEL = "whisper-1"              # only OpenAI ASR model returning segments
# Benchmarked winner: 0 mis-heard course terms and the lowest mean WER to the
# multi-engine consensus (19.3%) across 11 engines. Cannot return timestamps,
# so its wording is fused onto whisper-1's timings (see fuse.py).
ACCURATE_MODEL = "gpt-transcribe"


def _client():
    from openai import OpenAI
    return OpenAI()


def timed_segments(chunks):
    """Timestamped segments across all chunks, with offsets applied."""
    client = _client()
    segments = []
    for chunk in chunks:
        with open(chunk["path"], "rb") as fh:
            r = client.audio.transcriptions.create(
                model=TIMED_MODEL, file=fh, language="en",
                prompt=INITIAL_PROMPT, response_format="verbose_json",
            )
        off = chunk["offset"]
        for s in r.segments or []:
            text = (s.text or "").strip()
            if not text:
                continue
            segments.append({
                "start": round(float(s.start) + off, 2),
                "end": round(float(s.end) + off, 2),
                "text": text,
                "avg_logprob": round(float(getattr(s, "avg_logprob", 0.0)), 4),
                "no_speech_prob": round(float(getattr(s, "no_speech_prob", 0.0)), 4),
                "compression_ratio": round(float(getattr(s, "compression_ratio", 0.0)), 3),
                "low_confidence": float(getattr(s, "avg_logprob", 0.0)) < -0.55,
            })
    segments.sort(key=lambda s: s["start"])
    return segments


def plain_text(chunks, model=ACCURATE_MODEL):
    """Untimed but highest-accuracy text, used as the cross-check stream."""
    client = _client()
    parts = []
    for chunk in chunks:
        with open(chunk["path"], "rb") as fh:
            r = client.audio.transcriptions.create(
                model=model, file=fh, language="en", prompt=INITIAL_PROMPT,
            )
        parts.append(r.text.strip())
    return " ".join(parts)
