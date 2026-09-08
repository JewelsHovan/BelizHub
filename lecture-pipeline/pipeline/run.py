"""End-to-end: lecture audio -> VTT for the Lecture Desk, study notes, audit.

  python run.py AUDIO --course BTEC620 --title "Lecture 1" --date 2026-09-03
Backends:
  --backend local   fully offline (default; nothing leaves the machine)
  --backend api     hosted ASR, more accurate on course vocabulary; UPLOADS AUDIO
  --backend both    api transcript + local cross-check for disagreement flags
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import agree
import audio
import emit
import structure
import transcribe as local_asr
from lexicon import LEXICON, correct


def slugify(text):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.lower())).strip("-") or "lecture"


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("audio")
    ap.add_argument("--course", default="BTEC620")
    ap.add_argument("--title", default="Untitled lecture")
    ap.add_argument("--date", default="")
    ap.add_argument("--backend", choices=["local", "api", "both", "best"],
                    default="local",
                    help="best = gpt-transcribe wording fused onto whisper-1 timings")
    ap.add_argument("--review", action="store_true",
                    help="LLM review pass, with every proposal verified against "
                         "the recording before it is applied")
    ap.add_argument("--outdir", default="out")
    ap.add_argument("--workdir", default="work")
    args = ap.parse_args()

    src = Path(args.audio).expanduser()
    if not src.exists():
        sys.exit(f"No such audio file: {src}")
    slug = slugify(f"{args.course}-{args.title}")
    work = Path(args.workdir) / slug
    out = Path(args.outdir)
    out.mkdir(parents=True, exist_ok=True)
    warnings = []

    print(f"[1/6] Normalising audio ({src.name})")
    wav = audio.normalise(src, work / "audio16k.wav")
    total = audio.duration(wav)
    print(f"      {total/60:.1f} min at 16 kHz mono, -16 LUFS")

    chunks = None
    if args.backend in ("api", "both", "best"):
        # Pauses are found on the unprocessed copy: loudness normalisation
        # lifts quiet gaps above every silence threshold, which made every
        # chunk boundary fall on a blind timer cut mid-sentence.
        plain = audio.to_wav(src, work / "audio16k_plain.wav")
        spans = audio.plan_chunks(total, audio.silences(plain))
        chunks = audio.export_chunks(wav, spans, work / "chunks")
        print(f"[2/6] Split into {len(chunks)} chunk(s) on natural pauses for upload")
    else:
        print("[2/6] Local backend: no chunking or upload needed")

    crosscheck = None
    if args.backend == "best":
        import asr_api
        import fuse as fuser
        print(f"[3/6] Timing pass: {asr_api.TIMED_MODEL}")
        timed_cache = work / "timed.json"
        if timed_cache.exists():
            timed = json.loads(timed_cache.read_text())
            print("      reused cached timing pass")
        else:
            timed = asr_api.timed_segments(chunks)
            timed_cache.write_text(json.dumps(timed))
        print(f"      accuracy pass: {asr_api.ACCURATE_MODEL}")
        cache = work / "accurate.txt"
        accurate = cache.read_text() if cache.exists() else asr_api.plain_text(chunks)
        cache.write_text(accurate)
        segments, fstats = fuser.fuse(timed, accurate)
        engine = f"fused:{asr_api.ACCURATE_MODEL}+{asr_api.TIMED_MODEL}"
        print(f"      fused into {fstats['cues']} cues; recovered "
              f"{fstats['recovered_words']} word(s) from {fstats['recovered_regions']} "
              f"region(s) the accurate engine dropped")
        if fstats["recovered_words"]:
            warnings.append(
                f"{asr_api.ACCURATE_MODEL} omitted {fstats['recovered_regions']} "
                f"region(s) ({fstats['recovered_words']} words); whisper-1 text was "
                f"kept there and is marked in the segment data.")
        crosscheck = " ".join(s["text"] for s in timed)
    elif args.backend == "local":
        print("[3/6] Transcribing locally (mlx whisper-large-v3-turbo, greedy)")
        segments = local_asr.transcribe(wav)
        engine = f"local:{local_asr.MODEL}"
    else:
        import asr_api
        print(f"[3/6] Transcribing via {asr_api.TIMED_MODEL} (timestamped)")
        segments = asr_api.timed_segments(chunks)
        engine = f"api:{asr_api.TIMED_MODEL}"
        print(f"      cross-checking with {asr_api.ACCURATE_MODEL}")
        # Cached so re-running the structuring stages costs nothing extra.
        cache = work / "crosscheck.txt"
        if cache.exists():
            crosscheck = cache.read_text()
            print("      reused cached cross-check transcript")
        else:
            crosscheck = asr_api.plain_text(chunks)
            cache.write_text(crosscheck)
    if not segments:
        sys.exit("No speech was transcribed. Check the recording.")
    print(f"      {len(segments)} segments")

    if args.backend == "both" and crosscheck is None:
        crosscheck = " ".join(s["text"] for s in local_asr.transcribe(wav))

    print("[4/6] Applying lexicon corrections")
    changes_total = {}
    for seg in segments:
        seg["text"], changes = correct(seg["text"])
        for pat, right, n in changes:
            key = (pat, right)
            changes_total[key] = changes_total.get(key, 0) + n
    changes = [(p, r, n) for (p, r), n in sorted(changes_total.items(), key=lambda kv: -kv[1])]
    print(f"      {sum(n for _, _, n in changes)} substitution(s) across "
          f"{len(changes)} rule(s)")

    verified = []
    if args.review:
        import review as reviewer
        import verify as verifier
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "eval"))
        import engines as engine_pool

        print(f"[4b/6] Review pass ({reviewer.MODEL})")
        rcache = work / "review.json"
        if rcache.exists():
            cached = json.loads(rcache.read_text())
            proposals, blocked, rerrs = cached["p"], cached["b"], cached["e"]
            print("      reused cached review proposals")
        else:
            proposals, blocked, rerrs = reviewer.review(segments)
            rcache.write_text(json.dumps({"p": proposals, "b": blocked, "e": rerrs}))
        print(f"      {len(proposals)} proposal(s); {len(blocked)} blocked by "
              f"anti-rewrite guards; {len(rerrs)} error(s)")
        if proposals:
            print("      verifying each against the recording")
            pool = {
                "gemini-3.5-transcribe": engine_pool.ENGINES["gemini-3.5-transcribe"],
                "gpt-4o-mini-transcribe": engine_pool.ENGINES["openai_gpt4o_mini"],
                "whisper-1": engine_pool.ENGINES["openai_whisper1"],
            }
            vcache = work / "verified.json"
            if vcache.exists():
                verified = json.loads(vcache.read_text())
                print("      reused cached audio verification")
            else:
                verified = verifier.verify(proposals, wav, pool)
                vcache.write_text(json.dumps(verified))
            confirmed = [v for v in verified if v["verdict"] == "CONFIRMED"]
            counts = {}
            for v in verified:
                counts[v["verdict"]] = counts.get(v["verdict"], 0) + 1
            print(f"      {counts}")
            segments, applied = reviewer.apply(segments, confirmed,
                                               min_confidence="medium")
            for c in applied:
                changes.append((c["find"], c["replace"], c["occurrences"]))
            print(f"      applied {len(applied)} audio-confirmed correction(s); "
                  f"{len(verified) - len(confirmed)} left for a human to check")
            warnings.append(
                f"LLM review proposed {len(verified)} corrections; only the "
                f"{len(confirmed)} an independent engine could hear in the audio "
                f"were applied. The rest are listed for checking, not applied.")

    drift = None
    contested = []
    if crosscheck:
        drift = agree.annotate(segments, crosscheck)
        contested = agree.contested_terms(segments, crosscheck, LEXICON)
        gaps = agree.coverage_gaps(segments)
        for g in gaps:
            for seg in segments:
                if g["start"] <= seg["start"] <= g["end"]:
                    seg["needs_review"] = False
                    seg["crosscheck_missing"] = True
        flagged = [s for s in segments if s.get("needs_review")]
        print(f"[5/6] Cross-engine drift {drift:.1%}; {len(flagged)} segment(s) flagged")
        warnings.append(f"Cross-engine word drift: {drift:.1%}")
        if gaps:
            lost = sum(g["end"] - g["start"] for g in gaps)
            print(f"      {len(gaps)} region(s), {lost:.0f}s, absent from the "
                  f"cross-check engine - kept from the primary transcript")
            warnings.append(
                f"The cross-check engine ({asr_api.ACCURATE_MODEL}) omitted "
                f"{len(gaps)} region(s) totalling {lost:.0f}s that the primary "
                f"engine transcribed. Those passages are unverified by a second engine.")
    else:
        for seg in segments:
            seg.setdefault("disagreement", None)
            seg["needs_review"] = seg["low_confidence"]
        print("[5/6] Single engine: review flags fall back to decoder confidence, "
              "which measured poorly at catching real errors")
        warnings.append(
            "Single-engine run: review flags use decoder confidence, which failed "
            "to detect known meaning-changing errors in benchmarking. Re-run with "
            "--backend both for reliable flags.")

    review = [s for s in segments if s.get("needs_review")]
    secs = structure.sections(segments)
    index = structure.term_index(segments)
    meta = {"course": args.course, "title": args.title, "date": args.date,
            "source_audio": src.name, "engine": engine}

    print(f"[6/6] Writing {len(secs)} section(s), {len(index)} indexed term(s)")
    (out / f"{slug}.vtt").write_text(emit.to_vtt(segments))
    (out / f"{slug}.txt").write_text(emit.to_transcript_txt(segments))
    (out / f"{slug}.readable.md").write_text(
        emit.to_readable(meta, segments, secs))
    (out / f"{slug}.notes.md").write_text(
        emit.to_notes(meta, segments, secs, index, review, changes))
    fingerprint = local_asr.config_fingerprint()
    fingerprint["backend"] = args.backend
    fingerprint["engine"] = engine
    if drift is not None:
        fingerprint["crosscheck_drift"] = drift
        fingerprint["contested_terms"] = contested[:20]
    if verified:
        fingerprint["review"] = [
            {k: v[k] for k in ("at", "find", "replace", "reason", "verdict",
                               "confidence", "category", "heard_new")}
            for v in verified]
    (out / f"{slug}.audit.json").write_text(
        emit.audit(meta, fingerprint, segments, secs, review, changes, warnings))
    if verified:
        (out / f"{slug}.review.md").write_text(emit.to_review(meta, verified))
    (out / f"{slug}.segments.json").write_text(json.dumps(segments, indent=2))
    if crosscheck:
        (out / f"{slug}.crosscheck.txt").write_text(crosscheck)

    print(f"\nWrote to {out}/:")
    for suffix in ("vtt", "txt", "readable.md", "notes.md", "audit.json", "segments.json"):
        print(f"  {slug}.{suffix}")
    print(f"\nImport {slug}.vtt in the Lecture Desk (Add lecture -> transcript file).")


if __name__ == "__main__":
    main()
