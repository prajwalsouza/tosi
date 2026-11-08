// The demo run: a replay of a recorded session in which an AI agent (Codex CLI) used Tosi's MCP server in test-run mode
// to propose versioned changes to the algorithm's parameters. Nothing here is live and nothing is saved: the recording
// (ui/demo/codex-demo.json, served at /api/demo/codex) is replayed with its own pacing, the page follows the agent to what
// it reads and changes (Algorithm or Guidebook), each proposal waits for a person to approve or decline it, and approving
// moves the page to the next version in memory only. Reset restores the real state. No result is computed here.
import { icon } from "./icons.js";

/* ---------- what the Algorithm and Guidebook pages read ---------- */
// Which rulebook (spec/rulebook/<stage>.json) belongs to which step.
export const STAGE_OF_STEP = { s1: "downlink", s2: "reach", s3: "limit", s4: "data", s5: "power", s6: "compare", s7: "stations",
  t1: "mobile", t2: "range", t3: "tdata", t4: "field", t5: "threshold", t6: "tstations" };
const STEP_NAME = { downlink: "Downlink", reach: "Reach", limit: "Limit", data: "Data", power: "Power", compare: "Compare", stations: "Stations",
  mobile: "Land mobile", range: "Range", tdata: "Data", field: "Field strength", threshold: "Threshold", tstations: "Stations" };
const LABELS = {
  near_db: "Near-miss margin", reference_khz: "Reference bandwidth", samples: "Path samples, land or sea", spread_km: "Border search window",
  nearest_points: "Nearest border points", stride: "Every nth border point", min_km: "Shortest path", time_percent: "Time exceeded",
  locations_percent: "Locations", receiver_height_m: "Receiver height", earth_radius_km: "Earth radius", geostationary_radius_km: "Geostationary radius",
  max_km: "Longest path", f_min_mhz: "Lowest frequency", f_max_mhz: "Highest frequency", mobile_default_m: "Mobile height when none is filed",
  eirp_to_erp_db: "EIRP to ERP", horizon_deg: "Horizon", ngso_angle_step_deg: "Angle step, moving satellites", mhz_to_hz: "MHz to Hz",
  same_frequency_mhz: "Same-frequency tolerance", near_frequency_min_mhz: "Near-frequency window", stations_listed: "Stations listed", uses_listed: "Uses listed",
};
const UNITS = [["_db", "dB"], ["_khz", "kHz"], ["_mhz", "MHz"], ["_km", "km"], ["_m", "m"], ["_deg", "°"], ["_percent", "%"]];
export const paramLabel = (k) => LABELS[k] ?? k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
export function paramValue(k, v) {
  const u = UNITS.find(([s]) => k.endsWith(s))?.[1];
  const n = Number(v).toLocaleString("en-GB", { maximumFractionDigits: 6 });
  return u ? (u === "°" || u === "%" ? `${n}${u}` : `${n} ${u}`) : n;
}

// The demo's state, in memory only. version 1 is the rulebook as saved; each approval is the next version.
// target: what the agent is looking at now ({page, kind, steps | step, stage, parameter | entries}), for the pages to show.
export const demo = { active: false, running: false, finished: false, version: 1, values: {}, stageVersion: {}, pending: null, decided: [], target: null, seq: 0 };
const subs = new Set();
export function onDemo(fn) { subs.add(fn); return () => subs.delete(fn); }
const emit = (why) => { for (const f of [...subs]) { try { f(why); } catch (e) { console.error(e); } } };

