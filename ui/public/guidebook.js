// Two views over the spec:
//  - the Guidebook (spec/guidebook/guidebook.json): the constitution. Principles, concerns, methods, data rules,
//    known limits and the concern ladder, each entry linked to the steps that apply it.
//  - the Algorithm: the steps in order, the entries each applies, and the tables each needs. The tables intake
//    reads (spec/rulebook/intake.json) are edited here, each with the steps that need it and a reason for any change.
import { icon } from "./icons.js";

let ctx = null;
const open = new Set(["P", "C", "ladder", "algo:space", "step:space:relevant", "known:space"]);
const fmt = (n) => Number(n).toLocaleString("en-GB");
const SECTION_ICON = { P: "scale-balanced", C: "triangle-exclamation", M: "sitemap", D: "database", L: "lock" };
const FAMILY = { space: { label: "Space", icon: "satellite-dish" }, terrestrial: { label: "Terrestrial", icon: "tower-broadcast" } };

export function init(c) { ctx = c; }

async function getJSON(url, fallback) { try { const r = await fetch(url); return r.ok ? await r.json() : fallback; } catch { return fallback; } }

async function latestTables() {
  const list = await getJSON("/api/runs", []);
  const out = {};
  for (const s of list.slice().reverse()) {
    if (s.state !== "done") continue;
    const d = await getJSON(`/api/runs/${s.id}`, null);
    const k = d?.result?.kind;
    if (k && k !== "unknown" && d.result.database && !out[k]) out[k] = { file: d.file.name, tables: new Map(d.result.database.tables.map((t) => [t.name, t])) };
  }
  return out;
}

/* ---------- outline pieces shared by both pages ---------- */
function outline(redraw) {
  const { el } = ctx;
  const chev = (key) => el("span", { class: "chev" + (open.has(key) ? " open" : ""), html: icon("chevron-right") });
  return {
    line(key, label, extra, kids, attrs = {}) {
      const isOpen = open.has(key);
      const row = el("button", { class: "ol-row", "aria-expanded": String(isOpen), onclick: () => { isOpen ? open.delete(key) : open.add(key); redraw(); } }, chev(key), label, extra);
      return el("div", { class: "ol", ...attrs }, row, isOpen ? el("div", { class: "ol-kids" }, kids()) : null);
    },
    reveal(key, id) { open.add(key); redraw(); requestAnimationFrame(() => { const t = document.getElementById(id); if (t) { t.scrollIntoView({ block: "center", behavior: "smooth" }); t.classList.add("flash"); setTimeout(() => t.classList.remove("flash"), 1400); } }); },
  };
}
const joined = (items) => items.flatMap((x, i) => (i ? [", ", x] : [x]));
const applies = (el, fams) => el("span", { class: "fam" }, fams.map((f) => el("span", { title: FAMILY[f].label, html: icon(FAMILY[f].icon) })));

