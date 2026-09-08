"""Per-course vocabulary that accumulates across lectures.

The first lecture is transcribed with a generic prompt. Every entity that a
public registry confirms is written into the course profile, and the next
lecture is primed with that vocabulary. A course therefore gets more accurate
the more of it has been transcribed - and the vocabulary is verified, so
priming cannot teach the recogniser a word that does not exist.
"""

import json
from datetime import date
from pathlib import Path

PROFILES = Path(__file__).resolve().parent.parent / "courses"
MAX_PROMPT_TERMS = 60          # Whisper's prompt window is ~224 tokens

BASE = ("University laboratory lecture in molecular biotechnology. The speaker "
        "discusses experimental protocols, controls, and laboratory records.")


def path(course):
    return PROFILES / f"{course.lower().replace(' ', '-')}.json"


def load(course):
    try:
        return json.loads(path(course).read_text())
    except Exception:
        return {"course": course, "created": str(date.today()),
                "lectures": [], "vocabulary": {}}


def save(profile):
    PROFILES.mkdir(parents=True, exist_ok=True)
    path(profile["course"]).write_text(json.dumps(profile, indent=2, sort_keys=True))
    return path(profile["course"])


def update(profile, lecture_id, confirmed):
    """Record a lecture's registry-confirmed entities in the course vocabulary."""
    vocab = profile.setdefault("vocabulary", {})
    for e in confirmed:
        # Store the form the registry actually matched, so "lacZ gene" and
        # "lacZ" collapse into one entry instead of both eating prompt budget.
        key = e["check"].get("matched_as") or e["text"]
        # Case-insensitive: "p53" and "P53" are one term, not two prompt slots.
        existing = next((k for k in vocab if k.lower() == key.lower()), None)
        key = existing or key
        entry = vocab.setdefault(key, {"kind": e["kind"], "mentions": 0,
                                       "lectures": [], "source": ""})
        entry["mentions"] += e["mentions"]
        entry["source"] = e["check"].get("record", {}).get("source", "")
        if lecture_id not in entry["lectures"]:
            entry["lectures"].append(lecture_id)
    if lecture_id not in profile.setdefault("lectures", []):
        profile["lectures"].append(lecture_id)
    return profile


def prompt(profile, extra=()):
    """Build a decoder prompt from verified course vocabulary."""
    vocab = profile.get("vocabulary", {})
    ranked = sorted(vocab.items(),
                    key=lambda kv: (-len(kv[1].get("lectures", [])),
                                    -kv[1].get("mentions", 0)))
    terms = [k for k, _ in ranked][:MAX_PROMPT_TERMS]
    terms += [t for t in extra if t not in terms]
    if not terms:
        return BASE
    return (f"{BASE} Vocabulary used in {profile['course']}: "
            + ", ".join(terms) + ".")
