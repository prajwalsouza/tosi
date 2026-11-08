// Two views over the spec:
//  - the Guidebook (spec/guidebook/guidebook.json): the constitution. Principles, concerns, methods, data rules,
//    known limits and the concern ladder, each entry linked to the steps that apply it.
//  - the Algorithm: the steps in order, the entries each applies, and the tables each needs. The tables intake
//    reads (spec/rulebook/intake.json) are edited here, each with the steps that need it and a reason for any change.
import { icon } from "./icons.js";
import { metric, sizeFormat, sizeParse } from "./metric.js";
import { demo, onDemo, ready, locate, STAGE_OF_STEP, paramLabel, paramValue } from "./demo.js";

// The demo run lights up what the agent is reading or changing: a short pulse on each row, one after another.
function lit(ids, scrollTo, block = "center") {
  requestAnimationFrame(() => {
    const first = document.getElementById(scrollTo ?? ids[0]);
    first?.scrollIntoView({ block, behavior: "smooth" });
    ids.forEach((id, i) => {
      const n = document.getElementById(id); if (!n) return;
      n.classList.remove("dm-lit"); void n.offsetWidth;
      n.style.setProperty("--dm-d", `${i * 120}ms`); n.classList.add("dm-lit");
      setTimeout(() => n.classList.remove("dm-lit"), 2400 + i * 120);
    });
  });
}

// The file size limit, in gigabytes: a showcase parameter for now, kept while the page is open.
const SIZE_LIMIT = { saved: 100, draft: 100 };

let ctx = null;
const open = new Set(["P", "C", "ladder", "algo:space", "step:space:relevant", "known:space"]);
const fmt = (n) => Number(n).toLocaleString("en-GB");
const SECTION_ICON = { P: "scale-balanced", C: "triangle-exclamation", MD: "sitemap", D: "database", L: "lock" };
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

  // The demo run: proposals that cite this entry, the one waiting first.
  const demoFor = (id) => [demo.pending, ...demo.decided.slice().reverse()].filter((p) => p && p.cites.some((c) => c.id === id));
  function demoNote(p) {
    const st = gb.steps.find((x) => x.id === p.step);
    const state = p === demo.pending ? `Proposed for version ${p.versionTo}` : p.approved ? `Approved as version ${p.version}` : "Declined";
    return el("div", { class: "dm-note" + (p === demo.pending ? " now" : "") },
      el("span", { class: "dm-tag" }, "Demo run"),
      el("span", {}, `${state}: ${st?.short ?? p.stage}, ${paramLabel(p.parameter)} ${paramValue(p.parameter, p.from)} → ${paramValue(p.parameter, p.to)}. The proposal cites this entry.`),
      el("a", { class: "sref", href: `#/algorithm/${p.step}` }, "See it on the Algorithm page"));
  }

  function entryLine(e) {
    const usedBy = gb.steps.filter((s) => s.cites.includes(e.id)), rungs = gb.ladder.filter((r) => r.cites === e.id);
    const dm = demoFor(e.id);
    return o.line(`e:${e.id}`, el("span", { class: "en" }, el("code", { class: "eid" }, e.id), el("b", {}, e.title)), el("span", { class: "meta" }, e.applies.length === 1 ? applies(el, e.applies) : null, dm.length ? el("span", { class: "dm-chip" + (dm[0] === demo.pending ? " now" : "") }, dm[0] === demo.pending ? "cited by the proposal" : "cited in the demo") : null), () => [
      ...dm.slice(0, 1).map(demoNote),
      el("p", { class: "rule" }, e.rule),
      e.why ? el("p", { class: "kv" }, el("span", {}, "Why"), e.why) : null,
      e.effect ? el("p", { class: "kv" }, el("span", {}, "Effect"), e.effect) : null,
      el("p", { class: "kv" }, el("span", {}, "Basis"), e.basis.join(" · ")),
      usedBy.length ? el("p", { class: "kv" }, el("span", {}, "Applied in"), usedBy.map(stepLink)) : null,
      rungs.length ? el("p", { class: "kv" }, el("span", {}, "Ladder"), rungs.map((r) => el("span", { class: "rref " + r.level }, r.rung))) : null,
    ].filter(Boolean), { id: `g-${e.id}`, class: "ol" + (dm[0] === demo.pending && dm.length ? " dm-cited" : "") });
  }

  function draw() {
    if (!gb) {
      page.replaceChildren(el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Guidebook"))),
        el("div", { class: "outline" }, [0, 1, 2, 3, 4].map(() => el("div", { class: "ol-row" }, el("span", { class: "sk line", style: "width:280px" })))));
      return;
    }
    page.replaceChildren(
      el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Guidebook")), el("span", { class: "ver" }, `Version ${gb.version} · ${gb.entries.length} entries`)),
      el("div", { class: "lede why" },
        el("p", {}, "When Finland raises a concern about another country's filing, that country's engineers will check every number. So every finding Tosi makes has to point to a written rule: this is that book of rules."),
        el("p", {}, "Each entry says the rule, why it exists, what it changes and where it comes from: a Radio Regulation, an ITU Recommendation, a published table, or a choice the administration makes and owns. Nothing is decided anywhere else."),
        el("p", {}, "Because the rules are written down, a concern can cite them, a person can question them, and a change to one shows exactly which results it moves before anyone approves it.")),
      el("div", { class: "outline" },
        gb.sections.map((s) => {
          const list = gb.entries.filter((e) => e.section === s.id);
          return o.line(s.id, el("span", { class: "kl", html: icon(SECTION_ICON[s.id] ?? "book") }, s.title), el("span", { class: "meta" }, `${list.length} · ${s.about}`), () => list.map(entryLine));
        }),
        o.line("ladder", el("span", { class: "kl concern", html: icon("list-check") }, "Concern ladder"), el("span", { class: "meta" }, "Every filing lands on the first rung that is true, from the top"), () =>
          gb.ladder.map((r, i) => el("div", { class: "ol leaf rung" }, el("span", { class: "rn" }, String(i + 1)), el("i", { class: "lv " + r.level }), el("b", {}, r.rung), el("span", { class: "meta" }, r.means), entryLink(r.cites))))));
  }

  // The demo run follows the agent here: entries it cites are opened; entries it reads light up in their sections.
  function showTarget(t) {
    if (!gb || !t || t.page !== "guidebook") return;
    const ids = (t.entries ?? []).filter((id) => gb.entries.some((e) => e.id === id));
    for (const id of ids) { open.add(gb.entries.find((x) => x.id === id).section); if (t.cite) open.add(`e:${id}`); }
    draw();
    if (ids.length) lit(ids.map((id) => `g-${id}`));
  }
  page.cleanup = onDemo((why) => { if (why === "target") showTarget(demo.target); else draw(); });

  draw();
  getJSON("/api/guidebook", null).then((d) => {
    gb = d; draw();
    if (demo.target?.page === "guidebook") showTarget(demo.target);
    else if (focus) { const e = gb.entries.find((x) => x.id === focus); if (e) { open.add(e.section); open.add(`e:${e.id}`); o.reveal(`e:${e.id}`, `g-${e.id}`); } }
    ready("guidebook");
  });
  return page;
}

