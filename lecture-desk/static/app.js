const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escape = (value = "") =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const main = $("#main");
const modal = $("#modal");
let lectures = [],
  doc = null,
  selected = null,
  tab = "notes",
  lastHash = "",
  routing = 0;
let briefDirty = false,
  briefTimer,
  savingBrief = null,
  busy = false,
  pending = 0;
let practice = { count: 0, skipped: new Set(), question: null };
let energy = "standard";
try {
  energy =
    localStorage.getItem("beliz-energy") === "small" ? "small" : "standard";
} catch {}
const limit = () => (energy === "small" ? 1 : 3);
const endpoint = (id = doc.id) => `/api/lectures/${id}`;
const time = (seconds) =>
  seconds === null
    ? ""
    : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const sourceLabel = (segment) =>
  segment.start === null
    ? `Paragraph ${segment.id.slice(1)}`
    : time(segment.start);
const sourceOptions = () =>
  doc.segments
    .map(
      (s) =>
        `<option value="${s.id}" ${s.id === selected ? "selected" : ""}>${escape(sourceLabel(s))} · ${escape(s.text.slice(0, 65))}…</option>`,
    )
    .join("");
const sourceButton = (id) =>
  `<button class="source-link" data-action="source" data-id="${id}">↗ ${escape(sourceLabel(doc.segments.find((s) => s.id === id)))}</button>`;
const status = (text) => {
  $("#save-status").textContent = text;
};
const formDirty = (root) =>
  $$('form[data-dirty="true"]', root || document).length > 0;
