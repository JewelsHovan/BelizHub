"""lp - pilot the lecture pipeline.

One command per thing you want, with each lecture's details (course, title,
date) remembered in work/<slug>/lecture.json so nothing is retyped:

  ./lp run '<signed url>' --date 2026-10-01 --course-id 97394   # what the extension copies
  ./lp run '<signed url>' --date 2026-10-01 --course BTEC501    # same, by course code
  ./lp redo <slug> --from notes      # rebuild from a stage onwards (cached work is reused)
  ./lp list                          # every lecture and what it has
  ./lp open <slug> [--audio|--doc|--md|--review]
  ./lp courses                       # course profiles
  ./lp course BTEC501 --title "BTEC 501 — Bioinformatics" --lecturer "Dr. …" --id 12345
  ./lp fix BTEC501 BLOSUM blossom blossum   # teach a course a recurring mis-hearing
  ./lp check                         # prerequisites

Stages, in order: fetch -> transcribe -> slides -> notes -> study.
"""

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from datetime import date as _date
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COURSES, OUT, WORK, LECTURES = ROOT / "courses", ROOT / "out", ROOT / "work", ROOT / "lectures"
DEFAULT_FILE = COURSES / ".default"
STAGES = ["fetch", "transcribe", "slides", "notes", "study"]
PY = ["uv", "run", "--quiet", "python"]


def say(msg):
    print(f"\033[1m{msg}\033[0m", flush=True)


def sh(cmd):
    print("  $ " + shlex.join(str(c) for c in cmd), flush=True)
    # unbuffered, so progress shows up live even when lp's output goes to a log file
    r = subprocess.run([str(c) for c in cmd], cwd=ROOT, env={**os.environ, "PYTHONUNBUFFERED": "1"})
    if r.returncode:
        sys.exit(f"\nStage failed (exit {r.returncode}). Fix the cause, then re-run with "
                 f"`./lp redo <slug> --from <stage>` - finished work is cached.")


# --- course profiles -------------------------------------------------------

def profile_path(code):
    return COURSES / f"{code.lower().replace(' ', '-')}.json"


def load_profile(code):
    try:
        return json.loads(profile_path(code).read_text())
    except FileNotFoundError:
        return {}


def all_profiles():
    return [json.loads(p.read_text()) for p in sorted(COURSES.glob("*.json"))]


def default_course():
    return DEFAULT_FILE.read_text().strip() if DEFAULT_FILE.exists() else ""


def resolve_course(code=None, course_id=None):
    if code:
        return code.upper()
    if course_id:
        hit = next((p for p in all_profiles() if str(p.get("course_id", "")) == str(course_id)), None)
        if hit:
            return hit["course"]
        sys.exit(f"No course profile has course_id {course_id}. Tell lp which course it is, once:\n"
                 f"  ./lp course <CODE> --id {course_id} --title \"…\" --lecturer \"…\"")
    if default_course():
        return default_course()
    sys.exit("Which course? Pass --course CODE (or --course-id), or set one: ./lp course <CODE> --default")


def course_title(code):
    return load_profile(code).get("title") or code


# --- per-lecture record ----------------------------------------------------

def lecture_path(slug):
    return WORK / slug / "lecture.json"


def load_lecture(slug):
    p = lecture_path(slug)
    if p.exists():
        return json.loads(p.read_text())
    # lectures made before lp existed: recover what the slide JSON remembers
    sj = OUT / f"{slug}.slides.json"
    if sj.exists():
        meta = json.loads(sj.read_text())["meta"]
        code = next((p["course"] for p in all_profiles() if p.get("title") == meta.get("course")), "")
        if code:
            return {"slug": slug, "course": code, "title": meta.get("title", ""),
                    "date": meta.get("date", ""), "auto_title": False}
    sys.exit(f"Don't know lecture '{slug}'. See `./lp list`.")


def save_lecture(lec):
    p = lecture_path(lec["slug"])
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(lec, indent=2))


# --- stages ----------------------------------------------------------------

