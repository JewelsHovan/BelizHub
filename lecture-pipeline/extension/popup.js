// LRS URL Grabber — popup script.
// Finds the LRS frame (top-level lrs.mcgill.ca tab, or the lrs.mcgill.ca
// iframe embedded in myCourses), injects scrapeLRS into that frame's MAIN
// world, and renders the recordings.
//
// scrapeLRS reads the JWT from the Vuex store, then finds recordings via:
//   1. the course ID parsed from the page's own network log
//      (performance.getEntriesByType('resource') -> MediaRecordings/dto/<id>)
//   2. deep-searching the Vuex store + every Vue component's $data for a
//      course-ID key
//   3. the LRSWAPI (freshest signed URLs) once a course ID is known
//   4. the recordings the page already loaded into component-local data
// The store dump in diagnostics showed the LRS app keeps recordings in
// component data, not Vuex — hence the component-tree walk.

const LP_CMD = './lp run';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function el(id) { return document.getElementById(id); }

// lp maps --course-id to a course profile and names the lecture from its
// slides when no real title is given (LRS recordings usually have none).
function buildLpCmd(url, date, courseId, title) {
  const q = s => `'${String(s).replace(/'/g, "'\\''")}'`;
  let cmd = `${LP_CMD} ${q(url)} --date ${date}`;
  if (courseId) cmd += ` --course-id ${courseId}`;
  if (title && title !== date) cmd += ` --title ${q(title)}`;
  return cmd;
}

