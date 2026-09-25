"""Slide-aligned lecture notes: a screen-capture recording + its transcript ->
one entry per distinct slide (its image, the text on it, its visits, and the
transcript spoken over it) as a Word document, Markdown, and slide JSON for the
notes and study page.

Slide changes are found by frame-differencing the video (robust for text
slides, where scene-score detectors fail). The frames are then OCR'd and
grouped: webcam/pointer-only changes and animation builds merge into one entry
(keeping the fully built slide), a slide the lecturer returns to gains a visit
instead of a duplicate entry, and brief frames (flipping past slides, the
PowerPoint editor) fold into the slide around them.

  uv run python slidedoc.py \
      --video lecture.mp4 --transcript out/<slug>.segments.json \
      --out out/<slug>.slides.docx \
      --title "..." --lecturer "..." --date "18 September 2026" --course "BIOT 505"

Everything it reads and writes is transient/private; nothing is committed.
"""

import argparse
import json
import subprocess
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH


def hms(t):
    t = int(round(t))
    return f"{t // 3600}:{(t % 3600) // 60:02d}:{t % 60:02d}"


def video_duration(video):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", video],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def detect_changes(video, work, step=2, w=96, h=54, min_gap=8.0):
    """Timestamps (s) where the slide image changes, by mean-abs-diff of dense
    downscaled grayscale frames."""
    raw = work / "frames.raw"
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", video,
         "-vf", f"fps=1/{step},scale={w}:{h},format=gray",
         "-f", "rawvideo", "-pix_fmt", "gray", str(raw)], check=True)
    a = np.fromfile(raw, dtype=np.uint8)
    n = a.size // (w * h)
    a = a[:n * w * h].reshape(n, w * h).astype(np.int16)
    d = np.abs(np.diff(a, axis=0))
    mad = d.mean(axis=1)
    # Pixels that change in many samples are live video (the speaker's webcam,
    # a Zoom tile), not slide content; slide comparisons ignore them.
    live = ((d > 12).mean(axis=0) > 0.08).reshape(h, w)
    # threshold: well above the static baseline, below real slide-flip spikes
    med, q75 = np.percentile(mad, 50), np.percentile(mad, 75)
    thr = max(6.0, med + 6 * (q75 - med + 1e-6))
    changes = []
    for i in np.where(mad > thr)[0]:
        t = float((i + 1) * step)
        if changes and t - changes[-1] < min_gap:
            continue
        changes.append(t)
    return changes, float(thr), live


def extract_frames(video, bounds, slides_dir):
    """One representative full-res frame per [start,end) segment, sampled late
    enough to catch the fully-built slide."""
    slides_dir.mkdir(parents=True, exist_ok=True)
    segs = []
    for i in range(len(bounds) - 1):
        s, e = bounds[i], bounds[i + 1]
        dur = e - s
        t = min(max(s + 1.5, s + dur * 0.7), e - 1.5) if dur > 3 else s + dur / 2
        out = slides_dir / f"slide_{i + 1:03d}.jpg"
        subprocess.run(
            ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-ss", f"{t:.2f}",
             "-i", video, "-frames:v", "1", "-q:v", "3", str(out)], check=True)
        segs.append({"start": s, "end": e, "frame_t": t, "img": str(out)})
    return segs


CMP_W, CMP_H = 160, 90


def ocr(segs, workers=8):
    """Slide text via tesseract (if installed): the best signal for "is this
    the same slide", and useful context in its own right."""
    import re
    import shutil
    from concurrent.futures import ThreadPoolExecutor
    if not shutil.which("tesseract"):
        for sg in segs:
            sg["text"], sg["words"] = "", set()
        return False

    def one(sg):
        r = subprocess.run(["tesseract", sg["img"], "-", "--psm", "3"],
                           capture_output=True, text=True)
        return r.stdout

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for sg, text in zip(segs, pool.map(one, segs)):
            sg["text"] = "\n".join(l.strip() for l in text.splitlines() if l.strip())
            sg["words"] = set(re.findall(r"[a-z0-9]{3,}", text.lower()))
    return True


def _thumb(path):
    im = Image.open(path).convert("L").resize((CMP_W, CMP_H), Image.BILINEAR)
    return np.asarray(im, dtype=np.int16)


