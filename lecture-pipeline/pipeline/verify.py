"""Ground each proposed correction in the audio, not in the model's priors.

A reviewing model proposes corrections from plausibility alone: it knows Taq
adds A overhangs, so it will "fix" the transcript toward the textbook even where
the instructor genuinely said something else. That is exactly how a study aid
starts teaching things the lecture never said.

So every proposal is re-checked against the recording. The disputed moment is
re-transcribed by independent engines, and the proposal is confirmed only if an
engine that never saw the suggestion actually heard it.

  CONFIRMED   another engine transcribed the proposed wording
  CONTRADICTED every engine agrees with the ORIGINAL wording
  UNRESOLVED  neither wording appears; a human must listen
"""

import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

PAD_BEFORE = 26.0
PAD_AFTER = 28.0


def _clip(wav, start, out, pad_before=PAD_BEFORE, pad_after=PAD_AFTER):
    begin = max(0.0, start - pad_before)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{begin:.2f}",
         "-t", f"{pad_before + pad_after:.2f}", "-i", str(wav),
         "-ac", "1", "-ar", "16000", "-b:a", "64k", str(out)], check=True)
    return out


def _norm(text):
    return re.sub(r"[^a-z0-9' ]+", " ", text.lower().replace("-", " "))


def _contains(haystack, needle):
    """Loose containment: content words of `needle` all present, in order."""
    h = _norm(haystack)
    toks = [t for t in _norm(needle).split() if len(t) > 1]
    if not toks:
        return False
    pos = 0
    for t in toks:
        idx = h.find(t, pos)
        if idx < 0:
            return False
        pos = idx + len(t)
    return True


def verify(corrections, wav, engines_map, workers=4):
    """Re-transcribe each disputed moment and classify the proposal."""
    tmp = Path(tempfile.mkdtemp(prefix="verify_"))

    def job(item):
        i, c = item
        clip = _clip(wav, c["at"], tmp / f"c{i:03d}.mp3")
        heard = {}
        for name, fn in engines_map.items():
            try:
                heard[name] = fn(clip)
            except Exception as exc:
                heard[name] = f"__ERROR__ {type(exc).__name__}"
        saw_new = [n for n, t in heard.items()
                   if not t.startswith("__ERROR__") and _contains(t, c["replace"])]
        saw_old = [n for n, t in heard.items()
                   if not t.startswith("__ERROR__") and _contains(t, c["find"])]
        if saw_new:
            verdict = "CONFIRMED"
        elif saw_old and not saw_new:
            verdict = "CONTRADICTED"
        else:
            verdict = "UNRESOLVED"
        return {**c, "verdict": verdict, "heard_new": saw_new,
                "heard_old": saw_old, "evidence": heard}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(job, enumerate(corrections)))
