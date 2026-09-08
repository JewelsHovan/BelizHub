"""Write the artefacts: a VTT the Lecture Desk imports, study notes, and an audit."""

import json
from datetime import datetime

import structure
from lexicon import LEXICON


def timestamp(seconds):
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def to_vtt(segments):
    """WEBVTT matching lecture-desk/transcripts.py: ordered cues, end > start."""
    lines = ["WEBVTT", ""]
    for i, seg in enumerate(segments, 1):
        end = max(seg["end"], seg["start"] + 0.05)
        lines += [str(i), f"{timestamp(seg['start'])} --> {timestamp(end)}",
                  seg["text"], ""]
    return "\n".join(lines)


def to_transcript_txt(segments):
    return "\n\n".join(s["text"] for s in segments)


def hhmm(seconds):
    return f"{int(seconds // 60):02d}:{int(seconds % 60):02d}"


def to_notes(meta, segments, secs, index, flagged, changes):
    """A study map: sections with timestamps, a term index, and what to verify."""
    total = segments[-1]["end"] if segments else 0
    out = [
        f"# {meta['title']}",
        "",
        f"*{meta['course']} · {meta['date']} · {int(total // 60)} min · "
        f"machine transcript, unverified*",
        "",
        "> Generated locally by the BelizHub lecture pipeline. Section titles and "
        "keywords are derived statistically from the transcript, not written by a "
        "person or a language model. **Check scientific terms and figures against "
        "the recording and the slides before relying on them.**",
        "",
        "## Sections",
        "",
    ]
    all_labels = structure.label_sections(segments, secs)
    for n, (sec, (terms, keywords)) in enumerate(zip(secs, all_labels), 1):
        a, b = sec["start_index"], sec["end_index"]
        head = ", ".join(keywords[:3]) or (", ".join(terms[:3]) or "Discussion")
        out.append(f"### {n}. {head or 'Discussion'}  ·  {hhmm(segments[a]['start'])}"
                   f"–{hhmm(segments[b]['end'])}")
        out.append("")
        out.append(f"*Keywords:* {', '.join(keywords)}")
        if terms:
            out.append(f"*Course terms:* {', '.join(terms)}")
        out.append("")
        opening = " ".join(s["text"] for s in segments[a:min(a + 3, b + 1)])
        out.append(f"Opens: “{opening[:260].strip()}…”")
        out.append("")

    out += ["## Where each term is discussed", ""]
    for term, times in list(index.items())[:40]:
        stamps = ", ".join(hhmm(t) for t in times[:8])
        more = f" (+{len(times) - 8} more)" if len(times) > 8 else ""
        out.append(f"- **{term}** — {stamps}{more}")
    out.append("")

    out += ["## Verify these passages", ""]
    if flagged:
        out.append(f"{len(flagged)} passage(s) decoded with low confidence. "
                   "Re-listen before trusting them:")
        out.append("")
        for s in flagged[:25]:
            out.append(f"- `{hhmm(s['start'])}` (score {s['avg_logprob']:.2f}) — "
                       f"“{s['text'][:150]}”")
    else:
        out.append("No passage fell below the low-confidence threshold. That means "
                   "the decoder was consistently sure of itself — **it is not proof "
                   "the words are correct**, especially for names and figures.")
    out.append("")

    out += ["## Vocabulary corrections applied", ""]
    if changes:
        out.append("The pipeline replaced known mis-hearings of course vocabulary:")
        out.append("")
        for wrong, right, n in changes:
            out.append(f"- `{wrong}` → **{right}** ({n}×)")
    else:
        out.append("No lexicon corrections were needed.")
    out.append("")
    return "\n".join(out)


def to_readable(meta, segments, secs):
    """A reading copy: sectioned, timestamped, no metrics or machinery."""
    total = segments[-1]["end"] if segments else 0
    out = [f"# {meta['title']} — {meta['course']}", "",
           f"*{meta['date']} · {int(total // 60)} minutes · automatic transcript*", "",
           "> Produced automatically from the recording. Wording is close but not "
           "perfect — check technical terms, names and numbers against the "
           "recording or slides before relying on them.", "",
           "---", ""]
    labels = structure.label_sections(segments, secs)
    for n, (sec, (_terms, keywords)) in enumerate(zip(secs, labels), 1):
        a, b = sec["start_index"], sec["end_index"]
        out.append(f"## {n}. {', '.join(keywords[:3])}"
                   f"  ·  {hhmm(segments[a]['start'])}–{hhmm(segments[b]['end'])}")
        out.append("")
        # Stamp each paragraph with the time it STARTS, so the timestamp is a
        # usable seek point rather than where the paragraph happened to end.
        para, para_start = [], None
        for seg in segments[a:b + 1]:
            if para_start is None:
                para_start = seg["start"]
            para.append(seg["text"])
            if sum(len(x) for x in para) > 700:
                out.append(f"**`{hhmm(para_start)}`**  " + " ".join(para))
                out.append("")
                para, para_start = [], None
        if para:
            out.append(f"**`{hhmm(para_start)}`**  " + " ".join(para))
            out.append("")
    return "\n".join(out)