class Matcher:
    """Pairwise slide relations on masked thumbnails + OCR word sets."""

    def __init__(self, segs, live):
        from scipy.ndimage import binary_dilation
        m = Image.fromarray(live.astype(np.uint8) * 255).resize((CMP_W, CMP_H))
        self.keep = ~binary_dilation(np.asarray(m) > 0, iterations=3)
        for sg in segs:
            sg["px"] = _thumb(sg["img"])

    def pix(self, a, b):
        """Fraction of (non-live) pixels that clearly differ."""
        ch = (np.abs(a["px"] - b["px"]) > 40) & self.keep
        return ch.sum() / self.keep.sum()

    def added(self, a, b):
        """Of the pixels that changed a -> b, the share that were blank
        background in a: ~1.0 for an animation build, low for a new layout."""
        ch = (np.abs(a["px"] - b["px"]) > 40) & self.keep
        if not ch.any():
            return 1.0
        v, c = np.unique(a["px"][self.keep] // 8, return_counts=True)
        bg = v[c.argmax()] * 8 + 4
        return ((np.abs(a["px"] - bg) < 24) & ch).sum() / ch.sum()

    @staticmethod
    def jaccard(a, b):
        u = a["words"] | b["words"]
        return len(a["words"] & b["words"]) / len(u) if u else 1.0

    def same(self, a, b):
        if self.pix(a, b) < 0.008:
            return True
        return (min(len(a["words"]), len(b["words"])) >= 5
                and self.jaccard(a, b) >= 0.85)

    def build(self, a, b):
        """b is a (text) superset of a: a bullet or figure appeared."""
        wa, wb = a["words"], b["words"]
        return len(wa) >= 3 and len(wb) > len(wa) and len(wa & wb) / len(wa) >= 0.95


def group(segs, live, min_dur=8.0):
    """Collapse raw segments into one entry per distinct slide.

    - identical frames (webcam / pointer only)      -> same entry
    - an animation build of the slide just shown    -> same entry, final image
    - a slide shown earlier (lecturer went back)    -> earlier entry, new visit
    - a brief frame matching nothing (flipping
      past slides, the PowerPoint editor, a pop-up) -> folded into the current
    """
    m = Matcher(segs, live)
    groups, cur, last = [], None, None

    def dur(sg):
        return sg["end"] - sg["start"]

    for sg in segs:
        if cur is not None and m.same(last, sg):
            cur["visits"][-1][1] = sg["end"]
            cur["members"].append(sg)
            if len(sg["words"]) > len(cur["rep"]["words"]) and dur(sg) >= dur(cur["rep"]):
                cur["rep"] = sg
        elif cur is not None and m.build(last, sg):
            cur["visits"][-1][1] = sg["end"]
            cur["members"].append(sg)
            # a real build keeps the layout; a text superset with a new layout
            # is usually the editor or a zoomed view -> keep the longer frame
            if m.added(last, sg) >= 0.8 or dur(sg) >= dur(cur["rep"]):
                cur["rep"] = sg
        else:
            prev = next((g for g in reversed(groups) if any(
                m.same(x, sg) for x in g["members"])), None)
            if prev is not None:
                if prev is cur:                   # back after a folded pop-up
                    cur["visits"][-1][1] = sg["end"]
                else:
                    prev["visits"].append([sg["start"], sg["end"]])
                prev["members"].append(sg)
                cur = prev
            elif cur is not None and dur(sg) < min_dur:
                cur["visits"][-1][1] = sg["end"]
                last = sg                     # compare the next frame to what is on screen
                continue
            else:
                cur = {"rep": sg, "members": [sg], "visits": [[sg["start"], sg["end"]]]}
                groups.append(cur)
        last = sg
    return groups


def align(groups, cues):
    """Attach each transcript cue to the slide visit that holds its midpoint."""
    spans = sorted((v[0], v[1], g, k) for g in groups for k, v in enumerate(g["visits"]))
    for g in groups:
        g["cues"] = [[] for _ in g["visits"]]
    for c in cues:
        mid = (c["start"] + c["end"]) / 2
        hit = next((sp for sp in spans if sp[0] <= mid < sp[1]), spans[-1] if spans else None)
        if hit:
            hit[2]["cues"][hit[3]].append(c)
    return groups


def title_of(text):
    """First OCR line that reads like a heading."""
    for line in text.splitlines():
        line = line.strip(" .:-|")
        if len(line) >= 4 and sum(ch.isalpha() for ch in line) >= 0.6 * len(line):
            return line[:90]
    return ""


def to_records(groups):
    """Plain, JSON-able slide records (what the notes + study page consume)."""
    recs = []
    for i, g in enumerate(groups, 1):
        recs.append({
            "n": i,
            "image": g["rep"]["img"],
            "title": title_of(g["rep"]["text"]),
            "slide_text": g["rep"]["text"],
            "visits": [{"start": round(v[0], 2), "end": round(v[1], 2),
                        "cues": [{"start": c["start"], "end": c["end"],
                                  "text": c["text"].strip(),
                                  "flag": bool(c.get("needs_review"))} for c in cs]}
                       for v, cs in zip(g["visits"], g["cues"])],
        })
    return recs


def clean_image(path, max_w=1280):
    """Re-encode to a clean baseline JPEG python-docx will accept (ffmpeg's
    JPEGs occasionally trip its strict header parser)."""
    im = Image.open(path).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=85)
    buf.seek(0)
    return buf


