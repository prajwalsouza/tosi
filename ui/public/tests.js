// Settings · Tests: time every engine on the sample files, step by step, then use those times to estimate how
// long a file of any size might take. The estimate is a heuristic: real timings, scaled in proportion to size.
import { icon } from "./icons.js";
import { metric, sizeFormat, sizeParse } from "./metric.js";

const NAMES = { ts: "TypeScript", rust: "Rust", python: "Python" };
const STEPS = [
  ["start", "Start the engine"],
  ["fingerprint", "Fingerprint the file"],
  ["unpack", "Unpack the database"],
  ["database-fingerprint", "Fingerprint the database"],
  ["database", "Read the list of tables"],
  ["check", "Recognise and check", ["recognise", "check"]],
  ["downlink", "Downlink"],
  ["reach", "Reach"],
  ["limit", "Applicable limits"], ["data", "Data sufficiency"], ["power", "Power"],
  ["compare", "Compare with limits"], ["stations", "Station overlap"],
  ["ladder", "Prioritise space filings"], ["report", "Space report"],
  ["mobile", "Land mobile"], ["range", "Range"], ["tdata", "Terrestrial data"],
  ["field", "Field strength"], ["threshold", "Compare with thresholds"],
  ["tstations", "Station exposure"], ["tladder", "Prioritise terrestrial filings"],
  ["treport", "Terrestrial report"],
];
const fmt = (n) => Number(n).toLocaleString("en-GB");
const mb = (b) => `${(b / 1e6).toFixed(b < 1e7 ? 1 : 0)} MB`;
export function dur(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = s / 60;
  if (m < 60) return `${Math.round(m)} min`;
  return `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`;
}
const stepMs = (r, s) => (s[2] ?? [s[0]]).reduce((a, k) => a + (r.steps[k] ?? 0), 0);

let size = 0.35;                   // gigabytes, kept while the page is open
let sample = null;

