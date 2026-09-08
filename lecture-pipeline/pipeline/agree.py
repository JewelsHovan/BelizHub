"""Cross-engine agreement, used as the real confidence signal.

Measured on this lecture: Whisper's own avg_logprob flagged NONE of the passages
where the local model corrupted meaning ("releases the receptor" for "releases
the repressor", "laxative" for "lacZ"). Two independent engines disagreeing at
the same timestamp did catch them. So agreement, not self-reported confidence,
decides what a student is asked to re-listen to.
"""

import difflib
import re

WORD = re.compile(r"[A-Za-z0-9']+")

# Engines differ in transcription CONVENTION, not accuracy: whisper-1 writes
# "we are going to", gpt-4o-mini writes "we're going to". Without expansion those
# stretches fail to align and whole correct passages were flagged as 100%
# disagreed. Fillers are dropped for the same reason (Gemini keeps "uh", others
# do not).
_CONTRACTIONS = {
    "we're": "we are", "you're": "you are", "they're": "they are",
    "it's": "it is", "that's": "that is", "there's": "there is",
    "what's": "what is", "here's": "here is", "let's": "let us",
    "i'm": "i am", "he's": "he is", "she's": "she is", "who's": "who is",
    "don't": "do not", "doesn't": "does not", "didn't": "did not",
    "can't": "cannot", "won't": "will not", "isn't": "is not",
    "aren't": "are not", "wasn't": "was not", "weren't": "were not",
    "haven't": "have not", "hasn't": "has not", "hadn't": "had not",
    "wouldn't": "would not", "couldn't": "could not", "shouldn't": "should not",
    "i've": "i have", "we've": "we have", "you've": "you have",
    "they've": "they have", "i'll": "i will", "we'll": "we will",
    "you'll": "you will", "they'll": "they will", "it'll": "it will",
    "i'd": "i would", "we'd": "we would", "you'd": "you would",
}
_FILLER = {"uh", "um", "mm", "mhm", "er", "ah", "eh"}


def _norm(text):
    out = []
    for w in WORD.findall(text.replace("-", " ").lower()):
        expanded = _CONTRACTIONS.get(w)
        if expanded:
            out.extend(expanded.split())
        elif w not in _FILLER:
            out.append(w)
    return out


def annotate(segments, reference_text):
    """Mark each timestamped segment with how far it drifts from a second engine.

    Returns the fraction of the whole transcript that disagrees, and mutates
    segments with `disagreement` (0..1) and `needs_review`.
    """
    hyp_words, owner = [], []
    for i, seg in enumerate(segments):
        for w in _norm(seg["text"]):
            hyp_words.append(w)
            owner.append(i)
    ref_words = _norm(reference_text)
    if not hyp_words or not ref_words:
        for seg in segments:
            seg["disagreement"] = 0.0
            seg["needs_review"] = False
        return 0.0

    matcher = difflib.SequenceMatcher(a=hyp_words, b=ref_words, autojunk=False)
    agreed = [False] * len(hyp_words)
    for i, _, size in matcher.get_matching_blocks():
        for k in range(i, i + size):
            agreed[k] = True

    totals = [0] * len(segments)
    misses = [0] * len(segments)
    for k, seg_i in enumerate(owner):
        totals[seg_i] += 1
        if not agreed[k]:
            misses[seg_i] += 1

    for i, seg in enumerate(segments):
        score = (misses[i] / totals[i]) if totals[i] else 0.0
        seg["disagreement"] = round(score, 3)
        # A third of the words differing is well beyond the 4-6% baseline drift
        # measured between engines that agree.
        seg["needs_review"] = score >= 0.34 and totals[i] >= 4

    return round(sum(misses) / len(hyp_words), 4)


def coverage_gaps(segments, min_run=3):
    """Consecutive fully-disagreeing segments = the cross-check dropped content.

    Measured: gpt-4o-mini-transcribe silently omitted ~30 s of a 10-minute chunk.
    That is an engine failure, not a transcription dispute, and is reported
    separately so it is not mistaken for a passage the student must re-listen to.
    """
    gaps, run = [], []
    for seg in segments:
        if seg.get("disagreement", 0) >= 0.99:
            run.append(seg)
        else:
            if len(run) >= min_run:
                gaps.append({"start": run[0]["start"], "end": run[-1]["end"],
                             "segments": len(run),
                             "text": " ".join(s["text"] for s in run)})
            run = []
    if len(run) >= min_run:
        gaps.append({"start": run[0]["start"], "end": run[-1]["end"],
                     "segments": len(run),
                     "text": " ".join(s["text"] for s in run)})
    return gaps


def contested_terms(segments, reference_text, lexicon):
    """Course terms present in one engine's output but absent from the other."""
    hyp = " ".join(s["text"] for s in segments).lower()
    ref = reference_text.lower()
    out = []
    for entry in lexicon:
        h = len(re.findall(entry["pattern"], hyp))
        r = len(re.findall(entry["pattern"], ref))
        if abs(h - r) >= 2:
            out.append({"term": entry["term"], "in_transcript": h, "in_crosscheck": r})
    return sorted(out, key=lambda d: -abs(d["in_transcript"] - d["in_crosscheck"]))