def to_review(meta, verified):
    """What the review model proposed, and what the recording said about it."""
    groups = {"CONFIRMED": [], "CONTRADICTED": [], "UNRESOLVED": []}
    for v in verified:
        groups.setdefault(v["verdict"], []).append(v)
    out = [f"# Review log — {meta['title']}", "",
           "A language model proof-read the transcript for biology and lab-method "
           "errors. Every proposal was then checked against the recording by "
           "re-transcribing that moment with independent engines.", "",
           f"**{len(groups['CONFIRMED'])} applied · "
           f"{len(groups['CONTRADICTED'])} rejected · "
           f"{len(groups['UNRESOLVED'])} need a human**", ""]

    out += ["## Applied (an independent engine heard this in the audio)", ""]
    for v in groups["CONFIRMED"]:
        out.append(f"- `{hhmm(v['at'])}` “{v['find']}” → **{v['replace']}** — "
                   f"{v['reason']} *(heard by {', '.join(v['heard_new'])})*")
    out += ["", "## Rejected (the recording contradicts the suggestion)", "",
            "The model corrected these toward the textbook, but the engines agree "
            "with the original wording. Left exactly as spoken.", ""]
    for v in groups["CONTRADICTED"]:
        out.append(f"- `{hhmm(v['at'])}` “{v['find']}” → ~~{v['replace']}~~ — "
                   f"{v['reason']}")
    out += ["", "## Needs a human ear", "",
            "Neither wording could be confirmed. Worth listening to before "
            "relying on these passages.", ""]
    for v in groups["UNRESOLVED"]:
        out.append(f"- `{hhmm(v['at'])}` “{v['find']}” → ? **{v['replace']}** — "
                   f"{v['reason']}")
    out.append("")
    return "\n".join(out)


def to_entities(meta, confirmed, suspect):
    """Which biological names were checked against public registries."""
    out = [f"# Biological names — {meta['title']}", "",
           "Every name below was looked up in a public registry (HGNC, UniProt, "
           "PubChem, Cellosaurus, NCBI Taxonomy). This checks the name EXISTS; "
           "it does not check the lecture used it correctly.", "",
           f"**{len(confirmed)} confirmed · {len(suspect)} unresolved**", "",
           "## Confirmed", ""]
    for e in confirmed:
        c = e["check"]
        r = c.get("record", {})
        ident = r.get("id") or r.get("accession") or r.get("cid") or r.get("taxon") or ""
        note = f" — {r.get('name')}" if r.get("name") else ""
        out.append(f"- **{e['text']}** ({c.get('kind','')}) — {r.get('source','')}"
                   f"{' ' + str(ident) if ident else ''}{note}")
    out += ["", "## Not found in any registry", "",
            "Either a mis-hearing, or something specific to this course "
            "(a construct, a group name, a local label).", ""]
    for e in suspect:
        if e.get("likely_asr_error"):
            flag = "possibly a mis-hearing"
        elif e.get("descriptive_phrase"):
            flag = "a descriptive phrase, not a catalogued name"
        else:
            flag = "used repeatedly, so probably real"
        sug = e["check"].get("suggestions")
        out.append(f"- `{hhmm(e['at'])}` **{e['text']}** — said {e['mentions']}×, "
                   f"{flag}" + (f" (near: {', '.join(sug)})" if sug else ""))
    out.append("")
    return "\n".join(out)


def audit(meta, fingerprint, segments, secs, flagged, changes, warnings):
    lps = [s["avg_logprob"] for s in segments]
    return json.dumps({
        "generated": datetime.now().isoformat(timespec="seconds"),
        "source": meta,
        "config": fingerprint,
        "segments": len(segments),
        "sections": len(secs),
        "duration_seconds": segments[-1]["end"] if segments else 0,
        "confidence": {
            "mean_avg_logprob": round(sum(lps) / len(lps), 4) if lps else None,
            "min_avg_logprob": round(min(lps), 4) if lps else None,
            "low_confidence_segments": len(flagged),
        },
        "lexicon_corrections": [{"pattern": w, "to": r, "count": n} for w, r, n in changes],
        "warnings": warnings,
    }, indent=2)
