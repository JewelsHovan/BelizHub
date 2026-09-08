"""Turn a flat segment list into study structure, deterministically.

Sections come from lexical cohesion (a TextTiling variant): where the vocabulary
of the preceding block stops overlapping the following block, the lecture has
changed subject. No model, no API, no generated prose - so nothing here can
invent content that the instructor did not say.
"""

import math
import re
from collections import Counter

from lexicon import LEXICON

STOP = set("""a an the and or but if then than that this these those of to in on at by for with
from as is are was were be been being it its it's he she they we you i him her them us my your
our their so not no do does did doing have has had having will would can could should may might
must there here what when where which who whom how why all any both each few more most other some
such only own same too very just now also into about over under again further once during before
after above below up down out off on again one two three going go get got make makes made like
well okay ok right yeah um uh gonna wanna lot lots thing things way ways say says said see seen
know knew think thought want wants need needs use used using because while does""".split())

WORD = re.compile(r"[A-Za-z][A-Za-z'-]+")


def content_words(text):
    return [w.lower() for w in WORD.findall(text) if w.lower() not in STOP and len(w) > 2]


def _cosine(a, b):
    if not a or not b:
        return 0.0
    shared = set(a) & set(b)
    if not shared:
        return 0.0
    num = sum(a[w] * b[w] for w in shared)
    den = math.sqrt(sum(v * v for v in a.values())) * math.sqrt(sum(v * v for v in b.values()))
    return num / den if den else 0.0


def sections(segments, block=6, min_gap=8, target_section_segments=30):
    """Split segments into topic sections at lexical-cohesion valleys.

    block   - how many segments form each side of the comparison window
    min_gap - minimum segments between boundaries, so sections stay readable
    """
    if len(segments) < block * 2 + 2:
        return [{"start_index": 0, "end_index": len(segments) - 1}]

    vocab = [Counter(content_words(s["text"])) for s in segments]
    scores = []
    for i in range(block, len(segments) - block):
        left = Counter()
        right = Counter()
        for v in vocab[i - block:i]:
            left.update(v)
        for v in vocab[i:i + block]:
            right.update(v)
        scores.append((i, _cosine(left, right)))

    # A boundary is a local minimum whose "depth" (drop from surrounding peaks)
    # exceeds the mean depth - the standard TextTiling cutoff.
    depths = []
    vals = [s for _, s in scores]
    for k, (i, val) in enumerate(scores):
        lpeak = max(vals[:k + 1]) if k else val
        rpeak = max(vals[k:]) if k < len(vals) else val
        depths.append((i, (lpeak - val) + (rpeak - val)))
    if not depths:
        return [{"start_index": 0, "end_index": len(segments) - 1}]

    dvals = [d for _, d in depths]
    mean = sum(dvals) / len(dvals)
    sd = math.sqrt(sum((d - mean) ** 2 for d in dvals) / len(dvals))
    cutoff = mean + sd / 2

    # Depth alone produced ~1 section per minute on a 46-minute lecture, which is
    # not a study aid. Keep only the deepest boundaries, aiming for sections of
    # roughly `target_section_segments` segments each.
    max_sections = max(3, min(16, round(len(segments) / target_section_segments)))
    picked = []
    for i, d in sorted(depths, key=lambda x: -x[1]):
        if d < cutoff or len(picked) >= max_sections - 1:
            break
        if all(abs(i - p) >= min_gap for p in picked):
            picked.append(i)
    picked.sort()

    bounds = [0] + picked + [len(segments)]
    out = []
    for a, b in zip(bounds, bounds[1:]):
        if b - a > 0:
            out.append({"start_index": a, "end_index": b - 1})
    return out


def label_sections(segments, secs, top=5):
    """Label every section by what makes it DIFFERENT from the others.

    Raw frequency titled four separate sections "protocol", because the word
    appears throughout a lab-methods lecture. Weighting each term by how few
    sections contain it (TF-IDF) surfaces what each section is actually about.
    """
    texts, counts = [], []
    for sec in secs:
        text = " ".join(s["text"] for s in
                        segments[sec["start_index"]:sec["end_index"] + 1])
        texts.append(text)
        counts.append(Counter(content_words(text)))

    n = len(secs)
    doc_freq = Counter()
    for c in counts:
        doc_freq.update(set(c))

    labels = []
    for text, c in zip(texts, counts):
        total = sum(c.values()) or 1
        scored = {
            w: (freq / total) * math.log((n + 1) / (doc_freq[w] + 0.5))
            for w, freq in c.items() if freq >= 2
        }
        keywords = [w for w, _ in sorted(scored.items(), key=lambda kv: -kv[1])][:top]
        low = text.lower()
        # Course terms are ranked the same way, so generic ones stop winning.
        terms = [e["term"] for e in LEXICON if re.search(e["pattern"], low)]
        terms.sort(key=lambda t: -scored.get(t.lower().split()[0], 0))
        labels.append((terms, keywords))
    return labels


def label_section(segments, sec, top=5):
    """Single-section fallback (kept for callers that lack the full set)."""
    return label_sections(segments, [sec], top)[0]


def term_index(segments):
    """Every domain term with the timestamps where it is discussed.

    This is the highest-value study artefact the pipeline can build without a
    language model: jump straight to where 'lac operon' is explained.
    """
    index = {}
    for seg in segments:
        low = seg["text"].lower()
        for entry in LEXICON:
            if re.search(entry["pattern"], low):
                index.setdefault(entry["term"], []).append(seg["start"])
    return {k: v for k, v in sorted(index.items(), key=lambda kv: -len(kv[1]))}


def review_queue(segments):
    """Passages the model was least sure about, for human verification."""
    flagged = [s for s in segments if s["low_confidence"]]
    return sorted(flagged, key=lambda s: s["avg_logprob"])
