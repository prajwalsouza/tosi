// The library: every file processed so far, one record each, kept on disk. Filters at the top; a row opens into
// its record: what was found, which engine and rulebook decided it, and ways to see it in the Flow or process it again.
import { icon } from "./icons.js";

let ctx = null;
const state = { kind: "all", outcome: "all", q: "", open: null };
const fmt = (n) => Number(n).toLocaleString("en-GB");
const mb = (b) => `${(b / 1e6).toFixed(b < 1e7 ? 2 : 1)} MB`;
const NAMES = { ts: "TypeScript", rust: "Rust", python: "Python" };
const KIND = { space: { label: "Space", icon: "satellite-dish" }, terrestrial: { label: "Terrestrial", icon: "tower-broadcast" }, unknown: { label: "Not recognised", icon: "file-zipper" } };

export function init(c) { ctx = c; }

export function libraryPage() {
  const { el } = ctx;
  const page = el("div", { class: "lib" });
  let records = null, version = 0, live = new Set(), detail = {};

  async function load() {
    const [list, rules, runs] = await Promise.all([
      fetch("/api/library").then((r) => r.json()).catch(() => []),
      fetch("/api/rulebook/intake").then((r) => r.json()).catch(() => ({})),
      fetch("/api/runs").then((r) => r.json()).catch(() => []),
    ]);
    records = list; version = rules.version ?? 0; live = new Set(runs.map((r) => r.id));
    draw();
  }

  const seg = (key, options) => el("div", { class: "seg small", role: "tablist" }, options.map(([v, label, n]) =>
    el("button", { class: state[key] === v ? "on" : "", role: "tab", "aria-selected": String(state[key] === v), onclick: () => { state[key] = v; draw(); } }, label, n != null ? el("span", { class: "n" }, String(n)) : null)));

  async function openRecord(id) {
    state.open = state.open === id ? null : id;
    if (state.open && !detail[id]) { draw(); detail[id] = await fetch(`/api/library/${id}`).then((r) => r.json()).catch(() => null); }
    draw();
  }
  async function again(id) {
    const r = await fetch(`/api/library/${id}/again?engine=${ctx.using()}`, { method: "POST" }).then((x) => x.json());
    if (r.error) { ctx.toast(r.error); return; }
    ctx.go(`/flow/${r.id}`);
  }

  function recordView(rec) {
    const d = detail[rec.id];
    if (!d) return el("div", { class: "rec" }, [0, 1, 2].map(() => el("span", { class: "sk line", style: "width:320px;margin:6px 0" })));
    const stale = d.rulebook && d.rulebook.version !== version;
    return el("div", { class: "rec" },
      el("p", { class: "rec-say" }, d.state === "failed" ? `The engine failed: ${d.error}` :
        d.accepted ? `A ${KIND[d.kind]?.label.toLowerCase()} filing with ${fmt(d.tables)} tables and ${fmt(d.rows)} rows. Every table the rules need is there, so it was accepted.` :
        `Turned away. ${d.reason ?? ""}`),
      d.relevant?.length ? el("div", { class: "rec-tables" }, d.relevant.map((t) => el("div", { class: "rt" + (t.present ? "" : " miss") },
        el("b", {}, t.alias ?? t.table), el("code", {}, t.table), el("span", { class: "meta" }, t.present ? `${fmt(t.rows)} rows` : "missing")))) : null,
      el("dl", { class: "rec-facts" },
        el("dt", {}, "Fingerprint"), el("dd", {}, el("code", {}, d.file.sha256 ?? "–")),
        el("dt", {}, "Processed by"), el("dd", {}, `${NAMES[d.engine] ?? d.engine}${d.ms != null ? ` in ${(d.ms / 1000).toFixed(1)} s` : ""}`),
        el("dt", {}, "Rules used"), el("dd", { class: stale ? "stale-t" : "" }, d.rulebook ? `Rulebook version ${d.rulebook.version}${stale ? ` (now version ${version})` : ""}` : "–"),
        el("dt", {}, "Processed"), el("dd", {}, new Date(d.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }))),
      // A file that was turned away has nothing to show in the Flow and nothing to gain from running again.
      !d.accepted ? null : el("div", { class: "rec-act" },
        live.has(d.id) ? el("a", { class: "btn primary", href: `#/flow/${d.id}`, html: icon("route") }, "See it in the Flow") : null,
        el("button", { class: "btn" + (live.has(d.id) ? "" : " primary"), onclick: () => again(d.id), html: icon("rotate-left") }, stale ? "Process again with the current rules" : "Process again")));
  }

  function draw() {
    if (!records) {
      page.replaceChildren(el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Library"))),
        el("div", { class: "lib-list" }, [0, 1, 2, 3].map(() => el("div", { class: "lib-row" }, el("span", { class: "sk line", style: "width:60%" })))));
      return;
    }
    const count = (f) => records.filter(f).length;
    const shown = records.filter((r) =>
      (state.kind === "all" || r.kind === state.kind) &&
      (state.outcome === "all" || (state.outcome === "accepted" ? r.accepted : !r.accepted)) &&
      (!state.q || r.file.name.toLowerCase().includes(state.q.toLowerCase())));
    const q = el("input", { class: "lib-q", type: "search", placeholder: "Find a file", value: state.q });
    q.addEventListener("input", (e) => { state.q = e.target.value; draw(); requestAnimationFrame(() => { const n = page.querySelector(".lib-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); });
    page.replaceChildren(
      el("header", { class: "gb-h" }, el("h1", {}, el("span", { class: "t" }, "Library")), el("span", { class: "ver" }, `${records.length} ${records.length === 1 ? "file" : "files"} processed`)),
      el("div", { class: "lib-filters" },
        seg("kind", [["all", "All", records.length], ["space", "Space", count((r) => r.kind === "space")], ["terrestrial", "Terrestrial", count((r) => r.kind === "terrestrial")], ["unknown", "Not recognised", count((r) => r.kind === "unknown")]]),
        seg("outcome", [["all", "Any outcome"], ["accepted", "Accepted", count((r) => r.accepted)], ["refused", "Turned away", count((r) => !r.accepted)]]),
        q),
      shown.length ? el("div", { class: "lib-list" }, shown.map((r) => {
        const k = KIND[r.kind] ?? KIND.unknown, isOpen = state.open === r.id, stale = r.rulebook && r.rulebook.version !== version;
        return el("div", { class: "lib-item" + (isOpen ? " open" : "") },
          el("button", { class: "lib-row", "aria-expanded": String(isOpen), onclick: () => openRecord(r.id) },
            el("span", { class: "chev" + (isOpen ? " open" : ""), html: icon("chevron-right") }),
            el("span", { class: "ic", html: icon(k.icon), title: k.label }),
            el("span", { class: "lr-name" }, el("b", {}, r.file.name), el("span", { class: "meta" }, `${k.label} · ${mb(r.file.bytes)}`)),
            el("span", { class: "lr-out" + (r.accepted ? "" : " bad") }, r.state === "failed" ? "Failed" : r.accepted ? `${r.relevant.length} tables picked` : "Turned away"),
            el("span", { class: "lr-meta" }, `${NAMES[r.engine] ?? r.engine}${r.ms != null ? ` · ${(r.ms / 1000).toFixed(1)} s` : ""}`),
            el("span", { class: "lr-meta" + (stale ? " stale-t" : "") }, r.rulebook ? `Rules v${r.rulebook.version}` : ""),
            el("span", { class: "lr-meta" }, new Date(r.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))),
          isOpen ? recordView(r) : null);
      })) : el("p", { class: "meta pad" }, records.length ? "No file matches these filters." : "Nothing has been processed yet. Drop an ITU file anywhere, or pick a sample on Home."));
  }

  draw();
  load();
  return page;
}