export function testsPage(el) {
  const box = el("div", { class: "tests" });
  let data = null, timer = 0, showReference = true;

  async function load() {
    data = await fetch("/api/tests").then((r) => r.json()).catch(() => ({ last: null }));
    draw();
    clearTimeout(timer);
    if (data.running && box.isConnected) timer = setTimeout(load, 1000);
  }
  async function start() {
    showReference = false;
    data = await fetch("/api/tests/run", { method: "POST" }).then((r) => r.json());
    draw(); timer = setTimeout(load, 800);
  }

  function relative(t, best) {
    if (t <= best) return el("span", { class: "tr-best" }, "fastest");
    const r = t / best;
    return el("span", { class: "tr-rel" }, r < 2 ? `${Math.round((r - 1) * 100)}% slower` : `${r < 10 ? r.toFixed(1) : Math.round(r)}× slower`);
  }

  function table(results) {
    const engines = [...new Set(results.map((r) => r.engine))];
    const rows = STEPS.filter((s) => results.some((r) => stepMs(r, s) > 0));
    const cell = (ms, best, max) => el("td", {},
      el("div", { class: "tc" }, el("b", {}, dur(ms)), relative(ms, best)),
      el("div", { class: "tbar" }, el("i", { style: `width:${Math.max(1, (ms / max) * 100)}%`, class: ms <= best ? "best" : "" })));
    const line = (label, get) => {
      const v = results.map(get), best = Math.min(...v.filter((x) => x > 0)), max = Math.max(...v);
      return el("tr", {}, el("th", { scope: "row" }, label), v.map((ms) => ms > 0 ? cell(ms, best, max) : el("td", { class: "tna" }, "–")));
    };
    return el("table", { class: "ttab" },
      el("thead", {}, el("tr", {}, el("th", {}, "Step"), engines.map((e) => el("th", { scope: "col" }, NAMES[e] ?? e)))),
      el("tbody", {}, rows.map((s) => line(s[1], (r) => stepMs(r, s)))),
      el("tfoot", {}, line("All of it", (r) => r.total)));
  }

  // Each step's time scales with the file's size, from the largest sample; starting the engine does not.
  function estimate(results) {
    const per = {};
    for (const r of results) if (r.state === "done" && (!per[r.engine] || r.file.bytes > per[r.engine].file.bytes)) per[r.engine] = r;
    const big = Object.values(per)[0];
    const ratio = big?.file.dbBytes ? big.file.dbBytes / big.file.bytes : null;
    const out = el("div", { class: "est" }), note = el("p", { class: "meta est-note" });
    function drawOut() {
      const bytes = size * 1e9;
      const rows = Object.values(per).map((r) => {
        const k = bytes / r.file.bytes, parts = STEPS.map((s) => [s[1], s[0] === "start" ? stepMs(r, s) : stepMs(r, s) * k]);
        const total = parts.reduce((a, p) => a + p[1], 0), top = parts.reduce((a, p) => p[1] > a[1] ? p : a);
        return { e: r.engine, total, top };
      });
      const max = Math.max(...rows.map((r) => r.total)), best = Math.min(...rows.map((r) => r.total));
      note.textContent = `Scaled from ${big?.file.name ?? "the largest sample"} (${big ? mb(big.file.bytes) : "–"}).` +
        (ratio ? ` Unpacked, that file's database is ${ratio.toFixed(1)} times its size, so ${sizeFormat(size).join(" ")} would unpack to about ${sizeFormat(size * ratio).join(" ")}.` : "");
      out.replaceChildren(...rows.map((r) => el("div", { class: "est-r" },
        el("span", { class: "est-n" }, NAMES[r.e] ?? r.e),
        el("div", { class: "tbar wide" }, el("i", { class: r.total <= best ? "best" : "", style: `width:${Math.max(1, (r.total / max) * 100)}%` })),
        el("b", { class: "est-t" }, `about ${dur(r.total)}`),
        el("span", { class: "est-m" }, `mostly ${r.top[0].toLowerCase()} (${Math.round((r.top[1] / r.total) * 100)}%)`))));
    }
    const card = metric(el, { label: "If a file this size comes in", value: size, min: 0.01, max: 200, log: true, format: sizeFormat, parse: sizeParse,
      hint: "Drag across the card, or type a size such as 350 MB or 30 GB",
      onInput: (v) => { size = v; drawOut(); } });
    drawOut();
    return el("div", {},
      card,
      out,
      note);
  }

  function draw() {
    const saved = showReference && data?.reference;
    const last = saved || data?.last, running = data?.running;
    const results = (last?.results ?? []).filter((r) => r.state === "done");
    const files = [...new Set(results.map((r) => r.file.name))];
    if (!sample || !files.includes(sample)) sample = files.sort((a, b) => results.find((r) => r.file.name === b).file.bytes - results.find((r) => r.file.name === a).file.bytes)[0];
    const shown = results.filter((r) => r.file.name === sample);
    box.replaceChildren(...[
      el("div", { class: "bar" },
        el("div", {},
          el("h2", { html: icon("flask-vial") }, el("span", { class: "t" }, "Tests")),
          el("p", { class: "lede" }, data?.reference ? "Compare saved timings for all three engines or measure Rust on this host." : "How long each engine takes on each step, timed on this computer with the sample files.")),
        el("button", { class: "btn primary", disabled: running ? true : null, onclick: start, html: icon(running ? "stopwatch" : "play") }, running ? "Testing…" : data?.reference ? "Run Rust tests" : last ? "Run the tests again" : "Run the tests")),
      data?.reference ? el("div", { class: "seg small", role: "group", "aria-label": "Timing source" },
        el("button", { class: showReference ? "on" : "", "aria-pressed": String(showReference), onclick: () => { showReference = true; draw(); } }, "Saved comparison"),
        el("button", { class: !showReference ? "on" : "", "aria-pressed": String(!showReference), onclick: () => { showReference = false; draw(); } }, "Hosted Rust tests")) : null,
      saved ? el("p", { class: "meta" }, "Recorded on an Apple M4. Covers intake for both samples and the Space 3074 downlink stage.") : null,
      el("div", { class: "heur", html: icon("circle-info") },
        el("p", {}, el("b", {}, "These are heuristics, not promises. "),
          "The step times below are real: each engine ran each sample three times, reporting when every step started and ended, and the middle of the three times is shown. The estimates further down are not measured: they take those times and scale them in proportion to the file's size. Disk speed, other programs, and what is inside a file all change the real time.")),
      running ? el("div", { class: "trun" }, el("span", { class: "meta" }, `Running ${running.done + 1} of ${running.total}: ${running.now}`),
        el("div", { class: "tbar wide" }, el("i", { class: "best", style: `width:${(running.done / running.total) * 100}%` }))) : null,
      data === null ? el("div", { class: "ttab-sk" }, [0, 1, 2, 3, 4].map(() => el("span", { class: "sk line", style: "width:100%;height:28px;margin:6px 0" })))
        : !results.length ? (running ? el("div", { class: "ttab-sk" }, [0, 1, 2, 3, 4].map(() => el("span", { class: "sk line", style: "width:100%;height:28px;margin:6px 0" }))) : el("p", { class: "meta pad" }, "No tests have run on this computer yet."))
        : el("div", {},
          el("div", { class: "tsec" },
            el("h3", {}, "Step by step"),
            files.length > 1 ? el("div", { class: "seg small", role: "tablist" }, files.map((f) => el("button", { class: f === sample ? "on" : "", role: "tab", "aria-selected": String(f === sample), onclick: () => { sample = f; draw(); } }, f))) : null),
          el("p", { class: "meta" }, `${sample} · ${mb(shown[0].file.bytes)}${shown[0].file.dbBytes ? `, unpacking to ${mb(shown[0].file.dbBytes)}` : ""}. Tested ${new Date(last.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} on ${last.machine.cores} cores, ${Math.round(last.machine.ram / 1e9)} GB memory.`),
          table(shown),
          el("div", { class: "tsec" }, el("h3", {}, "Estimate for a larger file")),
          estimate(results))].filter(Boolean));
  }

  draw(); load();
  return box;
}
