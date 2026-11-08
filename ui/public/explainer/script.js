// The Play demo's script. Each scene is told either in the dark, with its own drawing (mode "dark"), or over the real
// app (mode "app"), where each beat can drive the interface (act), light one part of it (spot) and label it (note).
// A beat's caption is one or two sentences; its numbers are read from real runs (D), never typed in.
import { S, G, T, T2, path, hot, rng, clamp, lerp, fmt, num } from "./kit.js";
import * as demo from "../demo.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const c = (D, k, st) => D[k]?.out?.[st]?.counts ?? {};
const plural = (n, one, many = one + "s") => `${fmt(n)} ${n === 1 ? one : many}`;
const firstItem = (D) => D.sp?.out?.report?.items?.[0] ?? null;
const band = (x) => x?.lo_mhz != null ? `${fmt(x.lo_mhz)}–${fmt(x.hi_mhz)} MHz` : "";
const engineSha = (D) => Object.entries(D.te?.engines ?? {}).map(([k, e]) => [k, e]);
const NAMES = { ts: "TypeScript", rust: "Rust", python: "Python" };

/* a soft rounded card in the dark */
function card(p, x, y, w, h, o = {}) {
  const g = G(p);
  S("rect", { x, y, width: w, height: h, rx: o.r ?? 18, fill: o.fill ?? "rgba(243,241,236,.05)" }, g);
  return g;
}
function pill(p, x, y, label, o = {}) {
  const g = G(p), w = o.w ?? Math.max(120, label.length * 11 + 44);
  S("rect", { x: x - w / 2, y: y - 26, width: w, height: 52, rx: 26, fill: o.fill ?? "rgba(243,241,236,.06)" }, g);
  if (o.dot) S("circle", { cx: x - w / 2 + 24, cy: y, r: 6, fill: o.dot }, g);
  T(g, x + (o.dot ? 10 : 0), y, label, { size: o.size ?? 20, anchor: "middle", fill: o.ink ?? "var(--x-ink)", w: o.weight ?? 400 });
  return g;
}

