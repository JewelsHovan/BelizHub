"""Find the biological names in a transcript and check each one is real.

Two different questions, answered by two different tools:
  "Is this a named entity at all?"  - a language model reads the sentence.
  "Does this name exist?"           - a public registry decides (ontology.py).

Neither can do the other's job. The model will endorse a gene it invented; the
registry cannot tell that "receptor" in this sentence is a common noun.
"""

import json
import re
from concurrent.futures import ThreadPoolExecutor

import ontology

MODEL = "gpt-5.5"
WINDOW = 40

SYSTEM = """Extract the specific biological and laboratory NAMED ENTITIES from
this lecture passage.

Include: gene symbols, protein/enzyme names, cell lines, organisms, plasmids and
vectors, reagents, buffers, kits, RNA species, receptors named after a specific
ligand or family.

Exclude: generic nouns used on their own (protein, gene, vector, receptor, cell,
enzyme, buffer, assay, primer), technique names, equipment, and anything that is
not a specific name.

For each entity give the surface form EXACTLY as it appears in the passage.

Return JSON: {"entities":[{"text":"...","kind":"gene|protein|reagent|vector|cell_line|organism|rna|other"}]}
Return {"entities":[]} if the passage names none."""


def extract(segments, model=MODEL, workers=5):
    """Named entities with the timestamp of first mention."""
    from openai import OpenAI
    client = OpenAI()

    chunks = [segments[i:i + WINDOW] for i in range(0, len(segments), WINDOW)]

    def job(chunk):
        text = " ".join(s["text"] for s in chunk)
        try:
            r = client.chat.completions.create(
                model=model,
                messages=[{"role": "system", "content": SYSTEM},
                          {"role": "user", "content": f"Passage:\n\n{text}"}],
                response_format={"type": "json_object"},
            )
            found = json.loads(r.choices[0].message.content or "{}").get("entities", [])
        except Exception:
            found = []
        out = []
        for e in found:
            surface = (e.get("text") or "").strip()
            if not surface or surface not in text:
                continue        # never trust a form the model did not copy
            at = next((s["start"] for s in chunk if surface in s["text"]),
                      chunk[0]["start"])
            out.append({"text": surface, "kind": e.get("kind", "other"), "at": at})
        return out

    seen, entities = {}, []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for found in pool.map(job, chunks):
            for e in found:
                key = e["text"].lower()
                if key in seen:
                    seen[key]["mentions"] += 1
                    continue
                e["mentions"] = 1
                seen[key] = e
                entities.append(e)
    return sorted(entities, key=lambda e: e["at"])


def validate(entities, workers=4):
    """Attach a registry verdict to every entity."""
    def job(e):
        kind = e["kind"] if e["kind"] in ("gene", "protein", "reagent") else None
        return {**e, "check": ontology.validate(e["text"], kind=kind)}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(job, entities))


def triage(checked):
    """Split into confirmed vocabulary and names that resolve nowhere.

    A name no registry knows is either a mis-hearing or something the course
    invented (a construct, a group name). Repetition tells them apart: a term
    said once and unrecognised is far more likely to be an ASR error than a term
    the lecturer used a dozen times.
    """
    confirmed, suspect, generic = [], [], []
    for e in checked:
        status = e["check"]["status"]
        if status in ("VALID", "VALID_ALIAS"):
            confirmed.append(e)
        elif status == "GENERIC":
            generic.append(e)
        else:
            # Absence from a registry is not evidence of a mis-hearing.
            # "poly-A tail", "silica surface" and "guanidine salts" are all
            # correct; they are descriptive phrases, not catalogued entities.
            # Only an odd-looking token ("multiclodding", "AluS") suggests the
            # recogniser invented a word.
            words = e["text"].split()
            plain = all(re.fullmatch(r"[A-Za-z][a-z'-]{2,}", w) for w in words)
            e["descriptive_phrase"] = len(words) >= 2 and plain
            e["likely_asr_error"] = (not e["descriptive_phrase"]
                                     and e["mentions"] <= 2)
            suspect.append(e)
    confirmed.sort(key=lambda e: -e["mentions"])
    suspect.sort(key=lambda e: (-int(e["likely_asr_error"]), -e["mentions"]))
    return confirmed, suspect, generic
