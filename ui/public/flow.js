// The Flow: a file going through the pipeline, told as a scroll story while it happens.
// The left column explains each step; the right column shows it, live, from the engine's own progress events.
import { icon } from "./icons.js";

let ctx = null;              // { el, store, using(), go(route) } from app.js
const runs = new Map();      // id -> run as the server reports it, with every event so far
let polling = null;

/* ---------- numbers in words ---------- */
const fmt = (n) => Number(n).toLocaleString("en-GB");
const mb = (b) => `${(b / 1e6).toFixed(b < 1e7 ? 2 : 1)} MB`;
const pct = (d, t) => (t ? Math.min(100, (d / t) * 100) : 0);

/* ---------- runs ---------- */
export async function startSample(name) {
  const r = await fetch(`/api/runs?sample=${encodeURIComponent(name)}&engine=${ctx.using()}`, { method: "POST" }).then((x) => x.json());
  runs.set(r.id, r);
  return r.id;
}
export async function upload(file) {
  ctx.busy(`Receiving ${file.name}`, `${mb(file.size)}`);
  try {
    const res = await fetch(`/api/runs?engine=${ctx.using()}`, { method: "POST", headers: { "x-file-name": encodeURIComponent(file.name) }, body: file });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || "The upload failed.");
    runs.set(r.id, r);
    ctx.go(`/flow/${r.id}`);
  } catch (e) {
    ctx.toast(e.message);
  } finally {
    ctx.busy(null);
  }
}
export async function loadRuns() {
  const list = await fetch("/api/runs").then((x) => x.json());
  for (const s of list) if (!runs.has(s.id)) runs.set(s.id, { ...s, events: [], engines: {}, result: null, eventCount: 0 });
  return list;
}
async function refresh(id) {
  const r = runs.get(id);
  const since = r?.events?.length ?? 0;
  const d = await fetch(`/api/runs/${id}?since=${since}`).then((x) => x.json());
  d.events = (r?.events ?? []).concat(d.events);
  runs.set(id, d);
  return d;
}
function poll(id, onTick) {
  clearTimeout(polling);
  const tick = async () => {
    const d = await refresh(id);
    onTick(d);
    if (d.state === "running" || Object.values(d.engines || {}).some((e) => e.state === "running" || e.state === "waiting")) polling = setTimeout(tick, 250);
    else polling = setTimeout(tick, 2000);   // stay current if an agreement check is started from elsewhere
  };
  tick();
}

/* ---------- what the events say ---------- */
function model(run) {
  const m = { file: run.file, steps: {}, tables: [], result: run.result, engines: run.engines || {}, state: run.state };
  for (const ev of run.events || []) {
    if (ev.event !== "step") continue;
    const s = (m.steps[ev.step] ??= { state: "waiting" });
    if (ev.state === "start") { s.state = "running"; if (ev.total != null) s.total = ev.total; }
    if (ev.state === "progress") { s.state = "running"; s.done = ev.done; s.total = ev.total; if (ev.table) m.tables.push({ name: ev.table, rows: ev.rows }); }
    if (ev.state === "done") Object.assign(s, ev, { state: "done" });
  }
  // the database step's tables come complete from the result, once there is one
  if (run.result?.database) m.tables = run.result.database.tables;
  return m;
}
const st = (m, k) => m.steps[k]?.state ?? "waiting";

// What the rulebook says the later steps read, per kind of filing (spec/rulebook/intake.json, served by the server).
// Read fresh each time a Flow opens, because the guidebook can change it.
let KIND_MARKERS = {}, REQUIRED = {}, KIND_LABEL = {}, TABLES = {}, RULE_VERSION = 0;
async function loadRules() {
  const r = await fetch("/api/rulebook/intake").then((x) => x.json()).catch(() => null);
  if (!r) return;
  RULE_VERSION = r.version ?? 0; TABLES = {};
  for (const [k, v] of Object.entries(r.kinds)) {
    KIND_MARKERS[k] = v.markers; KIND_LABEL[k] = v.label;
    REQUIRED[k] = Object.fromEntries(Object.entries(v.tables).filter(([, t]) => t.read).map(([n, t]) => [n, t.columns ?? []]));
    for (const [n, t] of Object.entries(v.tables)) TABLES[n] = { alias: t.alias, about: t.about };
  }
}

