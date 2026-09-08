"""Config sweep over probe slices, scored with reference-free metrics.

Each config isolates one hypothesis about the failure modes seen in the
baseline decode, so the production settings are chosen from evidence.
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import mlx_whisper
import metrics
from lexicon import INITIAL_PROMPT, LEXICON

TURBO = "mlx-community/whisper-large-v3-turbo"
V3 = "mlx-community/whisper-large-v3-mlx"
PROBE_SECONDS = 120

CONFIGS = [
    # name, model, audio variant, kwargs -- each row changes ONE thing.
    ("baseline_turbo", TURBO, "norm", {}),
    ("noloop_turbo", TURBO, "norm", {"condition_on_previous_text": False}),
    ("noloop_prompt_turbo", TURBO, "norm",
     {"condition_on_previous_text": False, "initial_prompt": INITIAL_PROMPT}),
    ("noloop_prompt_turbo_RAW", TURBO, "raw",
     {"condition_on_previous_text": False, "initial_prompt": INITIAL_PROMPT}),
    ("noloop_prompt_v3", V3, "norm",
     {"condition_on_previous_text": False, "initial_prompt": INITIAL_PROMPT}),
]

PROBES = ["a", "b", "c"]
WORK = Path(__file__).resolve().parent.parent / "work"


def audio_path(variant, probe):
    return str(WORK / (f"probe_{probe}.wav" if variant == "norm" else f"raw_{probe}.wav"))


def main():
    rows, texts = [], {}
    for name, model, variant, kwargs in CONFIGS:
        for probe in PROBES:
            t0 = time.time()
            result = mlx_whisper.transcribe(
                audio_path(variant, probe),
                path_or_hf_repo=model,
                language="en",
                verbose=None,
                **kwargs,
            )
            elapsed = time.time() - t0
            text = result["text"].strip()
            texts[f"{name}::{probe}"] = text
            s = metrics.score(text, LEXICON, PROBE_SECONDS)
            s.update(config=name, probe=probe, secs=round(elapsed, 1),
                     rtf=round(PROBE_SECONDS / elapsed, 1))
            rows.append(s)
            print(f"  {name:26s} probe_{probe}  "
                  f"loop={s['loop_frac']:.3f} rep={s['max_repeat']:>3} "
                  f"comp={s['compression']:>5} wpm={s['wpm']:>6} "
                  f"ok={s['term_ok']:>3} bad={s['term_bad']:>2} "
                  f"degen={s['degen_lines']:>2} {s['rtf']:>5}x", flush=True)

    out = WORK / "sweep_results.json"
    out.write_text(json.dumps(
        {"rows": [{k: (dict(v) if k == "misses" else v) for k, v in r.items()} for r in rows],
         "texts": texts}, indent=2))

    print("\n" + "=" * 78)
    print("AGGREGATE BY CONFIG (summed over 3 probe slices, 6 min of audio)")
    print("=" * 78)
    print(f"{'config':28s}{'loop_frac':>10}{'degen':>7}{'term_ok':>9}"
          f"{'term_bad':>10}{'words':>8}{'speed':>8}")
    for name, _, _, _ in CONFIGS:
        rs = [r for r in rows if r["config"] == name]
        lf = sum(r["loop_frac"] for r in rs) / len(rs)
        print(f"{name:28s}{lf:>10.3f}{sum(r['degen_lines'] for r in rs):>7}"
              f"{sum(r['term_ok'] for r in rs):>9}{sum(r['term_bad'] for r in rs):>10}"
              f"{sum(r['words'] for r in rs):>8}"
              f"{sum(r['rtf'] for r in rs) / len(rs):>7.1f}x")

    print("\nDomain terms still mis-heard, by config:")
    for name, _, _, _ in CONFIGS:
        agg = {}
        for r in (r for r in rows if r["config"] == name):
            for k, v in r["misses"].items():
                agg[k] = agg.get(k, 0) + v
        print(f"  {name:28s} {agg if agg else '(none detected)'}")


if __name__ == "__main__":
    main()