/* ---------- the Guidebook: the constitution ---------- */
export function guidebookPage(focus) {
  const { el } = ctx;
  const page = el("div", { class: "gb" });
  let gb = null;
  const o = outline(draw);

  const entryLink = (id) => el("a", { class: "eref", href: `#/guidebook/${id}` }, id);
  const stepLink = (s) => el("a", { class: "sref", href: `#/algorithm/${s.id}` }, s.short);

  function entryLine(e) {
    const usedBy = gb.steps.filter((s) => s.cites.includes(e.id)), rungs = gb.ladder.filter((r) => r.cites === e.id);
    return o.line(`e:${e.id}`, el("span", { class: "en" }, el("code", { class: "eid" }, e.id), el("b", {}, e.title)), el("span", { class: "meta" }, e.applies.length === 1 ? applies(el, e.applies) : null), () => [
      el("p", { class: "rule" }, e.rule),
      e.why ? el("p", { class: "kv" }, el("span", {}, "Why"), e.why) : null,
      e.effect ? el("p", { class: "kv" }, el("span", {}, "Effect"), e.effect) : null,
      el("p", { class: "kv" }, el("span", {}, "Basis"), e.basis.join(" · ")),
      usedBy.length ? el("p", { class: "kv" }, el("span", {}, "Applied in"), usedBy.map(stepLink)) : null,
      rungs.length ? el("p", { class: "kv" }, el("span", {}, "Ladder"), rungs.map((r) => el("span", { class: "rref " + r.level }, r.rung))) : null,
    ].filter(Boolean), { id: `g-${e.id}` });
  }

  function draw() {
    if (!gb) {
      page.replaceChildren(el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Guidebook"))),
        el("div", { class: "outline" }, [0, 1, 2, 3, 4].map(() => el("div", { class: "ol-row" }, el("span", { class: "sk line", style: "width:280px" })))));
      return;
    }
    page.replaceChildren(
      el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Guidebook")), el("span", { class: "ver" }, `Version ${gb.version} · ${gb.entries.length} entries`)),
      el("p", { class: "lede" }, "What every finding is cited against. Each entry says its rule, why it exists, what it changes and where it comes from, and links to the steps that apply it."),
      el("div", { class: "outline" },
        gb.sections.map((s) => {
          const list = gb.entries.filter((e) => e.section === s.id);
          return o.line(s.id, el("span", { class: "kl", html: icon(SECTION_ICON[s.id] ?? "book") }, s.title), el("span", { class: "meta" }, `${list.length} · ${s.about}`), () => list.map(entryLine));
        }),
        o.line("ladder", el("span", { class: "kl", html: icon("list-check") }, "Concern ladder"), el("span", { class: "meta" }, "Every filing lands on the first rung that is true, from the top"), () =>
          gb.ladder.map((r, i) => el("div", { class: "ol leaf rung" }, el("span", { class: "rn" }, String(i + 1)), el("i", { class: "lv " + r.level }), el("b", {}, r.rung), el("span", { class: "meta" }, r.means), entryLink(r.cites))))));
  }

  draw();
  getJSON("/api/guidebook", null).then((d) => { gb = d; draw(); if (focus) { const e = gb.entries.find((x) => x.id === focus); if (e) { open.add(e.section); open.add(`e:${e.id}`); o.reveal(`e:${e.id}`, `g-${e.id}`); } } });
  return page;
}