// --- injected into the LRS frame's MAIN world (must be fully self-contained) ---
async function scrapeLRS(courseIdOverride) {
  const LRS_API = 'https://LRSWAPI.campus.mcgill.ca/api/MediaRecordings/dto';

  function diag(root, compDatas) {
    const d = { href: location.href };
    try { d.vueGlobals = Object.getOwnPropertyNames(window).filter(k => /vue/i.test(k)).slice(0, 12); } catch (_) { /* noop */ }
    try { d.cookieNames = document.cookie.split(';').map(c => c.split('=')[0].trim()).filter(Boolean); } catch (_) { /* noop */ }
    // API URLs the page itself called (no query strings — may contain tokens)
    try {
      const urls = performance.getEntriesByType('resource')
        .map(e => e.name.split('?')[0])
        .filter(u => /LRSWAPI/i.test(u));
      d.perfApiUrls = [...new Set(urls)].slice(0, 10);
    } catch (_) { /* noop */ }
    // Vuex store top-level shape (values masked where token-ish)
    try {
      const st = root?.$store?.state;
      if (st) {
        d.storeState = {};
        for (const k of Object.keys(st)) {
          const v = st[k];
          if (Array.isArray(v)) {
            d.storeState[k] = { type: 'array', length: v.length,
              itemKeys: v[0] && typeof v[0] === 'object' ? Object.keys(v[0]).slice(0, 25) : null };
          } else if (v && typeof v === 'object') {
            d.storeState[k] = { type: 'object', keys: Object.keys(v).slice(0, 25) };
          } else {
            d.storeState[k] = { type: typeof v, value: /token/i.test(k) ? '***' : v };
          }
        }
      }
    } catch (_) { /* noop */ }
    // component-data shapes (the LRS list lives here, per field debugging)
    try {
      d.componentData = compDatas.slice(0, 12).map(data => {
        const shape = {};
        for (const k of Object.keys(data)) {
          const v = data[k];
          if (Array.isArray(v)) shape[k] = `array(${v.length})`;
          else if (v && typeof v === 'object') shape[k] = `object(${Object.keys(v).length})`;
          else if (/token/i.test(k)) shape[k] = '***';
          else shape[k] = typeof v === 'string' && v.length > 40 ? `${v.slice(0, 40)}…` : v;
        }
        return shape;
      });
    } catch (_) { /* noop */ }
    try {
      const r = root?.$route;
      if (r) d.route = { path: r.path, params: r.params, query: r.query };
    } catch (_) { /* noop */ }
    return d;
  }

  function findVueRoot() {
    for (const qel of document.querySelectorAll('*')) {
      if (qel.__vue__) return qel.__vue__;
      if (qel.__vue_app__) {
        const inst = qel.__vue_app__._instance;
        return inst?.proxy || inst;
      }
    }
    return null;
  }

  function jwtFromStorage() {
    for (const store of [localStorage, sessionStorage]) {
      try {
        for (let i = 0; i < store.length; i++) {
          const k = store.key(i);
          const v = store.getItem(k);
          if (typeof v === 'string' && /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}$/.test(v.trim())) {
            return { key: k, token: v.trim() };
          }
        }
      } catch (_) { /* noop */ }
    }
    return null;
  }

  // depth-limited DFS; returns { value, path } of first key/value matching pred
  function deepFind(node, pred, maxDepth) {
    const seen = new Set();
    function walk(n, path, depth) {
      if (!n || typeof n !== 'object' || seen.has(n) || depth > maxDepth) return null;
      seen.add(n);
      if (Array.isArray(n)) {
        for (let i = 0; i < Math.min(n.length, 60); i++) {
          const r = walk(n[i], `${path}[${i}]`, depth + 1);
          if (r) return r;
        }
        return null;
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (pred(k, v)) return { value: v, path: `${path}.${k}` };
        const r = walk(v, `${path}.${k}`, depth + 1);
        if (r) return r;
      }
      return null;
    }
    return walk(node, '$', 0);
  }

  // all component $data objects on the Vue tree (recordings live here)
  function collectComponentData(root) {
    const datas = [];
    const seen = new Set();
    (function walk(comp, depth) {
      if (!comp || seen.has(comp) || depth > 8 || datas.length >= 30) return;
      seen.add(comp);
      if (comp.$data && typeof comp.$data === 'object' && Object.keys(comp.$data).length) {
        datas.push(comp.$data);
      }
      for (const c of (comp.$children || [])) walk(c, depth + 1);
    })(root, 0);
    return datas;
  }

  // the page must have called MediaRecordings/dto/<id> to render the list —
  // its own network log tells us the course ID
  function courseIdFromPerf() {
    try {
      for (const e of performance.getEntriesByType('resource')) {
        const m = e.name.match(/MediaRecordings\/dto\/(\d+)/i);
        if (m) return m[1];
      }
    } catch (_) { /* noop */ }
    return null;
  }

  const isNumericId = v =>
    typeof v === 'number' || (typeof v === 'string' && /^\d{2,}$/.test(v));
  const courseIdPred = (k, v) => /course_?id/i.test(k) && isNumericId(v);
  const recordingsPred = (_k, v) =>
    Array.isArray(v) && v.length > 0 && v[0] && typeof v[0] === 'object' &&
    ('sources' in v[0] || 'dateTime' in v[0]);

  // decode the JWT payload -> { raw, masked } (masked for debug output)
  function jwtClaims(tok) {
    try {
      const part = tok.split('.')[1];
      if (!part) return null;
      let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const claims = JSON.parse(new TextDecoder().decode(bytes));
      const masked = {};
      for (const [k, v] of Object.entries(claims)) {
        masked[k] = typeof v === 'string' && v.length > 60 ? `${v.slice(0, 24)}…` : v;
      }
      return { raw: claims, masked };
    } catch (_) {
      return null;
    }
  }

  const root = findVueRoot();
  if (!root) {
    return { error: 'Vue app not found — is the Lecture Recordings list page loaded?', diagnostics: diag(null, []) };
  }

  // --- token ---
  let token = null;
  let tokenSource = null;
  const st = (() => { try { return root.$store?.state; } catch (_) { return null; } })();
  if (st?.token) { token = st.token; tokenSource = 'Vuex store'; }
  if (!token) {
    const fromStorage = jwtFromStorage();
    if (fromStorage) { token = fromStorage.token; tokenSource = `storage "${fromStorage.key}"`; }
  }
  if (!token) {
    return { error: 'No auth token found — is the Lecture Recordings list page loaded?', diagnostics: diag(root, []) };
  }

  const compDatas = collectComponentData(root);

  // --- course ID: override > store > route > page's own network log > component data ---
  let courseId = courseIdOverride || null;
  let courseSource = null;
  if (!courseId && st) {
    const f = deepFind(st, courseIdPred, 3);
    if (f) { courseId = String(f.value); courseSource = `store ${f.path}`; }
  }
  if (!courseId) {
    try {
      const r = root.$route;
      const fromRoute = r?.params?.courseId ?? r?.params?.courseID ?? r?.query?.courseId ?? r?.query?.courseID ?? null;
      if (fromRoute != null) { courseId = String(fromRoute); courseSource = 'route'; }
    } catch (_) { /* noop */ }
  }
  if (!courseId) {
    const fromPerf = courseIdFromPerf();
    if (fromPerf) { courseId = fromPerf; courseSource = 'network log'; }
  }
  const claims = jwtClaims(token);
  if (!courseId && claims?.raw) {
    const hit = Object.entries(claims.raw).find(([k, v]) => /course/i.test(k) && isNumericId(v));
    if (hit) { courseId = String(hit[1]); courseSource = `JWT claim "${hit[0]}"`; }
  }
  if (!courseId) {
    for (const data of compDatas) {
      const f = deepFind(data, courseIdPred, 3);
      if (f) { courseId = String(f.value); courseSource = `component ${f.path}`; break; }
    }
  }

  // --- recordings: API (freshest signed URLs) > store > component data ---
  // Store/component fallbacks are only for the implicit case (the page's own
  // course). When the user explicitly requests a course, an API failure must
  // be an error — never silently show the current course's recordings.
  const explicit = !!courseIdOverride;
  let recordings = null;
  let recSource = null;
  let apiStatus = null;
  if (courseId) {
    try {
      const resp = await fetch(`${LRS_API}/${courseId}`, { headers: { Authorization: `Bearer ${token}` } });
      apiStatus = resp.status;
      if (resp.ok) {
        const j = await resp.json();
        if (Array.isArray(j) && j.length) { recordings = j; recSource = `API course ${courseId}`; }
        else if (Array.isArray(j?.recordings) && j.recordings.length) { recordings = j.recordings; recSource = `API course ${courseId}`; }
      }
    } catch (e) {
      apiStatus = `fetch error: ${e.message}`;
    }
  }
  if (!recordings && !explicit && st) {
    const f = deepFind(st, recordingsPred, 3);
    if (f) { recordings = f.value; recSource = `store ${f.path}`; }
  }
  if (!recordings && !explicit) {
    for (const data of compDatas) {
      const f = deepFind(data, recordingsPred, 3);
      if (f) { recordings = f.value; recSource = `component data ${f.path}`; break; }
    }
  }

  if (recordings?.length) {
    return { recordings, courseId: courseId || null, courseSource, recSource, tokenSource, jwtClaims: claims?.masked ?? null, diagnostics: diag(root, compDatas) };
  }
  if (!courseId) {
    return { error: 'Could not detect course ID — enter it below.', tokenSource, jwtClaims: claims?.masked ?? null, diagnostics: diag(root, compDatas) };
  }
  const reason = apiStatus === 200
    ? `The API returned no recordings for course ${courseId} — either that course has none, or its recordings are only served through its own myCourses launch.`
    : `The API returned ${apiStatus ?? 'nothing'} for course ${courseId}. Your session token is scoped to the course of the LTI launch (JWT claim LRSCourseId) — open that course's Lecture Recordings page in myCourses, then click the extension.`;
  return {
    error: reason,
    courseId, tokenSource, jwtClaims: claims?.masked ?? null, diagnostics: diag(root, compDatas),
  };
}

