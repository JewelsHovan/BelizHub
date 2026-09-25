"""A self-contained study page: one slide at a time, with a toggle between the
succinct notes and the raw transcript.

Reads out/<slug>.slides.json (slidedoc.py, plus notes from slidenotes.py) and
writes out/<slug>.study.html with every slide image embedded, so the file can
be opened anywhere - no server, no network. If the recording sits at
lectures/<slug>.mp4 the page can also play the lecture from any timestamp.

  uv run python studypage.py out/<slug>.slides.json

Everything it reads and writes is transient/private; nothing is committed.
"""

import argparse
import base64
import html
import json
import subprocess
from io import BytesIO
from pathlib import Path

from PIL import Image


def data_uri(path, max_w=1280, quality=76):
    im = Image.open(path).convert("RGB")
    if im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = BytesIO()
    im.save(buf, format="JPEG", quality=quality, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def lecture_audio(media, cache, bitrate="24k"):
    """Speech-grade mono audio for embedding: HE-AAC (~11 MB/hour at 24 kbps)
    via macOS AudioToolbox, else plain AAC at a higher rate. Cached."""
    if cache.exists() and cache.stat().st_mtime >= media.stat().st_mtime:
        return cache
    cache.parent.mkdir(parents=True, exist_ok=True)
    enc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    codec = (["-c:a", "aac_at", "-profile:a", "4", "-b:a", bitrate] if " aac_at " in enc
             else ["-c:a", "aac", "-b:a", "48k"])
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(media),
                    "-vn", "-ac", "1", "-ar", "44100", *codec, "-movflags", "+faststart",
                    str(cache)], check=True)
    return cache


def payload(data, video_rel, embedded=False):
    slides = []
    for s in data["slides"]:
        n = s.get("notes") or {}
        slides.append({
            "n": s["n"],
            "title": n.get("title") or s.get("title") or f"Slide {s['n']}",
            "notes": n.get("notes", []), "terms": n.get("terms", []),
            "emphasis": n.get("emphasis", []), "hasNotes": bool(s.get("notes")),
            "visits": [{"start": v["start"], "end": v["end"],
                        "cues": [[round(c["start"], 1), c["text"], int(c["flag"])] for c in v["cues"]]}
                       for v in s["visits"]],
        })
    return {"meta": data["meta"], "video": video_rel, "embedded": embedded, "slides": slides}