def run_stages(lec, start, url=None, review=True, backend="best"):
    slug, code = lec["slug"], lec["course"]
    prof = load_profile(code)
    video = LECTURES / f"{slug}.mp4"
    for stage in STAGES[STAGES.index(start):]:
        say(f"\n[{stage}] {slug}")
        if stage == "fetch":
            if not url:
                sys.exit("fetch needs the signed URL: ./lp run '<url>' … (or redo --from transcribe)")
            sh([*PY, "fetch_lecture.py", "--url", url, "--name", slug])
        elif stage == "transcribe":
            if not video.exists():
                sys.exit(f"No recording at {video.relative_to(ROOT)} - run from fetch with the URL.")
            sh([*PY, "pipeline/run.py", video, "--course", code, "--slug", slug,
                "--title", lec["title"] or lec["date"], "--date", lec["date"],
                "--backend", backend, *(["--review"] if review else [])])
        elif stage == "slides":
            sh([*PY, "slidedoc.py", "--video", video, "--transcript", OUT / f"{slug}.segments.json",
                "--out", OUT / f"{slug}.slides.docx", "--title", lec["title"] or lec["date"],
                "--lecturer", prof.get("lecturer", ""), "--course", course_title(code),
                "--date", lec["date"]])
        elif stage == "notes":
            sh([*PY, "slidenotes.py", OUT / f"{slug}.slides.json", "--course", course_title(code),
                *(["--auto-title"] if lec.get("auto_title") else [])])
            if lec.get("auto_title"):             # keep the record in step with the page
                lec["title"] = json.loads((OUT / f"{slug}.slides.json").read_text())["meta"]["title"]
                save_lecture(lec)
        elif stage == "study":
            sh([*PY, "studypage.py", OUT / f"{slug}.slides.json", "--embed-audio"])
    say(f"\nDone: {lec['title'] or slug}")
    for f, what in [(".study.html", "study page (lean, to share)"),
                    (".study-audio.html", "study page with audio inside"),
                    (".slides.docx", "context for AI"), (".slides.md", "context for AI, no images"),
                    (".review.md", "what the review changed / needs your ear")]:
        if (OUT / f"{slug}{f}").exists():
            print(f"  out/{slug}{f:<20} {what}")
    print(f"\n  ./lp open {slug}")


# --- commands --------------------------------------------------------------

def cmd_run(a):
    code = resolve_course(a.course, a.course_id)
    if not load_profile(code):
        print(f"(no profile for {code} yet - defaults apply; see `./lp course {code} --help`)")
    d = a.date or _date.today().isoformat()
    slug = a.slug or f"{code.lower()}-{d}"
    title = (a.title or "").strip()
    auto = not title or title == d                # the extension sends the date when LRS has no title
    lec = {"slug": slug, "course": code, "title": "" if auto else title, "date": d, "auto_title": auto}
    save_lecture(lec)
    say(f"{slug}  ·  {course_title(code)}  ·  {d}" + ("  ·  title from the notes" if auto else f"  ·  {title}"))
    run_stages(lec, "transcribe" if a.skip_fetch else "fetch", url=a.url,
               review=not a.no_review, backend=a.backend)


def cmd_redo(a):
    lec = load_lecture(a.slug)
    if a.title:
        lec["title"], lec["auto_title"] = a.title, False
    if a.auto_title:
        lec["auto_title"] = True
    if a.course:
        lec["course"] = a.course.upper()
    save_lecture(lec)
    run_stages(lec, a.start, url=a.url, review=not a.no_review, backend=a.backend)


def _review_counts(slug):
    p = OUT / f"{slug}.review.md"
    m = re.search(r"(\d+) applied · (\d+) rejected · (\d+) need", p.read_text()) if p.exists() else None
    return (int(m[1]), int(m[3])) if m else None


