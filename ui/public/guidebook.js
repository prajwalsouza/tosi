// The guidebook: the rulebook as an outliner. What Tosi reads, why, and the record of every change.
// Every edit is sent to the server, which writes spec/rulebook/intake.json, bumps its version and logs the change.
import { icon } from "./icons.js";

let ctx = null;
const open = new Set(["space", "terrestrial", "space:read", "terrestrial:read"]);   // which outline lines are expanded
const fmt = (n) => Number(n).toLocaleString("en-GB");

export function init(c) { ctx = c; }

async function latestTables() {
  // The most recent finished file of each kind, so the guidebook can show real rows and columns.
  const list = await fetch("/api/runs").then((r) => r.json()).catch(() => []);
  const out = {};
  for (const s of list.slice().reverse()) {
    if (s.state !== "done") continue;
    const d = await fetch(`/api/runs/${s.id}`).then((r) => r.json()).catch(() => null);
    const k = d?.result?.kind;
    if (k && k !== "unknown" && !out[k]) out[k] = { file: d.file.name, tables: new Map(d.result.database.tables.map((t) => [t.name, t])) };
  }
  return out;
}

export function guidebookPage() {
  const { el } = ctx;
  const page = el("div", { class: "gb" });
  let rules = null, seen = {}, history = [], note = "";

  async function load() {
    [rules, seen, history] = await Promise.all([
      fetch("/api/rulebook/intake").then((r) => r.json()),
      latestTables(),
      fetch("/api/rulebook/intake/changes").then((r) => r.json()).catch(() => []),
    ]);
    draw();
  }

  async function change(kind, table, field, value) {
    const res = await fetch("/api/rulebook/intake", { method: "POST", body: JSON.stringify({ kind, table, field, value, why: note }) }).then((r) => r.json());
    if (!res.ok) { ctx.toast(res.error); return; }
    await load();
  }

  const chev = (key) => el("span", { class: "chev" + (open.has(key) ? " open" : ""), html: icon("chevron-right") });
  function line(key, label, extra, kids) {
    const isOpen = open.has(key);
    const row = el("button", { class: "ol-row", "aria-expanded": String(isOpen), onclick: () => { isOpen ? open.delete(key) : open.add(key); draw(); } }, chev(key), label, extra);
    return el("div", { class: "ol" }, row, isOpen ? el("div", { class: "ol-kids" }, kids()) : null);
  }

  function editable(text, placeholder, save, cls) {
    const span = el("span", { class: "ed " + (cls ?? "") + (text ? "" : " empty"), tabindex: "0", title: "Click to edit" }, text || placeholder);
    const start = (e) => {
      e.stopPropagation();
      const inp = el("input", { class: "ed-in " + (cls ?? ""), value: text ?? "", placeholder });
      inp.addEventListener("keydown", (k) => { if (k.key === "Enter") inp.blur(); if (k.key === "Escape") { inp.value = text ?? ""; inp.blur(); } });
      inp.addEventListener("blur", () => { const v = inp.value.trim(); if (v !== (text ?? "")) save(v); else draw(); });
      span.replaceWith(inp); inp.focus(); inp.select();
    };
    span.addEventListener("click", start);
    span.addEventListener("keydown", (k) => { if (k.key === "Enter") start(k); });
    return span;
  }

  function tableLine(kind, name, t, file) {
    const key = `${kind}:t:${name}`, marker = rules.kinds[kind].markers.includes(name), f = file?.tables.get(name);
    const box = el("input", { type: "checkbox", class: "tick", checked: t.read, disabled: marker, "aria-label": `Read ${name}`,
      onclick: (e) => { e.stopPropagation(); }, onchange: (e) => change(kind, name, "read", e.target.checked) });
    const label = el("span", { class: "tl" + (t.read ? "" : " off") },
      box,
      editable(t.alias, "Add a name", (v) => change(kind, name, "alias", v), "al"),
      el("code", {}, name),
      marker ? el("span", { class: "lk", title: `Marker table: this is how a ${rules.kinds[kind].label.toLowerCase()} is recognised, so it is always read`, html: icon("lock") }) : null);
    const extra = el("span", { class: "meta" }, f ? `${fmt(f.rows)} rows` : file ? "not in the last file" : "", t.read ? ` · ${t.columns.length} ${t.columns.length === 1 ? "column" : "columns"} read` : " · not read");
    return line(key, label, extra, () => [
      el("div", { class: "gb-about" }, editable(t.about, "Add a one-line description", (v) => change(kind, name, "about", v))),
      el("div", { class: "cols-h" }, f ? `Columns in ${file.file}. Click a column to make the rules read it, or stop.` : "Columns the rules read"),
      el("div", { class: "cols" }, (f ? f.columns : t.columns).map((c) => {
        const on = t.columns.includes(c);
        return el("button", { class: "col" + (on ? " on" : ""), "aria-pressed": String(on), title: on ? "Read by the rules" : "Not read",
          onclick: () => change(kind, name, "columns", on ? t.columns.filter((x) => x !== c) : (f ? f.columns.filter((x) => x === c || t.columns.includes(x)) : [...t.columns, c])) }, c);
      }), t.columns.filter((c) => f && !f.columns.includes(c)).map((c) => el("button", { class: "col on miss", title: "Required, but not in this file", onclick: () => change(kind, name, "columns", t.columns.filter((x) => x !== c)) }, c))),
    ]);
  }

  function kindLine(kind) {
    const k = rules.kinds[kind], file = seen[kind];
    const names = Object.keys(k.tables), read = names.filter((n) => k.tables[n].read);
    const unread = file ? [...file.tables.values()].filter((t) => !k.tables[t.name]) : [];
    return line(kind, el("span", { class: "kl", html: icon(kind === "space" ? "satellite-dish" : "tower-broadcast") }, k.label),
      el("span", { class: "meta" }, `${read.length} tables read · recognised by ${k.markers.join(", ")}`), () => [
        line(`${kind}:read`, el("span", { class: "sl" }, "Tables the rules know"), el("span", { class: "meta" }, `${names.length}`), () =>
          names.map((n) => tableLine(kind, n, k.tables[n], file))),
        line(`${kind}:new`, el("span", { class: "sl" }, file ? `Other tables in ${file.file}` : "Other tables"),
          el("span", { class: "meta" }, file ? `${unread.length} not in the rulebook` : "load a file to see them"), () =>
          file ? unread.map((t) => el("div", { class: "ol leaf" }, el("span", { class: "tl off" },
            el("input", { type: "checkbox", class: "tick", "aria-label": `Start reading ${t.name}`, onchange: () => change(kind, t.name, "add", true) }),
            el("code", {}, t.name)), el("span", { class: "meta" }, `${fmt(t.rows)} rows · ${t.columns.length} columns`))) : [el("div", { class: "meta pad" }, "Drop a file or load a sample, and its tables appear here.")]),
      ]);
  }

  function historyLine() {
    return line("history", el("span", { class: "kl", html: icon("clock-rotate-left") }, "History"), el("span", { class: "meta" }, `${history.length} changes`), () =>
      history.length ? history.map((h) => el("div", { class: "ol leaf hist" },
        el("span", { class: "v" }, `v${h.version}`),
        el("span", {}, describe(h)),
        el("span", { class: "meta" }, `${new Date(h.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}${h.why ? ` · ${h.why}` : ""}`))) : [el("div", { class: "meta pad" }, "No changes yet.")]);
  }
  function describe(h) {
    const n = h.to?.alias ? `${h.to.alias} (${h.table})` : h.table;
    if (h.field === "add") return `Started reading ${h.table}`;
    if (h.field === "read") return `${h.to.read ? "Switched on" : "Switched off"} ${n}`;
    if (h.field === "columns") { const a = h.from?.columns ?? [], b = h.to?.columns ?? []; const plus = b.filter((x) => !a.includes(x)), minus = a.filter((x) => !b.includes(x)); return `${n}: ${[plus.length ? `now reads ${plus.join(", ")}` : "", minus.length ? `stopped reading ${minus.join(", ")}` : ""].filter(Boolean).join("; ")}`; }
    if (h.field === "alias") return `Named ${h.table} "${h.to?.alias ?? ""}"`;
    return `Described ${n}`;
  }

  function draw() {
    if (!rules) {
      page.replaceChildren(el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Guidebook"))),
        el("div", { class: "outline" }, [0, 1, 2].map(() => el("div", { class: "ol-row" }, el("span", { class: "sk line", style: "width:260px" })))));
      return;
    }
    const noteIn = el("input", { class: "note", placeholder: "Why are you changing this? (kept with each change)", value: note });
    noteIn.addEventListener("input", (e) => { note = e.target.value; });
    page.replaceChildren(
      el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Guidebook")), el("span", { class: "ver" }, `Rulebook version ${rules.version}`)),
      el("p", { class: "lede" }, "What Tosi reads, and why. Tick a table to read it, click a column to require it, click a name to rename it. Every change is a new version, and each result records the version that decided it."),
      noteIn,
      el("div", { class: "outline" }, Object.keys(rules.kinds).map(kindLine), historyLine()));
  }

  draw();
  load();
  return page;
}
