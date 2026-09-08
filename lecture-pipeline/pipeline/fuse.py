"""Fuse the most accurate text with the only engine that returns timestamps.

Measured on this lecture: gpt-transcribe scores best on course vocabulary but
cannot return timestamps (verbose_json is rejected). whisper-1 returns segment
timings but mis-hears more terms. LLM-based engines also drop content
non-deterministically - one benchmark run lost a third of a slice.

So: take gpt-transcribe's wording, borrow whisper-1's clock, and fall back to
whisper-1's words wherever gpt-transcribe dropped content. Nothing is invented;
every output word came from one of the two engines, and its source is recorded.
"""

import difflib
import re

WORD = re.compile(r"[A-Za-z0-9']+")
SENT_END = re.compile(r"[.!?]$")


def _key(w):
    return w.lower().strip(".,!?;:\"'()")


def timed_words(segments):
    """Spread each segment's words evenly across its own time span."""
    out = []
    for seg in segments:
        toks = seg["text"].split()
        if not toks:
            continue
        span = max(seg["end"] - seg["start"], 0.01)
        step = span / len(toks)
        for i, tok in enumerate(toks):
            out.append({"word": tok, "t": seg["start"] + i * step,
                        "key": _key(tok)})
    return out


def fuse(timed_segments, accurate_text, min_gap_words=12):
    """Return cue-sized segments carrying the accurate wording and real times."""
    ref = timed_words(timed_segments)
    if not ref or not accurate_text.strip():
        return list(timed_segments), {"fused": False}

    hyp = [{"word": w, "key": _key(w)} for w in accurate_text.split() if w.strip()]
    matcher = difflib.SequenceMatcher(
        a=[w["key"] for w in ref], b=[w["key"] for w in hyp], autojunk=False)

    for w in hyp:
        w["t"] = None
    recovered = []
    ops = matcher.get_opcodes()

    for tag, i1, i2, j1, j2 in ops:
        if tag in ("equal", "replace"):
            for off, j in enumerate(range(j1, j2)):
                src = min(i1 + off, i2 - 1) if i2 > i1 else None
                if src is not None:
                    hyp[j]["t"] = ref[src]["t"]
        if tag == "delete" and (i2 - i1) >= min_gap_words:
            # The accurate engine dropped this stretch: keep the other engine's
            # words rather than lose the content.
            recovered.append({
                "start": round(ref[i1]["t"], 2),
                "end": round(ref[i2 - 1]["t"] + 0.5, 2),
                "text": " ".join(r["word"] for r in ref[i1:i2]),
                "source": "whisper-1 (recovered)",
                "words": i2 - i1,
            })

    # Fill unmatched insertions by interpolating from known neighbours.
    last = ref[0]["t"]
    for w in hyp:
        if w["t"] is None:
            w["t"] = last
        else:
            last = w["t"]
    for w in reversed(hyp):
        if w["t"] is None:
            w["t"] = last
        else:
            last = w["t"]

    # Group into sentence-sized cues.
    cues, buf = [], []
    for w in hyp:
        buf.append(w)
        long_enough = len(buf) >= 8
        if (SENT_END.search(w["word"]) and long_enough) or len(buf) >= 26:
            cues.append(buf)
            buf = []
    if buf:
        cues.append(buf)

    out = []
    for cue in cues:
        start = cue[0]["t"]
        end = max(cue[-1]["t"] + 0.4, start + 0.3)
        out.append({"start": round(start, 2), "end": round(end, 2),
                    "text": " ".join(w["word"] for w in cue),
                    "source": "gpt-transcribe"})
    out.extend(recovered)
    out.sort(key=lambda s: s["start"])

    # Keep cues strictly ordered and non-overlapping for the VTT parser.
    for a, b in zip(out, out[1:]):
        if a["end"] > b["start"]:
            a["end"] = max(b["start"] - 0.01, a["start"] + 0.05)

    for s in out:
        s.setdefault("avg_logprob", 0.0)
        s.setdefault("no_speech_prob", 0.0)
        s.setdefault("compression_ratio", 0.0)
        s.setdefault("low_confidence", False)

    stats = {"fused": True, "cues": len(out),
             "recovered_regions": len(recovered),
             "recovered_words": sum(r["words"] for r in recovered)}
    return out, stats