/* ---------- pages ---------- */
export function homePage(samples) {
  const { el } = ctx;
  return el("div", { class: "home" },
    el("div", { class: "drop-hint" },
      el("div", { class: "dh-ic", html: icon("arrow-up-from-bracket") }),
      el("h1", {}, el("span", { class: "t" }, "Drop an ITU IFIC file anywhere")),
      el("p", {}, "A space or terrestrial issue, as the zip the ITU publishes. It is processed on this computer.")),
    samples === null
      ? el("div", { class: "samples" }, [0, 1].map(() => el("div", { class: "sample" }, el("span", { class: "sk title" }), el("span", { class: "sk line", style: "width:120px;margin-top:8px" }))))
      : samples.length ? el("div", { class: "samples" },
        el("div", { class: "s-h" }, "Or start with a sample"),
        samples.map((s) => el("button", { class: "sample", onclick: async () => ctx.go(`/flow/${await startSample(s.name)}`) },
          el("span", { class: "ic", html: icon(/^br/i.test(s.name) ? "tower-broadcast" : "satellite-dish") }),
          el("span", {}, el("b", {}, s.name), el("small", {}, `${/^br/i.test(s.name) ? "Terrestrial" : "Space"} · ${mb(s.bytes)}`))))) : null);
}

/* ---------- the flow: modules on the left, the picture on the right, driven by scrolling ---------- */
const BUILT = [
  { id: "file", label: "File", icon: "file-zipper" },
  { id: "tables", label: "Tables", icon: "database" },
  { id: "relevant", label: "Relevant tables", icon: "list-check" },
];
const NEXT = {
  space: ["Downlink", "Reach", "Limit", "Data", "Power", "Compare", "Stations", "Ladder", "Report"],
  terrestrial: ["Land mobile", "Range", "Data", "Field strength", "Threshold", "Stations", "Coordinated", "Ladder", "Report"],
};
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

