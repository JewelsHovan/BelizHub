"""Download a McGill LRS lecture from its signed HLS URL, then trim the dead air.

The recordings play from `lrs.mcgill.ca` as HLS: one large MPEG-TS file exposed as
~2700 byte-range segments behind a short-lived *signed* URL. You copy that signed
`.m3u8` URL out of your own browser (see docs/GUIDE.md) — the token is yours, and
this script never mints, stores, or logs it beyond the single run you pass it to.

What it does:
  1. fetch the .m3u8 playlist and find the underlying TS file + its total size
  2. download it with parallel ranged requests (~10x faster than one connection)
  3. remux TS -> MP4 losslessly (no re-encode)
  4. trim the trailing dead air (mic left on after class) unless --no-trim

  uv run python fetch_lecture.py --url '<signed .m3u8 url>' --name lecture-3

Output: lectures/<name>.mp4  (gitignored — this repo is public).
"""

import argparse
import concurrent.futures as cf
import re
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0"
CHUNK = 96 * 1024 * 1024          # 96 MiB per ranged request
RETRIES = 4


def _get(url, rng=None, to_file=None):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    if rng:
        req.add_header("Range", f"bytes={rng}")
    with urllib.request.urlopen(req, timeout=120) as r:
        if to_file is None:
            return r.read()
        n = 0
        with open(to_file, "wb") as fh:
            while True:
                block = r.read(1 << 20)
                if not block:
                    break
                fh.write(block)
                n += len(block)
        return n


def parse_playlist(text):
    """-> (segment_url, total_bytes). Handles the LRS single-file byte-range case
    (all segments are ranges of one TS file) and falls back to summing sizes."""
    lines = text.splitlines()
    total = sum(int(m.group(1)) for l in lines
                for m in [re.match(r"#EXT-X-BYTERANGE:(\d+)", l.strip())] if m)
    segs = [l.strip() for l in lines if l.strip() and not l.startswith("#")]
    if not segs:
        sys.exit("No media segments found in playlist — is the URL a valid .m3u8?")
    uniq = {s.split("#", 1)[0] for s in segs}
    if len(uniq) != 1:
        sys.exit(f"Playlist references {len(uniq)} distinct files; this tool expects "
                 "the LRS single-file byte-range layout. Use ffmpeg directly.")
    return uniq.pop(), total


def download_parallel(url, total, dest_ts, workers):
    tmp = Path(tempfile.mkdtemp(prefix="lrsdl_"))
    n = (total + CHUNK - 1) // CHUNK
    print(f"      {total/1048576:.0f} MB in {n} chunks × {workers} workers")

    def one(i):
        start = i * CHUNK
        end = min(start + CHUNK, total) - 1
        want = end - start + 1
        part = tmp / f"part_{i:05d}"
        last = "size mismatch"
        for attempt in range(1, RETRIES + 1):
            try:
                got = _get(url, rng=f"{start}-{end}", to_file=part)
                if got == want:
                    return i, got
            except Exception as e:                       # noqa: BLE001
                last = repr(e)
            time.sleep(attempt)
        raise RuntimeError(f"chunk {i} failed after {RETRIES} tries: {last}")

    done_bytes = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, i): i for i in range(n)}
        for k, fut in enumerate(cf.as_completed(futs), 1):
            _, got = fut.result()
            done_bytes += got
            print(f"\r      downloaded {done_bytes/1048576:6.0f} / {total/1048576:.0f} MB "
                  f"({k}/{n} chunks)", end="", flush=True)
    print()
    with open(dest_ts, "wb") as out:
        for i in range(n):
            with open(tmp / f"part_{i:05d}", "rb") as p:
                while True:
                    b = p.read(1 << 20)
                    if not b:
                        break
                    out.write(b)
            (tmp / f"part_{i:05d}").unlink()
    tmp.rmdir()
    size = dest_ts.stat().st_size
    if size != total:
        sys.exit(f"Assembled size {size} != expected {total}. Aborting (token may have expired).")


def ffprobe_duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def remux(ts, mp4):
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
         "-i", str(ts), "-map", "0", "-c", "copy", "-bsf:a", "aac_adtstoasc", str(mp4)],
        check=True)


def content_end(mp4, noise="-35dB", min_sil=45.0):
    """Timestamp where speech last stops before trailing dead air (or None)."""
    dur = ffprobe_duration(mp4)
    out = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(mp4),
         "-map", "0:a", "-af", f"silencedetect=noise={noise}:d={min_sil}", "-f", "null", "-"],
        capture_output=True, text=True)
    starts = [float(m) for m in re.findall(r"silence_start: ([0-9.]+)", out.stderr)]
    ends = re.findall(r"silence_end: ([0-9.]+)", out.stderr)
    if not starts:
        return None, dur
    last_start = starts[-1]
    # trailing silence = the last detected silence runs (near) to EOF
    trailing = (len(ends) < len(starts)) or (float(ends[-1]) >= dur - 2)
    if trailing and last_start < dur - 60:
        return last_start, dur
    return None, dur


def trim(mp4, end_t, buffer=5.0):
    tmp = mp4.with_suffix(".trim.mp4")
    subprocess.run(
        ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(mp4),
         "-t", f"{end_t + buffer:.2f}", "-c", "copy", "-bsf:a", "aac_adtstoasc", str(tmp)],
        check=True)
    tmp.replace(mp4)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", required=True, help="signed .m3u8 URL from your browser")
    ap.add_argument("--name", required=True, help="output basename, e.g. lecture-3")
    ap.add_argument("--outdir", default="lectures")
    ap.add_argument("--workers", type=int, default=10)
    ap.add_argument("--no-trim", action="store_true", help="keep the full recording (dead air included)")
    ap.add_argument("--keep-ts", action="store_true", help="keep the intermediate .ts file")
    args = ap.parse_args()

    outdir = Path(args.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    mp4 = outdir / f"{args.name}.mp4"
    ts = outdir / f"{args.name}.ts"

    print(f"[1/4] Reading playlist…")
    seg_url, total = parse_playlist(urllib.request.urlopen(
        urllib.request.Request(args.url, headers={"User-Agent": UA}), timeout=60
    ).read().decode("utf-8", "replace"))

    print(f"[2/4] Downloading…")
    download_parallel(seg_url, total, ts, args.workers)

    print(f"[3/4] Remuxing to {mp4}…")
    remux(ts, mp4)
    if not args.keep_ts:
        ts.unlink(missing_ok=True)

    if args.no_trim:
        dur = ffprobe_duration(mp4)
        print(f"[4/4] Skipping trim. Duration {dur/60:.1f} min.")
    else:
        print(f"[4/4] Trimming trailing dead air…")
        end_t, dur = content_end(mp4)
        if end_t:
            trim(mp4, end_t)
            print(f"      content ends ~{end_t/60:.1f} min; trimmed from {dur/60:.1f} min "
                  f"(saved {(dur-end_t)/60:.0f} min)")
        else:
            print(f"      no long trailing silence found; kept full {dur/60:.1f} min")

    print(f"\nSaved {mp4}  ({mp4.stat().st_size/1048576:.0f} MB)")


if __name__ == "__main__":
    main()
