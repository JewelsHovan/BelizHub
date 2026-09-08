"""Automatic transcript-quality metrics that need no reference transcript.

Each metric targets a failure mode observed in real decodes of this lecture:
loops (F1), domain-term corruption (F2), and degenerate filler lines (F3).
"""

import re
import zlib
from collections import Counter

WORD = re.compile(r"[A-Za-z0-9''-]+")


def words(text):
    return WORD.findall(text.lower())


def compression_ratio(text):
    """Whisper's own loop signal: repetitive text compresses far too well."""
    data = text.encode("utf-8")
    if not data:
        return 0.0
    return len(data) / len(zlib.compress(data))


def max_consecutive_repeat(text, n=5):
    """Largest number of back-to-back repeats of any n-gram.

    Counts only CONTIGUOUS repetition, which is the signature of a decoding
    loop. Plain frequency counts cannot tell a loop apart from a lecturer's
    verbal tic ("we are going to be"), which recurs but never back-to-back.
    """
    toks = words(text)
    if len(toks) < 2 * n:
        return 0
    best = 1
    i = 0
    while i < len(toks) - n:
        gram = toks[i : i + n]
        run = 1
        j = i + n
        while toks[j : j + n] == gram:
            run += 1
            j += n
        best = max(best, run)
        i += 1 if run == 1 else (run * n)
    return best


def looped_word_fraction(text, n=5):
    """Fraction of words inside a back-to-back repeated n-gram run."""
    toks = words(text)
    if len(toks) < 2 * n:
        return 0.0
    flagged = set()
    i = 0
    while i < len(toks) - n:
        gram = toks[i : i + n]
        run, j = 1, i + n
        while toks[j : j + n] == gram:
            run += 1
            j += n
        if run > 1:
            flagged.update(range(i, j))
            i = j
        else:
            i += 1
    return len(flagged) / len(toks)


def degenerate_lines(text):
    """Lines that are only punctuation/whitespace - the '.' filler failure."""
    return sum(
        1 for ln in text.splitlines() if ln.strip() and not WORD.search(ln)
    )


def term_audit(text, lexicon):
    """Count correct domain terms and known corruptions of them."""
    low = text.lower()
    good = bad = 0
    misses = Counter()
    for entry in lexicon:
        good += len(re.findall(entry["pattern"], low))
        for wrong in entry["wrong"]:
            hits = len(re.findall(r"\b" + re.escape(wrong.lower()) + r"\b", low))
            if hits:
                misses[wrong] += hits
                bad += hits
    return good, bad, misses


def score(text, lexicon, audio_seconds):
    toks = words(text)
    good, bad, misses = term_audit(text, lexicon)
    return {
        "words": len(toks),
        "wpm": round(len(toks) / (audio_seconds / 60), 1) if audio_seconds else 0,
        "compression": round(compression_ratio(text), 2),
        "max_repeat": max_consecutive_repeat(text),
        "loop_frac": round(looped_word_fraction(text), 3),
        "degen_lines": degenerate_lines(text),
        "term_ok": good,
        "term_bad": bad,
        "misses": misses,
    }