def cmd_list(a):
    slugs = {p.name.split(".")[0] for p in OUT.glob("*.slides.json")}
    slugs |= {p.parent.name for p in WORK.glob("*/lecture.json")}
    rows = []
    for slug in sorted(slugs):
        try:
            lec = load_lecture(slug)
        except SystemExit:
            continue
        sj = OUT / f"{slug}.slides.json"
        n = len(json.loads(sj.read_text())["slides"]) if sj.exists() else 0
        rc = _review_counts(slug)
        have = "".join(c if (OUT / f"{slug}{f}").exists() else "·" for c, f in
                       [("T", ".txt"), ("D", ".slides.docx"), ("S", ".study.html"), ("A", ".study-audio.html")])
        rows.append((lec["date"], lec["course"], slug, n, rc, have, lec["title"] or "(title pending)"))
    if not rows:
        print("No lectures yet. Start one with ./lp run '<url>' --date … --course …")
        return
    print(f"{'date':<11}{'course':<9}{'slug':<24}{'slides':>6}  {'review':<17}{'files':<7}title")
    for d, c, s, n, rc, have, t in rows:
        rv = f"{rc[0]} fixed, {rc[1]} ear" if rc else "-"
        print(f"{d:<11}{c:<9}{s:<24}{n or '-':>6}  {rv:<17}{have:<7}{t}")
    print("\nfiles: T transcript · D Word doc · S study page · A study page with audio   "
          "('ear' = passages the review wants you to listen to)")


def cmd_open(a):
    ext = (".study-audio.html" if a.audio else ".slides.docx" if a.doc else
           ".slides.md" if a.md else ".review.md" if a.review else ".study.html")
    f = OUT / f"{a.slug}{ext}"
    if not f.exists():
        sys.exit(f"No {f.relative_to(ROOT)} - see ./lp list")
    subprocess.run(["open", str(f)])


def cmd_courses(a):
    ps = all_profiles()
    if not ps:
        print("No course profiles. Create one: ./lp course CODE --title … --lecturer … --id …")
        return
    dflt = default_course()
    print(f"{'code':<10}{'id':<9}{'lectures':>8}{'terms':>7}{'fixes':>7}  title / lecturer")
    for p in ps:
        mark = "*" if p["course"] == dflt else " "
        print(f"{mark}{p['course']:<9}{str(p.get('course_id', '-')):<9}{len(p.get('lectures', [])):>8}"
              f"{len(p.get('vocabulary', {})):>7}{sum(len(v) for v in p.get('lexicon', {}).values()):>7}"
              f"  {p.get('title', '-')} / {p.get('lecturer', '-')}")
    print("\n* = default course when a command names none")


def cmd_course(a):
    code = a.code.upper()
    p = load_profile(code) or {"course": code, "created": _date.today().isoformat(),
                               "lectures": [], "vocabulary": {}}
    for key, val in [("title", a.title), ("lecturer", a.lecturer), ("course_id", a.id)]:
        if val:
            p[key] = val
    if a.subject:
        p["decoder_context"] = f"University lecture in {a.subject}."
        p["review_context"] = (f"a university lecture in {a.subject} ({code}). The speech recogniser "
                               f"mis-hears technical terms and names.")
    if a.examples:
        p["review_examples"] = a.examples
    COURSES.mkdir(exist_ok=True)
    profile_path(code).write_text(json.dumps(p, indent=2, sort_keys=True))
    if a.default:
        DEFAULT_FILE.write_text(code)
    print(f"Saved {profile_path(code).relative_to(ROOT)}" + ("  (now the default course)" if a.default else ""))
    cmd_courses(a)


def cmd_fix(a):
    code = a.code.upper()
    p = load_profile(code)
    if not p:
        sys.exit(f"No profile for {code}. Create it first: ./lp course {code} --title …")
    lex = p.setdefault("lexicon", {})
    known = lex.setdefault(a.term, [])
    added = [w for w in a.wrong if w not in known]
    known.extend(added)
    profile_path(code).write_text(json.dumps(p, indent=2, sort_keys=True))
    print(f"{code}: {' / '.join(added) or '(nothing new)'} -> {a.term}")
    print("Applies from the transcribe stage on; for an existing lecture: "
          "./lp redo <slug> --from transcribe")


def cmd_urls(a):
    code = resolve_course(a.course, None)
    cid = load_profile(code).get("course_id")
    if not cid:
        sys.exit(f"{code} has no course_id. Set it: ./lp course {code} --id <LRSWAPI id>")
    print((ROOT / "docs" / "get-urls.js").read_text().replace("COURSE_ID", str(cid)))


