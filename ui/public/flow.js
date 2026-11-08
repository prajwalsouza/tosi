// The Flow: a file going through the pipeline, told as a scroll story while it happens.
// The left column explains each step; the right column shows it, live, from the engine's own progress events.
import { icon } from "./icons.js";
import { makeGlobe, gsoSky, ngsoSky, spread, tiltPink, farBlue } from "./reachglobe.js";
import { plan } from "./dots.js";
import { SCENES as SPACE_SCENES } from "./scenes/space.js";
import { makeTerra } from "./scenes/terra.js";
import { makeReport } from "./scenes/report.js";

let ctx = null;              // { el, store, using(), go(route) } from app.js
const runs = new Map();      // id -> run as the server reports it, with every event so far
let polling = null;

/* ---------- numbers in words ---------- */
const fmt = (n) => Number(n).toLocaleString("en-GB");
const mb = (b) => `${(b / 1e6).toFixed(b < 1e7 ? 2 : 1)} MB`;
const pct = (d, t) => (t ? Math.min(100, (d / t) * 100) : 0);

/* ---------- runs ---------- */
export async function startSample(name) {
  const res = await fetch(`/api/runs?sample=${encodeURIComponent(name)}&engine=${ctx.using()}`, { method: "POST" });
  const r = await res.json();
  if (!res.ok) { ctx.toast(r.error || "The sample could not start."); return null; }
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
let KIND_MARKERS = {}, REQUIRED = {}, KIND_LABEL = {}, TABLES = {}, RULE_VERSION = 0, DOWNLINK = null, REACH = null, FINLAND = null, REGION = null;
// The ladders' rungs and wording (spec/rulebook/ladder.json, tladder.json) and the guidebook rules they cite, by id.
const RB = {}; let GUIDE = null;
async function loadRules() {
  const get = (n) => fetch(`/api/rulebook/${n}`).then((x) => x.json()).catch(() => null);
  fetch("/api/chain").then((x) => x.json()).then((c) => { CHAIN = c; }).catch(() => {});
  const [r, dl, rc, fi, la, tla, gb] = await Promise.all([get("intake"), get("downlink"), get("reach"), FINLAND ? FINLAND : fetch("/finland.json").then((x) => x.json()).catch(() => null),
    get("ladder"), get("tladder"), fetch("/api/guidebook").then((x) => x.json()).catch(() => null)]);
  RB.ladder = la; RB.tladder = tla;
  GUIDE = Object.fromEntries((gb?.entries ?? gb?.rules ?? (Array.isArray(gb) ? gb : [])).filter((e) => e?.id).map((e) => [e.id, { title: e.title, rule: e.rule }]));
  DOWNLINK = dl; REACH = rc; FINLAND = fi;
  if (!REGION) REGION = await fetch("/region.json").then((x) => x.json()).catch(() => null);
  if (!r) return;
  RULE_VERSION = r.version ?? 0; TABLES = {};
  for (const [k, v] of Object.entries(r.kinds)) {
    KIND_MARKERS[k] = v.markers; KIND_LABEL[k] = v.label;
    REQUIRED[k] = Object.fromEntries(Object.entries(v.tables).filter(([, t]) => t.read).map(([n, t]) => [n, t.columns ?? []]));
    for (const [n, t] of Object.entries(v.tables)) TABLES[n] = { alias: t.alias, about: t.about };
  }
}

/* ---------- pages ---------- */
// Where the ITU publishes each kind of issue (BR IFIC for space services and for terrestrial services).
const ITU = { space: "https://www.itu.int/en/ITU-R/space/brific/Pages/default.aspx", terrestrial: "https://www.itu.int/en/ITU-R/terrestrial/brific/Pages/default.aspx" };
export function homePage(samples, demo = false) {
  const { el } = ctx;
  // The 3D scene just below the fold. It loads on its own; the page's cleanup stops it.
  const scene = el("section", { class: "home3d", "aria-hidden": "true" });
  let stop3d = null, gone3d = false;
  import("./home3d.js").then((m) => { if (!gone3d) stop3d = m.mount(scene); }).catch(() => scene.remove());
  const home = el("div", { class: "home" },
    demo ? el("div", { class: "drop-hint" },
      el("div", { class: "dh-ic", html: icon("satellite-dish") }),
      el("h1", {}, "Try Tosi with an official ITU sample"),
      el("p", {}, "Choose a space or terrestrial filing to run the analysis and open its report."))
    : el("div", { class: "drop-hint" },
      el("div", { class: "dh-ic", html: icon("arrow-up-from-bracket") }),
      // the ITU pages where the issues are published, opened in the browser
      el("h1", {}, el("span", { class: "t" }, "Drop an ", el("a", { class: "ext", href: ITU.space, target: "_blank", rel: "noopener" }, "ITU IFIC file"), " anywhere")),
      el("p", {}, "A ", el("a", { class: "ext", href: ITU.space, target: "_blank", rel: "noopener" }, "space"), " or ",
        el("a", { class: "ext", href: ITU.terrestrial, target: "_blank", rel: "noopener" }, "terrestrial"), " issue, ",
        el("a", { class: "ext", href: ITU.space, target: "_blank", rel: "noopener" }, "as the zip the ITU publishes"), ". It is processed on this computer.")),
    samples === null
      ? el("div", { class: "samples" }, [0, 1].map(() => el("div", { class: "sample" }, el("span", { class: "sk title" }), el("span", { class: "sk line", style: "width:120px;margin-top:8px" }))))
      : samples.length ? el("div", { class: "samples" },
        el("div", { class: "s-h" }, demo ? "Official samples" : "Or click a sample to try it"),
        samples.map((s) => el("button", { class: "sample", onclick: async () => { const id = await startSample(s.name); if (id) ctx.go(`/flow/${id}`); } },
          el("span", { class: "ic", html: icon(/^br/i.test(s.name) ? "tower-broadcast" : "satellite-dish") }),
          el("span", {}, el("b", {}, s.name), el("small", {}, `${/^br/i.test(s.name) ? "Terrestrial" : "Space"} · ${mb(s.bytes)}`))))) : null,
    scene);
  home.cleanup = () => { gone3d = true; stop3d?.(); };
  return home;
}

/* ---------- the flow: modules on the left, the picture on the right, driven by scrolling ---------- */
const BUILT = [
  { id: "file", label: "File", icon: "file-zipper" },
  { id: "tables", label: "Tables", icon: "database" },
  { id: "relevant", label: "Relevant tables", icon: "list-check" },
];
// Every stage after intake, by command name: its label and icon. Which ones a run shows comes from engines/chain.json.
const STAGES = {
  downlink: { label: "Downlink", icon: "satellite" }, reach: { label: "Reach", icon: "satellite-dish" },
  limit: { label: "Limit", icon: "scale-balanced" }, data: { label: "Data", icon: "list-check" }, power: { label: "Power", icon: "weight-hanging" },
  compare: { label: "Compare", icon: "scale-unbalanced" }, stations: { label: "Stations", icon: "tower-broadcast" },
  mobile: { label: "Land mobile", icon: "tower-broadcast" }, range: { label: "Range", icon: "route" }, tdata: { label: "Data", icon: "list-check" },
  field: { label: "Field strength", icon: "gauge-high" }, threshold: { label: "Threshold", icon: "scale-unbalanced" }, tstations: { label: "Stations", icon: "tower-broadcast" },
  ladder: { label: "Ladder", icon: "triangle-exclamation" }, report: { label: "Report", icon: "paper-plane" },
  tladder: { label: "Ladder", icon: "triangle-exclamation" }, treport: { label: "Report", icon: "paper-plane" },
};
// The whole path for each kind of filing, built or not, so the steps still to come can be listed.
const PATH = {
  space: ["Downlink", "Reach", "Limit", "Data", "Power", "Compare", "Stations", "Ladder", "Report"],
  terrestrial: ["Land mobile", "Range", "Data", "Field strength", "Threshold", "Stations", "Ladder", "Report"],
};
let CHAIN = { space: ["downlink", "reach"], terrestrial: [] };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// A rulebook source in a few words: the part before its colon, or the named source of an "As in …" pointer.
const citeShort = (t) => {
  const s = String(t), m = s.match(/^As in spec\/rulebook\/[\w.]+ \((.+)\)\.?$/);
  if (m) return m[1];
  const i = s.indexOf(":");
  return (i > 0 && i < 110 ? s.slice(0, i) : s.split(/\.\s/)[0]).replace(/\.$/, "").trim();
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// The line under the picture for each stage once it has a result, and while it is working.
const SAY = {
  downlink: (o) => `<b>${fmt(o.counts.kept)} of ${fmt(o.counts.notices)} filings</b> send signals down · ${fmt(o.counts.groups_kept)} transmitting groups go on`,
  reach: (o) => `<b>${fmt(o.counts.seen)} of ${fmt(o.counts.notices)} filings</b> can be seen from Finland · ${fmt(o.counts.clear)} are clear`,
};
Object.assign(SAY, {
  limit: (o) => `<b>${fmt(o.counts.limited)} of ${fmt(o.counts.notices)} filings</b> have an international power limit · ${fmt(o.counts.left)} have none`,
  data: (o) => `<b>${fmt(o.counts.complete)} of ${fmt(o.counts.notices)} filings</b> file everything the calculation needs · ${fmt(o.counts.left)} cannot be calculated`,
  power: (o) => `Worst-case power worked out for <b>${fmt(o.notices.filter((n) => n.eirp != null).length)} filings</b>, as if every antenna pointed straight at Finland`,
  compare: (o) => `<b>${fmt(o.counts.how?.over ?? 0)} over the limit</b> · ${fmt(o.counts.how?.near ?? 0)} within 3 dB · ${fmt(o.counts.how?.under ?? 0)} under`,
  stations: (o) => o.counts.how?.no_list ? "The list of Finnish stations is not on this computer" : `<b>${fmt(o.notices.filter((n) => n.stations?.length).length)} filings</b> work on the frequencies of ${fmt(o.counts.stations_hit ?? 0)} listed Finnish stations`,
});
Object.assign(SAY, {
  mobile: (o) => `<b>${fmt(o.counts.kept)} of ${fmt(o.counts.notices)} stations</b> are foreign land mobile stations`,
  range: (o) => `<b>${fmt(o.counts.kept)} of ${fmt(o.counts.notices)}</b> are close enough to matter: within 1,000 km of Finland`,
  tdata: (o) => `<b>${fmt(o.counts.kept)} of ${fmt(o.counts.notices)}</b> file power and antenna height`,
  field: (o) => `Signal strength worked out at Finland's border for <b>${fmt(o.counts.notices)} stations</b>`,
  threshold: (o) => `<b>${fmt(o.counts.how?.over ?? 0)} over the trigger level</b> · ${fmt(o.counts.how?.over_coordinated ?? 0)} over but already coordinated · ${fmt(o.counts.how?.near ?? 0)} near`,
  tstations: (o) => o.counts.how?.no_list ? "The list of Finnish stations is not on this computer" : `<b>${fmt(o.counts.how?.exposed ?? 0)} stations</b> are too strong at a listed Finnish station`,
  ladder: (o) => `<b>${fmt(o.counts.levels.crit)} ${o.counts.levels.crit === 1 ? "filing needs" : "filings need"} attention</b> · ${fmt(o.counts.levels.warn)} worth a look · ${fmt(o.counts.levels.none)} no concern`,
  report: (o) => `The notification lists <b>${fmt(o.counts.items)} filings</b> · every filing is in the CSV`,
  tladder: (o) => `<b>${fmt(o.counts.levels.crit)} ${o.counts.levels.crit === 1 ? "station needs" : "stations need"} attention</b> · ${fmt(o.counts.levels.warn)} worth a look · ${fmt(o.counts.levels.none)} no concern`,
  treport: (o) => `The notification lists <b>${fmt(o.counts.items)} stations</b> · every station is in the CSV`,
});
const WAIT = { mobile: "Finding the foreign land mobile stations…", range: "Measuring the distance to Finland…", tdata: "Checking power and antenna height…",
  field: "Working out the signal at Finland's border…", threshold: "Comparing with the trigger level…", tstations: "Working out the signal at Finnish stations…", downlink: "Finding the filings that send signals down…", reach: "Working out which satellites Finland can see…", limit: "Looking up the international limits…",
  data: "Checking what each filing files…", power: "Working out the power that could arrive…", compare: "Comparing with the limit at every angle…", stations: "Finding the Finnish stations on these frequencies…",
  ladder: "Placing each filing on the concern ladder…", report: "Writing the notification…", tladder: "Placing each station on the concern ladder…", treport: "Writing the notification…" };

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

  const agree = el("div", { class: "agree" });
  // The module names can fold away, leaving their icons, to give the picture more room. Names show by default.
  let compact = (() => { try { return localStorage.getItem("tosi.flowCompact") === "1"; } catch { return false; } })();
  const fold = el("button", { class: "fold", onclick: () => {
    compact = !compact;
    try { localStorage.setItem("tosi.flowCompact", compact ? "1" : "0"); } catch {}
    setFold(); requestAnimationFrame(() => { layout(); frame(); });
  } });
  function setFold() {
    page.classList.toggle("compact", compact);
    fold.innerHTML = icon(compact ? "angles-right" : "angles-left");
    fold.setAttribute("aria-label", compact ? "Show the module names" : "Hide the module names"); fold.title = fold.getAttribute("aria-label");
  }
  const diagram = el("nav", { class: "diagram", "aria-label": "Modules" });
  const stage = el("div", { class: "stage" });
  const msg = el("div", { class: "msg", "aria-live": "polite" });
  const scrolly = el("div", { class: "scrolly" }, el("div", { class: "sticky" }, stage, msg));
  // The last scene, the report, is not part of the sticky picture: once the ladder has been seen the page scrolls on
  // into the notification (the outliner, the table and the map), so it reads and scrolls like a document.
  const reportBox = el("section", { class: "rp", "aria-label": "Report" });
  const page = el("div", { class: "flow" },
    el("header", { class: "flow-h" }, el("h1", {}, el("span", { class: "t" }, "Flow"), fold), agree),
    el("div", { class: "flow-body" }, el("div", { class: "diagram-col" }, diagram), el("div", { class: "flow-main" }, scrolly, reportBox)));

  setFold();
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

  // Downlink: one dot per filing, out of the notice table. Those that send signals down stay; the rest step aside,
  // grouped by why. Leaving is not a concern, so the leavers are grey, not red.
  const SHORT = { not_satellite: "On the ground", nothing_filed: "Files nothing", receive_only: "Only receives" };
  let dl = null;
  const hasDownlink = () => current.result?.kind === "space" && current.result?.check?.status === "accepted";
  function buildDownlink() {
    const d = current.downlink;
    if (!d?.notices || dl) return;
    const order = Object.keys(DOWNLINK?.reasons ?? SHORT);
    const dots = d.notices.map((n) => {
      const e = el("i", { class: "ndot" + (n.kept ? " kept" : ""), "data-ntc": String(n.ntc_id) });
      stage.append(e);
      return { n, e };
    });
    const labels = order.filter((k) => d.counts.left[k]).map((k) => {
      const e = el("div", { class: "nleft" }, el("b", {}, SHORT[k] ?? k), el("span", {}, fmt(d.counts.left[k])));
      stage.append(e);
      return { k, e };
    });
    const keptLabel = el("div", { class: "nleft kept" }, el("b", {}, "Sends signals down"), el("span", {}, fmt(d.counts.kept)));
    stage.append(keptLabel);
    dl = { dots, labels, keptLabel, order };
    layoutDownlink();
  }
  function layoutDownlink() {
    if (!dl || !geo) return;
    const { W, H } = geo, top = Math.max(H * 0.3, 200), bottom = H * 0.9;
    const kept = dl.dots.filter((x) => x.n.kept), left = dl.dots.filter((x) => !x.n.kept);
    // the kept: a block on the left two thirds
    // dot size and spacing from how many filings there are (design tokens --dot-*, ui/public/dots.js)
    const bw = W * 0.56, bx = W * 0.06, pl = plan(kept.length, bw, bottom - top - 34), cols = pl.cols, step = pl.cell;
    stage.style.setProperty("--nd", `${pl.size}px`); dl.size = pl.size;
    kept.forEach((x, i) => { x.to = { x: bx + (i % cols) * step, y: top + 34 + Math.floor(i / cols) * step }; });
    dl.keptLabel.style.left = `${bx}px`; dl.keptLabel.style.top = `${top}px`;
    // the leavers: one small block per reason, stacked on the right
    const rx = W * 0.7, rcols = Math.max(4, Math.floor((W * 0.28) / step));
    let y = top;
    for (const L of dl.labels) {
      L.e.style.left = `${rx}px`; L.e.style.top = `${y}px`;
      const mine = left.filter((x) => x.n.reason === L.k);
      mine.forEach((x, i) => { x.to = { x: rx + (i % rcols) * step, y: y + 34 + Math.floor(i / rcols) * step }; });
      y += 34 + Math.ceil(mine.length / rcols) * step + 22;
    }
    const src = built?.tiles.find((t) => t.t.name === "notice")?.l;
    dl.from = src ? { x: src.x + src.w / 2, y: src.y + src.h / 2 } : { x: W / 2, y: H / 2 };
  }

  // Reach: the filings that went on regroup. Those Finland can see stay; the clear ones step aside, grey, by why.
  const RSHORT = { below_horizon: "Below Finland's horizon", too_far_south: "Never far enough north" };
  let rc = null;
  function buildReach() {
    const d = current.reach;
    if (!d?.notices || rc || !dl) return;
    const by = new Map(d.notices.map((n) => [n.ntc_id, n]));
    for (const x of dl.dots) x.r = by.get(x.n.ntc_id) ?? null;
    const clearKeys = Object.keys(REACH?.outcomes?.clear ?? RSHORT).filter((k) => d.counts.how[k]);
    const labels = clearKeys.map((k) => { const e = el("div", { class: "nleft" }, el("b", {}, RSHORT[k] ?? k), el("span", {}, fmt(d.counts.how[k]))); stage.append(e); return { k, e }; });
    const h = d.counts.how, parts = [[h.above_horizon, "fixed in the sky"], [h.reaches_north, "moving"], [h.beyond_earth, "beyond Earth"], [h.assumed, "orbit not filed"]].filter(([v]) => v);
    const seenLabel = el("div", { class: "nleft kept" }, el("b", {}, "Can be seen from Finland"), el("span", {}, fmt(d.counts.seen)));
    const sub = el("div", { class: "nsub" }, parts.map(([v, t]) => `${fmt(v)} ${t}`).join(" · "));
    stage.append(seenLabel, sub);
    // Two views of the same result: the sky above Finland (the default) and the grid. A toggle switches, smoothly.
    const globe = FINLAND ? makeGlobe(el, FINLAND) : null;
    if (globe) { stage.insertBefore(globe.svg, dl.dots[0]?.e ?? null); stage.append(globe.note, globe.legend); }
    const SKY = '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="6.3"/><ellipse cx="8" cy="8" rx="2.8" ry="6.3"/><path d="M1.9 8h12.2"/></svg>';
    const GRID = '<svg viewBox="0 0 16 16" width="15" height="15" fill="currentColor">' + [3, 8, 13].flatMap((y) => [3, 8, 13].map((x) => `<circle cx="${x}" cy="${y}" r="1.6"/>`)).join("") + "</svg>";
    const bSky = el("button", { "aria-label": "Show in the sky above Finland", title: "In the sky", html: SKY, onclick: () => setView("globe") });
    const bGrid = el("button", { "aria-label": "Show as a grid", title: "As a grid", html: GRID, onclick: () => setView("grid") });
    const toggle = el("div", { class: "rview", role: "group", "aria-label": "View" }, bSky, bGrid);
    stage.append(toggle);
    rc = { labels, seenLabel, sub, globe, toggle, bSky, bGrid };
    if (!globe) view = "grid";
    viewT = view === "globe" ? 1 : 0;
    // Drag the picture to turn it around Finland or tilt it; double-click to go back to the starting view.
    if (globe) {
      let drag = null;
      const at = (ev) => { const b = stage.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
      stage.addEventListener("pointerdown", (ev) => {
        const p = at(ev);
        if (phase !== 4 || view !== "globe" || ev.button !== 0 || ev.target.closest(".ndot, .rview") || !globe.over(p.x, p.y)) return;
        drag = { ...p, id: ev.pointerId, moved: false };
        stage.setPointerCapture(ev.pointerId); stage.classList.add("turning");
      });
      stage.addEventListener("pointermove", (ev) => {
        if (!drag || ev.pointerId !== drag.id) return;
        const p = at(ev), dx = p.x - drag.x, dy = p.y - drag.y;
        if (!drag.moved && Math.hypot(dx, dy) < 3) return;
        drag.moved = true; drag.x = p.x; drag.y = p.y;
        globe.turn(-dx * 0.4, -dy * 0.3); placeInSky(); frame();
      });
      const end = (ev) => { if (!drag || ev.pointerId !== drag.id) return; drag = null; stage.classList.remove("turning"); };
      stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
      stage.addEventListener("dblclick", (ev) => { const p = at(ev); if (phase === 4 && view === "globe" && globe.over(p.x, p.y) && !ev.target.closest(".ndot, .rview")) { globe.reset(); placeInSky(); frame(); } });
    }
    layoutReach();
  }
  let view = (() => { try { return localStorage.getItem("tosi.reachView") || "globe"; } catch { return "globe"; } })(), viewT = 1, viewRaf = 0, dark = true;
  function setView(v) {
    if (v === "globe" && !rc?.globe) return;
    view = v;
    try { localStorage.setItem("tosi.reachView", v); } catch {}
    cancelAnimationFrame(viewRaf);
    const from = viewT, to = v === "globe" ? 1 : 0, t0 = performance.now();
    const step = (now) => { const k = clamp((now - t0) / 700); viewT = from + (to - from) * ease(k); frame(); if (k < 1) viewRaf = requestAnimationFrame(step); };
    viewRaf = requestAnimationFrame(step);
  }
  function layoutReach() {
    if (!rc || !geo) return;
    const { W, H } = geo, top = Math.max(H * 0.3, 200), bottom = H * 0.9;
    const seen = dl.dots.filter((x) => x.r?.seen), clear = dl.dots.filter((x) => x.r && !x.r.seen);
    const bw = W * 0.56, bx = W * 0.06, pl = plan(seen.length, bw, bottom - top - 54), cols = pl.cols, step = pl.cell;
    seen.forEach((x, i) => { x.rt = { x: bx + (i % cols) * step, y: top + 54 + Math.floor(i / cols) * step }; });
    rc.seenLabel.style.left = `${bx}px`; rc.seenLabel.style.top = `${top}px`;
    rc.sub.style.left = `${bx}px`; rc.sub.style.top = `${top + 24}px`;
    const rx = W * 0.7, rcols = Math.max(4, Math.floor((W * 0.28) / step));
    let y = top;
    for (const L of rc.labels) {
      L.e.style.left = `${rx}px`; L.e.style.top = `${y}px`;
      const mine = clear.filter((x) => x.r.how === L.k);
      mine.forEach((x, i) => { x.rt = { x: rx + (i % rcols) * step, y: y + 34 + Math.floor(i / rcols) * step }; });
      y += 34 + Math.ceil(mine.length / rcols) * step + 22;
    }
    // In the sky: each satellite Finland can see, where you would look to find it.
    rc.toggle.style.left = `${W * 0.64 - 70}px`; rc.toggle.style.top = `${top - 14}px`;
    if (!rc.globe) return;
    rc.globe.layout({ x0: W * 0.05, x1: W * 0.64, y0: top + 104, y1: H * 0.93 });
    placeInSky();
    const bg = getComputedStyle(document.body).backgroundColor.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
    dark = (bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11) < 128;
    rc.globe.legend.classList.toggle("dark", dark);
  }
  function placeInSky() {
    if (!rc?.globe) return;
    for (const x of dl.dots.filter((d) => d.r?.seen)) { const at = skyAt(x.r); x.gt = rc.globe.place(at.az, at.el, dl.size ?? 12); }
    if (geo) for (const id in later) later[id].layout(geo);       // beams and ground stations follow the turned sky
  }

  // Where in Finland's sky a filing Finland can see is drawn (az, el in degrees), from its Reach result. Display only.
  function skyAt(r) {
    const f = FILINGS?.[r.ntc_id];
    return r.how === "above_horizon" ? (() => { const q = gsoSky(r.longitude); return { az: q.az, el: Math.max(2, q.el) }; })()
      : r.how === "beyond_earth" ? { az: 180 + (spread(r.ntc_id) - 0.5) * 140, el: 12 + 30 * spread(r.ntc_id, 2) }
      : r.how === "assumed" && r.type === "G" ? { az: 180 + (spread(r.ntc_id) - 0.5) * 90, el: 10 }
      : ngsoSky(r.ntc_id, f?.tilt ?? null, f?.apogee ?? null);
  }

  // The space scenes after Reach (ui/public/scenes/space.js), built as each stage's result arrives.
  const later = {};
  let STATIONS = null;
  const laterIds = () => { const x = extras(), i = x.indexOf("reach"); return i < 0 ? [] : x.slice(i + 1).filter((id) => SPACE_SCENES[id]); };
  function buildLater() {
    if (!rc || !dl) return;
    if (STATIONS === null && current.out?.stations) { STATIONS = []; fetch("/api/stations").then((x) => x.json()).then((d) => { STATIONS = d.stations; later.stations?.layout(geo); frame(); }).catch(() => {}); }
    for (const id of laterIds()) {
      if (later[id] || !current.out?.[id]) continue;
      later[id] = SPACE_SCENES[id]({ el, stage, dots: dl.dots, out: current.out, fmt, size: () => dl.size ?? 12, finland: FINLAND, globe: rc.globe, rulebooks: RB, guide: GUIDE, get stations() { return STATIONS; } });
      if (geo) later[id].layout(geo);
    }
  }

  // Terrestrial: one map for all its scenes (ui/public/scenes/terra.js), built once Land mobile has a result.
  let terra = null;
  const TERRA = ["mobile", "range", "tdata", "field", "threshold", "tstations", "tladder"];
  function buildTerra() {
    if (terra && current.out?.tladder && !terra.hasLadder) { terra.addLadder(current.out); if (geo) layout(); }
    if (terra || current.result?.kind !== "terrestrial" || !current.out?.mobile) return;
    if (STATIONS === null) { STATIONS = []; fetch("/api/stations").then((x) => x.json()).then((d) => { STATIONS = d.stations; frame(); report?.layout(); }).catch(() => {}); }
    terra = makeTerra({ el, stage, out: current.out, fmt, region: REGION, rulebooks: RB, guide: GUIDE, get stations() { return STATIONS; } });
    if (geo) layout();
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
    layoutDownlink();
    layoutReach();
    for (const id in later) later[id].layout(geo);
    if (terra) { const src = built?.tiles.find((t) => t.t.name === "fxm_terra")?.l; terra.layout(geo, src ? { x: src.x + src.w / 2, y: src.y + src.h / 2 } : null); }
  }

  function progress() {
    const r = scrolly.getBoundingClientRect();
    return clamp(-r.top / Math.max(1, r.height - innerHeight));
  }

  // An accepted space filing has two more scenes, Downlink and Reach: the first three take the first 60% of the scroll.
  // Scenes after intake share the scroll after the first three: each gets an equal window, entered over most of it.
  const extras = () => current.result?.check?.status === "accepted" ? CHAIN[current.result.kind] ?? [] : [];
  const FINAL = new Set(["report", "treport"]);            // shown in the page below the scroll story, not in the picture
  const scened = () => extras().filter((id) => !FINAL.has(id));
  const SPAN = () => 1 / (1 + scened().length / 3);
  const win = (i) => { const n = scened().length, w = (1 - SPAN()) / Math.max(1, n); return { start: SPAN() + i * w, w }; };
  const tScene = (P, id) => { const i = scened().indexOf(id); if (i < 0) return 0; const { start, w } = win(i); return ease(clamp((P - start - 0.1 * w) / (0.7 * w))); };
  function frame() {
    scrolly.style.height = scened().length ? `${300 + 120 * scened().length}vh` : "";
    const P = progress(), p = P / SPAN(), W = geo?.W ?? stage.clientWidth, H = geo?.H ?? stage.clientHeight;
    const tD = tScene(P, "downlink");
    const tR = tScene(P, "reach");
    const lids = laterIds(), tL = Object.fromEntries(lids.map((id) => [id, later[id] ? tScene(P, id) : 0]));
    const afterReach = 1 - clamp((tL[lids[0]] ?? 0) * 3);         // Reach's labels and picture give way to the next scene
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
        const tF = tScene(P, extras()[0]), src = current.result?.kind === "terrestrial" ? "fxm_terra" : "notice";
        const op = (x.absent ? tC : x.rel ? d : d * (1 - tC)) * (1 - (x.t.name === src ? clamp(tF * 1.4 - 0.4) : tF));
        s.opacity = String(op); s.pointerEvents = op > 0.3 ? "" : "none";   // a faded tile must not catch the pointer
        x.e.classList.toggle("lit", x.rel && tC > 0.5);
        x.e.classList.toggle("named", b.w > 64 && b.h > 16);
      });
      built.info.forEach((inf) => { inf.e.style.opacity = String(clamp((tC - 0.6) / 0.4) * (1 - tScene(P, extras()[0]))); });
    }
    if (dl) {
      const n = dl.dots.length;
      dl.dots.forEach((x, i) => {
        const d = clamp(tD * 1.6 - (i / n) * 0.6);       // the dots leave the notice table one after another
        let b = x.to ? { x: lerp(dl.from.x, x.to.x, d), y: lerp(dl.from.y, x.to.y, d) } : dl.from;
        if (rc && x.rt) {
          const t = x.gt ? { x: lerp(x.rt.x, x.gt.x, ease(viewT)), y: lerp(x.rt.y, x.gt.y, ease(viewT)) } : x.rt;
          b = { x: lerp(b.x, t.x, tR), y: lerp(b.y, t.y, tR) };
        }
        // In the sky, a moving satellite is pink: paler for a gentle orbit tilt, deeper for a steep one.
        const sky = rc && x.gt && tR > 0.5 && viewT > 0.5;
        const skyColour = !sky ? "" : x.r.how === "beyond_earth" ? farBlue(dark) : x.r.type === "N" ? tiltPink(FILINGS?.[x.n.ntc_id]?.tilt, dark) : "";
        x.e.style.background = skyColour;
        // the scenes after Reach: a dot moves to its place in each; one that has no place there fades as it begins
        let gone = 0, back = 0, paint;
        for (const id of lids) {
          const t = tL[id]; if (!t || (!x.r && !later[id].all)) continue;
          const at = x.at?.[id], sk = x.sky?.[id];
          const to = at && sk ? { x: lerp(at.x, sk.x, ease(viewT)), y: lerp(at.y, sk.y, ease(viewT)) } : at ?? sk;
          if (to) { b = { x: lerp(b.x, to.x, t), y: lerp(b.y, to.y, t) }; if (t > 0.5) paint = later[id].colour(x) ?? undefined; if (later[id].all) back = Math.max(back, t); }
          else if (!x.unknown) gone = Math.max(gone, t);            // a satellite that cannot be calculated stays in view
        }
        if (lids.some((id) => tL[id] > 0.5)) x.e.style.background = paint ?? skyColour;   // a concern colour wins; else the sky's own
        x.e.classList.toggle("unknown", !!x.unknown && (tL.data ?? 0) > 0.5);
        x.e.style.transform = `translate(${b.x}px, ${b.y}px)`;
        // in the sky, a satellite on the far side of the dome is fainter, so the dome reads as round
        const op = clamp(d * 3) * (rc && !x.n.kept ? 1 - tR * (1 - back) : 1) * (rc && x.gt?.far ? 1 - 0.45 * tR * viewT * afterReach : 1) * (1 - gone * (1 - back));
        x.e.style.opacity = String(op); x.e.style.pointerEvents = op > 0.3 ? "" : "none";
        x.e.classList.toggle("kept", x.n.kept && !(rc && tR > 0.5 && x.r && !x.r.seen));
      });
      const lo = clamp((tD - 0.75) / 0.25) * (rc ? 1 - clamp(tR * 3) : 1);
      dl.labels.forEach((L) => { L.e.style.opacity = String(lo); }); dl.keptLabel.style.opacity = String(lo);
    }
    if (rc) {
      const ro = clamp((tR - 0.75) / 0.25) * afterReach;
      rc.labels.forEach((L) => { L.e.style.opacity = String(ro); }); rc.seenLabel.style.opacity = String(ro); rc.sub.style.opacity = String(ro);
      const tAll = Math.max(0, ...lids.filter((id) => later[id]?.all).map((id) => tL[id]));   // the ladder takes the whole picture
      rc.globe?.show(clamp((tR - 0.35) / 0.65) * viewT * (1 - tAll), clamp((tR - 0.35) / 0.65) * viewT * afterReach);   // the sky stays; its note is Reach's own
      const to = clamp((tR - 0.75) / 0.25) * (1 - clamp(tAll * 2));
      rc.toggle.style.opacity = String(to); rc.toggle.style.pointerEvents = to > 0.3 ? "" : "none";
      rc.bSky.classList.toggle("on", view === "globe"); rc.bGrid.classList.toggle("on", view === "grid");
    }
    if (terra) { const tt = Object.fromEntries(TERRA.map((id) => [id, current.out?.[id] ? tScene(P, id) : 0])); terra.frame(tt, tt.mobile, 1); }
    lids.forEach((id, i) => { const sc = later[id]; if (sc) sc.frame(tL[id], 1 - clamp((tL[lids[i + 1]] ?? 0) * 3), ease(viewT)); });
    let ph = p < 0.33 ? 0 : p < 0.7 ? 1 : 2;
    scened().forEach((_, i) => { if (P >= win(i).start + 0.2 * win(i).w) ph = 3 + i; });
    const fin = extras().find((id) => FINAL.has(id));
    if (fin && reportBox.getBoundingClientRect().top < innerHeight * 0.55) ph = 3 + extras().indexOf(fin);
    if (ph !== phase) { phase = ph; say(); light(); if (terra && ph >= 3) terra.words(extras()[ph - 3]); }
  }

  function say() {
    const r = current.result, f = current.file;
    const lines = [
      `<b>${f.name}</b> · ${mb(f.bytes)}${r ? "" : " · reading…"}`,
      r?.database ? `<b>${fmt(r.database.tables.length)} tables</b> inside · ${fmt(r.database.rows)} rows` : r ? "No tables could be read" : "Reading the tables…",
      r?.database ? (r.check.status === "accepted" ? `The rules read <b>${built?.relevant.length ?? 0} of them</b>` + ` · ${KIND_LABEL[r.kind] ?? ""}` : `<b>Refused</b> · ${r.check.reason}`) : r ? `<b>Refused</b> · ${r.check.reason}` : "Picking the tables the rules read…",
    ];
    for (const id of extras()) { const o = current.out?.[id]; lines.push(o && SAY[id] ? SAY[id](o) : WAIT[id] ?? `Working on ${STAGES[id]?.label ?? id}…`); }
    let html = lines[Math.max(0, phase)] ?? lines[lines.length - 1];
    // a bare pointer to another rulebook ("As in spec/rulebook/…: …") names no source of its own: leave it out
    const sid = extras()[phase - 3], cites = sid ? Object.values(current.out?.[sid]?.rulebook?.cites ?? {}).filter((c) => !/^As in spec\/rulebook\/[\w.]+:/.test(String(c))) : [];
    html = `<span class="say">${html}</span>`;
    if (cites.length) html += `<small class="cite" title="${esc(cites.join("\n\n"))}">Based on ${[...new Set(cites.map(citeShort))].map(esc).join(" · ")}</small>`;
    if (msg.dataset.html === html) return;              // only animate when the message really changes
    msg.dataset.html = html;
    msg.classList.remove("in"); void msg.offsetWidth;
    msg.innerHTML = `<span>${html}</span>`; msg.classList.add("in");
  }

  function light() {
    const kind = current.result?.kind;
    // the steps still to come: the whole path for this kind, after the ones this run shows
    const next = PATH[kind]?.slice(extras().length);
    diagram.replaceChildren(
      ...[...BUILT, ...extras().map((id) => ({ id, ...STAGES[id] }))].map((m, i) => el("button", { class: "node" + (i === phase ? " on" : "") + (i < phase ? " past" : ""), onclick: () => jumpTo(i) },
        el("span", { class: "ic", html: icon(m.icon) }), el("span", { class: "label" }, m.label))),
      // "Next" only while steps remain: a refused file, a path still to build, or a result not in yet
      ...(next && !next.length && current.result?.check.status === "accepted" ? [] : [el("div", { class: "next-h" }, "Next")]),
      ...(current.result && current.result.check.status !== "accepted" ? [el("div", { class: "node later stop" }, el("span", { class: "ic", html: icon("circle-xmark") }), el("span", { class: "label" }, "Stops here: the file was turned away"))]
        : next ? next.map((n) => el("div", { class: "node later" }, el("span", { class: "ic" }, el("i", { class: "pip" })), el("span", { class: "label" }, n)))
        : [0, 1, 2, 3].map(() => el("div", { class: "node later" }, el("span", { class: "ic" }, el("i", { class: "sk dot" })), el("span", { class: "sk line", style: "width:80px" })))));
  }
  function jumpTo(i) {
    if (i >= 3 && FINAL.has(extras()[i - 3])) {
      const head = parseFloat(getComputedStyle(page).getPropertyValue("--flowhead")) || 90;
      // the report's own heading just under the page's header; the story's last line slips behind the header
      return scrollTo({ top: scrollY + reportBox.getBoundingClientRect().top + (parseFloat(getComputedStyle(reportBox).paddingTop) || 0) - head - 4, behavior: "smooth" });
    }
    const r = scrolly.getBoundingClientRect(), span = r.height - innerHeight;
    const at = i >= 3 ? Math.min(0.99, win(scened().indexOf(extras()[i - 3])).start + 0.9 * win(scened().indexOf(extras()[i - 3])).w) : [0.08, 0.48, 0.94][i] * SPAN();
    scrollTo({ top: scrollY + r.top + span * at, behavior: "smooth" });
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
  const onResize = () => { layout(); frame(); report?.layout(); };
  addEventListener("scroll", onScroll, { passive: true });
  addEventListener("resize", onResize);
  page.cleanup = () => { report?.cleanup(); removeEventListener("scroll", onScroll); removeEventListener("resize", onResize); for (const t of ["wheel", "touchmove", "keydown"]) removeEventListener(t, stopFollow); clearTimeout(polling); clearInterval(clock); };

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
  const TYPE = { G: "Satellite fixed in the sky", N: "Satellite moving across the sky", S: "Station on the ground" };
  // What each filing is, read once per run from the server (display only).
  let FILINGS = null, filingsFor = null;
  function loadFilings() {
    if (!current.downlink || filingsFor === current.id) return;
    filingsFor = current.id;
    fetch(`/api/runs/${current.id}/filings`).then((x) => x.ok ? x.json() : null).then((f) => { FILINGS = f; layoutReach(); frame(); report?.layout(); }).catch(() => {});
  }
  function describeNotice(id) {
    const n = current.downlink?.notices.find((x) => String(x.ntc_id) === id);
    if (!n) return [];
    const f = FILINGS?.[id];
    const who = f ? ["Filed by", f.country, f.with.length ? `with ${f.with.join(", ")}` : null, f.org ? `for ${f.org}` : null].filter(Boolean).join(" ") : null;
    const kv = f ? [["Where", f.where], ["Sends", f.sends], ["Listens", f.listens], ["Filing", f.stage], ["Received", f.received]].filter(([, v]) => v) : [];
    return [el("div", { class: "tt-h" }, el("b", {}, f?.name ?? `Filing ${n.ntc_id}`), el("code", {}, String(n.ntc_id))),
      el("div", { class: "tt-s" }, [who, f?.where ? null : TYPE[n.type] ?? `Station type ${n.type}`].filter(Boolean).join(" · ")),
      kv.length ? el("dl", { class: "tt-kv" }, ...kv.flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, v)])) : null,
      el("div", { class: "tt-s" }, `${fmt(n.transmit)} transmitting, ${fmt(n.receive)} receiving groups`),
      f?.note ? el("div", { class: "tt-n" }, `“${f.note.length > 160 ? f.note.slice(0, 157) + "…" : f.note}”`) : null,
      el("div", { class: n.kept ? "tt-r" : "tt-a" }, n.kept ? "Goes on: it sends signals down." : DOWNLINK?.reasons?.[n.reason] ?? n.reason),
      ...describeReach(n.ntc_id),
      ...laterIds().filter((id, i) => later[id] && phase >= 3 + extras().indexOf(id)).map((id) => { const t = later[id].describe(n.ntc_id); return t ? el("div", { class: "tt-s" }, t) : null; })].filter(Boolean);
  }
  // Reach, once it has run: whether Finland can see it, why, and the number behind it.
  function describeReach(ntc) {
    const r = phase >= 4 ? current.reach?.notices.find((x) => x.ntc_id === ntc) : null;
    if (!r) return [];
    const words = (REACH?.outcomes?.[r.seen ? "seen" : "clear"]?.[r.how] ?? r.how).replaceAll("{body}", REACH?.bodies?.[r.body] ?? r.body ?? "");
    const deg = (v) => `${v.toLocaleString("en-GB", { maximumFractionDigits: 2 })}°`;
    const south = deg(REACH?.finland?.south ?? 59.3);
    const num = r.elevation != null ? `Highest in Finland's sky: ${deg(Math.abs(r.elevation))} ${r.elevation >= 0 ? "above" : "below"} the horizon`
      : r.north != null ? (r.north >= 90 ? "Can see the ground all the way to the North Pole" : `Can see the ground as far north as ${deg(r.north)} N; Finland starts at ${south} N`) : null;
    return [el("div", { class: r.seen ? "tt-r" : "tt-a" }, words), num ? el("div", { class: "tt-s" }, num) : null];
  }
  const showTip = (ev, lines) => {
    tip.replaceChildren(...lines); tip.hidden = false;
    const r = stage.getBoundingClientRect();
    tip.style.left = `${clamp(ev.clientX - r.left + 14, 4, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${clamp(ev.clientY - r.top + 14, 4, r.height - tip.offsetHeight - 4)}px`;
  };
  stage.addEventListener("pointermove", (ev) => {
    const nd = ev.target.closest(".ndot");
    const sceneNow = extras()[phase - 3];
    // Stations: hover a satellite to draw its stations; hover a station on the ground to see what reaches it and why
    if (sceneNow === "stations" && later.stations) {
      later.stations.highlight(nd ? Number(nd.dataset.ntc) : null);
      if (!nd) { const r = stage.getBoundingClientRect(); const lines = later.stations.hoverAt(ev.clientX - r.left, ev.clientY - r.top, el, (id) => FILINGS?.[id]?.name ?? `Filing ${id}`); if (lines) return showTip(ev, lines); }
    }
    if (terra && phase >= 3 && !nd) { const r = stage.getBoundingClientRect(); const lines = terra.hover(ev.clientX - r.left, ev.clientY - r.top); if (lines) { frame(); return showTip(ev, lines); } }
    if (nd && Number(nd.style.opacity) > 0.3) {
      tip.replaceChildren(...describeNotice(nd.dataset.ntc)); tip.hidden = false;
      const r = stage.getBoundingClientRect();
      tip.style.left = `${clamp(ev.clientX - r.left + 14, 4, r.width - tip.offsetWidth - 4)}px`;
      tip.style.top = `${clamp(ev.clientY - r.top + 14, 4, r.height - tip.offsetHeight - 4)}px`;
      return;
    }
    const t = ev.target.closest(".tile");
    if (!t || Number(t.style.opacity) < 0.3) { tip.hidden = true; return; }
    tip.replaceChildren(...describe(t.dataset.name, false).filter(Boolean)); tip.hidden = false;
    const r = stage.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${clamp(ev.clientX - r.left + 14, 4, r.width - w - 4)}px`;
    tip.style.top = `${clamp(ev.clientY - r.top + 14, 4, r.height - h - 4)}px`;
  });
  stage.addEventListener("pointerleave", () => { tip.hidden = true; });
  stage.addEventListener("click", (ev) => {
    const nd = ev.target.closest(".ndot");
    if (nd && Number(nd.style.opacity) > 0.3) {
      tip.hidden = true;
      pin.replaceChildren(...describeNotice(nd.dataset.ntc), el("button", { class: "tp-x", "aria-label": "Close", html: icon("circle-xmark"), onclick: (e) => { e.stopPropagation(); pin.hidden = true; } }));
      pin.hidden = false; return;
    }
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
    const done = (CHAIN[d.result?.kind] ?? []).filter((id) => d.out?.[id]).length;
    if (done) return 2 + done;
    if (d.result || ev.some((x) => x.step === "check" && x.state === "done")) return 2;
    if (ev.some((x) => x.step === "database" && (x.state === "progress" || x.state === "done"))) return 1;
    return 0;
  }
  let report = null;
  function buildReport() {
    const kind = current.result?.kind, id = kind === "terrestrial" ? "treport" : "report";
    if (current.result && (current.result.check?.status !== "accepted" || !extras().includes(id))) { reportBox.hidden = true; return; }
    reportBox.hidden = false;
    if (!report) {
      report = makeReport({ el, box: reportBox, fmt, kind: kind ?? "space", runId: () => current.id, guide: () => GUIDE, rulebooks: RB,
        finland: FINLAND, region: REGION, skyAt: (r) => skyAt(r), get stations() { return STATIONS; }, get filings() { return FILINGS; } });
    }
    report.update(current);
  }
  function update(d) {
    current = d;
    drawCard(); drawAgree();
    if (!built) build();
    if (!dl) buildDownlink();
    if (!rc) buildReach();
    buildLater();
    buildTerra();
    buildReport();
    loadFilings();
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
