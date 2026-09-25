#!/usr/bin/env bash
# grab_lecture.sh — download a McGill LRS lecture you are enrolled in, then (optionally) transcribe it.
#
# The McGill "Lecture Recordings" player streams each recording as HLS: one large
# MPEG-TS file behind a short-lived SIGNED URL (contains your session's stoken/etime).
# That signed URL is *your* credential, so YOU copy it out of your own browser; this
# script never mints or handles the token. Once you paste the URL, ffmpeg pulls the
# whole stream and remuxes it to MP4 losslessly (-c copy, no re-encode).
#
# ── Get the URL (either way) ────────────────────────────────────────────────
#  A) DevTools: open the recording, F12 ▸ Network tab ▸ filter "hls" ▸ click the
#     request to  .../api/hls/?rid=...&f=VGA&stoken=...&etime...  ▸ Copy ▸ Copy URL.
#  B) Console one-liner (paste in the LRS player tab's DevTools console): prints +
#     copies every recording's URL to your clipboard —
#       (async()=>{const t=[...document.querySelectorAll('*')].find(e=>e.__vue__).__vue__.$root.$store.state.token;
#        const r=await fetch('https://LRSWAPI.campus.mcgill.ca/api/MediaRecordings/dto/97394',{headers:{Authorization:'Bearer '+t}}).then(x=>x.json());
#        const out=r.map(x=>x.dateTime.slice(0,10)+'\t'+x.sources[0].src).join('\n');
#        console.log(out); copy(out);})();
#     (97394 is this course's id — change it for another course.)
#
# ── Use ─────────────────────────────────────────────────────────────────────
#   ./grab_lecture.sh '<m3u8-url>' moores-2026-09-18
#   ./grab_lecture.sh '<m3u8-url>' moores-2026-09-18 --transcribe \
#        --course BIOT505 --title "Lecture 3" --date 2026-09-18 --backend best
#
# The token typically stays valid ~14 h, so grab a fresh URL if a download 403s.

set -euo pipefail

URL="${1:-}"; OUT="${2:-}"
if [[ -z "$URL" || -z "$OUT" ]]; then
  sed -n '2,32p' "$0"; echo; echo "usage: $0 '<m3u8-url>' <output-basename> [--transcribe --course X --title \"Y\" --date Z --backend best]" >&2
  exit 2
fi
shift 2

TRANSCRIBE=0; COURSE="BIOT505"; TITLE="Lecture"; DATE=""; BACKEND="best"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --transcribe) TRANSCRIBE=1; shift;;
    --course) COURSE="$2"; shift 2;;
    --title)  TITLE="$2";  shift 2;;
    --date)   DATE="$2";   shift 2;;
    --backend) BACKEND="$2"; shift 2;;
    *) echo "unknown arg: $1" >&2; exit 2;;
  esac
done

command -v ffmpeg >/dev/null || { echo "ffmpeg required: brew install ffmpeg" >&2; exit 1; }

MP4="${OUT}.mp4"
echo ">> Downloading + remuxing to ${MP4} (lossless, no re-encode) …"
# HLS media playlist points at one TS file sliced by byte-range; ffmpeg follows it.
ffmpeg -hide_banner -loglevel warning -stats \
  -user_agent "Mozilla/5.0" \
  -protocol_whitelist file,http,https,tcp,tls,crypto \
  -allowed_extensions ALL \
  -i "$URL" \
  -map 0 -c copy -bsf:a aac_adtstoasc \
  "$MP4"
echo ">> Saved ${MP4} ($(du -h "$MP4" | cut -f1))"

if [[ "$TRANSCRIBE" == "1" ]]; then
  HERE="$(cd "$(dirname "$0")" && pwd)"
  echo ">> Transcribing via pipeline (backend=${BACKEND}) …"
  ( cd "$HERE" && uv run python pipeline/run.py "$(cd "$(dirname "$MP4")" && pwd)/$(basename "$MP4")" \
      --course "$COURSE" --title "$TITLE" --date "$DATE" --backend "$BACKEND" )
  echo ">> Transcript + notes in ${HERE}/out/  •  import the .vtt in the Lecture Desk"
else
  echo ">> To transcribe:"
  echo "   uv run python pipeline/run.py '$MP4' --course $COURSE --title \"$TITLE\" --date ${DATE:-YYYY-MM-DD} --backend best"
fi
