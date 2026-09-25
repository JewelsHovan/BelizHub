"""Succinct study notes per slide, written from that slide's text and what the
lecturer said over it - nothing else.

Reads the slide records slidedoc.py wrote and adds, per slide, a short title,
a few bullet notes, the terms it defines, and anything the lecturer flagged as
important. Results are cached per slide (keyed on its content), so re-running
after a regroup only pays for slides that changed.

  uv run python slidenotes.py out/<slug>.slides.json --course "BTEC 501 — Bioinformatics"

Everything it reads and writes is transient/private; nothing is committed.
"""

import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

MODEL = "gpt-5.5"
VERSION = 1          # bump when SYSTEM changes, to invalidate the cache

SYSTEM = """You write concise study notes for a student, one slide at a time,
for a university lecture ({course}). You get the text on the slide (OCR, may be
noisy) and a machine transcript of what the lecturer said while it was shown.
Passages marked [uncertain: ...] may be mis-transcribed.

Use ONLY the slide and the transcript. Do not add facts, examples or numbers
that neither contains. Prefer the lecturer's own explanations and examples over
restating the slide. Correct obvious transcription slips of technical terms
(e.g. "blossom" -> BLOSUM) only when the slide or context makes it certain.

Return JSON:
{{"title": "short title for this slide, at most 8 words",
  "notes": ["3-6 bullets, each at most 25 words: what to understand and remember"],
  "terms": [{{"term": "...", "meaning": "one line, as explained here"}}],
  "emphasis": ["what the lecturer explicitly stressed: said was important, would
               be on the exam or an assignment, or a course announcement"]}}

"terms" holds at most 4 entries, only for terms this slide actually explains.
"emphasis" is usually empty. Only include what the transcript shows the
lecturer explicitly flagging; never add your own study advice.
If the screen is not lecture content (a video-call gallery, a title card, an
editor window) and little of substance is said, return one note summarising
what was said, or none."""


def transcript_of(slide):
    parts = []
    for v in slide["visits"]:
        parts.append(" ".join(f"[uncertain: {c['text']}]" if c["flag"] else c["text"]
                              for c in v["cues"]))
    return "\n\n[later, back on this slide]\n".join(p for p in parts if p)


def key_of(slide, course):
    blob = json.dumps([VERSION, MODEL, course, slide["slide_text"], transcript_of(slide)])
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


def note_one(client, slide, course):
    said = transcript_of(slide)
    if not said.strip() and not slide["slide_text"].strip():
        return {"title": slide.get("title", ""), "notes": [], "terms": [], "emphasis": []}
    user = (f"Slide text (OCR):\n{slide['slide_text'] or '(none)'}\n\n"
            f"Transcript:\n{said or '(nothing said)'}")
    r = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "system", "content": SYSTEM.format(course=course)},
                  {"role": "user", "content": user}],
        response_format={"type": "json_object"},
    )
    data = json.loads(r.choices[0].message.content or "{}")
    return {"title": str(data.get("title", "")).strip(),
            "notes": [str(x) for x in data.get("notes", []) if str(x).strip()],
            "terms": [t for t in data.get("terms", []) if isinstance(t, dict) and t.get("term")][:4],
            "emphasis": [str(x) for x in data.get("emphasis", []) if str(x).strip()]}


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slides", help="out/<slug>.slides.json from slidedoc.py")
    ap.add_argument("--course", default="")
    ap.add_argument("--workdir", default="", help="cache dir; default work/<slug>")
    ap.add_argument("--workers", type=int, default=8)
    args = ap.parse_args()

    from openai import OpenAI
    client = OpenAI()

    path = Path(args.slides).expanduser()
    data = json.loads(path.read_text())
    slides = data["slides"]
    course = args.course or data["meta"].get("course", "")
    stem = path.name.split(".")[0]
    work = Path(args.workdir).expanduser() if args.workdir else Path("work") / stem
    work.mkdir(parents=True, exist_ok=True)
    cache_path = work / "slidenotes.json"
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}

    todo = [s for s in slides if key_of(s, course) not in cache]
    print(f"Notes for {len(slides)} slides ({len(slides) - len(todo)} cached, "
          f"{len(todo)} to write with {MODEL})…")

    def run(s):
        try:
            return s, note_one(client, s, course), None
        except Exception as exc:
            return s, None, f"{type(exc).__name__}: {exc}"

    errors = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for s, notes, err in pool.map(run, todo):
            if err:
                errors.append(f"slide {s['n']}: {err}")
                continue
            cache[key_of(s, course)] = notes
    cache_path.write_text(json.dumps(cache, indent=1))

    for s in slides:
        s["notes"] = cache.get(key_of(s, course))
    path.write_text(json.dumps(data, indent=1))
    done = sum(1 for s in slides if s["notes"])
    print(f"Wrote notes for {done}/{len(slides)} slides into {path}")

    # re-render the context doc + Markdown so they carry the clean titles and summaries
    import slidedoc
    docx = path.with_name(stem + ".slides.docx")
    slidedoc.build_docx(slides, data["meta"], str(docx))
    path.with_name(stem + ".slides.md").write_text(slidedoc.build_md(slides, data["meta"]))
    print(f"Updated {docx.name} and {stem}.slides.md with titles and summaries")
    for e in errors:
        print("  !", e)


if __name__ == "__main__":
    main()
