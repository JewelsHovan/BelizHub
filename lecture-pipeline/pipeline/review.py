"""LLM review pass: find ASR errors the lexicon cannot, under strict guards.

The rule-based lexicon only repairs mis-hearings someone already wrote down. It
cannot catch a plausible-sounding wrong word ("laxative" for "lacZ"), and it has
no idea whether a sentence makes biological sense. A reviewing model can.

The danger is the obvious one: a model asked to "clean up" a transcript will
happily rewrite what the instructor said. So this pass is deliberately narrow.
The model may only propose SHORT span replacements, it must quote the span
verbatim, and every proposal is verified against the real text before it counts.
Anything it invents is dropped, not applied.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

MODEL = "gpt-5.5"
WINDOW = 22          # segments per review window
OVERLAP = 3          # shared segments so errors on a seam are still seen
MAX_SPAN_WORDS = 6   # a "correction" longer than this is a rewrite, not a fix

SYSTEM = """You are proof-reading an automatic transcript of a university
molecular-biotechnology laboratory lecture (McGill BTEC620). The audio was a
phone on a desk, so the speech recogniser mis-hears technical vocabulary.

Find places where the transcript says something that is WRONG as biology or as
lab practice, and where a near-homophone is clearly what the instructor said.

Report ONLY:
- gene, protein, plasmid, vector, reagent, enzyme, kit, organism or cell-line names
- laboratory technique names
- numbers, units, concentrations, temperatures
- words where the sentence is biologically impossible as transcribed

Do NOT report:
- grammar, disfluency, filler, repetition, punctuation, capitalisation
- awkward phrasing, non-native constructions, incomplete sentences
- anything you would merely word differently

Rules:
- `find` MUST be copied character-for-character from the passage, and must be
  SHORT (at most 6 words) - the minimal span containing the error.
- `replace` must be the same kind of thing, similar length. Never a sentence.
- If you are not confident the instructor said your replacement, omit it.
- An unusual term that is correct biology is NOT an error. The lecturer really
  does discuss p53, pGEM-T, X-gal, lacZ, GAPDH, guanidine thiocyanate.

Return JSON: {"corrections":[{"find":"...","replace":"...","reason":"...",
"category":"gene|reagent|technique|cell_line|number|other","confidence":"high|medium|low"}]}
Return {"corrections":[]} if the passage is clean."""


def _windows(segments):
    step = WINDOW - OVERLAP
    for start in range(0, len(segments), step):
        chunk = segments[start:start + WINDOW]
        if chunk:
            yield start, chunk
        if start + WINDOW >= len(segments):
            break


def _review_window(client, chunk):
    text = " ".join(s["text"] for s in chunk)
    try:
        r = client.chat.completions.create(
            model=MODEL,
            messages=[{"role": "system", "content": SYSTEM},
                      {"role": "user", "content": f"Passage:\n\n{text}"}],
            response_format={"type": "json_object"},
        )
        data = json.loads(r.choices[0].message.content or "{}")
        return text, data.get("corrections", []) or []
    except Exception as exc:
        return text, [{"_error": f"{type(exc).__name__}: {exc}"}]


def _valid(find, replace, text):
    """Reject anything that is a rewrite, a fabrication, or a no-op."""
    if not find or not replace or find == replace:
        return "empty or identical"
    if find not in text:
        return "span not present in transcript"
    if len(find.split()) > MAX_SPAN_WORDS:
        return f"span too long ({len(find.split())} words)"
    if len(replace.split()) > MAX_SPAN_WORDS + 2:
        return "replacement too long"
    # A replacement far longer than the original is added content, not a fix.
    if len(replace) > len(find) * 3 + 12:
        return "replacement disproportionate to span"
    return None


def review(segments, model=MODEL, workers=6):
    """Return (accepted, rejected, errors) proposals. Applies nothing."""
    from openai import OpenAI
    client = OpenAI()
    global MODEL
    MODEL = model

    jobs = list(_windows(segments))
    accepted, rejected, errors = [], [], []
    seen = set()

    def run(job):
        start, chunk = job
        text, props = _review_window(client, chunk)
        return start, chunk, text, props

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for start, chunk, text, props in pool.map(run, jobs):
            for p in props:
                if "_error" in p:
                    errors.append(p["_error"])
                    continue
                find = (p.get("find") or "").strip()
                replace = (p.get("replace") or "").strip()
                why = _valid(find, replace, text)
                record = {
                    "find": find, "replace": replace,
                    "reason": p.get("reason", ""),
                    "category": p.get("category", "other"),
                    "confidence": p.get("confidence", "low"),
                    "window_start": start,
                    "at": next((s["start"] for s in chunk if find in s["text"]), chunk[0]["start"]),
                }
                if why:
                    record["rejected_because"] = why
                    rejected.append(record)
                    continue
                key = (find, replace)
                if key in seen:
                    continue
                seen.add(key)
                accepted.append(record)

    accepted.sort(key=lambda r: r["at"])
    return accepted, rejected, errors


def apply(segments, corrections, min_confidence="high", window=45.0):
    """Apply corrections ONLY near the moment that was actually verified.

    A correction is evidence about one point in the recording. Replacing every
    occurrence of a short, generic span ("has a color") would rewrite passages
    minutes away that nobody checked, so edits are scoped to `window` seconds
    around the verified timestamp.
    """
    order = {"high": 3, "medium": 2, "low": 1}
    threshold = order.get(min_confidence, 3)
    applied = []
    for c in corrections:
        if order.get(c["confidence"], 1) < threshold:
            continue
        hits = out_of_scope = 0
        for seg in segments:
            if c["find"] not in seg["text"]:
                continue
            if abs(seg["start"] - c["at"]) > window:
                out_of_scope += 1
                continue
            seg["text"] = seg["text"].replace(c["find"], c["replace"])
            hits += 1
        if hits:
            applied.append({**c, "occurrences": hits,
                            "left_untouched_elsewhere": out_of_scope})
    return segments, applied