/* ---------- the Algorithm: steps, the entries they apply, the tables they need ---------- */
export function algorithmPage(focus) {
  const { el } = ctx;
  const page = el("div", { class: "gb" });
  let gb = null, rules = null, seen = {}, history = [], note = "", editing = false;
  const o = outline(draw);

  async function load() {
    let about;
    [gb, rules, seen, history, about] = await Promise.all([getJSON("/api/guidebook", null), getJSON("/api/rulebook/intake", null), latestTables(), getJSON("/api/rulebook/intake/changes", []), getJSON("/api/about", {})]);
    editing = about.editing === true;
    draw();
    if (focus) { const s = gb.steps.find((x) => x.id === focus); if (s) { const kind = s.family[0]; open.add(`algo:${kind}`); o.reveal(`step:${kind}:${s.id}`, `a-${kind}-${s.id}`); } }
  }

  async function change(kind, table, field, value) {
    if ((field === "read" || field === "add") && !note.trim()) { ctx.toast("Say why first, in the box at the top. Every change to what Tosi reads keeps its reason."); document.querySelector(".gb .note")?.focus(); return; }
    const res = await fetch("/api/rulebook/intake", { method: "POST", body: JSON.stringify({ kind, table, field, value, why: note }) }).then((r) => r.json());
    if (!res.ok) { ctx.toast(res.error); return; }
    await load();
  }

  function editable(text, placeholder, save, cls) {
    if (!editing) return text ? el("span", { class: "ed-ro " + (cls ?? "") }, text) : null;
    const span = el("span", { class: "ed " + (cls ?? "") + (text ? "" : " empty"), tabindex: "0", title: "Click to edit" }, text || placeholder);
    const start = (e) => {
      e.stopPropagation();
      const inp = el("input", { class: "ed-in " + (cls ?? ""), value: text ?? "", placeholder });
      inp.addEventListener("click", (k) => k.stopPropagation());
      inp.addEventListener("keydown", (k) => { if (k.key === "Enter") inp.blur(); if (k.key === "Escape") { inp.value = text ?? ""; inp.blur(); } });
      inp.addEventListener("blur", () => { const v = inp.value.trim(); if (v !== (text ?? "")) save(v); else draw(); });
      span.replaceWith(inp); inp.focus(); inp.select();
    };
    span.addEventListener("click", start);
    span.addEventListener("keydown", (k) => { if (k.key === "Enter") start(k); });
    return span;
  }

  const stepsFor = (kind) => gb.steps.filter((s) => s.family.includes(kind));
  const neededBy = (kind, table) => stepsFor(kind).filter((s) => s.reads.includes(table));
  const stepRef = (s, kind) => el("a", { class: "sref" + (s.built ? "" : " planned"), href: `#/algorithm/${s.id}`, onclick: (e) => { e.preventDefault(); open.add(`algo:${kind}`); o.reveal(`step:${kind}:${s.id}`, `a-${kind}-${s.id}`); } }, s.short);

  // One table the rules know: its names, whether it is read, which steps need it, and its columns.
  function tableLine(kind, name) {
    const t = rules.kinds[kind].tables[name], marker = rules.kinds[kind].markers.includes(name), file = seen[kind], f = file?.tables.get(name);
    const need = neededBy(kind, name);
    const state = marker ? el("span", { class: "rd", title: `Marker table: this is how a ${rules.kinds[kind].label.toLowerCase()} is recognised`, html: icon("lock") }, "Always read")
      : !editing ? el("span", { class: "rd" }, t.read ? "Read" : "Not read")
      : el("button", { class: "act" + (t.read ? "" : " on"), onclick: (e) => { e.stopPropagation(); change(kind, name, "read", !t.read); } }, t.read ? "Stop reading" : "Start reading");
    const label = el("span", { class: "tl" + (t.read ? "" : " off") },
      editable(t.alias, "Add a name", (v) => change(kind, name, "alias", v), "al"), el("code", {}, name));
    const extra = el("span", { class: "meta" },
      need.length ? el("span", { class: "need" }, "Needed by ", joined(need.map((x) => stepRef(x, kind)))) : el("span", { class: "need none" }, "No step needs it yet"),
      f ? ` · ${fmt(f.rows)} rows` : "");
    return o.line(`tbl:${kind}:${name}`, label, el("span", { class: "row-end" }, extra, state), () => [
      el("div", { class: "gb-about" }, editable(t.about, "Add a one-line description", (v) => change(kind, name, "about", v))),
      el("div", { class: "cols-h" }, f ? `Columns in ${file.file}. Orange ones are required${editing ? "; click to change" : ""}.` : "Columns required"),
      el("div", { class: "cols" }, (f ? f.columns : t.columns).map((c) => {
        const on = t.columns.includes(c);
        if (!editing) return el("span", { class: "col ro" + (on ? " on" : "") }, c);
        return el("button", { class: "col" + (on ? " on" : ""), "aria-pressed": String(on), onclick: () => change(kind, name, "columns", on ? t.columns.filter((x) => x !== c) : f ? f.columns.filter((x) => x === c || t.columns.includes(x)) : [...t.columns, c]) }, c);
      })),
    ]);
  }

  // What intake reads, per kind: the tables it knows, the ones steps need but it does not read yet, and the rest of the file.
  function readsFor(kind) {
    const k = rules.kinds[kind], file = seen[kind], known = Object.keys(k.tables);
    const wanted = [...new Set(stepsFor(kind).flatMap((s) => s.reads))].filter((t) => !known.includes(t));
    const others = file ? [...file.tables.values()].filter((t) => !k.tables[t.name] && !wanted.includes(t.name)) : [];
    const addRow = (name, rows, cols, why) => el("div", { class: "ol leaf" },
      el("span", { class: "tl new" }, el("code", {}, name)),
      el("span", { class: "row-end" }, el("span", { class: "meta" }, why, rows != null ? ` · ${fmt(rows)} rows · ${cols} columns` : ""),
        editing ? el("button", { class: "act on", onclick: () => change(kind, name, "add", true) }, "Start reading") : null));
    return [
      o.line(`known:${kind}`, el("span", { class: "sl" }, "Read by intake"), el("span", { class: "meta" }, `${known.filter((n) => k.tables[n].read).length} of ${known.length}`), () => known.map((n) => tableLine(kind, n))),
      wanted.length ? o.line(`wanted:${kind}`, el("span", { class: "sl warn" }, "Needed by later steps, not read yet"), el("span", { class: "meta" }, `${wanted.length}`), () =>
        wanted.map((n) => { const f = file?.tables.get(n); return addRow(n, f?.rows, f?.columns.length, el("span", { class: "need" }, "Needed by ", joined(neededBy(kind, n).map((x) => stepRef(x, kind))))); })) : null,
      o.line(`others:${kind}`, el("span", { class: "sl" }, file ? `Other tables in ${file.file}` : "Other tables"), el("span", { class: "meta" }, file ? `${others.length}, no step needs them` : "load a file to see them"), () =>
        file ? others.map((t) => addRow(t.name, t.rows, t.columns.length, "")) : [el("div", { class: "meta pad" }, "Drop a file or load a sample, and its tables appear here.")]),
    ].filter(Boolean);
  }

  function stepLine(s, kind) {
    const cites = s.cites.map((id) => gb.entries.find((e) => e.id === id)).filter(Boolean);
    return o.line(`step:${kind}:${s.id}`, el("span", { class: "st-l" }, el("i", { class: "pip" + (s.built ? " built" : "") }), el("b", {}, s.short), el("span", { class: "st-t" }, s.title)),
      el("span", { class: "meta" }, s.built ? "built" : "planned", s.exit ? ` · exit: ${s.exit}` : ""), () => [
        s.lines?.length ? el("p", { class: "rule" }, s.lines.join(" ")) : null,
        cites.length ? el("p", { class: "kv" }, el("span", {}, "Applies"), cites.map((e) => el("a", { class: "eref", href: `#/guidebook/${e.id}`, title: e.rule }, `${e.id} ${e.title}`))) : null,
        s.reads.length ? el("p", { class: "kv" }, el("span", {}, "Needs"), s.reads.map((t) => {
          const k = rules.kinds[kind]?.tables[t];
          return el("span", { class: "tref" + (k?.read ? "" : " missing"), title: k?.read ? "Read by intake" : "Not read by intake yet" }, k?.alias ? `${k.alias} (${t})` : t);
        })) : null,
        s.id === "relevant" ? el("div", { class: "reads" }, readsFor(kind)) : null,
      ].filter(Boolean), { id: `a-${kind}-${s.id}` });
  }

  function historyLine() {
    const describe = (h) => {
      const n = h.to?.alias ? `${h.to.alias} (${h.table})` : h.table;
      if (h.field === "add") return `Started reading ${h.table}`;
      if (h.field === "read") return `${h.to.read ? "Started" : "Stopped"} reading ${n}`;
      if (h.field === "columns") { const a = h.from?.columns ?? [], b = h.to?.columns ?? []; const plus = b.filter((x) => !a.includes(x)), minus = a.filter((x) => !b.includes(x)); return `${n}: ${[plus.length ? `now requires ${plus.join(", ")}` : "", minus.length ? `no longer requires ${minus.join(", ")}` : ""].filter(Boolean).join("; ")}`; }
      if (h.field === "alias") return `Named ${h.table} "${h.to?.alias ?? ""}"`;
      if (h.field === "reasons") return "Reworded the reasons for turning a file away";
      return `Described ${n}`;
    };
    return o.line("history", el("span", { class: "kl", html: icon("clock-rotate-left") }, "History"), el("span", { class: "meta" }, `${history.length} changes`), () =>
      history.length ? history.map((h) => el("div", { class: "ol leaf hist" }, el("span", { class: "v" }, `v${h.version}`), el("span", {}, describe(h)),
        el("span", { class: "meta" }, `${new Date(h.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}${h.why ? ` · ${h.why}` : ""}`))) : [el("div", { class: "meta pad" }, "No changes yet.")]);
  }

  function draw() {
    if (!gb || !rules) {
      page.replaceChildren(el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Algorithm"))),
        el("div", { class: "outline" }, [0, 1, 2, 3].map(() => el("div", { class: "ol-row" }, el("span", { class: "sk line", style: "width:280px" })))));
      return;
    }
    const noteIn = editing ? el("input", { class: "note", placeholder: "Why are you changing what Tosi reads? (required, kept with the change)", value: note }) : el("div", { class: "locked", html: icon("lock") }, "Read-only. What Tosi reads cannot be changed here for now; editing will return as drafts that become a version only when saved.");
    if (editing) noteIn.addEventListener("input", (e) => { note = e.target.value; });
    page.replaceChildren(
      el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Algorithm")), el("span", { class: "ver" }, `Rulebook version ${rules.version}`)),
      el("p", { class: "lede" }, "The steps a filing goes through, in order. Each step applies guidebook entries and needs certain tables. Open “Relevant tables” to see what intake reads and which steps need each table."),
      noteIn,
      el("div", { class: "outline" },
        Object.keys(FAMILY).map((kind) => o.line(`algo:${kind}`, el("span", { class: "kl", html: icon(FAMILY[kind].icon) }, FAMILY[kind].label), el("span", { class: "meta" }, `${stepsFor(kind).length} steps`), () => stepsFor(kind).map((s) => stepLine(s, kind)))),
        historyLine()));
  }

  draw();
  load();
  return page;
}