export const SCENES = [
  /* ---------- 1. The moment ---------- */
  {
    id: "issue", chapter: "The moment", mode: "dark", title: "Every two weeks, | a new file.",
    beats: [
      { say: (D) => `Every two weeks the ITU publishes every new claim on radio spectrum. Issue 3074: <b>${fmt(D.sp.result.database.rows)} rows</b>.` },
      { say: (D) => `Inside, <b>${fmt(c(D, "sp", "downlink").notices)} satellite filings</b>, each a claim on spectrum Finland may use.` },
      { say: (D) => { const l = c(D, "sp", "ladder").levels; return `<span class="crit">${fmt(l.crit)} need attention</span>. <span class="warn">${fmt(l.warn)} are worth a look</span>. The rest can wait.`; } },
    ],
    build(g, A, D) {
      const f = D.sp.file, db = D.sp.result.database;
      // the file
      const fileG = G(g);
      card(fileG, 650, 250, 300, 300, { r: 26 });
      path(fileG, "M760 300h56l34 34v96a10 10 0 0 1-10 10h-80a10 10 0 0 1-10-10v-120a10 10 0 0 1 10-10z", { fill: "rgba(185,166,246,.18)", stroke: "var(--x-acc)", w: 2 });
      path(fileG, "M816 300v34h34", { stroke: "var(--x-acc)", w: 2 });
      T(fileG, 800, 482, f.name, { size: 26, anchor: "middle", w: 500 });
      T(fileG, 800, 518, `${num(f.bytes / 1e6, 1)} MB`, { size: 18, anchor: "middle", fill: "var(--x-ink3)" });
      A.show(fileG, 0, 1, { d: 0.8 });
      A.pose(fileG, [[0, 0, 0, 1], [0.35, -330, 0, 1]], 0.9);
      // what is inside
      const inside = G(g);
      T(inside, 1010, 340, fmt(db.tables.length), { size: 96, w: 600, ls: "-0.04em" });
      T(inside, 1014, 402, "tables", { size: 22, fill: "var(--x-ink3)" });
      T(inside, 1010, 500, fmt(db.rows), { size: 96, w: 600, ls: "-0.04em", fill: "var(--x-acc)" });
      T(inside, 1014, 562, "rows", { size: 22, fill: "var(--x-ink3)" });
      A.show(inside, 0.45, 1, { d: 1, rise: 24 });
      // one dot per filing; they lean away from the pointer
      const n = c(D, "sp", "downlink").notices || 196, lv = c(D, "sp", "ladder").levels ?? { crit: 0, warn: 0 };
      const cols = Math.ceil(Math.sqrt(n * 1.9)), gap = 34, x0 = 800 - ((cols - 1) * gap) / 2, rows = Math.ceil(n / cols), y0 = 430 - ((rows - 1) * gap) / 2;
      const dotsG = G(g), r = rng(7), order = Array.from({ length: n }, (_, i) => i).sort(() => r() - 0.5);
      const dots = order.map((k, i) => {
        const x = x0 + (i % cols) * gap, y = y0 + Math.floor(i / cols) * gap;
        const lvl = k < lv.crit ? "crit" : k < lv.crit + lv.warn ? "warn" : "none";
        return { e: S("circle", { cx: x, cy: y, r: 8, fill: "var(--x-ink3)" }, dotsG), x, y, lvl, d: r() };
      });
      A.show(dotsG, 1, Infinity, { d: 0.6 });
      A.tick((t) => {
        const appear = clamp((t - A.bt(1)) / 1.4), paint = A.at(t, 2, 1.2), m = A.st.mouse;
        for (const p of dots) {
          const k = clamp(appear * 1.6 - p.d * 0.6);
          let dx = 0, dy = 0;
          if (m?.in) { const vx = p.x - m.x, vy = p.y - m.y, dd = Math.hypot(vx, vy); if (dd < 110) { const f = (1 - dd / 110) * 14; dx = (vx / (dd || 1)) * f; dy = (vy / (dd || 1)) * f; } }
          p.e.setAttribute("cx", (p.x + dx).toFixed(1)); p.e.setAttribute("cy", (p.y + dy + (1 - k) * 14).toFixed(1));
          p.e.style.opacity = String(k * (p.lvl === "none" ? lerp(0.9, 0.22, paint) : 1));
          p.e.style.fill = paint > 0.02 && p.lvl !== "none" ? `var(--x-${p.lvl})` : "var(--x-ink3)";
          p.e.setAttribute("r", String(p.lvl !== "none" ? lerp(8, 9.5, paint) : 8));
        }
      });
    },
  },

  /* ---------- 2. Why it has to be exact ---------- */
  {
    id: "proof", chapter: "Why trust it", mode: "dark", title: "You can't send another country | a probability.",
    beats: [
      { say: "Every result comes from a filed record, a published table or a formula. <b>No AI decides a result.</b>" },
      { say: (D) => `Same file, same answer, every time. This one's fingerprint begins <b>${esc(D.sp.result.file.sha256.slice(0, 8))}</b>.` },
    ],
    build(g, A, D) {
      const srcs = [["A filed record", 300], ["A published table", 450], ["A stated formula", 600]];
      const left = G(g);
      srcs.forEach(([s, y], i) => { const p = pill(left, 420, y, s, { w: 300 }); A.show(p, 0, 1, { delay: i * 0.15 }); });
      const arrows = G(g);
      srcs.forEach(([, y]) => A.draw(path(arrows, `M580 ${y} C 800 ${y}, 880 450, 1040 450`, { stroke: "var(--x-ink3)", w: 1.5 }), 0.3, 1.1));
      A.show(arrows, 0, 1);
      const res = pill(g, 1180, 450, "A result", { w: 230, fill: "rgba(185,166,246,.22)", ink: "var(--x-ink)", weight: 500, size: 22 });
      A.show(res, 0.35, 1);
      const noai = G(g);
      T(noai, 1180, 530, "no model, no guess", { size: 17, anchor: "middle", fill: "var(--x-ink3)" });
      A.show(noai, 0.55, 1);
      // the fingerprint
      const sha = D.sp.result.file.sha256, fp = G(g);
      T(fp, 800, 360, "SHA-256", { size: 18, anchor: "middle", fill: "var(--x-ink3)", ls: "0.2em" });
      const line = T(fp, 800, 450, "", { size: 40, anchor: "middle", cls: "mono" });
      S("tspan", { text: sha.slice(0, 8), fill: "var(--x-acc)" }, line);
      S("tspan", { text: sha.slice(8, 32), fill: "var(--x-ink2)" }, line);
      T(fp, 800, 510, sha.slice(32), { size: 40, anchor: "middle", cls: "mono", fill: "var(--x-ink2)" });
      T(fp, 800, 600, "ific3074.zip, 8 November 2026", { size: 18, anchor: "middle", fill: "var(--x-ink3)" });
      hot(line, "Its fingerprint", "Change one byte of the file and this changes completely. Every result Tosi writes records it.");
      A.show(fp, 1, Infinity, { d: 1, rise: 20 });
    },
  },

  /* ---------- 3. A file arrives ---------- */
  {
    id: "drop", chapter: "A file arrives", mode: "app",
    beats: [
      { say: "Drop the issue's zip into Tosi, or pick a sample. It all runs on this computer.", spot: ".home .samples",
        act: async (X, D) => { await X.go("#/", ".home .samples"); scrollTo(0, 0); await X.tap(X.text(".home .sample", "ific3074")); await X.go(`#/flow/${D.spRun.id}`, ".diagram button.node"); } },
    ],
  },

  /* ---------- 4. The questions ---------- */
  {
    id: "flow", chapter: "Questions, in order", mode: "app", title: "An expert's questions, | in order.",
    beats: [
      { say: (D) => { const k = c(D, "sp", "downlink"); return `Does it transmit to the ground? <b>${fmt(k.kept)} of ${fmt(k.notices)}</b> do.`; }, spot: ".sticky",
        act: async (X, D) => { await X.go(`#/flow/${D.spRun.id}`, ".diagram button.node"); await X.flowTo("Downlink"); } },
      { say: (D) => `Can it rise above Finland's horizon? <b>${fmt(c(D, "sp", "reach").seen)}</b> can.`, spot: ".sticky",
        act: async (X) => X.flowTo("Reach") },
      { say: (D) => { const h = c(D, "sp", "compare").how ?? {}; return `In the worst case, <span class="crit">${fmt(h.over)} are over the ITU limit</span>, <span class="warn">${fmt(h.near)} near it</span>.`; }, spot: ".sticky",
        act: async (X) => X.flowTo("Compare") },
      { say: (D) => { const k = c(D, "sp", "stations"); return `<b>${fmt(k.how?.stations)}</b> could reach <b>${fmt(k.stations_hit)} listed Finnish stations</b>.`; }, spot: ".sticky",
        act: async (X) => X.flowTo("Stations") },
    ],
  },

  /* ---------- 5. The notification ---------- */
  {
    id: "report", chapter: "The notification", mode: "app", title: "Not a spreadsheet. | A notification.",
    beats: [
      { say: "Each filing lands on a concern ladder. Out comes a short notification.", spot: ".rp-outline",
        act: async (X, D) => { await X.go(`#/flow/${D.spRun.id}`, ".diagram button.node"); await X.flowTo("Report"); await X.wait(".rp-outline"); } },
      { say: (D) => { const it = firstItem(D); if (!it) return "Open any case to see why it was flagged."; const h = it.how_much ?? {};
          return `<b>${esc(it.name)}</b>, ${esc(it.country)}: <span class="crit">${num(h.excess)} dB over</span> the limit at ${band(h)}, where Finnish stations work.`; },
        spot: () => document.querySelector(".rp-outline .rp-node.x-case") ?? document.querySelector(".rp-outline"),
        act: async (X) => {
          // open the first level, its first rung, then its first case
          let host = document.querySelector(".rp-outline");
          for (let depth = 0; depth < 3 && host; depth++) {
            const node = host.querySelector(":scope > .rp-node") ?? host.querySelector(".rp-node");
            const row = node?.querySelector(":scope > .rp-row");
            if (!row) break;
            if (row.getAttribute("aria-expanded") === "false") await X.press(row); else await X.to(row);
            if (depth === 2) node.classList.add("x-case");
            host = node.querySelector(":scope > .rp-kids");
          }
          document.querySelector(".x-case")?.scrollIntoView({ block: "center", behavior: "smooth" });
        } },
      { say: "The same cases as a table, or as CSV and Excel.", spot: ".rp-head",
        act: async (X) => { await X.press(X.text(".rp-views button", "Table")); await X.to(X.text(".rp-head a, .rp-head button", "Excel")); } },
    ],
    leave() { document.querySelector(".x-case")?.classList.remove("x-case"); },
  },

  /* ---------- 6. The glass box ---------- */
  {
    id: "glass", chapter: "Why trust it", mode: "dark", title: "A glass box, | not a black box.",
    beats: [
      { say: "Every line opens down: to its rung, and the guidebook rule behind it." },
      { say: (D) => { const h = firstItem(D)?.how_much ?? {}; return `To the step that applied it (<b>${num(h.pfd)}</b> where <b>${num(h.limit)}</b> is allowed), and the ITU record itself.`; } },
    ],
    build(g, A, D) {
      const it = firstItem(D) ?? { name: "A filing", country: "", why: {}, how_much: {} };
      const gb = Object.fromEntries((D.gb?.entries ?? []).map((e) => [e.id, e]));
      const cite = it.why?.cites?.[0] ?? "C-1", h = it.how_much ?? {};
      const items = [
        [it.name, it.country, "var(--x-crit)", "The case"],
        [it.why?.wording ?? "", "concern ladder", "var(--x-crit)", "Its rung"],
        [`Guidebook ${cite}`, gb[cite]?.title ?? "", "var(--x-acc)", "The rule"],
        [`Compare · ${h.provision ?? ""}`, `${num(h.pfd)} against ${num(h.limit)} dB(W/m²)`, "var(--x-acc)", "The step"],
        [`ITU file · notice ${it.ntc_id}`, "the row it came from", "var(--x-ink3)", "The source"],
      ];
      const xs = [190, 495, 800, 1105, 1410], y = 430, beatOf = [0, 0.25, 0.5, 1, 1.3], cut = (v, n) => (String(v).length > n ? String(v).slice(0, n - 1) + "…" : String(v));
      items.forEach(([a, b, col, label], i) => {
        const nG = G(g);
        S("rect", { x: xs[i] - 145, y: y - 70, width: 290, height: 140, rx: 20, fill: "rgba(243,241,236,.05)" }, nG);
        S("circle", { cx: xs[i] - 117, cy: y - 40, r: 6, fill: col }, nG);
        T(nG, xs[i] - 102, y - 40, label, { size: 15, fill: "var(--x-ink3)" });
        T(nG, xs[i] - 125, y + 2, cut(a, 28), { size: 18, w: 500 });
        T(nG, xs[i] - 125, y + 34, cut(b, 32), { size: 14, fill: "var(--x-ink2)" });
        hot(nG, label, `${esc(a)}${b ? `<br>${esc(b)}` : ""}`);
        A.show(nG, beatOf[i], Infinity, { d: 0.9, rise: 18 });
        if (i) A.draw(path(g, `M${xs[i - 1] + 147} ${y} L ${xs[i] - 147} ${y}`, { stroke: "var(--x-ink3)", w: 1.5, dash: "3 6" }), beatOf[i] - 0.05, 0.8);
      });
    },
  },

  /* ---------- 8. Three engines ---------- */
  {
    id: "engines", chapter: "Three engines", mode: "dark", title: "Three engines. | One answer.",
    beats: [
      { say: (D) => { const e = engineSha(D), same = e.length === 3 && e.every(([, x]) => x.state === "done") && new Set(e.map(([, x]) => x.sha256)).size === 1;
          return `Every step is written in TypeScript, Rust and Python. ${same ? "On issue 3076 all three write <b>byte-identical</b> results." : "They must write byte-identical results."}`; }, len: 6 },
    ],
    build(g, A, D) {
      const ids = ["ts", "rust", "python"], ys = [300, 450, 600];
      const lanes = G(g);
      ids.forEach((id, i) => {
        T(lanes, 230, ys[i], NAMES[id], { size: 26, w: 500 });
        path(lanes, `M420 ${ys[i]} L 1020 ${ys[i]}`, { stroke: "var(--x-line)", w: 2 });
      });
      A.show(lanes, 0, Infinity);
      // little packets of work flowing along each lane
      const flow = G(g), r = rng(3), packets = Array.from({ length: 27 }, (_, k) => ({ lane: k % 3, ph: r(), e: S("circle", { r: 5, fill: "var(--x-acc)" }, flow) }));
      A.show(flow, 0.3, Infinity);
      // each engine's fingerprint of the same result
      const chips = ids.map((id, i) => {
        const cg = G(g);
        S("rect", { x: 1050, y: ys[i] - 30, width: 330, height: 60, rx: 30, fill: "rgba(243,241,236,.06)" }, cg);
        const tx = T(cg, 1080, ys[i], "", { size: 22, cls: "mono", fill: "var(--x-ink2)" });
        A.show(cg, 0.3, Infinity, { delay: i * 0.2 });
        return { id, tx, cg };
      });
      const tick = G(g);
      S("circle", { cx: 1450, cy: 450, r: 30, fill: "rgba(143,211,176,.18)" }, tick);
      path(tick, "M1436 451 l9 9 l17 -19", { stroke: "var(--x-ok)", w: 3 });
      A.show(tick, 0.7, Infinity);
      A.tick((t) => {
        for (const p of packets) {
          const u = ((t * 0.18 + p.ph) % 1), x = 420 + u * 600;
          p.e.setAttribute("cx", x.toFixed(1)); p.e.setAttribute("cy", String(ys[p.lane])); p.e.style.opacity = String(Math.sin(u * Math.PI) * 0.9);
        }
        const e = D.te?.engines ?? {};
        for (const ch of chips) {
          const x = e[ch.id];
          ch.tx.textContent = x?.state === "done" && x.sha256 ? `${x.sha256.slice(0, 10)}…` : x?.state === "failed" ? "failed" : "checking";
          ch.tx.style.fill = x?.state === "done" ? "var(--x-ink)" : "var(--x-ink3)";
        }
        const all = ids.map((id) => e[id]);
        tick.style.visibility = all.every((x) => x?.state === "done") && new Set(all.map((x) => x.sha256)).size === 1 ? "visible" : "hidden";
      });
    },
  },

  /* ---------- 9. On the ground ---------- */
  {
    id: "ground", chapter: "On the ground", mode: "app",
    beats: [
      { say: (D) => `The same engine, on the ground: of <b>${fmt(c(D, "te", "mobile").notices)}</b> terrestrial filings, <b>${fmt(c(D, "te", "range").kept)}</b> are near enough to matter.`, spot: ".sticky",
        act: async (X, D) => { await X.go(`#/flow/${D.teRun.id}`, ".diagram button.node"); await X.flowTo("Range"); } },
      { say: (D) => { const h = c(D, "te", "threshold").how ?? {}; return `At Finland's border, <span class="crit">${plural(h.over ?? 0, "is", "are")} over</span> the trigger level.`; }, spot: ".sticky",
        act: async (X) => X.flowTo("Threshold") },
    ],
  },

  /* ---------- 10. Rules you can read and change ---------- */
  {
    id: "rules", chapter: "Rules you can change", mode: "app",
    beats: [
      { say: (D) => `Every number lives in a versioned rulebook with its source, like this <b>${fmt(D.rb.threshold?.near_db ?? 3)} dB</b> near-miss margin.`,
        spot: () => document.querySelector("#p-threshold-near_db") ?? document.querySelector("#a-terrestrial-t5"),
        act: async (X) => { await X.go("#/algorithm/t5", "#a-terrestrial-t5"); const p = await X.wait("#p-threshold-near_db", 4000); if (p) { p.scrollIntoView({ block: "center", behavior: "smooth" }); await new Promise((r) => setTimeout(r, 800)); await X.to(p); } } },
    ],
  },

  /* ---------- 11. AI proposes, people decide ---------- */
  {
    id: "ai", chapter: "AI proposes, people decide", mode: "app", title: "AI writes rules, | never results.",
    beats: [
      { say: "An assistant reaches every step through Tosi's MCP server. It can only propose. This is a real, recorded Codex run.", spot: ".dm-panel", len: 7,
        act: async (X) => {
          await X.go("#/algorithm", ".gb-h");
          if (document.querySelector(".dm-panel")?.hidden !== false) await X.press("#ask");
          const ta = await X.wait(".dm-in textarea", 4000);
          if (ta) { await X.to(ta); ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }
        } },
      { say: "Each change waits for a person, and becomes the next version.", spot: ".dm-panel", len: 5 },
    ],
    leave() { try { demo.reset(true); demo.toggle(false); } catch {} },
  },

  /* ---------- 12. Built and next ---------- */
  {
    id: "next", chapter: "What's next", mode: "dark",
    beats: [
      { say: "All of this runs today. Next: an audit track that looks for what the rules miss. It proposes; it never decides.", len: 7 },
    ],
    build(g, A) {
      const built = ["Space and terrestrial screening", "Three engines, byte for byte", "The concern ladder and notification", "A guidebook and versioned rulebook", "An MCP server that only proposes"];
      const next = ["Saving rule changes, with their effect on past issues", "An audit track over months of issues", "Any administration's own national data"];
      const L = G(g), R = G(g);
      T(L, 250, 240, "Built", { size: 20, fill: "var(--x-acc)", ls: "0.12em" });
      built.forEach((s, i) => { S("circle", { cx: 262, cy: 310 + i * 66, r: 6, fill: "var(--x-acc)" }, L); T(L, 290, 310 + i * 66, s, { size: 24 }); });
      T(R, 900, 240, "Next", { size: 20, fill: "var(--x-ink3)", ls: "0.12em" });
      next.forEach((s, i) => { S("circle", { cx: 912, cy: 310 + i * 66, r: 6, fill: "none", stroke: "var(--x-ink3)", "stroke-width": 1.5 }, R); T(R, 940, 310 + i * 66, s, { size: 24, fill: "var(--x-ink2)" }); });
      A.show(L, 0, Infinity, { d: 1 });
      A.show(R, 0.45, Infinity, { d: 1 });
    },
  },

  /* ---------- 13. Close ---------- */
  {
    id: "close", chapter: "Close", mode: "dark",
    beats: [
      { say: "Finland's spectrum, defended with evidence, not guesses." },
      { say: "That was Tosi. It's all live: press Esc and look around.", len: 4 },
    ],
    build(g, A) {
      const a = G(g);
      T2(a, 800, 420, "Experts stop searching, | and start deciding.", { size: 58, w: 600, anchor: "middle", ls: "-0.04em" });
      A.show(a, 0, 1, { d: 1.2, rise: 20 });
      const b = G(g);
      T(b, 800, 420, "Tosi", { size: 110, w: 600, anchor: "middle", ls: "-0.05em" });
      T(b, 800, 500, "true, and there to see", { size: 22, anchor: "middle", fill: "var(--x-ink3)" });
      A.show(b, 1, Infinity, { d: 1.2, rise: 20 });
    },
  },
];