/* ---------- the Algorithm: steps, the entries they apply, the tables they need ---------- */
export function algorithmPage(focus) {
  const { el } = ctx;
  const page = el("div", { class: "gb" });
  let gb = null, rules = null, seen = {}, history = [], note = "", editing = false, stageRules = {};
  const o = outline(draw);

  async function load() {
    let about, staged;
    [gb, rules, seen, history, about, staged] = await Promise.all([getJSON("/api/guidebook", null), getJSON("/api/rulebook/intake", null), latestTables(), getJSON("/api/rulebook/intake/changes", []), getJSON("/api/about", {}),
      Promise.all(Object.values(STAGE_OF_STEP).map(async (st) => [st, await getJSON(`/api/rulebook/${st}`, null)]))]);
    stageRules = Object.fromEntries(staged.filter(([, r]) => r));
    editing = about.editing === true;
    draw();
    if (demo.target?.page === "algorithm") showTarget(demo.target);
    else if (focus) { const s = gb.steps.find((x) => x.id === focus); if (s) { const kind = s.family[0]; open.add(`algo:${kind}`); if (STAGE_OF_STEP[s.id]) open.add(`prm:${kind}:${s.id}`); o.reveal(`step:${kind}:${s.id}`, `a-${kind}-${s.id}`); } }
    ready("algorithm");
  }

  // The demo run follows the agent here: the steps it reads light up one by one; a step it changes opens at the parameter.
  function showTarget(t) {
    if (!gb || !t || t.page !== "algorithm") return;
    const kind = t.kind ?? gb.steps.find((x) => x.id === t.step)?.family[0] ?? "terrestrial";
    open.add(`algo:${kind}`);
    if (t.step) {
      open.add(`step:${kind}:${t.step}`);
      if (t.parameter) open.add(`prm:${kind}:${t.step}`);
      draw();
      lit(t.parameter ? [`p-${t.stage}-${t.parameter}`, `a-${kind}-${t.step}`] : [`a-${kind}-${t.step}`]);
    } else if (t.steps) {
      draw();
      lit(t.steps.map((id) => `a-${kind}-${id}`), `a-${kind}-${t.steps[0]}`, "start");
    }
  }
  page.cleanup = onDemo((why) => { if (why === "target") showTarget(demo.target); else draw(); });

  // A step's numbers, from its rulebook, with the demo run's proposed or approved values over them (in memory only).
  const stageVersion = (stage) => demo.stageVersion[stage] ?? stageRules[stage]?.version;
  function paramsLine(s, kind) {
    const stage = STAGE_OF_STEP[s.id], r = stageRules[stage];
    if (!r) return null;
    const keys = Object.keys(r).filter((k) => k !== "version" && typeof r[k] === "number");
    if (!keys.length) return null;
    const p = demo.pending?.stage === stage ? demo.pending : null;
    const ver = stageVersion(stage);
    return o.line(`prm:${kind}:${s.id}`, el("span", { class: "sl" }, "Parameters"),
      el("span", { class: "meta" }, `${keys.length} · ${stage}.json, version ${ver}`, p ? el("span", { class: "dm-chip now" }, `v${ver} → v${ver + 1} proposed`) : demo.stageVersion[stage] ? el("span", { class: "dm-chip" }, "demo") : null), () =>
      keys.map((k) => {
        const saved = r[k], now = demo.values[stage]?.[k] ?? saved, prop = p?.parameter === k ? p : null;
        const basis = r[`${k}_basis`] ?? r[`${k.split("_")[0]}_basis`] ?? "";
        const value = prop ? el("span", { class: "dm-val" }, el("s", {}, paramValue(k, now)), el("span", { class: "dm-arrow" }, "→"), el("b", {}, paramValue(k, prop.to)))
          : el("span", { class: "pv" + (now !== saved ? " dm-changed" : "") }, paramValue(k, now));
        return el("div", { class: "ol leaf prm" + (prop ? " dm-prop" : ""), id: `p-${stage}-${k}` },
          el("span", { class: "prm-l" }, el("span", {}, paramLabel(k)), el("code", {}, k)), value,
          el("span", { class: "meta prm-b", title: basis }, prop ? "Proposed in the demo run" : now !== saved ? `Demo: was ${paramValue(k, saved)}` : basis));
      }));
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

  // A parameter of the File step: the largest file Tosi will take. Shown as its value; open it to adjust a draft.
  // The algorithm is read-only for now, so the draft cannot be saved yet.
  function sizeLimitLine(kind) {
    const shown = el("span", { class: "meta pv" });
    const save = el("button", { class: "btn primary", disabled: true, title: editing ? "" : "The algorithm is read-only for now", html: icon("check") }, "Save");
    const reset = el("button", { class: "btn", html: icon("rotate-left"), onclick: () => card.set(SIZE_LIMIT.saved) }, "Undo");
    const state = el("span", { class: "meta" });
    function sync(v) {
      SIZE_LIMIT.draft = v;
      const changed = Math.abs(v - SIZE_LIMIT.saved) > 1e-9;
      shown.textContent = `${sizeFormat(SIZE_LIMIT.saved).join(" ")}${changed ? ` · draft ${sizeFormat(v).join(" ")}` : ""}`;
      reset.hidden = !changed;
      save.disabled = !changed || !editing;
      state.textContent = changed ? (editing ? "Not saved yet." : "A draft. Saving comes back when the algorithm can be edited.") : "";
    }
    const card = metric(el, { label: "Largest file Tosi will take", value: SIZE_LIMIT.draft, min: 0.05, max: 200, log: true, format: sizeFormat, parse: sizeParse,
      hint: "Drag across the card, or type a size. Up to 200 GB.", onInput: sync });
    sync(SIZE_LIMIT.draft);
    return o.line(`param:${kind}:size`, el("span", { class: "sl" }, el("span", { class: "pk", html: icon("weight-hanging") }), "File size limit"), shown, () => [
      el("div", { class: "param" },
        el("p", { class: "gb-about" }, "A file larger than this is turned away before anything else happens, so nobody waits hours on a file that was sent by mistake."),
        card,
        el("div", { class: "param-a" }, save, reset, state)),
    ]);
  }

  // Marks beside a step the demo run proposed or changed; each takes you to the parameter.
  function stepBadges(s) {
    const go = (p) => (e) => { e.stopPropagation(); locate(p.target); };
    return [
      ...demo.decided.filter((d) => d.approved && d.step === s.id).map((d) => el("span", { class: "dm-chip go", role: "button", tabindex: "0", title: `${paramLabel(d.parameter)} ${paramValue(d.parameter, d.from)} → ${paramValue(d.parameter, d.to)}`, onclick: go(d) }, `Changed in v${d.version}`)),
      demo.pending?.step === s.id ? el("span", { class: "dm-chip now go", role: "button", tabindex: "0", title: `${paramLabel(demo.pending.parameter)}: proposed`, onclick: go(demo.pending) }, `Proposed for v${demo.pending.versionTo}`) : null,
    ];
  }

  function stepLine(s, kind) {
    const cites = s.cites.map((id) => gb.entries.find((e) => e.id === id)).filter(Boolean);
    return o.line(`step:${kind}:${s.id}`, el("span", { class: "st-l" }, el("i", { class: "pip" + (s.built ? " built" : "") }), el("b", {}, s.short), el("span", { class: "st-t" }, s.title)),
      el("span", { class: "meta" }, s.built ? "built" : "planned", s.exit ? ` · exit: ${s.exit}` : "", stepBadges(s)), () => [
        s.lines?.length ? el("p", { class: "rule" }, s.lines.join(" ")) : null,
        cites.length ? el("p", { class: "kv" }, el("span", {}, "Applies"), cites.map((e) => el("a", { class: "eref", href: `#/guidebook/${e.id}`, title: e.rule }, `${e.id} ${e.title}`))) : null,
        s.reads.length ? el("p", { class: "kv" }, el("span", {}, "Needs"), s.reads.map((t) => {
          const k = rules.kinds[kind]?.tables[t];
          return el("span", { class: "tref" + (k?.read ? "" : " missing"), title: k?.read ? "Read by intake" : "Not read by intake yet" }, k?.alias ? `${k.alias} (${t})` : t);
        })) : null,
        s.id === "relevant" ? el("div", { class: "reads" }, readsFor(kind)) : null,
        s.id === "file" ? el("div", { class: "reads" }, sizeLimitLine(kind)) : null,
        STAGE_OF_STEP[s.id] ? el("div", { class: "reads" }, paramsLine(s, kind)) : null,
      ].filter(Boolean), { id: `a-${kind}-${s.id}` });
  }

  function historyLine() {
    const describe = (h) => {
      if (h.field === "parameter") return `${h.stage}: ${paramLabel(h.parameter)} ${paramValue(h.parameter, h.from)} → ${paramValue(h.parameter, h.to)}`;
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
      el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Algorithm")), el("span", { class: "ver" }, `Rulebook version ${rules.version}`),
        demo.active ? el("span", { class: "dm-badge" + (demo.pending ? " now" : "") }, el("span", { class: "dm-tag" }, "Demo run"), demo.pending ? `Version ${demo.version} → ${demo.version + 1} (proposed)` : `Version ${demo.version}`) : null),
      el("div", { class: "lede why" },
        el("p", {}, "The algorithm is the guidebook put in order: the questions a filing is asked, one after another, until it is either set aside with a reason or becomes a concern."),
        el("p", {}, "It is drawn as a path so that every result can be traced back. For any filing you can see which step decided it, which guidebook entries that step applied, and which tables of the filing it read."),
        el("p", {}, "Each step is a plain question with a plain answer, so a person can follow the reasoning without reading code, and the same file always takes the same path.")),
      noteIn,
      el("div", { class: "outline" },
        Object.keys(FAMILY).map((kind) => o.line(`algo:${kind}`, el("span", { class: "kl", html: icon(FAMILY[kind].icon) }, FAMILY[kind].label), el("span", { class: "meta" }, `${stepsFor(kind).length} steps`), () => stepsFor(kind).map((s) => stepLine(s, kind)))),
        historyLine()));
  }

  draw();
  load();
  return page;
}
