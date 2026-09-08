"""Audio -> confidence-annotated segments, with a locked, reproducible config.

CONFIG RATIONALE (each value chosen from a measured sweep, see eval/):
  condition_on_previous_text=False
      Whisper feeds prior text back into the decoder. On this quiet, distant
      lecture recording that let one bad window poison the rest, producing a
      50x "and I have a lab" loop that destroyed ~75 words/min of content.
  temperature=0.0
      Whisper's default temperature FALLBACK resamples failed windows at rising
      temperatures. That made failures stochastic: the same 20-second region
      decoded correctly on one run and as fluent hallucination ("an Academy
      Award or financial scientist") on another. Greedy decoding is
      deterministic, so a re-run reproduces the transcript exactly.
  initial_prompt=<domain lexicon>
      Primes decoding toward course vocabulary. Measured: mis-heard domain
      terms fell from 10 to 2 across the probe set.
  loudness-normalised audio
      Source averages -34 dB (phone on a desk). EBU R128 to -16 LUFS measured
      fewer term errors than raw.
"""

import json
import shutil
import subprocess
from pathlib import Path

from lexicon import INITIAL_PROMPT

MODEL = "mlx-community/whisper-large-v3-turbo"

DECODE = {
    "language": "en",
    "condition_on_previous_text": False,
    "temperature": 0.0,
    "initial_prompt": INITIAL_PROMPT,
    "word_timestamps": False,
    "verbose": None,
}

# avg_logprob below this marks a passage for human re-listening rather than
# silently presenting possibly-hallucinated text as fact.
LOW_CONFIDENCE = -0.55


def normalise_audio(src, dst):
    """16 kHz mono WAV at broadcast loudness - Whisper's expected input."""
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required. Install it with: brew install ffmpeg")
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
        check=True,
    )
    return dst


def duration_seconds(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def transcribe(wav, model=MODEL):
    import mlx_whisper

    result = mlx_whisper.transcribe(str(wav), path_or_hf_repo=model, **DECODE)
    segments = []
    for s in result["segments"]:
        text = s["text"].strip()
        if not text:
            continue
        segments.append({
            "start": round(float(s["start"]), 2),
            "end": round(float(s["end"]), 2),
            "text": text,
            "avg_logprob": round(float(s["avg_logprob"]), 4),
            "no_speech_prob": round(float(s["no_speech_prob"]), 4),
            "compression_ratio": round(float(s["compression_ratio"]), 3),
            "low_confidence": float(s["avg_logprob"]) < LOW_CONFIDENCE,
        })
    return segments


def config_fingerprint():
    """Recorded in the audit file so a transcript is traceable to its settings."""
    return {"model": MODEL, "decode": {k: v for k, v in DECODE.items() if k != "initial_prompt"},
            "initial_prompt_words": len(INITIAL_PROMPT.split()),
            "low_confidence_threshold": LOW_CONFIDENCE}