def cmd_check(a):
    ok = True
    def line(good, what, hint=""):
        nonlocal ok
        ok &= good or hint.startswith("optional")
        print(f"  {'✓' if good else '✗'} {what}" + ("" if good else f"   - {hint}"))
    print("Prerequisites")
    for tool, hint in [("ffmpeg", "brew install ffmpeg"), ("tesseract", "brew install tesseract (slide OCR)"),
                       ("uv", "https://docs.astral.sh/uv/")]:
        line(bool(shutil.which(tool)), tool, hint)
    line((ROOT / ".venv").exists(), ".venv", "just setup")
    line(bool(os.environ.get("OPENAI_API_KEY")), "OPENAI_API_KEY", "needed for transcription, review, notes")
    line(bool(os.environ.get("GEMINI_API_KEY")), "GEMINI_API_KEY", "optional: cross-check engine")
    line(bool(all_profiles()), "course profiles", "./lp course CODE --title … --id …")
    print("Ready." if ok else "Fix the ✗ items above.")


def main():
    ap = argparse.ArgumentParser(prog="lp", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def pipeline_opts(p):
        p.add_argument("--no-review", action="store_true", help="skip the LLM review pass")
        p.add_argument("--backend", default="best", choices=["local", "api", "both", "best"])

    p = sub.add_parser("run", help="new lecture: download -> transcript -> slides -> notes -> study pages")
    p.add_argument("url", help="signed .m3u8 URL (the extension copies it)")
    p.add_argument("--date", help="recording date YYYY-MM-DD (default: today)")
    p.add_argument("--course", help="course code, e.g. BTEC501")
    p.add_argument("--course-id", help="LRSWAPI course id; mapped to a profile's course_id")
    p.add_argument("--slug", help="output basename (default: <course>-<date>)")
    p.add_argument("--title", help="lecture title (default: written from the notes)")
    p.add_argument("--skip-fetch", action="store_true", help="recording already in lectures/<slug>.mp4")
    pipeline_opts(p)
    p.set_defaults(fn=cmd_run)

    p = sub.add_parser("redo", help="rebuild an existing lecture from a stage onwards")
    p.add_argument("slug")
    p.add_argument("--from", dest="start", default="slides", choices=STAGES)
    p.add_argument("--title", help="set a new title")
    p.add_argument("--auto-title", action="store_true", help="(re)write the title from the notes")
    p.add_argument("--course", help="correct the course")
    p.add_argument("--url", help="signed URL, only for --from fetch")
    pipeline_opts(p)
    p.set_defaults(fn=cmd_redo)

    p = sub.add_parser("list", help="every lecture and what it has")
    p.set_defaults(fn=cmd_list)

    p = sub.add_parser("open", help="open a lecture's study page (or --audio/--doc/--md/--review)")
    p.add_argument("slug")
    for f in ["audio", "doc", "md", "review"]:
        p.add_argument(f"--{f}", action="store_true")
    p.set_defaults(fn=cmd_open)

    p = sub.add_parser("courses", help="list course profiles")
    p.set_defaults(fn=cmd_courses)

    p = sub.add_parser("course", help="create or update a course profile")
    p.add_argument("code")
    p.add_argument("--title", help='e.g. "BTEC 501 — Bioinformatics"')
    p.add_argument("--lecturer")
    p.add_argument("--id", help="LRSWAPI course id (the extension passes it as --course-id)")
    p.add_argument("--subject", help='what the course is about, e.g. "bioinformatics: sequence alignment, BLAST"')
    p.add_argument("--examples", help="comma-separated unusual terms the lecturer really uses")
    p.add_argument("--default", action="store_true", help="use this course when a command names none")
    p.set_defaults(fn=cmd_course)

    p = sub.add_parser("fix", help="add a recurring mis-hearing to a course's lexicon")
    p.add_argument("code")
    p.add_argument("term", help="the correct form, e.g. BLOSUM")
    p.add_argument("wrong", nargs="+", help="how the transcript mis-hears it, e.g. blossom")
    p.set_defaults(fn=cmd_fix)

    p = sub.add_parser("urls", help="print the DevTools snippet (fallback when the extension can't)")
    p.add_argument("--course")
    p.set_defaults(fn=cmd_urls)

    p = sub.add_parser("check", help="check prerequisites")
    p.set_defaults(fn=cmd_check)

    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
