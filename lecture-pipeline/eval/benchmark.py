"""Cross-engine accuracy benchmark on the probe slices.

Two kinds of measurement, because neither alone is trustworthy:
  1. Reference-free term audit - counts correct course vocabulary and known
     mis-hearings. Objective, needs no ground truth, and measures the errors
     that actually hurt a student.
  2. Pairwise WER - how much the engines disagree. The engine with the lowest
     mean distance to the others is the consensus centroid; regions where they
     diverge are where a human should look.
"""

import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline"))
sys.path.insert(0, str(ROOT / "eval"))

import engines
import metrics
from lexicon import LEXICON

PROBES = ["a", "b", "c"]
WORK = ROOT / "work"


def norm(text):
    text = text.lower().replace("-", " ")
    text = re.sub(r"[^a-z0-9' ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def main():
    results = {}

    def job(args):
        name, probe = args
        path = WORK / f"probe_{probe}.wav"
        t0 = time.time()
        try:
            text = engines.ENGINES[name](path)
            return name, probe, text, round(time.time() - t0, 1), None
        except Exception as exc:
            return name, probe, "", round(time.time() - t0, 1), f"{type(exc).__name__}: {exc}"

    # MLX shares one Metal queue: running it concurrently with itself causes GPU
    # command-buffer timeouts, so local decoding runs serially and APIs in parallel.
    def record(name, probe, text, secs, err):
        results[f"{name}::{probe}"] = {"text": text, "secs": secs, "error": err}
        status = err if err else f"{len(metrics.words(text))} words in {secs}s"
        print(f"  {name:22s} probe_{probe}  {status}", flush=True)

    for probe in PROBES:
        record(*job(("local_turbo_tuned", probe)))

    api_tasks = [(n, p) for n in engines.ENGINES if n != "local_turbo_tuned" for p in PROBES]
    with ThreadPoolExecutor(max_workers=5) as pool:
        for name, probe, text, secs, err in pool.map(job, api_tasks):
            record(name, probe, text, secs, err)

    (WORK / "benchmark_raw.json").write_text(json.dumps(results, indent=2))

    names = list(engines.ENGINES)
    print("\n" + "=" * 84)
    print("TERM AUDIT - reference-free, summed over 3 probe slices (6 min)")
    print("=" * 84)
    print(f"{'engine':24s}{'words':>8}{'term_ok':>9}{'term_bad':>10}{'loop':>7}{'secs':>8}")
    audit = {}
    for n in names:
        ok = bad = w = 0
        loop = 0.0
        secs = 0.0
        misses = {}
        for p in PROBES:
            r = results[f"{n}::{p}"]
            if r["error"]:
                continue
            s = metrics.score(r["text"], LEXICON, 120)
            ok += s["term_ok"]; bad += s["term_bad"]; w += s["words"]
            loop = max(loop, s["loop_frac"]); secs += r["secs"]
            for k, v in s["misses"].items():
                misses[k] = misses.get(k, 0) + v
        audit[n] = {"ok": ok, "bad": bad, "words": w, "misses": misses}
        print(f"{n:24s}{w:>8}{ok:>9}{bad:>10}{loop:>7.3f}{secs:>8.1f}")

    print("\nMis-heard course terms remaining:")
    for n in names:
        m = audit[n]["misses"]
        print(f"  {n:24s} {m if m else '(none)'}")

    import jiwer
    # An engine that returned nothing is a broken integration, not a distant
    # hypothesis; leaving it in produced 77,800% WER and destroyed the means.
    names = [n for n in names if audit[n]["words"] > 0]
    print("\n" + "=" * 84)
    print("PAIRWISE WER (row = hypothesis, col = reference) - disagreement, not truth")
    print("=" * 84)
    print(f"{'':24s}" + "".join(f"{n[:11]:>13}" for n in names))
    dist = {}
    for a in names:
        row = []
        for b in names:
            if a == b:
                row.append(0.0); continue
            ha = " ".join(norm(results[f"{a}::{p}"]["text"]) for p in PROBES)
            hb = " ".join(norm(results[f"{b}::{p}"]["text"]) for p in PROBES)
            row.append(jiwer.wer(hb, ha) if hb and ha else float("nan"))
        dist[a] = row
        print(f"{a:24s}" + "".join(f"{v:>12.1%} " for v in row))

    print("\nMean distance to other engines (lower = closer to consensus):")
    for a in names:
        vals = [v for b, v in zip(names, dist[a]) if b != a and v == v]
        if vals:
            print(f"  {a:24s} {sum(vals)/len(vals):.1%}")


if __name__ == "__main__":
    main()
