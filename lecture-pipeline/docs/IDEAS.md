# Ideas / backlog

Parking lot for future improvements. Nothing here is committed to — just notes.

## Chrome extension to grab signed URLs — ✅ IMPLEMENTED

Built and working in [`extension/`](../extension/) (see the main README). The
reverse-engineering of McGill's LRS turned out to be the interesting part:

- **No content scripts.** The working design is popup → `chrome.scripting
  .executeScript` with `world: "MAIN"`, targeted at the `lrs.mcgill.ca`
  iframe myCourses embeds (found via `chrome.webNavigation.getAllFrames`).
  MAIN-world content scripts get no `chrome.runtime`, and `allFrames` blind
  injection misses the iframe — targeted programmatic injection is what works.
- **The LTI launch mints a course-scoped JWT.** Claims include `LRSCourseId`,
  `crn`, `role: "Student"`, `sToken`, `eTime`. The token sits in the Vuex
  store at `state.token` (with `state.urlbaseAPI` holding the API base).
- **Recordings are NOT in the Vuex store** on the list page — they sit in
  component-local data (`activatorNode[0].fnContext.listofRecordings`),
  reachable by walking the Vue component tree's `$data`.
- **Course-ID discovery chain that works:** the page's own network log
  (`performance.getEntriesByType('resource')` — the app itself calls
  `MediaRecordings/dto/<id>`) → JWT claim `LRSCourseId` → deep search of
  store/components.
- **API map** (GET + bearer): `Course/<id>`, `Courses` (lists ~30 courses,
  200), `MediaRecordings/dto/<courseId>`, `LRSAnnouncement`,
  `VideoPlayerDefaults`. POST-only: bare `Course`, `ViewingClientInfo/`,
  `WebPublishing/ProcessorsStatusDataByCourseId`.
- **Cross-course fetches are not hard-blocked** (200, not 403) but returned no
  recordings for a non-launched course id — each course's own myCourses
  Lecture Recordings launch is the reliable path, and the extension
  auto-detects the course either way.
- The old console snippet fails on the myCourses tab because the LRS is a
  cross-origin iframe — DevTools' console needs its frame-context dropdown
  switched to the `lrs.mcgill.ca` frame.

## Higher-accuracy transcription (if the bio/chem vocab ever needs it)

The pipeline is on OpenAI's current `gpt-transcribe` (~3.31% WER). Lower-WER
options as of 2026: ElevenLabs Scribe v2 (2.3%, native word-level timestamps —
would let us drop the whisper-1 + `fuse.py` timing hack), Gemini 3 Pro (2.9%,
key already configured), Mistral Voxtral (3.0%). Add as a backend in
`pipeline/asr_api.py`. Course-vocabulary priming + cross-check probably matter as
much as the last WER point.