function error(message) {
  $("#error").hidden = false;
  $("#error").textContent = message;
}
function clearError() {
  $("#error").hidden = true;
}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("#toast").hidden = true), 4000);
}
async function api(
  path,
  { method = "GET", data, body, keepalive = false } = {},
) {
  const headers = method === "GET" ? {} : { "X-Beliz-Request": "local" };
  if (data !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(data);
  }
  let response;
  try {
    response = await fetch(path, { method, headers, body, keepalive });
  } catch {
    throw new Error(
      "Lecture Desk is not reachable. Keep the local server running, then retry. Unsaved text is still on this screen.",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "The request could not be completed.");
  return result;
}
async function change(path, method, data) {
  pending++;
  status("Saving…");
  try {
    const result = await api(path, { method, data });
    if (doc && result.id === doc.id) {
      // Collection responses may predate an already-completed autosave. The brief has its own writer.
      result.brief = $("#brief")?.value ?? doc.brief;
      doc = result;
    }
    status(briefDirty ? "Unsaved brief…" : "Saved on this laptop");
    return result;
  } catch (e) {
    status("Not saved · retry");
    throw e;
  } finally {
    pending--;
  }
}
async function flushBrief() {
  clearTimeout(briefTimer);
  if (savingBrief) return savingBrief;
  if (!briefDirty || !doc) return true;
  const id = doc.id;
  // One writer drains the latest draft, even if typing continues during a slow save.
  savingBrief = (async () => {
    while (briefDirty && doc?.id === id) {
      const value = $("#brief")?.value ?? doc.brief;
      pending++;
      status("Saving brief…");
      try {
        await api(endpoint(id), { method: "PATCH", data: { brief: value } });
        if (doc?.id === id && ($("#brief")?.value ?? doc.brief) === value) {
          briefDirty = false;
          doc.brief = value;
        }
      } catch (e) {
        error(e.message + " Use “Save brief” to retry.");
        status("Brief not saved");
        return false;
      } finally {
        pending--;
      }
    }
    status("Saved on this laptop");
    return true;
  })().finally(() => {
    savingBrief = null;
  });
  return savingBrief;
}
async function mayLeave(root) {
  if (busy || pending) {
    toast("Please wait for the current save to finish.");
    return false;
  }
  if (!(await flushBrief())) return false;
  return (
    !formDirty(root) ||
    confirm(
      "Discard the text in the unsaved form? Saved notes and your brief will be kept.",
    )
  );
}
function labCard() {
  return `<article class="mini-lab"><div class="lab-art" aria-hidden="true"><svg viewBox="0 0 160 120" fill="none"><path d="M56 10c80 34-50 65 30 100M104 10c-80 34 50 65-30 100" stroke="#66557f" stroke-width="3.5" stroke-linecap="round"/><path d="M60 18h40M69 37h22M61 59h38M65 79h30M75 101h10" stroke="#a89bbd" stroke-width="3"/></svg></div><div class="lab-copy"><span class="pill violet">Visual lab</span><h3>RT-PCR, from<br />RNA to result</h3><p>Work through the mechanism. Change a parameter. Check your reasoning.</p><a href="/pcr-explained/" target="_blank" rel="noreferrer">Explore the lab ↗</a></div></article>`;
}
function lectureCard(lecture) {
  return `<a class="lecture-card" href="#lecture/${lecture.id}"><span class="lecture-icon" aria-hidden="true">▤</span><div><p>${escape(lecture.course)} · ${escape(lecture.date)} ${lecture.sample ? "· Sample" : ""}</p><h3>${escape(lecture.title)}</h3><p>${lecture.passages} passages · ${lecture.notes} notes${lecture.markers ? ` · ${lecture.markers} marked moments` : ""}</p></div><span aria-hidden="true">→</span></a>`;
}
function emptyLibrary() {
  return `<div class="empty"><h3>Give your next lecture a home.</h3><p>Add a transcript to start. Or try a short sample to see how source-linked notes and practice fit together.</p><div class="actions"><button class="button primary" data-action="import">Add a lecture</button><button class="button" data-action="sample">Try the sample</button></div></div>`;
}
function renderHome() {
  const recent = lectures[0];
  const small = energy === "small";
  main.innerHTML = `<section class="home-intro"><div><p class="eyebrow">Your own pace. Your own place.</p><h1>Welcome back, Beliz.</h1><p class="lede">${small ? "Find one useful moment. Leave a question if you like. That can be enough for today." : "Pick up the thread, work through an idea, or try a little recall. You don’t need to do everything today."}</p></div><div class="energy" role="group" aria-label="Study session size"><button data-action="energy" data-value="small" aria-pressed="${small}">Just one thing</button><button data-action="energy" data-value="standard" aria-pressed="${!small}">A little study</button></div></section>
    <section class="resume-card" aria-label="Your next small step"><div><p class="eyebrow">${recent ? "Pick up where you left off" : "A gentle place to start"}</p><h2>${recent ? escape(recent.title) : "One lecture. One useful next step."}</h2><p class="small">${recent ? `${escape(recent.course)} · Your last passage is saved.` : "Try the sample, then make this space your own."}</p></div>${recent ? `<a class="button" href="#lecture/${recent.id}">Resume studying <span aria-hidden="true">→</span></a>` : '<button class="button" data-action="sample">Try the sample <span aria-hidden="true">→</span></button>'}</section>
    <div class="home-columns"><section><div class="section-title"><h2>Your lectures</h2><a class="small" href="#library">See all</a></div><div class="lecture-list">${recent ? lectures.slice(0, 3).map(lectureCard).join("") : emptyLibrary()}</div><p class="gentle">${small ? "Low-energy option: save a lecture and leave. It will be here when you’re ready." : "Lost the thread? Open a lecture and mark the passage “Lost here.” You can revisit it later."}</p></section><aside>${labCard()}<p class="gentle">The next visual tool should follow what you’re learning—not add another thing to keep up with.</p></aside></div>`;
}
function renderLibrary() {
  const courses = [...new Set(lectures.map((l) => l.course))].sort();
  main.innerHTML = `<p class="eyebrow">Kept together, easy to return to</p><h1>My lectures</h1><p class="muted">Your original sources, your explanations, and the place you left off.</p><div class="filters"><label>Find a lecture<input id="library-search" type="search" placeholder="Search titles or courses" /></label><label>Course<select id="course-filter"><option value="">All courses</option>${courses.map((c) => `<option>${escape(c)}</option>`).join("")}</select></label></div><div class="lecture-list library-list" id="library-list"></div>`;
  filterLibrary();
}
function filterLibrary() {
  const search = $("#library-search").value.toLowerCase();
  const course = $("#course-filter").value;
  const results = lectures.filter(
    (l) =>
      (!course || l.course === course) &&
      `${l.title} ${l.course}`.toLowerCase().includes(search),
  );
  $("#library-list").innerHTML = results.length
    ? results.map(lectureCard).join("")
    : lectures.length
      ? '<div class="empty"><h3>No matching lectures.</h3><p>Try a different title or choose all courses.</p></div>'
      : emptyLibrary();
}
function renderDesk() {
  const audio = doc.files.find((f) => f.kind === "audio");
  main.innerHTML = `<header class="lecture-heading"><div><p class="eyebrow">${escape(doc.course)} ${doc.sample ? "· Authored sample, not a real lecture" : ""}</p><h1>${escape(doc.title)}</h1><p>${escape(doc.date)} · ${doc.segments.length} source passages · ${doc.segments[0].start === null ? "Paragraph references" : "Original transcript timestamps"}</p></div><div class="actions"><a class="button small" href="${endpoint()}/export">Export lecture ↓</a><button class="button small quiet" data-action="lecture-menu">Manage</button></div></header>
    <div class="lecture-toolbar"><div class="audio-wrap">${audio ? `<audio id="audio" controls preload="metadata" src="/api/files/${audio.id}"></audio>` : `<p class="small">${doc.sample ? "This sample has no recording. Select a timestamp to explore its source passage." : "Transcript ready. Add the original recording for timestamp playback."}</p>`}</div><button class="button small" data-action="resume">↶ Resume saved place</button>${!audio ? '<button class="button small quiet" data-action="tab" data-tab="files">Attach files</button>' : ""}</div>
    <div class="desk-columns"><section class="source-panel" aria-label="Original transcript"><div class="panel-heading"><h2>The original explanation</h2><span class="pill">Source</span></div><div class="source-search"><label class="small">Find in transcript<input id="transcript-search" type="search" placeholder="A term, a question, a missed idea…" /></label></div><div class="source-list" id="source-list"></div><div class="source-foot">${escape(doc.filename)} · Original wording preserved. Select a passage to link your notes.</div></section><section class="study-panel" aria-label="Study workspace"><nav class="study-tabs" aria-label="Study views">${[
      ["notes", "My notes"],
      ["practice", "Practice"],
      ["files", "Files & checks"],
    ]
      .map(
        ([value, label]) =>
          `<button data-action="tab" data-tab="${value}" aria-pressed="${tab === value}">${label}</button>`,
      )
      .join(
        "",
      )}</nav><div class="study-content" id="side"></div></section></div>`;
  renderTranscript();
  renderSide();
  setupAudio();
  scrollSource(selected, false);
}
function renderTranscript() {
  const query = $("#transcript-search")?.value.toLowerCase() || "";
  const passages = doc.segments.filter((s) =>
    s.text.toLowerCase().includes(query),
  );
  $("#source-list").innerHTML = passages.length
    ? passages
        .map(
          (s) =>
            `<article class="passage ${s.id === selected ? "active" : ""}" id="source-${s.id}"><button class="source-time" data-action="source" data-id="${s.id}" aria-pressed="${s.id === selected}" aria-label="Select ${escape(sourceLabel(s))}">${s.start === null ? `¶ ${s.id.slice(1)}` : time(s.start)}</button><div><p>${escape(s.text)}</p><div class="passage-tags">${doc.markers
              .filter((m) => m.source_id === s.id)
              .map((m) => `<span class="pill amber">${escape(m.label)}</span>`)
              .join("")}</div></div></article>`,
        )
        .join("")
    : '<p class="panel-message">No matching passages. Try another term.</p>';
}
function scrollSource(id, smooth = true) {
  const element = $(`#source-${id}`),
    container = $("#source-list");
  if (element && container)
    container.scrollTo({
      top: element.offsetTop - container.offsetTop,
      behavior:
        smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "smooth"
          : "instant",
    });
}
function highlight() {
  $$(".passage").forEach((el) => {
    const active = el.id === `source-${selected}`;
    el.classList.toggle("active", active);
    $("button", el).setAttribute("aria-pressed", String(active));
  });
  if ($("#selected-label"))
    $("#selected-label").textContent =
      `Selected source · ${sourceLabel(doc.segments.find((s) => s.id === selected))}`;
}
async function selectSource(id, seek = true) {
  const segment = doc.segments.find((s) => s.id === id);
  if (!segment) return;
  selected = id;
  if ($("#transcript-search").value) {
    $("#transcript-search").value = "";
    renderTranscript();
  }
  highlight();
  scrollSource(id, false);
  const source = $(`#source-${id}`);
  const bounds = source.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > innerHeight) {
    source.scrollIntoView({ block: "nearest", behavior: "instant" });
  }
  $("button", source).focus({ preventScroll: true });
  const audio = $("#audio");
  if (seek && audio && segment.start !== null) {
    if (Number.isFinite(audio.duration) && segment.start >= audio.duration)
      toast(
        "This timestamp is beyond the recording. Check that these sources belong together.",
      );
    else audio.currentTime = segment.start;
  }
  await savePosition();
}
async function savePosition(keepalive = false) {
  if (!doc) return;
  const id = doc.id;
  const position = {
    segment_id: selected,
    seconds: $("#audio")?.currentTime ?? doc.position.seconds,
  };
  doc.position = position;
  try {
    await api(endpoint(id), { method: "PATCH", data: { position }, keepalive });
  } catch (e) {
    error(e.message + " Your latest playback position could not be saved.");
  }
}
function setupAudio() {
  const audio = $("#audio");
  if (!audio) return;
  const id = doc.id,
    resume = doc.position.seconds;
  audio.addEventListener("loadedmetadata", () => {
    if (doc?.id !== id) return;
    if (Number.isFinite(audio.duration) && resume < audio.duration)
      audio.currentTime = resume;
    const end = doc.segments.at(-1).end;
    if (end !== null && Number.isFinite(audio.duration)) {
      if (end > audio.duration + 2)
        error(
          "The transcript extends beyond this recording. Check that the files match.",
        );
      else if (audio.duration - end > 30)
        toast(
          "The recording continues past the last cue. Check the ending for missing material.",
        );
    }
  });
  let lastSave = 0;
  audio.addEventListener("timeupdate", () => {
    if (doc?.id !== id) return;
    const s = doc.segments.find(
      (s) =>
        s.start !== null &&
        audio.currentTime >= s.start &&
        audio.currentTime < s.end,
    );
    if (s && s.id !== selected) {
      selected = s.id;
      highlight();
    }
    if (Date.now() - lastSave > 5000) {
      lastSave = Date.now();
      void savePosition();
    }
  });
  audio.addEventListener("pause", () => {
    if (doc?.id === id) void savePosition();
  });
  audio.addEventListener("error", () =>
    error(
      "This browser cannot play the attachment, or the file is unavailable. Try MP3 or WAV; you can still use the transcript and download the original from Files & checks.",
    ),
  );
}
function renderSide() {
  $$(".study-tabs button").forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.tab === tab)),
  );
  if (tab === "notes") renderNotes();
  if (tab === "practice") renderPractice();
  if (tab === "files") renderFiles();
}
function renderNotes() {
  const focusedBrief = $("#brief") && document.activeElement === $("#brief");
  const caret = focusedBrief
    ? [$("#brief").selectionStart, $("#brief").selectionEnd]
    : null;
  const segment = doc.segments.find((s) => s.id === selected);
  $("#side").innerHTML =
    `<p class="eyebrow">Your words, with evidence nearby</p><h3>What’s the thread?</h3><label for="brief" class="small">My brief · a selective overview, not complete lecture notes</label><textarea id="brief" class="brief" placeholder="What is the main question? Which ideas connect? What’s one useful next step?" maxlength="20000">${escape(doc.brief)}</textarea><div class="section-title"><span class="small">Auto-saves after you pause typing.</span><button class="text-button" data-action="save-brief">Save brief</button></div>
    <div class="context-strip"><p id="selected-label">Selected source · ${escape(sourceLabel(segment))}</p><div class="actions">${["Lost here", "Important", "Ask about this"].map((label) => `<button class="button" data-action="marker" data-label="${label}">${label === "Lost here" ? "⚑ " : ""}${label}</button>`).join("")}</div></div>
    ${doc.markers.length ? `<p class="eyebrow">Moments to return to</p><div class="marker-list">${doc.markers.map((m) => `<span class="marker"><button data-action="source" data-id="${m.source_id}">${escape(m.label)} · ${escape(sourceLabel(doc.segments.find((s) => s.id === m.source_id)))}</button><button class="remove" data-action="remove-marker" data-id="${m.id}" aria-label="Remove ${escape(m.label)} marker">×</button></span>`).join("")}</div><hr class="divider" />` : ""}
    <div class="section-title"><h3>Source-linked notes</h3><button class="text-button" data-action="note-form">+ Add note</button></div><div id="note-form"></div><div id="notes-list">${doc.notes.length ? doc.notes.map((n) => `<article class="note-card"><div class="note-meta"><span class="pill ${n.kind === "My explanation" ? "" : "amber"}">${escape(n.kind)}</span>${sourceButton(n.source_id)}</div><p class="note-text">${escape(n.text)}</p><div class="actions"><button class="text-button" data-action="edit-note" data-id="${n.id}">Edit note</button><button class="text-button" data-action="remove-note" data-id="${n.id}">Delete note</button></div></article>`).join("") : '<p class="small">Explain a mechanism, capture a connection, or leave an uncertainty. Each note points back to the original passage.</p>'}</div><hr class="divider" /><p class="small">Need a different way into the idea? <a href="/pcr-explained/" target="_blank" rel="noreferrer">Explore the RT-PCR visual lab ↗</a></p>`;
  if (focusedBrief) {
    $("#brief").focus({ preventScroll: true });
    $("#brief").setSelectionRange(...caret);
  }
}
function showNoteForm(noteId) {
  if ($("#new-note")) {
    $("#new-note textarea").focus();
    return;
  }
  $("#note-form").innerHTML =
    `<form id="new-note" class="stack inline-form"><label>Source passage<select name="source_id">${sourceOptions()}</select></label><label>Type of note<select name="kind"><option>My explanation</option><option>Needs checking</option><option>Ask the instructor</option></select></label><label>My note<textarea name="text" required maxlength="20000" placeholder="In my own words…"></textarea></label><div class="actions"><button class="button primary" type="submit">Save note</button><button class="button quiet" type="button" data-action="cancel-note">Cancel</button></div></form>`;
  if (noteId) {
    const note = doc.notes.find((n) => n.id === noteId);
    const form = $("#new-note");
    form.dataset.noteId = noteId;
    form.elements.source_id.value = note.source_id;
    form.elements.kind.value = note.kind;
    form.elements.text.value = note.text;
  }
  $("#new-note textarea").focus();
}
function dueQuestions() {
  return doc.questions.filter(
    (q) =>
      q.checked &&
      (!q.due || Date.parse(q.due) <= Date.now()) &&
      !practice.skipped.has(q.id),
  );
}
function renderPractice() {
  const questions = dueQuestions();
  const q = practice.count < limit() ? questions[0] : null;
  practice.question = q?.id || null;
  $("#side").innerHTML =
    `<p class="eyebrow">Try, then check</p><h3>A little recall</h3><p class="small">${limit() === 1 ? "One question is enough for this session." : "Up to three questions. Stop whenever you like."} Answers stay hidden until you’re ready.</p><div class="practice-progress" role="img" aria-label="${practice.count} of ${limit()} questions practised">${Array.from({ length: limit() }, (_, i) => `<span class="${i < practice.count ? "done" : ""}"></span>`).join("")}</div>
    ${q ? `<p class="practice-question">${escape(q.prompt)}</p><label class="small">Your attempt · type it, or explain it aloud<textarea id="attempt" maxlength="10000" placeholder="Try without looking at the source first…"></textarea></label><div class="actions"><button class="button small" data-action="hint">A hint</button><button class="button small primary" data-action="reveal">Check my explanation</button><button class="text-button" data-action="skip-question">Skip for now</button></div><p id="hint" class="notice" hidden>${escape(q.hint || "Name the components, describe what changes, and say what the source supports.")}</p><div id="answer" hidden><hr class="divider" /><p class="eyebrow">Expected answer · compare with your reasoning</p><div class="answer-box">${escape(q.answer)}</div><p class="small">Check the original: ${sourceButton(q.source_id)}</p><p class="small">This is self-review, not an AI grade. How did that feel?</p><div class="actions"><button class="button small" data-action="rate" data-rating="again">Revisit tomorrow</button><button class="button small primary" data-action="rate" data-rating="got-it">I can explain it</button></div><button class="text-button" data-action="uncheck-question">The answer needs checking</button></div>` : `<div class="empty"><h3>${practice.count ? "A good place to pause." : "Nothing you need to review now."}</h3><p>${practice.count ? "Your next reviews are saved. No need to fill the rest of the day with more questions." : "Check a question against its source to add it to practice, or write one below. Skipped questions return next session."}</p>${practice.count || practice.skipped.size ? '<button class="button small" data-action="restart-practice">Start another small session</button>' : ""}</div>`}
    ${
      doc.questions.some((q) => !q.checked)
        ? `<details class="check-queue"><summary>${doc.questions.filter((q) => !q.checked).length} question(s) need a source check</summary>${doc.questions
            .filter((q) => !q.checked)
            .map(
              (q) =>
                `<article><p><b>${escape(q.prompt)}</b></p><p>${escape(q.answer)}</p><p>${sourceButton(q.source_id)}</p><button class="button small" data-action="check-question" data-id="${q.id}">I checked this against the source</button><button class="text-button" data-action="remove-question" data-id="${q.id}">Delete</button></article>`,
            )
            .join("")}</details>`
        : ""
    }
    <details class="check-queue"><summary>My question library (${doc.questions.length})</summary>${doc.questions.map((q) => `<article><p>${escape(q.prompt)}</p><p class="small">${q.checked ? (q.due ? `Next review: ${escape(new Date(q.due).toLocaleDateString())}` : "Ready to practise") : "Needs checking"} · ${q.history.length} attempt(s)</p>${sourceButton(q.source_id)} <button class="text-button" data-action="remove-question" data-id="${q.id}">Delete</button></article>`).join("") || '<p class="small">No questions yet.</p>'}</details>
    <hr class="divider" /><button class="text-button" data-action="question-form">+ Write a source-backed question</button><div id="question-form"></div><p class="small">Review spacing starts at 1, 3, then 7 days after successful recall. Missed items return tomorrow. No overdue penalties.</p>`;
}
function showQuestionForm() {
  if ($("#new-question")) {
    $("#new-question input").focus();
    return;
  }
  $("#question-form").innerHTML =
    `<form id="new-question" class="stack inline-form"><label>Source passage<select name="source_id">${sourceOptions()}</select></label><label>Question<input name="prompt" required maxlength="2000" placeholder="Why does…? What would change if…?" /></label><label>Expected answer<textarea name="answer" required maxlength="5000"></textarea></label><label>Helpful hint (optional)<input name="hint" maxlength="1000" /></label><p class="small">New questions stay out of scheduled practice until you check their answer against the source.</p><div class="actions"><button class="button primary" type="submit">Save question</button><button class="button quiet" type="button" data-action="cancel-question">Cancel</button></div></form>`;
  $("#new-question input").focus();
}
function renderFiles() {
  $("#side").innerHTML =
    `<p class="eyebrow">Originals first</p><h3>Files &amp; source checks</h3><p class="small">Attachments are copied to this laptop’s private app folder. Nothing is sent to an AI service.</p>${[
      "audio",
      "slides",
    ]
      .map((kind) => {
        const file = doc.files.find((f) => f.kind === kind);
        return `<div class="file-card"><h4>${kind === "audio" ? "Lecture recording" : "Original slides · PDF"}</h4>${file ? `<p>${escape(file.name)} · ${(file.size / 1024 / 1024).toFixed(1)} MB</p><div class="actions"><a class="button small" href="/api/files/${file.id}" target="_blank" rel="noreferrer">Open ${kind === "audio" ? "recording" : "slides"} ↗</a><a class="text-button" href="/api/files/${file.id}?download=1">Download original</a></div>` : "<p>No file attached yet.</p>"}<label>${file ? "Replace attachment" : "Attach a file"}<input type="file" data-upload="${kind}" accept="${kind === "audio" ? ".mp3,.m4a,.wav,.ogg,.webm,.flac" : ".pdf"}" /></label><p class="files-hint">${kind === "audio" ? "MP3, M4A, WAV, OGG, WebM, or FLAC. Browser playback support varies." : "Keep the original figures. Slide-to-transcript alignment is manual in this version."} Up to 500 MB.</p></div>`;
      })
      .join(
        "",
      )}<h4>Import checks</h4><ul class="warnings">${doc.warnings.map((w) => `<li>${escape(w)}</li>`).join("")}</ul><p class="small">Check names, units, negations, and qualifications against the original. Keep corrections in a “Needs checking” note; the transcript stays unchanged.</p><p class="notice">Transcription and AI-generated notes are not connected yet. Import a transcript you already have, or paste text to get started.</p><a class="button small" href="${endpoint()}/export">Export sources, notes &amp; questions ↓</a>`;
}
function openModal(title, body) {
  $("#modal-content").innerHTML =
    `<div class="modal-header"><h2 id="modal-title">${title}</h2><button class="close-button" data-action="close-modal" aria-label="Close dialog">×</button></div>${body}<p id="modal-error" role="alert"></p>`;
  modal.showModal();
}
function importModal() {
  openModal(
    "Give a lecture a home.",
    `<p class="lede">Start with a transcript. Add the recording and slides now or later. All files stay on this laptop.</p><form id="import-form"><fieldset class="stack"><label>Lecture title<input name="title" required maxlength="200" placeholder="e.g. Regulation of gene expression" /></label><div class="form-row"><label>Course<input name="course" required maxlength="160" placeholder="e.g. Molecular biotechnology" list="courses" /><datalist id="courses">${[...new Set(lectures.map((l) => l.course))].map((c) => `<option value="${escape(c)}"></option>`).join("")}</datalist></label><label>Lecture date<input name="date" type="date" required value="${new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)}" /></label></div><label>Transcript file · TXT, SRT, or VTT<input id="transcript-file" type="file" accept=".txt,.srt,.vtt" /></label><label>Or paste a plain-text transcript<textarea id="transcript-paste" placeholder="Paragraph references will be used. We won’t invent timestamps."></textarea></label><div class="form-row"><label>Recording (optional)<input id="import-audio" type="file" accept=".mp3,.m4a,.wav,.ogg,.webm,.flac" /></label><label>Slides (optional PDF)<input id="import-slides" type="file" accept=".pdf" /></label></div><label class="check"><input name="permission" type="checkbox" required />I have permission to use and locally process these materials for my personal study.</label><p class="small">5 MB transcript limit. 500 MB per attachment. Existing transcripts only; no automatic transcription yet.</p><div class="actions"><button class="button primary" type="submit">Save lecture</button><button class="button quiet" type="button" data-action="close-modal">Cancel</button></div></fieldset><p class="import-progress" id="import-progress" role="status"></p></form>`,
  );
}
function checkFile(file, type) {
  if (file.size > (type === "transcript" ? 5 : 500) * 1024 * 1024)
    throw new Error(
      `${file.name} is too large. ${type === "transcript" ? "5" : "500"} MB maximum.`,
    );
  if (!file.size) throw new Error(`${file.name} is empty.`);
}
async function upload(id, kind, file) {
  checkFile(file, kind);
  return api(
    `${endpoint(id)}/files?kind=${kind}&name=${encodeURIComponent(file.name)}`,
    { method: "PUT", body: file },
  );
}
async function importLecture(form, fields) {
  const file = $("#transcript-file").files[0],
    pasted = $("#transcript-paste").value;
  if (file && pasted.trim())
    throw new Error(
      "Choose either a transcript file or pasted text, not both.",
    );
  let transcript = pasted,
    filename = "pasted-transcript.txt";
  if (file) {
    checkFile(file, "transcript");
    filename = file.name;
    try {
      transcript = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
    } catch {
      throw new Error(
        "The transcript must use UTF-8 text. Export it as UTF-8 and retry.",
      );
    }
  }
  if (!transcript.trim())
    throw new Error("Choose a transcript file or paste some text.");
  const attachments = ["audio", "slides"]
    .map((kind) => [kind, $(`#import-${kind}`).files[0]])
    .filter(([, f]) => f);
  attachments.forEach(([kind, f]) => checkFile(f, kind));
  $("#import-progress").textContent =
    "Saving transcript and checking its passages…";
  const saved = await api("/api/lectures", {
    method: "POST",
    data: { ...fields, transcript, filename },
  });
  let attachmentError;
  for (const [kind, file] of attachments) {
    $("#import-progress").textContent =
      `Transcript saved. Copying ${kind === "audio" ? "recording" : "slides"}…`;
    try {
      await upload(saved.id, kind, file);
    } catch (e) {
      attachmentError = `${e.message} Your lecture is saved. Retry the attachment in Files & checks.`;
      break;
    }
  }
  form.dataset.dirty = "false";
  modal.close();
  tab = attachmentError ? "files" : "notes";
  location.hash = `lecture/${saved.id}`;
  if (attachmentError) setTimeout(() => error(attachmentError), 200);
  else toast("Lecture saved. Pick a passage and start wherever you like.");
}
async function route() {
  const hash = location.hash || "#home";
  if (hash === lastHash) return;
  if (lastHash && !(await mayLeave())) {
    history.replaceState(null, "", lastHash);
    return;
  }
  const ticket = ++routing;
  if (doc) await savePosition();
  const audio = $("#audio");
  if (audio) audio.pause();
  clearError();
  try {
    const result = await api("/api/lectures");
    if (ticket !== routing) return;
    lectures = result;
    const match = hash.match(/^#lecture\/([a-f0-9]{32})$/);
    if (match) {
      const result = await api(endpoint(match[1]));
      if (ticket !== routing) return;
      doc = result;
      selected = doc.position.segment_id;
      practice = { count: 0, skipped: new Set(), question: null };
      briefDirty = false;
      renderDesk();
      $("#breadcrumb").textContent = "My lectures / Lecture Desk";
    } else {
      doc = null;
      briefDirty = false;
      if (hash === "#library") {
        renderLibrary();
        $("#breadcrumb").textContent = "My lectures";
      } else {
        renderHome();
        $("#breadcrumb").textContent = "My desk";
      }
    }
    lastHash = hash;
    $$("[data-nav]").forEach((link) => {
      if ((match ? "library" : hash.slice(1)) === link.dataset.nav)
        link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    main.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    status("Local workspace");
  } catch (e) {
    error(e.message);
    if (lastHash) history.replaceState(null, "", lastHash);
    else
      main.innerHTML =
        '<div class="empty"><h1>Let’s reconnect your desk.</h1><p>Start the local server, then reload this page. Your saved files stay on the laptop.</p><button class="button" data-action="reload">Try again</button></div>';
  }
}

// Forms retain their text on failed saves. All material inserted into HTML is escaped.
document.addEventListener("input", (event) => {
  const form = event.target.closest("form");
  if (form) form.dataset.dirty = "true";
  if (event.target.id === "brief") {
    briefDirty = true;
    doc.brief = event.target.value;
    status("Unsaved brief…");
    clearTimeout(briefTimer);
    briefTimer = setTimeout(() => void flushBrief(), 650);
  }
  if (event.target.id === "library-search") filterLibrary();
  if (event.target.id === "transcript-search") renderTranscript();
});
document.addEventListener("change", async (event) => {
  if (event.target.id === "course-filter") filterLibrary();
  const kind = event.target.dataset.upload,
    file = event.target.files?.[0];
  if (!kind || !file || busy) return;
  if (!(await mayLeave($("#side")))) {
    event.target.value = "";
    return;
  }
  if (
    doc.files.some((f) => f.kind === kind) &&
    !confirm(
      "Replace this attachment? The previous app copy will be deleted. Your original file outside the app is not changed.",
    )
  ) {
    event.target.value = "";
    return;
  }
  busy = true;
  event.target.disabled = true;
  status("Copying attachment…");
  try {
    doc = await upload(doc.id, kind, file);
    renderDesk();
    toast("Attachment saved.");
    status("Saved on this laptop");
  } catch (e) {
    error(e.message);
    status("Attachment not saved");
    event.target.disabled = false;
    event.target.value = "";
  } finally {
    busy = false;
  }
});
document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!["import-form", "new-note", "new-question"].includes(form.id)) return;
  event.preventDefault();
  if (busy) return;
  if (form.id !== "import-form" && !(await flushBrief())) return;
  busy = true;
  clearError();
  if ($("#modal-error")) $("#modal-error").textContent = "";
  const fields = Object.fromEntries(new FormData(form));
  const controls = $$("button, input, select, textarea", form);
  controls.forEach((control) => (control.disabled = true));
  try {
    if (form.id === "import-form") await importLecture(form, fields);
    else {
      const collection = form.id === "new-note" ? "notes" : "questions";
      await change(
        `${endpoint()}/${collection}${form.dataset.noteId ? "/" + form.dataset.noteId : ""}`,
        form.dataset.noteId ? "PATCH" : "POST",
        fields,
      );
      form.dataset.dirty = "false";
      renderSide();
      toast(
        collection === "notes"
          ? "Note saved with its source."
          : "Question saved. Check its source before practising.",
      );
    }
  } catch (e) {
    if (modal.open) $("#modal-error").textContent = e.message;
    else error(e.message);
  } finally {
    busy = false;
    controls.forEach((control) => (control.disabled = false));
  }
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (busy || target.disabled) return;
  try {
    if (action === "reload") {
      lastHash = "";
      return await route();
    }
    if (action === "import") {
      if (await mayLeave()) importModal();
      return;
    }
    if (action === "close-modal") {
      if (!formDirty(modal) || confirm("Discard this unsaved form?"))
        modal.close();
      return;
    }
    if (action === "sample") {
      if (!(await mayLeave())) return;
      busy = true;
      target.disabled = true;
      const saved = await api("/api/sample", { method: "POST", data: {} });
      busy = false;
      tab = "notes";
      location.hash = `lecture/${saved.id}`;
      return;
    }
    if (action === "energy") {
      energy = target.dataset.value;
      try {
        localStorage.setItem("beliz-energy", energy);
      } catch {}
      renderHome();
      return;
    }
    if (action === "privacy") {
      openModal(
        "Your space stays yours.",
        `<p class="lede">Lecture Desk listens only on this laptop. It does not send your study material to a server or AI provider.</p><ul class="storage-list"><li>By default, data lives in <code>~/.local/share/beliz-hub/</code>. A custom location appears in the startup terminal.</li><li>For a full backup, stop the local server and copy that entire folder to a private backup location. To restore, stop the app and replace the data folder with your backup.</li><li>Use <b>Export lecture</b> for a portable ZIP: transcript, notes, question CSV, progress JSON, and attached originals. ZIPs are not currently re-importable through the app.</li><li>Deleting a lecture removes the app’s copy, not your originals, exports, or backups. This is ordinary deletion, not forensic secure erasure.</li><li>No sign-in or encryption is built in. Anyone with access to your computer account can read the data. Use a protected account and disk encryption.</li></ul><p class="notice">The visual lab is a separate learning tool. Its external source and video links can connect to the internet when opened. Lecture Desk itself makes no external requests.</p>`,
      );
      return;
    }
    if (!doc) return;
    if (action === "save-brief") {
      if (await flushBrief()) {
        clearError();
        toast("Brief saved.");
      }
      return;
    }
    if (action === "source") return await selectSource(target.dataset.id);
    if (action === "resume") {
      if ($("#audio")) $("#audio").currentTime = doc.position.seconds;
      await selectSource(doc.position.segment_id, false);
      toast("Back at your saved place.");
      return;
    }
    if (action === "tab") {
      if (!(await mayLeave($("#side")))) return;
      tab = target.dataset.tab;
      renderSide();
      return;
    }
    if (action === "note-form") return showNoteForm();
    if (action === "edit-note") return showNoteForm(target.dataset.id);
    if (action === "question-form") return showQuestionForm();
    if (action === "cancel-note" || action === "cancel-question") {
      const form = target.closest("form");
      if (!formDirty(form.parentNode) || confirm("Discard this unsaved form?"))
        form.remove();
      return;
    }
    if (action === "hint") {
      $("#hint").hidden = false;
      return;
    }
    if (action === "reveal") {
      $("#answer").hidden = false;
      return;
    }
    if (action === "lecture-menu") {
      if (!(await mayLeave())) return;
      openModal(
        "Manage this lecture",
        `<p>${escape(doc.title)}</p><p class="small">An export includes the transcript, notes, questions, progress, and attached files.</p><div class="actions"><a class="button" href="${endpoint()}/export">Export lecture ↓</a><button class="button danger" data-action="delete-lecture">Delete lecture</button></div>`,
      );
      return;
    }
    if (!(await flushBrief())) return;
    if (
      [
        "marker",
        "remove-marker",
        "remove-note",
        "remove-question",
        "check-question",
        "uncheck-question",
        "rate",
        "skip-question",
        "restart-practice",
      ].includes(action) &&
      formDirty($("#side")) &&
      !confirm("Discard the unsaved form to continue?")
    )
      return;
    busy = true;
    target.disabled = true;
    if (action === "marker") {
      await change(`${endpoint()}/markers`, "POST", {
        source_id: selected,
        label: target.dataset.label,
      });
      renderTranscript();
      renderNotes();
      toast("Moment marked.");
    }
    if (action === "remove-marker") {
      await change(`${endpoint()}/markers/${target.dataset.id}`, "DELETE");
      renderTranscript();
      renderNotes();
    }
    if (
      action === "remove-note" &&
      confirm("Delete this note? The original transcript will stay unchanged.")
    ) {
      await change(`${endpoint()}/notes/${target.dataset.id}`, "DELETE");
      renderNotes();
    }
    if (
      action === "remove-question" &&
      confirm("Delete this question and its review history?")
    ) {
      await change(`${endpoint()}/questions/${target.dataset.id}`, "DELETE");
      renderPractice();
    }
    if (action === "check-question") {
      await change(`${endpoint()}/questions/${target.dataset.id}`, "PATCH", {
        checked: true,
      });
      renderPractice();
    }
    if (action === "uncheck-question") {
      await change(`${endpoint()}/questions/${practice.question}`, "PATCH", {
        checked: false,
      });
      renderPractice();
      toast("Removed from practice until checked.");
    }
    if (action === "rate") {
      await change(
        `${endpoint()}/questions/${practice.question}/review`,
        "POST",
        { rating: target.dataset.rating, attempt: $("#attempt").value },
      );
      practice.count++;
      renderPractice();
      toast("Review saved. Come back another day.");
    }
    if (action === "skip-question") {
      practice.skipped.add(practice.question);
      renderPractice();
    }
    if (action === "restart-practice") {
      practice = { count: 0, skipped: new Set(), question: null };
      renderPractice();
    }
    if (
      action === "delete-lecture" &&
      confirm(
        "Delete this lecture, its notes, practice history, and attached app copies? Original files and exports outside the app will not be deleted.",
      )
    ) {
      await api(endpoint(), { method: "DELETE" });
      doc = null;
      modal.close();
      location.hash = "library";
      toast("Lecture deleted from this workspace.");
    }
  } catch (e) {
    if (modal.open) $("#modal-error").textContent = e.message;
    else error(e.message);
  } finally {
    busy = false;
    target.disabled = false;
  }
});
modal.addEventListener("cancel", (event) => {
  if (busy || (formDirty(modal) && !confirm("Discard this unsaved form?")))
    event.preventDefault();
});
modal.addEventListener("close", () => {
  $("#modal-content").innerHTML = "";
});
window.addEventListener("hashchange", () => void route());
window.addEventListener("beforeunload", (event) => {
  if (doc) void savePosition(true);
  if (briefDirty || formDirty() || pending || busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && doc) {
    void savePosition(true);
    void flushBrief();
  }
});
void route();