PAGE = r"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>__TITLE__</title>
<style>
:root {
  --bg: #f6f5f1; --panel: #ffffff; --ink: #1d1d1b; --muted: #6b6a66; --line: #e3e1da;
  --accent: #0f6e6a; --accent-soft: #e2f0ee; --flag: #9a6300; --flag-soft: #fbf0dc;
  --hi: #fff3b0; --shadow: 0 1px 2px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.05);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --panel: #1f1f1e; --ink: #ecebe6; --muted: #9c9a93; --line: #33322f;
    --accent: #5cc3bb; --accent-soft: #1d3432; --flag: #e7b45a; --flag-soft: #3a2e17;
    --hi: #5a4b12; --shadow: none; color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; background: var(--bg); color: var(--ink);
  font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
button { font: inherit; color: inherit; }
.app { display: grid; grid-template-columns: 300px 1fr; height: 100vh; height: 100dvh; }

/* sidebar */
aside { border-right: 1px solid var(--line); background: var(--panel); display: flex;
  flex-direction: column; min-height: 0; }
.brand { padding: 16px 16px 10px; border-bottom: 1px solid var(--line); }
.brand .course { font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.brand h1 { font: 600 17px/1.3 "Iowan Old Style", Charter, Georgia, serif; margin: 4px 0 2px; }
.brand .sub { font-size: 12.5px; color: var(--muted); }
.search { padding: 10px 12px; border-bottom: 1px solid var(--line); }
.search input { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--bg); color: var(--ink); font: inherit; font-size: 14px; }
.search input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.list { overflow-y: auto; flex: 1; padding: 6px; }
.item { display: grid; grid-template-columns: 72px 1fr; gap: 10px; align-items: center; width: 100%;
  text-align: left; border: 0; background: none; padding: 6px; border-radius: 8px; cursor: pointer; }
.item:hover { background: var(--bg); }
.item[aria-current="true"] { background: var(--accent-soft); }
.item img { width: 72px; aspect-ratio: 16/9; object-fit: cover; border-radius: 4px;
  border: 1px solid var(--line); background: #000; }
.item .t { font-size: 13px; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2;
  -webkit-box-orient: vertical; overflow: hidden; }
.item .m { font-size: 11.5px; color: var(--muted); font-variant-numeric: tabular-nums; }
.empty { color: var(--muted); font-size: 13px; padding: 12px; }

/* main */
main { overflow-y: auto; min-height: 0; }
.wrap { max-width: 980px; margin: 0 auto; padding: 18px 24px 80px; }
.bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.bar .count { font-variant-numeric: tabular-nums; color: var(--muted); font-size: 13px; }
.bar .spacer { flex: 1; }
.btn { border: 1px solid var(--line); background: var(--panel); border-radius: 8px; padding: 6px 12px;
  cursor: pointer; font-size: 14px; }
.btn:hover { border-color: var(--accent); }
.btn:disabled { opacity: .4; cursor: default; }
.menu { display: none; }
h2.title { font: 600 24px/1.25 "Iowan Old Style", Charter, Georgia, serif; margin: 0 0 6px; }
.times { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; }
.chip { font-size: 12.5px; font-variant-numeric: tabular-nums; border: 1px solid var(--line);
  background: var(--panel); border-radius: 999px; padding: 2px 10px; cursor: pointer; }
.chip { cursor: default; }
.can-play .chip { cursor: pointer; }
.can-play .chip:hover { border-color: var(--accent); color: var(--accent); }
figure { margin: 0 0 16px; background: #000; border-radius: 10px; overflow: hidden; box-shadow: var(--shadow); }
figure img { display: block; width: 100%; max-height: 62vh; object-fit: contain; cursor: zoom-in; }

.seg { display: inline-flex; border: 1px solid var(--line); border-radius: 9px; padding: 3px;
  background: var(--panel); margin-bottom: 14px; }
.seg button { border: 0; background: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; }
.seg button[aria-pressed="true"] { background: var(--accent); color: #fff; }
@media (prefers-color-scheme: dark) { .seg button[aria-pressed="true"] { color: #0c1d1c; } }
.pane { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px 22px; }
.pane ul.notes { margin: 0; padding-left: 20px; }
.pane ul.notes li { margin: 6px 0; }
.pane h3 { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted);
  margin: 18px 0 8px; }
.pane h3:first-child { margin-top: 0; }
dl.terms { margin: 0; display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; }
dl.terms dt { font-weight: 600; }
dl.terms dd { margin: 0; color: var(--ink); }
.stress { border-left: 3px solid var(--accent); background: var(--accent-soft); padding: 10px 14px;
  border-radius: 0 8px 8px 0; margin-top: 16px; }
.stress b { display: block; font-size: 12px; letter-spacing: .05em; text-transform: uppercase;
  color: var(--accent); margin-bottom: 4px; }
.stress ul { margin: 0; padding-left: 18px; }
.muted { color: var(--muted); }
.tx p { margin: 0 0 12px; }
.tx .ts { font-size: 12px; font-variant-numeric: tabular-nums; color: var(--muted); cursor: default;
  margin-right: 6px; border: 0; background: none; padding: 0; }
.can-play .tx .ts { color: var(--accent); cursor: pointer; }
.can-play .tx .ts:hover { text-decoration: underline; }
.vid-only { display: none; }
.can-play .vid-only { display: inline; }
.tx .visit { font-size: 12px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted);
  margin: 18px 0 8px; border-top: 1px dashed var(--line); padding-top: 12px; }
.flag { background: var(--flag-soft); color: var(--flag); border-radius: 3px; font-style: italic; }
mark { background: var(--hi); color: inherit; border-radius: 2px; }
.legend { font-size: 12.5px; color: var(--muted); margin-top: 10px; }
.keys { font-size: 12px; color: var(--muted); margin-top: 22px; }
kbd { font: 11px ui-monospace, Menlo, monospace; border: 1px solid var(--line); border-bottom-width: 2px;
  border-radius: 4px; padding: 0 4px; background: var(--panel); }

/* video dock + zoom */
.dock { position: fixed; right: 16px; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); width: min(420px, calc(100vw - 32px));
  background: #000; border-radius: 10px; overflow: hidden; box-shadow: 0 8px 30px rgba(0,0,0,.35); z-index: 20; }
.dock video { display: block; width: 100%; }
.dock.audio { background: var(--panel); border: 1px solid var(--line); padding-top: 10px; }
.dock.audio audio { display: block; width: calc(100% - 20px); margin: 0 10px; }
.dockbar { display: flex; align-items: center; gap: 10px; padding: 6px 10px 8px; font-size: 12px; color: #c9c9c4; }
.dock.audio .dockbar { color: var(--muted); }
.dockbar .now { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dockbar label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; }
.dockbar .x { background: none; border: 0; color: inherit; cursor: pointer; font-size: 14px; padding: 0 2px; }
.tx .now { background: var(--hi); border-radius: 3px; box-shadow: 0 0 0 2px var(--hi); }
.zoom { position: fixed; inset: 0; background: rgba(0,0,0,.9); display: flex; align-items: center;
  justify-content: center; z-index: 30; cursor: zoom-out; padding: 16px; }
.zoom img { max-width: 100%; max-height: 100%; }

/* wide screens: slide and notes side by side, notes scroll on their own */
@media (min-width: 1180px) {
  .wrap { max-width: 1680px; }
  .stage { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(360px, 1fr); gap: 20px; align-items: start; }
  .stage figure { position: sticky; top: 12px; margin: 0; }
  .stage figure img { max-height: calc(100dvh - 190px); }
  .stage .pane { max-height: calc(100dvh - 150px); overflow-y: auto; }
}
@media (max-width: 820px) {
  .app { grid-template-columns: 1fr; }
  aside { position: fixed; inset: 0 25% 0 0; z-index: 25; transform: translateX(-105%);
    transition: transform .2s ease; box-shadow: 0 0 40px rgba(0,0,0,.3); padding-top: env(safe-area-inset-top, 0px); }
  aside.open { transform: none; }
  .menu { display: inline-block; }
  .wrap { padding: 14px 16px 80px; }
  h2.title { font-size: 20px; }
  .pane { padding: 14px 16px; }
  dl.terms { grid-template-columns: 1fr; gap: 2px 0; }
  dl.terms dd { margin-bottom: 8px; }
}
</style>
</head>
<body>
<div class="app">
  <aside id="side">
    <div class="brand">
      <div class="course" id="course"></div>
      <h1 id="lecTitle"></h1>
      <div class="sub" id="lecSub"></div>
    </div>
    <div class="search"><input id="q" type="search" placeholder="Search notes and transcript  ( / )" autocomplete="off"></div>
    <div class="list" id="list"></div>
  </aside>
  <main id="main">
    <div class="wrap">
      <div class="bar">
        <button class="btn menu" id="menu" aria-label="Slide list">☰ Slides</button>
        <button class="btn" id="prev" aria-label="Previous slide">←</button>
        <button class="btn" id="next" aria-label="Next slide">→</button>
        <span class="count" id="count"></span>
        <span class="spacer"></span>
        <div class="seg" role="group" aria-label="View" style="margin:0">
          <button id="mNotes" aria-pressed="true">Notes</button>
          <button id="mTx" aria-pressed="false">Transcript</button>
        </div>
      </div>
      <h2 class="title" id="title"></h2>
      <div class="times" id="times"></div>
      <div class="stage">
        <figure><img id="img" alt=""></figure>
        <div class="pane" id="pane"></div>
      </div>
      <div class="keys"><kbd>←</kbd> <kbd>→</kbd> slides · <kbd>T</kbd> notes / transcript · <kbd>/</kbd> search<span class="vid-only"> · <kbd>P</kbd> play / pause · click a time to hear that part</span></div>
    </div>
  </main>
</div>
<script id="data" type="application/json">__DATA__</script>
<script id="imgs" type="application/json">__IMGS__</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById("data").textContent);
  const IM = JSON.parse(document.getElementById("imgs").textContent);
  const S = D.slides, KEY = "study:" + (D.meta.slug || D.meta.title);
  const $ = id => document.getElementById(id);
  const el = (tag, props = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v;
      else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const k of [].concat(kids)) if (k != null) e.append(k);
    return e;
  };
  const hms = t => { t = Math.round(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); };
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; } };
  const save = st => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  let saved = load();
  let i = Math.min(Math.max((parseInt(location.hash.slice(1)) || saved.n || 1) - 1, 0), S.length - 1);
  let mode = saved.mode || "notes", query = "";

  $("course").textContent = D.meta.course || "";
  $("lecTitle").textContent = D.meta.title || "Lecture";
  $("lecSub").textContent = [D.meta.lecturer, D.meta.date, S.length + " slides"].filter(Boolean).join(" · ");

  // highlight search hits inside a text node run
  const withHits = (text) => {
    if (!query) return document.createTextNode(text);
    const frag = document.createDocumentFragment(), low = text.toLowerCase();
    let at = 0, j;
    while ((j = low.indexOf(query, at)) !== -1) {
      frag.append(text.slice(at, j), el("mark", { text: text.slice(j, j + query.length) }));
      at = j + query.length;
    }
    frag.append(text.slice(at));
    return frag;
  };
  const haystack = S.map(s => [s.title, ...s.notes, ...s.terms.map(t => t.term + " " + t.meaning),
    ...s.visits.flatMap(v => v.cues.map(c => c[1]))].join(" ").toLowerCase());

  function renderList() {
    const list = $("list"); list.replaceChildren();
    let shown = 0;
    S.forEach((s, k) => {
      if (query && !haystack[k].includes(query)) return;
      shown++;
      list.append(el("button", { class: "item", "aria-current": String(k === i), onclick: () => { go(k); $("side").classList.remove("open"); } }, [
        el("img", { src: IM[k], alt: "", loading: "lazy" }),
        el("div", {}, [el("div", { class: "t", text: s.n + ". " + s.title }),
                       el("div", { class: "m", text: hms(s.visits[0].start) + (s.visits.length > 1 ? "  ·  +" + (s.visits.length - 1) + " revisit" : "") })])
      ]));
    });
    if (!shown) list.append(el("div", { class: "empty", text: "No slide mentions “" + query + "”." }));
    const cur = list.querySelector('[aria-current="true"]');
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function notesPane(s) {
    const kids = [];
    if (!s.hasNotes) kids.push(el("p", { class: "muted", text: "No notes generated for this slide yet — switch to Transcript." }));
    else if (!s.notes.length) kids.push(el("p", { class: "muted", text: "Nothing of substance on this screen — see the transcript." }));
    else kids.push(el("ul", { class: "notes" }, s.notes.map(n => el("li", {}, withHits(n)))));
    if (s.terms.length) {
      kids.push(el("h3", { text: "Key terms" }));
      kids.push(el("dl", { class: "terms" }, s.terms.flatMap(t => [el("dt", {}, withHits(t.term)), el("dd", {}, withHits(t.meaning || ""))])));
    }
    if (s.emphasis.length)
      kids.push(el("div", { class: "stress" }, [el("b", { text: "The lecturer stressed" }),
        el("ul", {}, s.emphasis.map(x => el("li", {}, withHits(x))))]));
    return kids;
  }

  function txPane(s) {
    const box = el("div", { class: "tx" }); let flagged = false;
    s.visits.forEach((v, vi) => {
      if (s.visits.length > 1) box.append(el("div", { class: "visit", text: vi ? "Back on this slide at " + hms(v.start) : "First shown at " + hms(v.start) }));
      if (!v.cues.length) { box.append(el("p", { class: "muted", text: "(nothing said)" })); return; }
      let p = null, words = 0;
      v.cues.forEach(c => {
        if (!p || words > 110) {
          p = el("p", {}, el("button", { class: "ts", text: hms(c[0]), title: canPlay ? "Play to the end of this slide" : "", onclick: () => play(c[0], v.end) }));
          box.append(p); words = 0;
        }
        const t = c[1] + " ";
        if (c[2]) { flagged = true; p.append(el("span", { class: "flag", "data-s": c[0], title: "The two transcription engines disagreed here — check the recording" }, withHits(t))); }
        else p.append(el("span", { "data-s": c[0] }, withHits(t)));
        words += c[1].split(/\s+/).length;
      });
    });
    const out = [box];
    if (flagged) out.push(el("div", { class: "legend" }, [el("span", { class: "flag", text: "highlighted" }), " = the transcription engines disagreed" + (canPlay ? "; click the time to listen." : ".")]));
    return out;
  }

  function render() {
    const s = S[i];
    $("count").textContent = "Slide " + s.n + " of " + S.length;
    $("title").textContent = s.title;
    $("img").src = IM[i]; $("img").alt = "Slide " + s.n + ": " + s.title;
    $("times").replaceChildren(...s.visits.map((v, k) => el("button", { class: "chip", title: canPlay ? "Play this slide" : "",
      onclick: () => play(v.start, v.end), text: (canPlay ? "▶ " : "") + (k ? "back " : "") + hms(v.start) + "–" + hms(v.end) })));
    $("pane").replaceChildren(...(mode === "notes" ? notesPane(s) : txPane(s)));
    $("mNotes").setAttribute("aria-pressed", String(mode === "notes"));
    $("mTx").setAttribute("aria-pressed", String(mode === "transcript"));
    $("prev").disabled = i === 0; $("next").disabled = i === S.length - 1;
    history.replaceState(null, "", "#" + s.n);
    save({ n: s.n, mode });
    renderList();
    if (player) highlight(player.currentTime);
  }
  // fromFollow: the player moved us; anything else is the reader navigating,
  // which turns "follow slides" off so playback doesn't yank them back
  function go(k, fromFollow) {
    if (k < 0 || k >= S.length) return;
    if (!fromFollow && followBox) followBox.checked = false;
    i = k; render(); $("main").scrollTop = 0;
  }
  function setMode(m) { mode = m; render(); }

  // Playback. Two sources: audio embedded in this file (the -audio build), or
  // the local recording next to out/. A shared lean copy has neither, so the
  // play controls only appear once a source is known to work.
  let dock = null, player = null, canPlay = false, srcURL = null, stopAt = null, followBox = null;
  const spans = S.flatMap((s, k) => s.visits.map(v => [v.start, v.end, k]));
  const slideAt = t => { const h = spans.find(([a, b]) => a <= t && t < b); return h ? h[2] : -1; };
  if (D.embedded) { canPlay = true; document.body.classList.add("can-play"); }
  else if (D.video) {
    const probe = document.createElement("video");
    probe.preload = "metadata"; probe.muted = true;
    probe.addEventListener("loadedmetadata", () => { canPlay = true; document.body.classList.add("can-play"); render(); probe.removeAttribute("src"); probe.load(); }, { once: true });
    probe.src = D.video;
  }
  async function source() {
    if (srcURL) return srcURL;
    if (!D.embedded) return (srcURL = D.video);
    const node = document.getElementById("audio");            // parsed after the page itself
    if (!node) throw new Error("still loading");
    const blob = await (await fetch("data:audio/mp4;base64," + node.textContent.trim())).blob();
    node.remove();                                             // drop the base64 copy from memory
    return (srcURL = URL.createObjectURL(blob));               // a blob URL seeks reliably
  }
  const setNow = txt => { const n = dock && dock.querySelector(".now"); if (n) n.textContent = txt; };
  async function openDock() {
    if (dock) return player;
    const m = el(D.embedded ? "audio" : "video", { controls: "", preload: "auto" });
    followBox = el("input", { type: "checkbox" }); followBox.checked = true;
    dock = el("div", { class: "dock" + (D.embedded ? " audio" : "") }, [m, el("div", { class: "dockbar" }, [
      el("span", { class: "now", text: "Loading…" }),
      el("label", { title: "While playing on, turn to each slide as the lecture reaches it" }, [followBox, "Follow slides"]),
      el("button", { class: "x", text: "✕", "aria-label": "Close player", onclick: closeDock })])]);
    document.body.append(dock);
    player = m;
    m.addEventListener("timeupdate", onTime);
    m.addEventListener("error", () => setNow("Couldn't load the recording."));
    try { m.src = await source(); } catch { setNow("Audio is still loading — try again in a moment."); }
    return m;
  }
  function closeDock() {
    if (player) player.pause();
    dock.remove(); dock = player = followBox = null; stopAt = null;
    document.querySelectorAll(".tx .now").forEach(e => e.classList.remove("now"));
  }
  async function play(t, end) {
    if (!canPlay) return;
    const m = await openDock();
    stopAt = end ?? null;
    if (followBox) followBox.checked = true;
    const k = slideAt(t);
    setNow("Slide " + (k + 1) + " · " + hms(t) + (end ? " → " + hms(end) : ""));
    const seek = () => { m.currentTime = Math.max(0, t - 0.3); m.play().catch(() => {}); };
    m.readyState >= 1 ? seek() : m.addEventListener("loadedmetadata", seek, { once: true });
  }
  function highlight(t) {
    const cues = document.querySelectorAll(".tx [data-s]");
    let cur = null;
    for (const c of cues) { if (+c.dataset.s <= t + 0.2) cur = c; else break; }
    cues.forEach(c => c.classList.toggle("now", c === cur && slideAt(t) === i));
    if (cur && followBox && followBox.checked && !player.paused) cur.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function onTime() {
    const t = player.currentTime;
    if (stopAt != null && t >= stopAt) {
      player.pause(); stopAt = null;
      setNow("End of this slide — press play to keep listening");
    } else if (stopAt == null && !player.paused) {
      const k = slideAt(t);
      if (followBox && followBox.checked && k >= 0 && k !== i) go(k, true);
      if (k >= 0) setNow("Slide " + (k + 1) + " · " + hms(t));
    }
    highlight(t);
  }

  $("prev").onclick = () => go(i - 1);
  $("next").onclick = () => go(i + 1);
  $("mNotes").onclick = () => setMode("notes");
  $("mTx").onclick = () => setMode("transcript");
  $("menu").onclick = () => $("side").classList.toggle("open");
  $("img").onclick = () => { const z = el("div", { class: "zoom", onclick: () => z.remove() }, el("img", { src: IM[i], alt: "" })); document.body.append(z); };
  $("q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
  $("q").addEventListener("keydown", e => {
    if (e.key === "Enter") { const k = S.findIndex((_, k) => haystack[k].includes(query) && k > i); const f = k >= 0 ? k : S.findIndex((_, k) => haystack[k].includes(query)); if (f >= 0) go(f); }
    if (e.key === "Escape") { e.target.value = ""; query = ""; e.target.blur(); render(); }
  });
  document.addEventListener("keydown", e => {
    if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "ArrowRight" || e.key === "j") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft" || e.key === "k") { e.preventDefault(); go(i - 1); }
    else if (e.key === "t" || e.key === "T") setMode(mode === "notes" ? "transcript" : "notes");
    else if (e.key === "/") { e.preventDefault(); $("q").focus(); }
    else if ((e.key === "p" || e.key === "P") && canPlay) {
      if (player && !player.paused) player.pause();
      else if (player) player.play().catch(() => {});
      else play(S[i].visits[0].start, S[i].visits[0].end);
    }
    else if (e.key === "Escape") { document.querySelector(".zoom")?.remove(); $("side").classList.remove("open"); }
  });
  window.addEventListener("hashchange", () => { const n = parseInt(location.hash.slice(1)); if (n && n - 1 !== i) go(n - 1); });
  render();
})();
</script>
__AUDIO__
</body>
</html>
"""


def render(data, imgs, video_rel, audio_b64=None):
    body = json.dumps(payload(data, video_rel, embedded=audio_b64 is not None), ensure_ascii=False)
    # JSON inside <script>: only "</" can end the element early
    body = body.replace("</", "<\\/")
    audio = (f'<script id="audio" type="application/octet-stream">{audio_b64}</script>'
             if audio_b64 else "")
    return (PAGE.replace("__TITLE__", html.escape(data["meta"].get("title") or "Lecture"))
                .replace("__IMGS__", json.dumps(imgs))
                .replace("__DATA__", body)
                .replace("__AUDIO__", audio))


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("slides", help="out/<slug>.slides.json")
    ap.add_argument("--out", default="", help="default: out/<slug>.study.html")
    ap.add_argument("--video", default="", help="recording path relative to the page; "
                    "default ../lectures/<slug>.mp4")
    ap.add_argument("--embed-audio", action="store_true",
                    help="also write <slug>.study-audio.html with the lecture audio inside")
    ap.add_argument("--media", default="", help="recording to take the audio from; "
                    "default lectures/<slug>.mp4")
    args = ap.parse_args()

    path = Path(args.slides).expanduser()
    data = json.loads(path.read_text())
    stem = path.name.split(".")[0]
    data["meta"]["slug"] = stem
    out = Path(args.out).expanduser() if args.out else path.with_name(stem + ".study.html")
    video = args.video or f"../lectures/{stem}.mp4"
    n_notes = sum(1 for s in data["slides"] if s.get("notes"))

    imgs = [data_uri(s["image"]) for s in data["slides"]]
    out.write_text(render(data, imgs, video))
    print(f"Wrote {out}  ({len(imgs)} slides, {n_notes} with notes, "
          f"{out.stat().st_size / 1e6:.1f} MB)")

    if args.embed_audio:
        media = Path(args.media or f"lectures/{stem}.mp4").expanduser()
        if not media.exists():
            print(f"  ! no recording at {media}; skipped the audio build")
            return
        a = lecture_audio(media, Path("work") / stem / "study_audio.m4a")
        full = out.with_name(stem + ".study-audio.html")
        full.write_text(render(data, imgs, "", base64.b64encode(a.read_bytes()).decode()))
        print(f"Wrote {full}  (lecture audio inside, {full.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