def heading_of(r):
    t = (r.get("notes") or {}).get("title") or r["title"]
    return f"Slide {r['n']}" + (f" — {t}" if t else "")


def visits_line(r):
    spans = [f"{hms(v['start'])}–{hms(v['end'])}" for v in r["visits"]]
    return "Shown " + spans[0] + ("" if len(spans) == 1 else " · back to it " + ", ".join(spans[1:]))


def build_docx(recs, meta, out_path):
    """One entry per distinct slide: image, the text on it, what was said."""
    doc = Document()
    normal = doc.styles["Normal"].font
    normal.name = "Calibri"
    normal.size = Pt(11)
    grey = RGBColor(0x60, 0x60, 0x60)

    title = doc.add_heading(meta["title"], level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for line in [meta.get("lecturer", ""), meta.get("course", ""), meta.get("date", "")]:
        if not line:
            continue
        p = doc.add_paragraph(line)
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.runs[0].font.size = Pt(12)

    n_flag = sum(c["flag"] for r in recs for v in r["visits"] for c in v["cues"])
    note = doc.add_paragraph()
    rn = note.add_run(
        f"{len(recs)} slides, each listed once: animation builds are merged and "
        f"slides the lecturer returned to carry every visit. \"On the slide\" is "
        f"OCR of the slide image; the transcript is gpt-transcribe (cross-checked, "
        f"reviewed). {n_flag} passage(s) the engines disagreed on are in orange italics.")
    rn.font.size = Pt(9)
    rn.font.color.rgb = RGBColor(0x80, 0x80, 0x80)
    note.alignment = WD_ALIGN_PARAGRAPH.CENTER

    for r in recs:
        doc.add_page_break()
        head = doc.add_heading(level=1)
        head.add_run(heading_of(r))
        sub = doc.add_paragraph()
        rs = sub.add_run(visits_line(r))
        rs.font.size = Pt(10)
        rs.font.color.rgb = grey
        doc.add_picture(clean_image(r["image"]), width=Inches(6.5))
        doc.paragraphs[-1].alignment = WD_ALIGN_PARAGRAPH.CENTER

        notes = (r.get("notes") or {}).get("notes") or []
        if notes:
            h = doc.add_paragraph()
            rh = h.add_run("Summary (AI-written from the slide and transcript)")
            rh.bold, rh.font.size = True, Pt(10)
            for n in notes:
                doc.add_paragraph(n, style="List Bullet")

        if r["slide_text"]:
            h = doc.add_paragraph()
            rh = h.add_run("On the slide")
            rh.bold, rh.font.size = True, Pt(10)
            t = doc.add_paragraph()
            rt = t.add_run(r["slide_text"])
            rt.font.size, rt.font.color.rgb = Pt(9), grey

        h = doc.add_paragraph()
        rh = h.add_run("Transcript")
        rh.bold, rh.font.size = True, Pt(10)
        if not any(v["cues"] for v in r["visits"]):
            e = doc.add_paragraph("(no speech recorded on this slide)")
            e.runs[0].font.italic = True
            e.runs[0].font.color.rgb = RGBColor(0x99, 0x99, 0x99)
            continue
        for v in r["visits"]:
            if not v["cues"]:
                continue
            para = doc.add_paragraph()
            if len(r["visits"]) > 1:
                lab = para.add_run(f"[{hms(v['start'])}] ")
                lab.bold, lab.font.color.rgb = True, grey
            for c in v["cues"]:
                run = para.add_run(c["text"] + " ")
                if c["flag"]:
                    run.font.italic = True
                    run.font.color.rgb = RGBColor(0x9A, 0x63, 0x00)

    doc.save(out_path)
    return out_path, n_flag


def build_md(recs, meta):
    """The same content as plain Markdown - the lightest form to hand an LLM."""
    out = [f"# {meta['title']}", "",
           " · ".join(x for x in [meta.get("course"), meta.get("lecturer"), meta.get("date")] if x),
           "", "_One section per distinct slide. \"On the slide\" is OCR of the slide; "
           "the transcript is machine-generated; [?…?] marks passages the engines disagreed on._", ""]
    for r in recs:
        out += [f"## {heading_of(r)}", "", f"*{visits_line(r)}*", ""]
        notes = (r.get("notes") or {}).get("notes") or []
        if notes:
            out += ["**Summary (AI-written):**", ""] + [f"- {n}" for n in notes] + [""]
        if r["slide_text"]:
            out += ["**On the slide:**", "", "> " + r["slide_text"].replace("\n", "\n> "), ""]
        out += ["**Transcript:**", ""]
        for v in r["visits"]:
            if not v["cues"]:
                continue
            body = " ".join(f"[?{c['text']}?]" if c["flag"] else c["text"] for c in v["cues"])
            out += [(f"[{hms(v['start'])}] " if len(r["visits"]) > 1 else "") + body, ""]
    return "\n".join(out)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--video", required=True)
    ap.add_argument("--transcript", required=True, help="<slug>.segments.json from run.py")
    ap.add_argument("--out", required=True, help="out/<slug>.slides.docx (.md and .json written beside it)")
    ap.add_argument("--title", default="Lecture")
    ap.add_argument("--lecturer", default="")
    ap.add_argument("--course", default="")
    ap.add_argument("--date", default="")
    ap.add_argument("--step", type=float, default=2.0, help="sampling seconds for change detection")
    ap.add_argument("--workdir", default="", help="default: work/<slug>/slidedoc (kept for the study page)")
    args = ap.parse_args()

    video = str(Path(args.video).expanduser())
    cues = json.load(open(Path(args.transcript).expanduser()))
    dur = video_duration(video)
    out_path = Path(args.out).expanduser()
    stem = out_path.name.split(".")[0]

    tmp = Path(args.workdir).expanduser() if args.workdir else Path("work") / stem / "slidedoc"
    tmp.mkdir(parents=True, exist_ok=True)
    slides_dir = tmp / "slides"

    print(f"[1/6] Detecting slide changes ({dur/60:.1f} min video)…")
    changes, thr, live = detect_changes(video, tmp, step=args.step)
    bounds = [0.0] + changes + [dur]
    print(f"      {len(changes)} changes (threshold {thr:.1f}) -> {len(bounds)-1} raw segments")

    print("[2/6] Extracting full-res slide frames…")
    segs = extract_frames(video, bounds, slides_dir)

    print("[3/6] Reading slide text (OCR)…")
    if not ocr(segs):
        print("      tesseract not found - grouping on pixels only (brew install tesseract)")

    print("[4/6] Grouping builds, revisits and pop-ups into distinct slides…")
    groups = group(segs, live)
    revisits = sum(len(g["visits"]) - 1 for g in groups)
    print(f"      -> {len(groups)} slides ({revisits} return visit(s) merged)")

    print(f"[5/6] Aligning {len(cues)} transcript cues to slides…")
    recs = to_records(align(groups, cues))

    print("[6/6] Writing Word document, Markdown and slide JSON…")
    meta = {"title": args.title, "lecturer": args.lecturer,
            "course": args.course, "date": args.date}
    out_path.parent.mkdir(parents=True, exist_ok=True)
    path, n_flag = build_docx(recs, meta, str(out_path))
    md, js = out_path.with_name(stem + ".slides.md"), out_path.with_name(stem + ".slides.json")
    md.write_text(build_md(recs, meta))
    js.write_text(json.dumps({"meta": meta, "slides": recs}, indent=1))
    print(f"\nWrote {path}  ({len(recs)} slides, {n_flag} flagged passages)")
    print(f"      {md}  ·  {js}")


if __name__ == "__main__":
    main()
