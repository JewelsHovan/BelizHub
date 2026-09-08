"""Audio preparation: loudness normalisation and silence-aware chunking."""

import re
import shutil
import subprocess
from pathlib import Path

TARGET_CHUNK = 600.0   # seconds; keeps uploads well inside API size limits
MAX_CHUNK = 780.0
SEARCH_BACK = 90.0     # how far back to hunt for a natural pause


def _require_ffmpeg():
    if not shutil.which("ffmpeg"):
        raise RuntimeError("ffmpeg is required. Install with: brew install ffmpeg")


def to_wav(src, dst):
    """Plain 16 kHz mono, no loudness processing - used for pause detection."""
    _require_ffmpeg()
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)], check=True)
    return dst


def normalise(src, dst):
    """16 kHz mono WAV at -16 LUFS. Measured fewer term errors than raw audio."""
    _require_ffmpeg()
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
         "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)],
        check=True)
    return dst


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "csv=p=0", str(path)], capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def noise_floor(path):
    """Mean level of the file; the pause threshold is set relative to it.

    A fixed -33 dB threshold found no pauses at all in loudness-normalised
    audio (normalisation raises the noise floor), so every chunk boundary fell
    on a blind timer cut in mid-sentence.
    """
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True)
    m = re.search(r"mean_volume: (-?[\d.]+) dB", out.stderr)
    return float(m.group(1)) if m else -25.0


def silences(path, noise_db=None, min_dur=0.45):
    """Midpoints of detected pauses - candidate cut points."""
    if noise_db is None:
        noise_db = round(noise_floor(path) - 8, 1)
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path),
         "-af", f"silencedetect=noise={noise_db}dB:d={min_dur}", "-f", "null", "-"],
        capture_output=True, text=True)
    starts = [float(m) for m in re.findall(r"silence_start: ([\d.]+)", out.stderr)]
    ends = [float(m) for m in re.findall(r"silence_end: ([\d.]+)", out.stderr)]
    return [(s + e) / 2 for s, e in zip(starts, ends)]


def plan_chunks(total, pauses):
    """Cut on a pause near the target length so no word is split mid-utterance."""
    cuts, pos = [], 0.0
    while total - pos > MAX_CHUNK:
        ideal = pos + TARGET_CHUNK
        window = [p for p in pauses if ideal - SEARCH_BACK <= p <= ideal + SEARCH_BACK]
        cut = min(window, key=lambda p: abs(p - ideal)) if window else ideal
        if cut <= pos + 60:
            cut = ideal
        cuts.append(cut)
        pos = cut
    bounds = [0.0] + cuts + [total]
    return [(a, b) for a, b in zip(bounds, bounds[1:]) if b - a > 0.5]


def export_chunks(wav, spans, outdir, fmt="mp3", bitrate="48k"):
    """Compressed chunks for upload; mono 16 kHz speech survives 48 kbps well."""
    _require_ffmpeg()
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    made = []
    for i, (a, b) in enumerate(spans):
        dst = outdir / f"chunk_{i:03d}.{fmt}"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{a:.3f}",
             "-t", f"{b - a:.3f}", "-i", str(wav),
             "-ac", "1", "-ar", "16000", "-b:a", bitrate, str(dst)], check=True)
        made.append({"path": str(dst), "offset": a, "end": b})
    return made
