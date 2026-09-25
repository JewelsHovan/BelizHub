# Ideas / backlog

Parking lot for future improvements. Nothing here is committed to — just notes.

## Chrome extension to grab signed URLs (kills the token-expiry friction)

**Problem it solves.** The only manual, fiddly step today is copying a signed
`.m3u8` URL from the browser (`just urls`), and those URLs expire after a few
hours — so you often re-copy. A one-click button that always fetches a *fresh*
URL would remove that entirely.

**Cleanest design (Manifest V3):**
- Content script with `"world": "MAIN"` injected on `lrs.mcgill.ca`. This is the
  key trick: a normal (isolated-world) content script can't read the page's JS
  variables, so it can't reach `$root.$store.state.token`. `world: "MAIN"` runs in
  the page's own context and reads the Vue store token exactly like the console
  snippet in `get-urls.js`.
- It calls `LRSWAPI/MediaRecordings/dto/<courseId>`, gets the recordings, and
  `postMessage`s them to the extension.
- A popup lists each recording (date + title) with a per-lecture button that
  copies a ready-to-run command, e.g.
  `just lecture '<fresh url>' lecture-3 "…" 2026-09-18`. Paste into the terminal.

**Permissions:** host access to `lrs.mcgill.ca` + `LRSWAPI.campus.mcgill.ca`. Small.

**Optional upgrades:**
- Auto-detect the course id from the current myCourses tab (no hardcoding).
- Native messaging → hand the URL straight to `fetch_lecture.py`, skipping the
  copy-paste. (Needs a small native-host manifest.)

**Caveats:**
- Personal/unlisted only — it rides your own session token; for your enrolled
  courses, not for sharing.
- Same fragility as the snippet: breaks if McGill changes the LRS Vue app or API.
- Do NOT download inside the extension — 2.9 GB in-browser blows up memory (we hit
  this). The extension's job is only to surface a fresh URL; downloading stays in
  `fetch_lecture.py`.

Estimated ~100 lines of MV3. Sweet spot: click button → paste → done.

## Higher-accuracy transcription (if the bio/chem vocab ever needs it)

The pipeline is on OpenAI's current `gpt-transcribe` (~3.31% WER). Lower-WER
options as of 2026: ElevenLabs Scribe v2 (2.3%, native word-level timestamps —
would let us drop the whisper-1 + `fuse.py` timing hack), Gemini 3 Pro (2.9%,
key already configured), Mistral Voxtral (3.0%). Add as a backend in
`pipeline/asr_api.py`. Course-vocabulary priming + cross-check probably matter as
much as the last WER point.