/* ---------- following the agent across the two pages ---------- */
const pageOf = () => (location.hash.match(/^#\/(algorithm|guidebook)(\/|$)/) ?? [])[1] ?? null;
const PAGE_NAME = { algorithm: "Algorithm", guidebook: "Guidebook" };
let follow = true, readyWait = null;
// Each page says when it has drawn its data, so a switch can wait for it before showing the target.
export function ready(page) { if (readyWait?.page === page) { readyWait.done(); readyWait = null; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function show(t, auto) {
  demo.target = { ...t, seq: ++demo.seq };
  if (pageOf() !== t.page) {
    const w = new Promise((done) => { readyWait = { page: t.page, done }; });
    location.hash = `#/${t.page}`;
    await Promise.race([w, sleep(2500)]);
  } else emit("target");
  if (auto) await sleep(t.dwell ?? 900);
}
// From a card, a badge or a line in the chat: go there now, whether following or not.
export function locate(t) { if (t) show(t, false); }

/* ---------- the replay ---------- */
let ctx = null, data = null, saved = {}, idx = 0, timer = null, log = [], panelOpen = false, aboutOpen = false;
let dock, panel, logEl, fade;
const SPEED = 1.5, MIN_GAP = 300, MAX_GAP = 2600;
const pace = (gap) => Math.min(Math.max(gap / SPEED, MIN_GAP), MAX_GAP);

const ICON = { think: "brain", read: "eye", book: "book", propose: "pen", check: "check", page: "location-crosshairs", change: "wand-magic-sparkles", decline: "xmark", agent: "robot" };
function toolLabel(tool, a) {
  if (tool === "tosi_get_algorithm") return [ICON.read, a.kind ? `Read the ${a.kind} algorithm` : "Read the algorithm"];
  if (tool === "tosi_get_parameters") return [ICON.read, a.stage ? `Read the ${STEP_NAME[a.stage] ?? a.stage} step` : "Read every step's parameters"];
  if (tool === "tosi_get_guidebook") return [ICON.book, a.id ? `Read guidebook entry ${a.id}` : "Read the guidebook"];
  if (tool === "tosi_get_rulebook") return [ICON.read, "Read what intake reads"];
  if (tool === "tosi_status") return [ICON.read, "Checked Tosi's status"];
  if (tool === "tosi_list_proposals") return [ICON.read, "Listed proposals"];
  if (tool === "tosi_propose_parameter") return [ICON.propose, `Proposed a change to ${STEP_NAME[a.stage] ?? a.stage}`];
  return [ICON.propose, tool];
}
const onPage = () => pageOf() !== null;

export function init(c) {
  ctx = c;
  const { el } = ctx;
  fade = el("div", { class: "dm-fade", "aria-hidden": "true" });
  dock = el("div", { class: "dm-dock", role: "region", "aria-label": "Demo run" });
  logEl = el("div", { class: "dm-log", "aria-live": "polite" });
  panel = el("aside", { class: "dm-panel", hidden: true, "aria-label": "Demo run: recorded Codex session" });
  document.body.append(fade, dock, panel);
  addEventListener("hashchange", place);
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) toggle(false);
    if (["PageDown", "PageUp", "ArrowDown", "ArrowUp", "Home", "End", " "].includes(e.key) && !e.target.closest?.("input, textarea, .dm-panel")) userScrolled();
  });
  // Scrolling the page by hand during the replay pauses following; the Follow toggle resumes it.
  for (const ev of ["wheel", "touchmove"]) addEventListener(ev, (e) => { if (!e.target.closest?.(".dm-panel, .dm-dock")) userScrolled(); }, { passive: true });
  place();
  drawDock();
}
function userScrolled() { if (demo.running && follow) { follow = false; drawDock(); drawPanel(); } }
function setFollow(v) { follow = v; drawDock(); drawPanel(); if (v && demo.target) show(demo.target, false); }

function place() {
  const on = onPage();
  document.body.classList.toggle("dm-page", on);
  document.body.classList.toggle("dm-open", on && panelOpen);
  panel.hidden = !(on && panelOpen);
}

export function toggle(v = !panelOpen) {
  panelOpen = v;
  document.getElementById("ask")?.classList.toggle("on", v);
  if (v) drawPanel();
  place();
  if (v && !demo.active) dock.querySelector("textarea")?.focus();
}

async function load() {
  if (data) return data;
  const r = await fetch("/api/demo/codex");
  if (!r.ok) throw new Error("No recorded demo on this server.");
  data = await r.json();
  // The agent's last message is its answer; the ones before it are its working notes, shown as Thinking.
  const msgs = data.steps.filter((s) => s.kind === "message");
  msgs.forEach((m, i) => { m.final = i === msgs.length - 1; });
  return data;
}

// The values as saved, for the stages the recording changes, so "from" is always what the page shows now.
async function loadSaved() {
  const stages = [...new Set(data.steps.filter((s) => s.proposal).map((s) => s.proposal.stage))];
  const got = await Promise.all(stages.map((st) => fetch(`/api/rulebook/${st}`).then((r) => r.json()).catch(() => null)));
  saved = Object.fromEntries(stages.map((st, i) => [st, got[i]]));
}

async function start() {
  if (demo.running) return;
  try { await load(); } catch (e) { ctx.toast(e.message); return; }
  reset(true);
  Object.assign(demo, { active: true, running: true });
  follow = true;
  log.push({ kind: "you", text: data.prompt });
  toggle(true);
  drawDock(); drawLog(); emit("start");
  await loadSaved();
  if (demo.running) next();
}

let run = 0;   // bumps on reset, so a replay in flight stops
function next() {
  clearTimeout(timer);
  if (!demo.running || demo.pending) return;
  if (idx >= data.steps.length) return finish();
  const s = data.steps[idx], gap = s.t - (idx ? data.steps[idx - 1].t : 0), my = run;
  timer = setTimeout(async () => { idx++; await play(s); if (my === run) next(); }, idx ? pace(gap) : 500);
}

let lastShown = "";
async function play(s) {
  const my = run;
  if (s.kind === "message" || s.kind === "reasoning") {
    log.push({ kind: s.final ? "message" : "think", text: s.text, typed: 0 }); drawLog();
  } else if (s.kind === "tool") {
    log.push({ kind: "tool", id: s.id, tool: s.tool, args: s.args, state: "run" }); drawLog(); drawDock();
    await goTo(s.target, my);
  } else if (s.kind === "tool_done") {
    const t = log.find((x) => x.kind === "tool" && x.id === s.id) ?? (log.push({ kind: "tool", id: s.id, tool: s.tool, args: s.args }), log.at(-1));
    Object.assign(t, { state: s.ok ? "ok" : "err", result: s.result, error: s.error, summary: s.summary });
    drawLog();
    if (s.ok && s.proposal) {
      const p = makeProposal(s.proposal, s.target);
      log.push({ kind: "change", p }); drawLog();
      demo.pending = p;
      emit("proposed");
      await goTo(s.target, my);
    }
  }
  if (my === run) drawDock();
}

// Follow the agent: switch to the page the event concerns, open it and light it up, and say so in the chat.
async function goTo(t, my) {
  if (!t || my !== run) return;
  const key = JSON.stringify([t.page, t.steps, t.step, t.parameter, t.entries]);
  if (key === lastShown) return;
  lastShown = key;
  const words = t.parameter ? `${STEP_NAME[t.stage] ?? t.step}, ${paramLabel(t.parameter).toLowerCase()}` : t.cite ? `the cited entries ${t.entries.join(", ")}` : t.label;
  log.push({ kind: "nav", t, words, auto: follow }); drawLog();
  if (follow) await show(t, true); else demo.target = { ...t, seq: ++demo.seq };
}

function makeProposal(p, target) {
  const st = saved[p.stage] ?? {};
  const from = demo.values[p.stage]?.[p.parameter] ?? st[p.parameter] ?? p.from;
  const stageFrom = demo.stageVersion[p.stage] ?? st.version ?? p.stage_version?.from ?? 1;
  return { ...p, from, recordedFrom: p.from, stageFrom, versionTo: demo.version + 1, target, state: "pending" };
}

function decide(approve) {
  const p = demo.pending;
  if (!p) return;
  if (approve) {
    demo.version += 1;
    (demo.values[p.stage] ??= {})[p.parameter] = p.to;
    demo.stageVersion[p.stage] = p.stageFrom + 1;
  }
  p.state = approve ? "approved" : "declined"; p.approved = approve; p.version = approve ? demo.version : null;
  demo.decided.push(p);
  log.push({ kind: "decision", approved: approve, p, version: demo.version });
  demo.pending = null;
  emit(approve ? "approved" : "declined");
  drawLog(); drawDock();
  next();
}

function finish() {
  demo.running = false; demo.finished = true;
  log.push({ kind: "summary" });
  emit("finished");
  drawLog(); drawDock(); drawPanel();
}

export function reset(quiet) {
  clearTimeout(timer); run++;
  for (const e of log) if (e.ticking) clearInterval(e.ticking);
  idx = 0; log = []; lastShown = ""; follow = true;
  Object.assign(demo, { active: false, running: false, finished: false, version: 1, values: {}, stageVersion: {}, pending: null, decided: [], target: null });
  if (!quiet) { emit("reset"); drawLog(); drawDock(); drawPanel(); }
}

/* ---------- drawing ---------- */
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// The agent writes light Markdown: bold, code, tables, paragraphs. Links keep only their words.
function md(text) {
  const inline = (s) => s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  return esc(text).split(/\n{2,}/).map((block) => {
    const rows = block.split("\n");
    if (rows.length > 1 && rows.every((r) => r.trim().startsWith("|"))) {
      const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      const [h, ...rest] = rows.filter((r) => !/^\s*\|[\s|:-]+\|\s*$/.test(r));
      return `<table><thead><tr>${cells(h).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rest.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    return `<p>${inline(block).replace(/\n/g, "<br>")}</p>`;
  }).join("");
}
const firstSentence = (t) => { const s = t.replace(/\s+/g, " ").trim(); const m = s.match(/^.{20,}?[.!?](\s|$)/); return (m ? m[0] : s).trim(); };
const ic = (name, cls = "") => ctx.el("span", { class: "dm-ic " + cls, html: icon(name) });

function followToggle() {
  const { el } = ctx;
  return el("button", { class: "dm-follow" + (follow ? " on" : ""), "aria-pressed": String(follow), title: follow ? "The page follows Codex. Scroll to stop." : "Follow Codex again", onclick: () => setFollow(!follow) },
    ic(ICON.page), el("span", {}, follow ? "Following" : "Follow"));
}

function drawDock() {
  const { el } = ctx;
  const head = el("div", { class: "dm-head" }, el("span", { class: "dm-tag" }, "Demo run"),
    el("span", { class: "dm-hd" }, "A replay of a recorded Codex session through Tosi's MCP server, in test-run mode. Nothing is saved."),
    demo.running ? followToggle() : null);
  let body;
  if (demo.pending) {
    const p = demo.pending;
    body = el("div", { class: "dm-ask" },
      el("div", { class: "dm-q" }, el("b", {}, `Go to version ${p.versionTo}?`),
        el("span", {}, `${p.step_name ?? p.stage}: ${paramLabel(p.parameter)} ${paramValue(p.parameter, p.from)} → ${paramValue(p.parameter, p.to)}`)),
      el("div", { class: "dm-btns" },
        el("button", { class: "btn primary", html: icon("check"), onclick: () => decide(true) }, "Approve"),
        el("button", { class: "btn", html: icon("xmark"), onclick: () => decide(false) }, "Decline")));
  } else if (demo.running) {
    const last = [...log].reverse().find((x) => x.kind === "tool" || x.kind === "think" || x.kind === "message");
    const what = last?.kind === "tool" && last.state === "run" ? toolLabel(last.tool, last.args)[1] : last?.kind === "think" ? "Thinking" : "Working";
    body = el("div", { class: "dm-run" }, el("span", { class: "dm-busy" }, el("span", { class: "sk line" })), el("span", { class: "dm-what" }, `Codex: ${what}`),
      el("button", { class: "btn", html: icon("rotate-left"), onclick: () => reset() }, "Stop and reset"));
  } else if (demo.finished) {
    const a = demo.decided.filter((d) => d.approved).length, d = demo.decided.length - a;
    body = el("div", { class: "dm-run" }, el("span", { class: "dm-what" }, el("b", {}, `Now at version ${demo.version}`), ` · ${a} approved, ${d} declined · in this page only`),
      el("button", { class: "btn primary", html: icon("rotate-left"), onclick: () => reset() }, "Reset demo"));
  } else {
    const ta = el("textarea", { rows: "2", readonly: true, "aria-label": "Recorded prompt. Press Enter to replay it." });
    // The whole prompt shows, up to a few lines, so what will be replayed is clear before pressing Enter.
    const fit = () => requestAnimationFrame(() => { ta.style.height = "auto"; ta.style.height = `${Math.min(ta.scrollHeight, 132)}px`; ta.scrollTop = 0; });
    ta.value = data?.prompt ?? ""; fit();
    if (!data) load().then(() => { ta.value = data.prompt; fit(); }).catch(() => { ta.placeholder = "No recorded demo on this server."; });
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); start(); } });
    body = el("div", { class: "dm-in" }, ta,
      el("div", { class: "dm-go" }, el("button", { class: "dm-send", title: "Replay (Enter)", "aria-label": "Replay the recorded run", html: icon("paper-plane"), onclick: start }), el("span", { class: "dm-hint" }, "Enter")));
  }
  dock.replaceChildren(el("div", { class: "dm-box" + (demo.pending ? " now" : "") }, head, body));
}

function drawPanel() {
  if (!panel) return;
  const { el } = ctx;
  const when = data?.recorded_at ? new Date(data.recorded_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : null;
  panel.replaceChildren(...[
    el("header", { class: "dm-ph" },
      el("span", { class: "dm-av", html: icon(ICON.agent) }), el("b", {}, "Codex"), el("span", { class: "dm-tag" }, "Demo run"),
      el("span", { class: "dm-sp" }),
      el("button", { class: "dm-x", "aria-label": "Close", title: "Close (Esc)", html: icon("xmark"), onclick: () => toggle(false) })),
    el("button", { class: "dm-about", "aria-expanded": String(aboutOpen), onclick: () => { aboutOpen = !aboutOpen; drawPanel(); } },
      el("span", { class: "chev" + (aboutOpen ? " open" : ""), html: icon("chevron-right") }), el("span", {}, "Recorded Codex session · nothing is saved")),
    aboutOpen ? el("div", { class: "dm-aboutx" },
      el("p", {}, "Codex used Tosi's MCP server in test-run mode: it could read the algorithm and the guidebook and propose changes, but nothing it proposed was saved. This is a replay of that session, a little faster than it ran. The page follows what Codex reads and changes; each proposal waits for you, and approving changes this page only."),
      el("p", { class: "meta" }, [when, data?.agent, data?.model].filter(Boolean).join(" · "))) : null,
    logEl].filter(Boolean));
  if (!data) load().then(drawPanel).catch(() => {});
  drawLog();
}

function drawLog() {
  if (!logEl) return;
  const { el } = ctx;
  if (!log.length) { logEl.replaceChildren(el("p", { class: "meta dm-empty" }, "Press Enter in the box below to replay the recorded run.")); return; }
  const nodes = log.map((e) => e.node ??= entry(e));   // drawn once and kept, so typing and states update in place
  for (const e of log) refresh(e);
  logEl.replaceChildren(...nodes);
  logEl.scrollTop = logEl.scrollHeight;
}

// A row that opens to show more: Thinking, tool calls.
function fold(cls, head, body) {
  const { el } = ctx;
  const n = el("div", { class: "dm-fold " + cls });
  const row = el("button", { class: "dm-fr", "aria-expanded": "false", onclick: () => { const o = n.classList.toggle("open"); row.setAttribute("aria-expanded", String(o)); } }, ...head, el("span", { class: "chev", html: icon("chevron-right") }));
  n.append(row, el("div", { class: "dm-fb" }, body));
  return n;
}

function entry(e) {
  const { el } = ctx;
  if (e.kind === "you") return el("div", { class: "dm-you" }, e.text);
  if (e.kind === "message") return el("div", { class: "dm-msg" });
  if (e.kind === "think") return fold("think", [ic(ICON.think, "think"), el("span", { class: "dm-fl" }, "Thinking"), el("span", { class: "dm-fs" }, firstSentence(e.text))], el("div", { class: "dm-msg thinking" }));
  if (e.kind === "tool") {
    const [i, words] = toolLabel(e.tool, e.args);
    return fold("tool", [ic(i, e.tool.includes("propose") ? "pen" : "read"), el("span", { class: "dm-fl" }, words), el("span", { class: "dm-fs" }), el("span", { class: "dm-st" })],
      el("div", {}, el("div", { class: "dm-k" }, `${e.tool} · arguments`), el("pre", { class: "dm-raw" }, JSON.stringify(e.args, null, 1)), el("div", { class: "dm-k" }, "Answer"), el("pre", { class: "dm-raw res" })));
  }
  if (e.kind === "nav") return el("button", { class: "dm-nav", title: "Show it again", onclick: () => locate(e.t) }, ic(ICON.page, "page"),
    el("span", {}, `${e.auto ? "Opened" : "Codex is on"} ${e.words} on the ${PAGE_NAME[e.t.page]} page`), e.auto ? null : el("b", {}, "Show"));
  if (e.kind === "change") return changeCard(e.p);
  if (e.kind === "decision") return el("div", { class: "dm-dec" + (e.approved ? " ok" : "") }, ic(e.approved ? ICON.check : ICON.decline),
    el("span", {}, e.approved ? `Approved. The page is at version ${e.version}: ${paramLabel(e.p.parameter).toLowerCase()} is ${paramValue(e.p.parameter, e.p.to)}.` : `Declined. The page stays at version ${e.version}.`));
  if (e.kind === "summary") {
    return el("div", { class: "dm-sum" }, el("b", {}, "Demo run finished"),
      el("p", {}, `${demo.decided.filter((d) => d.approved).length} of ${demo.decided.length} proposals approved; the page is at version ${demo.version}. Nothing was saved: reset to see the rules as they are.`),
      el("div", { class: "dm-sl" }, demo.decided.map((d) => el("button", { class: "dm-si" + (d.approved ? " ok" : ""), title: "Show it on the Algorithm page", onclick: () => locate(d.target) }, ic(d.approved ? ICON.check : ICON.decline),
        el("span", {}, `${d.step_name ?? d.stage}: ${paramLabel(d.parameter)} ${paramValue(d.parameter, d.from)} → ${paramValue(d.parameter, d.to)}`), el("span", { class: "meta" }, d.approved ? `v${d.version}` : "declined")))),
      el("button", { class: "btn primary", html: icon("rotate-left"), onclick: () => reset() }, "Reset demo"));
  }
  return el("div", {});
}

// A proposed change: what, where, from what to what, why and on what basis. Click it to see it on the page.
function changeCard(p) {
  const { el } = ctx;
  const card = el("div", { class: "dm-card", role: "button", tabindex: "0", title: "Show it on the Algorithm page", onclick: (e) => { if (!e.target.closest("a")) locate(p.target); } },
    el("div", { class: "dm-ch" }, ic(ICON.change, "change"), el("span", { class: "dm-cv" }), el("span", { class: "dm-cs" })),
    el("div", { class: "dm-cw" }, el("b", {}, p.step_name ?? p.stage), el("span", {}, paramLabel(p.parameter))),
    el("div", { class: "dm-val big" }, el("s", {}, paramValue(p.parameter, p.from)), el("span", { class: "dm-arrow", html: icon("arrow-right") }), el("b", {}, paramValue(p.parameter, p.to))),
    el("p", { class: "dm-why" }, p.why),
    el("div", { class: "dm-cites" }, p.cites.map((c) => el("a", { class: "eref", href: `#/guidebook/${c.id}`, title: c.title, onclick: (e) => { e.preventDefault(); e.stopPropagation(); locate({ page: "guidebook", entries: [c.id], cite: true }); } }, c.id)),
      p.source ? el("span", { class: "meta" }, p.source) : null, el("span", { class: "meta dm-where" }, `${p.stage}.json · not saved`)));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter") locate(p.target); });
  return card;
}

function refresh(e) {
  const n = e.node;
  if (e.kind === "message" || e.kind === "think") {
    const box = e.kind === "think" ? n.querySelector(".dm-msg") : n;
    if (e.kind === "think") { box.innerHTML = md(e.text); return; }
    const words = e.text.split(/(\s+)/);
    if (e.typed < words.length) {
      if (!e.ticking) {
        e.ticking = setInterval(() => {
          e.typed = Math.min(words.length, e.typed + Math.max(2, Math.ceil(words.length / 60)));
          box.innerHTML = md(words.slice(0, e.typed).join(""));
          logEl.scrollTop = logEl.scrollHeight;
          if (e.typed >= words.length) { clearInterval(e.ticking); e.ticking = null; }
        }, 30);
      }
    } else box.innerHTML = md(e.text);
  } else if (e.kind === "tool") {
    n.classList.toggle("run", e.state === "run"); n.classList.toggle("err", e.state === "err");
    n.querySelector(".dm-st").replaceChildren(e.state === "run" ? ctx.el("span", { class: "sk dot" }) : ic(e.state === "ok" ? ICON.check : ICON.decline));
    n.querySelector(".dm-fs").textContent = e.state === "err" ? e.error : e.summary ?? "";
    n.querySelector(".dm-raw.res").textContent = e.state === "run" ? "" : e.result ?? e.error ?? "";
  } else if (e.kind === "change") {
    const p = e.p;
    n.classList.toggle("now", p.state === "pending"); n.classList.toggle("ok", p.state === "approved"); n.classList.toggle("no", p.state === "declined");
    n.querySelector(".dm-cv").textContent = `Version ${p.versionTo - 1} → ${p.versionTo}`;
    n.querySelector(".dm-cs").textContent = p.state === "pending" ? "Waiting for you" : p.state === "approved" ? `Approved, v${p.version}` : "Declined";
  }
}