export function flowPage(id) {
  const { el } = ctx;
  const list = [...runs.values()];
  // A run the page has not seen yet (started elsewhere, or a link): fetch it, then draw.
  if (id && !runs.has(id)) {
    const wait = el("div", { class: "empty-state" }, el("span", { class: "sk line", style: "width:220px" }));
    refresh(id).then(() => wait.replaceWith(flowPage(id))).catch(() => wait.replaceWith(el("div", { class: "empty-state" }, "That file is not loaded.")));
    return wait;
  }
  const run = runs.get(id) ?? list[list.length - 1];
  if (!run) return el("div", { class: "empty-state" }, "Nothing has been loaded yet. Drop an ITU file anywhere.");

  // One tab per file: the latest run of each (a file run again replaces its earlier tab), plus the run being shown.
  const latest = new Map();
  for (const r of list) latest.set(r.file.name, r);
  const shown = [...latest.values()].map((r) => (r.file.name === run.file.name ? run : r));
  const tabs = el("div", { class: "runs", role: "tablist", "aria-label": "Files" }, shown.map((r) => el("a", { href: `#/flow/${r.id}`, class: r.id === run.id ? "on" : "", role: "tab" },
    el("span", { class: "ic", html: icon(r.result?.kind === "space" ? "satellite-dish" : r.result?.kind === "terrestrial" ? "tower-broadcast" : "file-zipper") }),
    el("span", { class: "label" }, r.file.name))));
  const agree = el("div", { class: "agree" });
  const diagram = el("nav", { class: "diagram", "aria-label": "Modules" });
  const stage = el("div", { class: "stage" });
  const msg = el("div", { class: "msg", "aria-live": "polite" });
  const scrolly = el("div", { class: "scrolly" }, el("div", { class: "sticky" }, stage, msg));
  const page = el("div", { class: "flow" },
    el("header", { class: "flow-h" }, el("h1", {}, el("span", { class: "t" }, "Flow")), tabs, agree),
    el("div", { class: "flow-body" }, el("div", { class: "diagram-col" }, diagram), scrolly));

  let current = run, built = null, phase = -1;

  /* the file card and the tiles are built once the catalogue is known; until then, skeletons */
  const card = el("div", { class: "fcard" });
  stage.append(card);
  function drawCard() {
    const f = current.file, sha = current.result?.file?.sha256;
    card.replaceChildren(
      el("div", { class: "fcard-ic", html: icon("file-zipper") }),
      el("div", { class: "fcard-name" }, f.name),
      el("div", { class: "fcard-sub" }, `${mb(f.bytes)}`),
      sha ? el("code", { class: "fcard-sha", title: `SHA-256 ${sha}` }, `${sha.slice(0, 8)}…${sha.slice(-6)}`) : el("span", { class: "sk line", style: "width:120px;margin:6px auto 0" }));
    card.classList.toggle("working", current.state === "running" && !current.result);
  }

  function build() {
    const r = current.result;
    if (!r?.database || built) return;
    const req = REQUIRED[r.kind] ?? {};
    const present = new Map(r.database.tables.map((t) => [t.name, t]));
    const relevant = Object.keys(req);
    const tiles = r.database.tables.map((t) => {
      const al = TABLES[t.name]?.alias;
      const e = el("div", { class: "tile" + (req[t.name] ? " rel" : ""), "data-name": t.name },
        req[t.name] && al ? el("span", {}, el("b", { class: "al" }, al), el("code", { class: "nm" }, t.name)) : el("span", {}, t.name));
      stage.append(e);
      return { t, e, rel: !!req[t.name] };
    });
    const info = relevant.map((name) => {
      const t = present.get(name), cols = req[name];
      const e = el("div", { class: "relinfo" },
        el("span", { class: "ri-rows" }, t ? `${fmt(t.rows)} rows` : "missing"),
        el("span", { class: "ri-cols" }, cols.map((c) => el("i", { class: t?.columns.includes(c) ? "" : "miss" }, c))));
      stage.append(e);
      return { name, e, missing: !t };
    });
    // a relevant table the file lacks still gets a place, drawn as missing
    for (const name of relevant) if (!present.has(name)) {
      const e = el("div", { class: "tile rel miss", "data-name": name }, el("span", {}, el("b", { class: "al" }, TABLES[name]?.alias ?? name), el("code", { class: "nm" }, name)));
      stage.append(e);
      tiles.push({ t: { name, rows: 0, columns: [] }, e, rel: true, absent: true });
    }
    built = { tiles, info, relevant };
    layout();
  }

  // Two arrangements: every table on a grid, and the relevant ones lifted into a list. Scrolling moves between them.
  let geo = null;
  function layout() {
    const W = stage.clientWidth, H = stage.clientHeight;
    geo = { W, H };
    if (!built) return;
    const all = built.tiles.filter((x) => !x.absent), n = all.length;
    const gx = W * 0.04, gy = Math.max(H * 0.26, 170), gw = W * 0.92, gh = H * 0.98 - gy;
    const cols = Math.max(4, Math.ceil(Math.sqrt((n * gw) / gh * 1.6))), rows = Math.ceil(n / cols);
    const cw = gw / cols, ch = Math.min(gh / rows, cw / 1.6);
    all.forEach((x, i) => { x.g = { x: gx + (i % cols) * cw, y: gy + Math.floor(i / cols) * ch, w: cw - 4, h: ch - 4 }; });
    built.tiles.filter((x) => x.absent).forEach((x) => { x.g = { x: W / 2, y: H * 0.9, w: 0, h: 0 }; });
    const k = built.relevant.length, rh = Math.min(46, (H * 0.7) / k), top = H * 0.5 - (k * rh) / 2, rx = Math.max(24, W * 0.1), rw = Math.min(240, W * 0.3);
    built.relevant.forEach((name, i) => {
      const x = built.tiles.find((t) => t.t.name === name);
      x.l = { x: rx, y: top + i * rh, w: rw, h: rh - 8 };
      const inf = built.info[i];
      inf.e.style.left = `${rx + rw + 18}px`; inf.e.style.top = `${top + i * rh}px`; inf.e.style.height = `${rh - 8}px`;
    });
  }

  function progress() {
    const r = scrolly.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - innerHeight));
  }

  function frame() {
    const p = progress(), W = geo?.W ?? stage.clientWidth, H = geo?.H ?? stage.clientHeight;
    const tB = ease(clamp((p - 0.2) / 0.22)), tC = ease(clamp((p - 0.58) / 0.22));
    // the file: centre stage, then up into the corner as its tables come out
    card.style.transform = `translate(${lerp(W / 2 - 110, W * 0.04, tB)}px, ${lerp(H / 2 - 110, H * 0.02, tB)}px) scale(${lerp(1, 0.62, tB)})`;
    if (built) {
      const n = built.tiles.length;
      built.tiles.forEach((x, i) => {
        if (!x.g) return;
        const d = clamp(tB * 1.5 - (i / n) * 0.5);        // tiles leave the file one after another
        const from = { x: W * 0.04 + 60, y: H * 0.06 + 60, w: 8, h: 6 };
        let b = { x: lerp(from.x, x.g.x, d), y: lerp(from.y, x.g.y, d), w: lerp(from.w, x.g.w, d), h: lerp(from.h, x.g.h, d) };
        if (x.rel && x.l) b = { x: lerp(b.x, x.l.x, tC), y: lerp(b.y, x.l.y, tC), w: lerp(b.w, x.l.w, tC), h: lerp(b.h, x.l.h, tC) };
        const s = x.e.style;
        s.transform = `translate(${b.x}px, ${b.y}px)`; s.width = `${b.w}px`; s.height = `${b.h}px`;
        s.opacity = String(x.absent ? tC : x.rel ? d : d * (1 - 0.88 * tC));
        x.e.classList.toggle("lit", x.rel && tC > 0.5);
        x.e.classList.toggle("named", b.w > 64 && b.h > 16);
      });
      built.info.forEach((inf) => { inf.e.style.opacity = String(clamp((tC - 0.6) / 0.4)); });
    }
    const ph = p < 0.33 ? 0 : p < 0.7 ? 1 : 2;
    if (ph !== phase) { phase = ph; say(); light(); }
  }

  function say() {
    const r = current.result, f = current.file;
    const lines = [
      `<b>${f.name}</b> · ${mb(f.bytes)}${r ? "" : " · reading…"}`,
      r?.database ? `<b>${fmt(r.database.tables.length)} tables</b> inside · ${fmt(r.database.rows)} rows` : r ? "No tables could be read" : "Reading the tables…",
      r?.database ? (r.check.status === "accepted" ? `The rules read <b>${built?.relevant.length ?? 0} of them</b>` + ` · ${KIND_LABEL[r.kind] ?? ""}` : `<b>Refused</b> · ${r.check.reason}`) : r ? `<b>Refused</b> · ${r.check.reason}` : "Picking the tables the rules read…",
    ];
    const html = lines[Math.max(0, phase)];
    if (msg.dataset.html === html) return;              // only animate when the message really changes
    msg.dataset.html = html;
    msg.classList.remove("in"); void msg.offsetWidth;
    msg.innerHTML = `<span>${html}</span>`; msg.classList.add("in");
  }

  function light() {
    const kind = current.result?.kind;
    const next = NEXT[kind];
    diagram.replaceChildren(
      ...BUILT.map((m, i) => el("button", { class: "node" + (i === phase ? " on" : "") + (i < phase ? " past" : ""), onclick: () => jumpTo(i) },
        el("span", { class: "ic", html: icon(m.icon) }), el("span", { class: "label" }, m.label))),
      el("div", { class: "next-h" }, "Next"),
      ...(next ? next.map((n) => el("div", { class: "node later" }, el("span", { class: "ic" }, el("i", { class: "pip" })), el("span", { class: "label" }, n)))
        : [0, 1, 2, 3].map(() => el("div", { class: "node later" }, el("span", { class: "ic" }, el("i", { class: "sk dot" })), el("span", { class: "sk line", style: "width:80px" })))));
  }
  function jumpTo(i) {
    const r = scrolly.getBoundingClientRect(), span = r.height - innerHeight;
    scrollTo({ top: scrollY + r.top + span * [0.08, 0.48, 0.94][i], behavior: "smooth" });
  }

  // A result made under an older rulebook: say so, and offer to run it again under the current one.
  function drawStale() {
    const v = current.result?.rulebook?.version;
    if (v == null || v === RULE_VERSION || current.state === "running") return null;
    return el("button", { class: "stale", title: `This file was checked with rulebook version ${v}. The rulebook is now at version ${RULE_VERSION}.`,
      onclick: async () => { const r = await fetch(`/api/runs/${current.id}/again?engine=${ctx.using()}`, { method: "POST" }).then((x) => x.json()); runs.set(r.id, r); ctx.go(`/flow/${r.id}`); }, html: icon("rotate-left") }, "Rulebook changed · run again");
  }

  // The corner: the engine this file runs in and how long it has taken, live. Other engines appear only after an agreement check.
  function drawAgree() {
    const names = { ts: "TypeScript", rust: "Rust", python: "Python" };
    const secs = (ms) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`;
    const e = Object.entries(current.engines || {}).filter(([k, x]) => k === current.engine || x.state !== "idle");
    const others = e.filter(([k]) => k !== current.engine);
    const checked = others.length && e.every(([, x]) => x.state === "done"), hashes = new Set(e.map(([, x]) => x.sha256));
    const times = e.map(([k, x]) => el("span", { class: "et" + (k === current.engine ? " me" : "") },
      names[k] ?? k, " ", x.state === "done" ? el("b", {}, secs(x.ms)) : x.state === "failed" ? el("b", { class: "bad" }, "failed")
        : x.state === "running" && x.started ? el("b", {}, secs(Date.now() - x.started)) : el("i", { class: "sk dot", title: "Waiting for its turn" })));
    agree.replaceChildren(...[drawStale(), el("span", { class: "times" }, times),
      checked ? el("span", { class: "verdict" + (hashes.size === 1 ? "" : " bad"), html: icon(hashes.size === 1 ? "circle-check" : "circle-xmark"), title: hashes.size === 1 ? "All engines wrote byte-identical results" : "The engines' results differ" }) : null].filter(Boolean));
  }
  let clock = setInterval(() => { if (current.state === "running") drawAgree(); }, 100);

  let raf = 0;
  const onScroll = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(frame); };
  const onResize = () => { layout(); frame(); };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  page.cleanup = () => { removeEventListener("scroll", onScroll); removeEventListener("resize", onResize); for (const t of ["wheel", "touchmove", "keydown"]) removeEventListener(t, stopFollow); clearTimeout(polling); clearInterval(clock); };

  /* hover a table: its names and size at once; click it: all its columns, pinned */
  const tip = el("div", { class: "ttip", hidden: true });
  const pin = el("div", { class: "tpin", hidden: true });
  stage.append(tip, pin);
  const tableOf = (name) => current.result?.database?.tables.find((t) => t.name === name);
  function describe(name, all) {
    const t = tableOf(name), meta = TABLES[name], req = REQUIRED[current.result?.kind]?.[name];
    return [
      el("div", { class: "tt-h" }, meta?.alias ? el("b", {}, meta.alias) : null, el("code", {}, name)),
      el("div", { class: "tt-s" }, t ? `${fmt(t.rows)} rows · ${t.columns.length} columns` : "Not in this file"),
      meta?.about ? el("div", { class: "tt-a" }, meta.about) : null,
      req ? el("div", { class: "tt-r" }, "Read by the rules: ", req.join(", ")) : null,
      t ? el("div", { class: "tt-c" }, (all ? t.columns : t.columns.slice(0, 8)).join(", ") + (!all && t.columns.length > 8 ? `, … ${t.columns.length - 8} more` : "")) : null,
    ];
  }
  stage.addEventListener("pointermove", (ev) => {
    const t = ev.target.closest(".tile");
    if (!t || Number(t.style.opacity) < 0.3) { tip.hidden = true; return; }
    tip.replaceChildren(...describe(t.dataset.name, false).filter(Boolean)); tip.hidden = false;
    const r = stage.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${clamp(ev.clientX - r.left + 14, 4, r.width - w - 4)}px`;
    tip.style.top = `${clamp(ev.clientY - r.top + 14, 4, r.height - h - 4)}px`;
  });
  stage.addEventListener("pointerleave", () => { tip.hidden = true; });
  stage.addEventListener("click", (ev) => {
    const t = ev.target.closest(".tile");
    if (!t || Number(t.style.opacity) < 0.3) { pin.hidden = true; return; }
    tip.hidden = true;
    pin.replaceChildren(...describe(t.dataset.name, true).filter(Boolean), el("button", { class: "tp-x", "aria-label": "Close", html: icon("circle-xmark"), onclick: (e) => { e.stopPropagation(); pin.hidden = true; } }));
    pin.hidden = false;
  });

  let follow = run.state === "running", reached = 0, showAt = 0;
  const stopFollow = (e) => { if (e.type !== "keydown" || ["ArrowDown", "ArrowUp", "PageDown", "PageUp", " ", "Home", "End"].includes(e.key)) follow = false; };
  for (const t of ["wheel", "touchmove", "keydown"]) addEventListener(t, stopFollow, { passive: true });
  // Which phase the engine has reached: the file while it is fingerprinted and unpacked, the tables once the catalogue
  // is being read, the relevant tables once the check is done.
  function phaseReached(d) {
    const ev = d.events || [];
    if (d.result || ev.some((x) => x.step === "check" && x.state === "done")) return 2;
    if (ev.some((x) => x.step === "database" && (x.state === "progress" || x.state === "done"))) return 1;
    return 0;
  }
  function update(d) {
    current = d;
    drawCard(); drawAgree();
    if (!built) build();
    say(); light(); frame();
    if (follow) {
      // Step through each phase in turn, each kept on screen long enough to be seen, however fast the engine is.
      const p = phaseReached(d);
      while (reached < p) { reached++; const target = reached; showAt = Math.max(showAt, Date.now()) + (target === 1 ? 300 : 2200); setTimeout(() => { if (follow) jumpTo(target); }, showAt - Date.now()); }
    }
  }
  requestAnimationFrame(() => { layout(); drawCard(); drawAgree(); light(); frame(); });
  loadRules().then(() => poll(run.id, update));
  return page;
}

export function init(c) { ctx = c; }
export const allRuns = () => [...runs.values()];