// --- injected to discover other course IDs (self-contained) ---
// Greps the LRS app's own JS bundles for API endpoint names, probes each with
// the user's token (GET only), and samples anything that looks like a course list.
async function exploreLRS() {
  function findVueRoot() {
    for (const qel of document.querySelectorAll('*')) {
      if (qel.__vue__) return qel.__vue__;
      if (qel.__vue_app__) {
        const inst = qel.__vue_app__._instance;
        return inst?.proxy || inst;
      }
    }
    return null;
  }

  const root = findVueRoot();
  if (!root) return { error: 'Vue app not found.' };

  let token = null;
  let base = 'https://LRSWAPI.campus.mcgill.ca/api/';
  try {
    const st = root.$store?.state;
    token = st?.token || null;
    if (st?.urlbaseAPI) base = st.urlbaseAPI;
  } catch (_) { /* noop */ }
  if (!token) return { error: 'No token in Vuex store.' };

  // decode JWT claims — for a user id, and to see the token's scope in debug
  let claims = null;
  const idCandidates = [];
  try {
    const part = token.split('.')[1];
    if (part) {
      let b64 = part.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      claims = JSON.parse(new TextDecoder().decode(bytes));
      for (const k of ['sub', 'uid', 'userId', 'user_id', 'nameid', 'unique_name', 'id']) {
        if (claims[k] != null) idCandidates.push(String(claims[k]));
      }
    }
  } catch (_) { /* not a JWT or not base64 — skip */ }
  try {
    const email = root.$store?.state?.myEmailAlt;
    if (email) idCandidates.push(email);
  } catch (_) { /* noop */ }

  // ground truth for calibrating the course-id field: the current course's id,
  // from the page's own network log or the JWT claim
  let currentCourseId = null;
  try {
    for (const e of performance.getEntriesByType('resource')) {
      const m = e.name.match(/MediaRecordings\/dto\/(\d+)/i);
      if (m) { currentCourseId = m[1]; break; }
    }
  } catch (_) { /* noop */ }
  if (!currentCourseId && claims?.LRSCourseId) currentCourseId = String(claims.LRSCourseId);

  // 1. gather the app's JS bundle URLs (script tags + network log)
  const srcs = new Set();
  for (const s of document.querySelectorAll('script[src]')) srcs.add(s.src);
  try {
    for (const e of performance.getEntriesByType('resource')) {
      if (/\.js(\?|$)/i.test(e.name)) srcs.add(e.name);
    }
  } catch (_) { /* noop */ }

  // 2. grep bundles for endpoint names
  const endpoints = new Set(['Courses/dto', 'Users/dto', 'Roles/dto', 'Institutions/dto']);
  for (const url of [...srcs].slice(0, 15)) {
    try {
      const txt = await (await fetch(url)).text();
      for (const m of txt.matchAll(/([A-Za-z][A-Za-z0-9]*)\/dto(?:["'?&]|$)/g)) endpoints.add(`${m[1]}/dto`);
      for (const m of txt.matchAll(/["'`]api\/([A-Za-z0-9/_-]+)["'`]/gi)) endpoints.add(m[1]);
    } catch (_) { /* bundle not fetchable — skip */ }
  }
  // endpoints the page itself called (strip query + trailing numeric id)
  try {
    for (const e of performance.getEntriesByType('resource')) {
      if (!/LRSWAPI/i.test(e.name)) continue;
      const ep = e.name.split('?')[0].replace(/\/\d+$/, '').replace(/^https?:\/\/[^/]+\/api\//i, '');
      if (ep) endpoints.add(ep);
    }
  } catch (_) { /* noop */ }

  const list = [...endpoints].filter(e => e.length < 60).slice(0, 20);

  // also probe user-scoped course endpoints derived from the JWT claims
  for (const idv of [...new Set(idCandidates)].slice(0, 4)) {
    const enc = encodeURIComponent(idv);
    list.push(`Courses/dto/${enc}`, `Users/dto/${enc}`);
  }
  list.push('Users/dto/Me', 'Courses/dto/Me', 'Courses', 'Users');

  // 3. probe each candidate (GET with bearer token, record shape only)
  const probes = [];
  for (const ep of list) {
    const p = { endpoint: ep, status: 0 };
    try {
      const resp = await fetch(base + ep, { headers: { Authorization: `Bearer ${token}` } });
      p.status = resp.status;
      if (resp.ok) {
        const j = await resp.json().catch(() => null);
        if (Array.isArray(j)) {
          p.kind = `array(${j.length})`;
          const item0 = j[0] && typeof j[0] === 'object' ? j[0] : null;
          const keys = item0 ? Object.keys(item0) : [];
          p.itemKeys = keys.slice(0, 15);
          // calibrate: find the id-ish key that equals the current course's
          // KNOWN id somewhere in the list — that's the real LRS course id field
          const numKeys = keys.filter(k => typeof item0?.[k] === 'number');
          const idish = numKeys.filter(k => /id|course/i.test(k));
          let idKey = null;
          if (currentCourseId) {
            idKey = idish.find(k => j.some(it => it && typeof it === 'object' && String(it[k]) === currentCourseId)) || null;
            if (idKey) p.calibrated = true;
          }
          if (!idKey) {
            idKey = numKeys.find(k => /course_?id/i.test(k))
              || numKeys.find(k => /^id$/i.test(k))
              || numKeys.find(k => /_?id$/i.test(k));
          }
          const nameKey = keys.find(k => /^(course_?name|name|title)$/i.test(k) && typeof item0?.[k] === 'string');
          if (idKey && nameKey) {
            p.idKey = idKey;
            p.nameKey = nameKey;
            p.sample = j.slice(0, 30).map(it => ({ id: it[idKey], name: it[nameKey] }));
          }
          // dump the first item so the real field names are visible in debug
          if (item0) {
            const firstItem = {};
            for (const k of keys.slice(0, 20)) {
              const v = item0[k];
              if (/token/i.test(k)) firstItem[k] = '***';
              else if (typeof v === 'string' && v.length > 60) firstItem[k] = `${v.slice(0, 40)}…`;
              else if (v && typeof v === 'object') firstItem[k] = Array.isArray(v) ? `array(${v.length})` : `object(${Object.keys(v).length})`;
              else firstItem[k] = v;
            }
            p.firstItem = firstItem;
          }
        } else if (j && typeof j === 'object') {
          p.kind = 'object';
          p.keys = Object.keys(j).slice(0, 15);
        } else {
          p.kind = typeof j;
        }
      }
    } catch (e) {
      p.error = e.message;
    }
    probes.push(p);
  }
  const maskedClaims = {};
  if (claims) {
    for (const [k, v] of Object.entries(claims)) {
      maskedClaims[k] = typeof v === 'string' && v.length > 60 ? `${v.slice(0, 24)}…` : v;
    }
  }
  return { base, found: list, probes, jwtClaims: Object.keys(maskedClaims).length ? maskedClaims : null, email: maskedClaims?.email || null, currentCourseId };
}

// --- popup-side rendering and control flow ---

function renderList(recordings, statusEl, listEl, courseId) {
  const sorted = [...recordings].sort((a, b) =>
    (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0));
  if (!sorted.length) { statusEl.textContent = 'No recordings found.'; return; }
  listEl.innerHTML = '';

  sorted.forEach(rec => {
    const date = (rec.dateTime || '').slice(0, 10);
    const title = rec.title || rec.name || date;
    const url = rec.sources?.[0]?.src || rec.sources?.[0]?.url || '';
    if (!url) return;

    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'date';
    span.textContent = date;
    const tSpan = document.createElement('span');
    tSpan.className = 'title';
    tSpan.textContent = title;
    const btn = document.createElement('button');
    btn.textContent = 'Copy';
    btn.addEventListener('click', () => {
      navigator.clipboard.writeText(buildLpCmd(url, date, courseId, rec.title || rec.name || ''));
      btn.textContent = 'Copied ✓';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 1500);
    });
    li.append(span, tSpan, btn);
    listEl.appendChild(li);
  });
}

function showManual(statusEl, go) {
  const manual = el('manual');
  manual.style.display = 'block';
  statusEl.textContent = '';
  el('courseIdBtn').onclick = () => {
    const id = el('courseIdInput').value.trim();
    if (id) go(id);
  };
}

function showDebug(debug) {
  el('debug').style.display = 'block';
  el('debugOut').textContent = JSON.stringify(debug, null, 2);
}

async function getFrames(tabId) {
  try { return await chrome.webNavigation.getAllFrames({ tabId }); } catch (_) { return []; }
}

async function run(courseIdOverride) {
  const statusEl = el('status');
  const listEl = el('list');
  statusEl.className = '';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { statusEl.className = 'error'; statusEl.textContent = 'No active tab.'; return; }

  const onLRS = tab.url?.includes('lrs.mcgill.ca');
  const onMyCourses = tab.url?.includes('mycourses2.mcgill.ca');
  if (!onLRS && !onMyCourses) {
    statusEl.className = 'error';
    statusEl.textContent = 'Open myCourses or lrs.mcgill.ca first, then click the extension.';
    return;
  }

  const debug = { tabUrl: tab.url, frames: [], injections: [] };
  let frames = await getFrames(tab.id);
  debug.frames = frames.map(f => ({ frameId: f.frameId, url: f.url }));

  const maxAttempts = 6;
  let lastData = null;
  let hardFail = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // candidates: any frame whose URL is lrs.mcgill.ca (top frame or iframe)
    let candidates = frames.filter(f => /lrs\.mcgill\.ca/i.test(f.url || ''));
    if (!candidates.length && onLRS) {
      const top = frames.find(f => f.frameId === 0);
      if (top) candidates = [top];
    }

    if (candidates.length) {
      for (const f of candidates) {
        try {
          const [r] = await chrome.scripting.executeScript({
            target: { tabId: tab.id, frameIds: [f.frameId] },
            world: 'MAIN',
            func: scrapeLRS,
            args: [courseIdOverride || null],
          });
          const data = r?.result;
          debug.injections.push({ frameId: f.frameId, result: data });
          if (data?.recordings?.length) {
            renderList(data.recordings, statusEl, listEl, data.courseId);
            statusEl.textContent =
              `${data.recordings.length} recording(s) — ${data.recSource} (course ID: ${data.courseSource ?? 'override'})`;
            if (data.jwtClaims?.email) {
              try { await chrome.storage.local.set({ lrsLastEmail: data.jwtClaims.email }); } catch (_) { /* noop */ }
            }
            showDebug(debug);
            return;
          }
          if (data) lastData = data;
          // an explicit course request that errored is deterministic — the API
          // answer won't change by waiting, so don't retry 6 times
          if (courseIdOverride && data?.error) hardFail = true;
        } catch (e) {
          debug.injections.push({ frameId: f.frameId, error: e.message });
          lastData = { error: `injection failed in frame ${f.frameId}: ${e.message}` };
        }
      }
    }

    if (hardFail) break;
    statusEl.textContent = `Waiting for LRS to load… (${attempt}/${maxAttempts})`;
    await sleep(1500);
    frames = await getFrames(tab.id);
    debug.frames = frames.map(fr => ({ frameId: fr.frameId, url: fr.url }));
  }

  statusEl.className = 'error';
  statusEl.textContent = lastData?.error || 'Could not find the LRS app in any frame.';
  if (lastData?.diagnostics) Object.assign(debug, lastData.diagnostics);
  showDebug(debug);
  if (/course/i.test(lastData?.error || '')) showManual(statusEl, id => run(id));
}

// --- course discovery scan, with a 24h cache in chrome.storage.local ---

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function loadCache(email) {
  const key = `lrsCourses:${email || 'default'}`;
  try {
    const obj = await chrome.storage.local.get(key);
    const c = obj?.[key];
    if (c?.courses?.length && Date.now() - c.savedAt < CACHE_TTL_MS) return c.courses;
  } catch (_) { /* noop */ }
  return null;
}

async function saveCache(email, courses) {
  if (!courses?.length) return;
  try {
    await chrome.storage.local.set({
      lrsLastEmail: email || '',
      [`lrsCourses:${email || 'default'}`]: { courses, savedAt: Date.now() },
    });
  } catch (_) { /* noop */ }
}

function populatePicker(courses) {
  const sel = el('courseSelect');
  sel.innerHTML = '';
  for (const c of courses) {
    const opt = document.createElement('option');
    opt.value = String(c.id);
    opt.textContent = `${c.name} (${c.id})`;
    sel.appendChild(opt);
  }
  el('courses').style.display = 'block';
  sel.onchange = () => { el('courses').style.display = 'none'; run(sel.value); };
}

function armRefreshButton() {
  const btn = el('scanBtn');
  btn.dataset.mode = 'refresh';
  btn.textContent = 'Refresh course list';
}

async function injectIntoLRS(tabId, func, args, errors) {
  const frames = await getFrames(tabId);
  const candidates = frames.filter(f => /lrs\.mcgill\.ca/i.test(f.url || ''));
  for (const f of candidates) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [f.frameId] },
        world: 'MAIN', func, args,
      });
      if (r?.result) return r.result;
    } catch (e) {
      errors.push(`frame ${f.frameId}: ${e.message}`);
    }
  }
  return null;
}

async function scanCourses(force) {
  const statusEl = el('status');
  statusEl.className = '';

  // cached course list? (no injection needed — instant)
  if (!force) {
    let lastEmail = '';
    try {
      const o = await chrome.storage.local.get('lrsLastEmail');
      lastEmail = o?.lrsLastEmail || '';
    } catch (_) { /* noop */ }
    const cached = await loadCache(lastEmail);
    if (cached) {
      populatePicker(cached);
      armRefreshButton();
      statusEl.textContent = `Found ${cached.length} courses (cached) — pick one, or click Refresh to rescan.`;
      return;
    }
  }

  statusEl.textContent = 'Scanning LRS app for course endpoints…';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) { statusEl.className = 'error'; statusEl.textContent = 'No active tab.'; return; }

  const errors = [];
  const result = await injectIntoLRS(tab.id, exploreLRS, [], errors);

  if (!result || result.error) {
    statusEl.className = 'error';
    statusEl.textContent = result?.error || 'Scan failed — is the LRS frame loaded?';
    if (result) showDebug({ scan: result, errors });
    return;
  }

  showDebug({ scan: result, errors });

  const courseProbe = result.probes.find(p => p.sample?.length);
  if (courseProbe) {
    populatePicker(courseProbe.sample);
    armRefreshButton();
    saveCache(result.email, courseProbe.sample);
    statusEl.textContent =
      `Found ${courseProbe.sample.length} courses via ${courseProbe.endpoint}` +
      (courseProbe.calibrated ? ' (id field verified against the current course)' : '') +
      ' — pick one.';
  } else {
    statusEl.className = 'error';
    statusEl.textContent = 'No course-list endpoint found — see Debug for everything it tried.';
  }
}

el('scanBtn').onclick = () => scanCourses(el('scanBtn').dataset.mode === 'refresh');

run();