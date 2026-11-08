// The report: the notification, read like a document below the scroll story. On top, an outliner: the cases that need
// attention and those worth a look, grouped by rung, one plain line each; open a case for why, how much, Finland's own
// use of the frequencies, the listed stations it touches, what to do next and the numbers. A switch shows the same
// report as a table (the rows of report.csv), and the files download as CSV, Excel or the short notification. At the
// bottom, the map: the sky above Finland with the reported satellites, or the region with the reported stations.
// Everything shown comes from the engine's report and ladder results; nothing here decides anything.
import { icon } from "../icons.js";
import { makeGlobe } from "../reachglobe.js";
import { makeTerra } from "./terra.js";
import { LEVEL_WORDS } from "./ladder.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const num = (v, d = 1) => Number(v).toLocaleString("en-GB", { maximumFractionDigits: d });
const signed = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${num(Math.abs(v))}`;
const plural = (n, one, many = one + "s") => `${num(n, 0)} ${n === 1 ? one : many}`;
const CLASS = { BC: "broadcasting", BT: "television", FX: "fixed link", FB: "base station", ML: "land mobile", MO: "mobile", AL: "aeronautical", RA: "radio astronomy" };
const ITU_WORDS = { provn: "a coordination provision naming Finland", tr_aff_ntw: "a Finnish network listed as affected", srv_area: "Finland inside its declared service area" };
const BAR = { lo: -12, hi: 45 };          // the dB range every bar shares, so bars compare across cases

export function makeReport(ctx) {
  const { el, box, fmt, kind } = ctx;
  const rid = kind === "terrestrial" ? "treport" : "report", lid = kind === "terrestrial" ? "tladder" : "ladder";
  const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };
  let mode = store("tosi.reportView") === "table" ? "table" : "outline", built = null, run = null, lit = null, map = null;

  // until the report is in: a skeleton shaped like it
  const skeleton = () => el("div", { class: "rp-sk" },
    el("span", { class: "sk title", style: "width:200px" }), el("span", { class: "sk line", style: "width:340px;margin-top:12px" }),
    ...[0, 1, 2, 3, 4, 5].map((i) => el("div", { class: "rp-skrow", style: `padding-left:${i ? 24 : 0}px` }, el("span", { class: "sk dot" }), el("span", { class: "sk line", style: `width:${[260, 380, 320, 420, 300, 360][i]}px` }))));
  box.replaceChildren(skeleton());

  /* ---------- words for one case ---------- */
  const space = kind !== "terrestrial";
  const idOf = (it) => space ? it.ntc_id : it.terrakey;
  // Space: a filing's worst transmission (how_much) and, for a station rung, the transmission the rung rests on
  // (evidence). The bar and the number at the end of a case's line are the margin its rung rests on.
  const band = (m) => m?.lo_mhz != null && m?.hi_mhz != null ? `${num(m.lo_mhz, 3)}–${num(m.hi_mhz, 3)} MHz` : null;
  const sameBand = (a, b) => a && b && a.lo_mhz === b.lo_mhz && a.hi_mhz === b.hi_mhz && a.excess === b.excess;
  const ev = (it) => space && it.evidence && !sameBand(it.evidence, it.how_much) ? it.evidence : null;
  const excessOf = (it) => space ? (it.evidence?.excess ?? it.how_much?.excess) : it.field?.excess;
  const overUnder = (x) => `${num(Math.abs(x))} dB ${x > 0 ? "over" : "under"} the limit`;
  function headline(it) {
    const parts = [], x = excessOf(it);
    if (space) {
      const h = it.how_much, e = ev(it), st = it.stations ?? {};
      if (h?.excess != null) parts.push(`${overUnder(h.excess)}${band(h) && e ? ` at worst (${band(h)})` : ""}`);
      else parts.push("its power could not be compared with a limit");
      const n = it.evidence?.count ?? st.count;
      if (e) parts.push(`${num(Math.abs(e.excess))} dB ${e.excess > 0 ? "over" : "under"} at ${band(e)}, the frequencies of ${plural(n ?? 0, "listed Finnish station")}`);
      else if (n) parts.push(`on the frequencies of ${plural(n, "listed Finnish station")}`);
      else if (st.near_frequency) parts.push(`next to the frequencies of ${plural(st.near_frequency, "listed Finnish station")}`);
      if (it.why?.itu?.length) parts.push("the ITU names Finland as affected");
    } else {
      if (x != null) parts.push(`${num(Math.abs(x))} dB ${x > 0 ? "over" : "under"} the trigger level at Finland's border, ${num(it.distance_km ?? it.field?.km, 0)} km away`);
      if (it.coordination?.completed) parts.push("coordination with Finland completed: to verify");
      if (it.stations?.over) parts.push(`too strong at ${plural(it.stations.over, "listed Finnish station")}`);
    }
    return parts.join(", ");
  }
  const nameOf = (it) => space ? (it.name ?? `Filing ${it.ntc_id}`) : (it.site ?? `Station ${it.terrakey}`);
  const countryOf = (it) => it.country ?? it.administration ?? "";

  // a bar of how far over (or under) the limit, the limit marked; red or amber by the case's level
  function bar(x, level, big) {
    if (x == null) return el("span", { class: "rp-bar none" + (big ? " big" : "") });
    const P = (v) => `${(clamp((v - BAR.lo) / (BAR.hi - BAR.lo)) * 100).toFixed(2)}%`;
    const a = Math.min(0, x), b = Math.max(0, x);
    return el("span", { class: `rp-bar ${level}` + (big ? " big" : ""), title: `${signed(x)} dB against the limit` },
      el("i", { class: "rp-fill", style: `left:${P(a)};width:calc(${P(b)} - ${P(a)})` }),
      el("i", { class: "rp-zero", style: `left:${P(0)}` }),
      big ? el("small", { class: "rp-zl", style: `left:${P(0)}` }, space ? "the limit" : "trigger level") : null);
  }

  // one line of an outliner: chevron (if it opens), a dot, the text, and things at the end
  function node({ level, text, end, kids, open = false, cls = "", onHover }) {
    const k = el("div", { class: "rp-kids", hidden: !open });
    const chev = el("span", { class: "chev" + (open ? " open" : ""), html: kids ? icon("chevron-right") : "" });
    const row = el(kids ? "button" : "div", { class: "rp-row" + (kids ? "" : " leaf"), "aria-expanded": kids ? String(open) : null }, chev,
      level !== undefined ? el("i", { class: `rp-dot ${level ?? ""}` }) : null, el("span", { class: "rp-text" }, text), end ? el("span", { class: "rp-end" }, end) : null);
    const wrap = el("div", { class: "rp-node " + cls }, row, k);
    let filled = false;
    const fill = () => { if (!filled && kids) { k.append(...(typeof kids === "function" ? kids() : kids)); filled = true; } };
    if (open) fill();
    if (kids) row.addEventListener("click", () => { const o = k.hidden; if (o) fill(); k.hidden = !o; chev.classList.toggle("open", o); row.setAttribute("aria-expanded", String(o)); });
    if (onHover) { row.addEventListener("pointerenter", () => onHover(true)); row.addEventListener("pointerleave", () => onHover(false)); }
    wrap.open = () => { if (k.hidden) row.click(); };
    return wrap;
  }
  const line = (label, ...body) => el("div", { class: "rp-line" }, el("span", { class: "rp-lab" }, label), el("div", { class: "rp-say" }, ...body));
  const citeTag = (ids) => (ids ?? []).map((c) => { const g = ctx.guide()?.[c]; return el("span", { class: "rp-cite", title: g ? `Guidebook ${c}, ${g.title}: ${g.rule}` : `Guidebook ${c}` }, `Guidebook ${c}`); });

  function details(it) {
    const lv = it.why?.level, x = excessOf(it), out = [];
    out.push(line("Why", el("span", {}, `${it.why?.wording ?? ""}. ${it.why?.means ?? ""}.`), ...citeTag(it.why?.cites),
      it.why?.itu?.length ? el("div", { class: "rp-sub" }, `The ITU's own records name Finland: ${it.why.itu.map((k) => ITU_WORDS[k] ?? k).join("; ")}.`) : null));
    if (space) {
      // Every station list and every Finnish use shown sits next to the margin, and the band, it is about.
      const h = it.how_much, e = ev(it), st = it.stations ?? {};
      out.push(line(e ? "Worst" : "How much", h ? el("div", {},
        bar(h.excess, lv, true),
        el("div", { class: "rp-sub" }, `${band(h) ? `Its worst transmission, at ${band(h)}: about` : "About"} ${num(h.pfd)} dB(W/m²) could arrive at Finland where ${num(h.limit)} is allowed, ${overUnder(h.excess)}${h.provision ? ` (${h.provision})` : ""}, assuming the worst. Strongest at ${num(h.angle)}° above the horizon, ${num(h.distance_km, 0)} km away.`))
        : el("span", {}, "Its power could not be compared with a limit, so how much is not known.")));
      out.push(uses(h?.finnish_use ?? (e ? null : it.finnish_use), band(h)));
      if (e) {
        out.push(line("At the stations", el("div", {},
          bar(e.excess, lv, true),
          el("div", { class: "rp-sub" }, `The transmission its rung rests on, at ${band(e) ?? "another band"}: ${overUnder(e.excess)}, on the frequencies of ${plural(e.count ?? 0, "listed Finnish station")}${e.first?.length ? `: ${e.first.join(", ")}${e.count > e.first.length ? ", …" : ""}` : ""}.`))));
        out.push(uses(e.finnish_use, band(e)));
      } else if (it.evidence?.count) {          // the rung rests on the worst transmission itself: its stations
        const v = it.evidence;
        out.push(line("At the stations", el("span", {}, `At this transmission, on the frequencies of ${plural(v.count, "listed Finnish station")}${v.first?.length ? `: ${v.first.join(", ")}${v.count > v.first.length ? ", …" : ""}` : ""}.`)));
      }
      out.push(line("What it is", el("span", {}, `${it.where ?? ""}. ${it.seen?.seen === false ? "Cannot be seen from Finland." : "Can be seen from Finland."} Filed by ${countryOf(it)}.`)));
      // every transmission together: totals only, since station names belong next to their own transmission above
      const first = it.evidence ? [] : st.first ?? [], n = st.count ?? 0;
      const split = [st.over ? `${num(st.over, 0)} at a transmission over the limit` : null, st.near ? `${num(st.near, 0)} only at a transmission near it` : null].filter(Boolean).join(", ");
      out.push(line(it.evidence ? "In all" : "Listed stations", el("span", {}, n ? `Across all its transmissions, on the frequencies of ${plural(n, "listed Finnish station")}${split ? ` (${split})` : ""}${first.length ? `: ${first.join(", ")}${n > first.length ? ", …" : ""}` : ""}.`
        : st.near_frequency ? `No listed Finnish station on its frequencies, but ${plural(st.near_frequency, "station")} just next to them.` : "No listed Finnish station on or next to its frequencies.")));
    } else {
      const f = it.field;
      out.push(line("How much", f ? el("div", {},
        bar(x, lv, true),
        el("div", { class: "rp-sub" }, `${num(f.e)} dB(µV/m) at Finland's ${f.at?.kind === "sea" ? "sea limit" : "land border"}, where the trigger level is ${num(f.limit)}${f.bandwidth_correction ? ` (with ${num(f.bandwidth_correction)} dB for its channel width)` : ""}: ${num(Math.abs(f.excess))} dB ${f.excess > 0 ? "over" : "under"}. ${num(f.km, 0)} km to the border, ${num((1 - (f.land ?? 1)) * 100, 0)}% of the way over sea.`))
        : el("span", {}, "Its signal could not be worked out.")));
      const p = it.power ?? {};
      out.push(line("What it is", el("span", {}, `A ${CLASS[it.class] ?? `class ${it.class}`} at ${it.site ?? "?"} (${it.site_country ?? countryOf(it)}), on ${num(it.f_mhz, 4)} MHz, ${num(it.distance_km, 0)} km from Finland. `
        + `${p.erp_dbw != null ? `Radiates ${num(p.erp_dbw)} dBW` : ""}${p.heff_m != null ? ` from an antenna ${num(p.heff_m, 0)} m up` : ""}${p.assumptions?.length ? " (height above ground used, as the effective height is not filed)" : ""}. Filed by ${countryOf(it)}.`)));
      out.push(line("Coordination", el("span", {}, it.coordination?.completed ? `Finland has completed coordination for it${it.coordination.records?.length ? ` (${it.coordination.records.join(", ")})` : ""}. Check that it covers the station as filed now.` : "No completed coordination with Finland on record.")));
      const st = it.stations ?? {}, w = st.worst;
      out.push(line("Listed stations", el("span", {}, st.over ? `Too strong at ${plural(st.over, "listed Finnish station")}: ${(st.first ?? []).join(", ")}${st.over > (st.first?.length ?? 0) ? ", …" : ""}.${w ? ` The worst, station ${w.station}, ${num(w.km, 0)} km away, gets ${num(w.e)} dB(µV/m), ${num(Math.abs(w.excess))} dB ${w.excess > 0 ? "over" : "under"}.` : ""}`
        : w ? `Under the trigger level at every listed Finnish station on its channel. Closest: station ${w.station}, ${num(Math.abs(w.excess))} dB under, ${num(w.km, 0)} km away.` : "No listed Finnish station on its channel.")));
    }
    if (!space) out.push(uses(it.finnish_use, it.f_mhz != null ? `${num(it.f_mhz, 4)} MHz` : null));
    out.push(line("Next", el("span", { class: "rp-next" }, it.next ?? "")));
    out.push(node({ text: el("span", { class: "rp-line in" }, el("span", { class: "rp-lab" }, "Numbers"), el("span", { class: "rp-say dim" }, "as the engine wrote them")), kids: () => [numbers(it)] }));
    return out.filter(Boolean);
  }
  // Finland's own use of a band (the national frequency table, M4), licence-exempt uses first; opens to the list
  function uses(u, where) {
    const list = u?.uses ?? [], ex = new Set(u?.exempt ?? []), at = where ? `at ${where}` : "on these frequencies";
    if (!u) return null;
    if (!list.length) return line("Finnish use", el("span", {}, `Finland's frequency table (M4) lists no use ${at}.`));
    return node({ text: el("span", { class: "rp-line in" }, el("span", { class: "rp-lab" }, "Finnish use"), el("span", { class: "rp-say" }, `${plural(list.length, "use")} in Finland's frequency table (M4) ${at}${ex.size ? `, ${num(ex.size, 0)} of them licence-exempt` : ""}`)),
      kids: () => [el("div", { class: "rp-uses" }, ...[...list].sort((a, b) => ex.has(b) - ex.has(a)).map((x) => el("span", { class: "rp-use" + (ex.has(x) ? " ex" : "") }, x, ex.has(x) ? el("small", {}, "licence-exempt") : null)))] });
  }
  function numbers(it) {
    const kv = space ? [["Filing (ntc_id)", it.ntc_id], ["Administration", it.administration], ["Power arriving", it.how_much?.pfd != null ? `${num(it.how_much.pfd, 2)} dB(W/m²)` : null], ["Limit", it.how_much?.limit != null ? `${num(it.how_much.limit, 2)} dB(W/m²)` : null],
      ["Against the limit", it.how_much?.excess != null ? `${signed(it.how_much.excess)} dB` : null], ["Worst band", band(it.how_much)], ["Provision", it.how_much?.provision],
      ["Rung rests on", it.evidence ? `${signed(it.evidence.excess)} dB at ${band(it.evidence) ?? "?"}` : null], ["Arrival angle", it.how_much?.angle != null ? `${num(it.how_much.angle, 2)}°` : null], ["Distance", it.how_much?.distance_km != null ? `${num(it.how_much.distance_km, 0)} km` : null],
      ["Listed stations", it.stations?.count], ["At a transmission over the limit", it.stations?.over], ["Only at a transmission near it", it.stations?.near], ["Next to listed stations", it.stations?.near_frequency], ["Rung", it.why?.rung]]
      : [["Station (terrakey)", it.terrakey], ["Administration", it.administration], ["Frequency", it.f_mhz != null ? `${num(it.f_mhz, 4)} MHz` : null], ["Position", it.lat != null ? `${num(it.lat, 3)}° N, ${num(it.lon, 3)}° E` : null],
      ["Distance to Finland", it.distance_km != null ? `${num(it.distance_km, 1)} km` : null], ["e.r.p.", it.power?.erp_dbw != null ? `${num(it.power.erp_dbw)} dBW` : null], ["Effective height", it.power?.heff_m != null ? `${num(it.power.heff_m, 0)} m` : null],
      ["Field at the border", it.field?.e != null ? `${num(it.field.e, 2)} dB(µV/m)` : null], ["Trigger level", it.field?.limit != null ? `${num(it.field.limit, 2)} dB(µV/m)` : null], ["Against the trigger", it.field?.excess != null ? `${signed(it.field.excess)} dB` : null],
      ["Listed stations over", it.stations?.over], ["Rung", it.why?.rung]];
    return el("dl", { class: "rp-kv" }, ...kv.filter(([, v]) => v != null && v !== "").flatMap(([k, v]) => [el("dt", {}, k), el("dd", {}, String(v))]));
  }

  /* ---------- the outliner ---------- */
  const cases = new Map();               // id -> its node, to open from the map
  function outline(items) {
    const rb = ctx.rulebooks?.[lid], rungs = rb?.rungs ?? [];
    const levels = ["crit", "warn"].map((lv) => ({ lv, items: items.filter((x) => x.why?.level === lv) })).filter((g) => g.items.length);
    if (!levels.length) return el("div", { class: "rp-none" }, `Nothing to report: no ${space ? "filing" : "station"} needs attention or is worth a look.`);
    return el("div", { class: "rp-outline" }, ...levels.map((g) => node({
      level: g.lv, open: true, cls: "lvl",
      text: el("span", {}, el("b", {}, LEVEL_WORDS[g.lv]), " ", el("span", { class: "rp-count" }, fmt(g.items.length))),
      kids: () => {
        const byRung = new Map(); for (const it of g.items) (byRung.get(it.why.rung) ?? byRung.set(it.why.rung, []).get(it.why.rung)).push(it);
        const order = [...byRung.keys()].sort((a, b) => rungs.findIndex((r) => r.key === a) - rungs.findIndex((r) => r.key === b));
        return order.map((k) => { const r = rungs.find((x) => x.key === k), list = byRung.get(k); return node({
          open: true, cls: "rung",
          text: el("span", {}, el("b", { class: "rp-rn" }, r?.rung ?? list[0].why?.wording ?? k), " ", el("span", { class: "rp-count" }, fmt(list.length)), el("span", { class: "rp-means" }, r?.means ?? list[0].why?.means ?? "")),
          end: citeTag(r?.cites ?? list[0].why?.cites),
          kids: () => list.map((it) => { const n = node({
            level: g.lv, cls: "case",
            text: el("span", {}, el("b", {}, nameOf(it)), el("span", { class: "rp-ctry" }, countryOf(it)), el("span", { class: "rp-hl" }, headline(it))),
            end: [bar(excessOf(it), g.lv, false), el("span", { class: "rp-x" }, excessOf(it) != null ? `${signed(excessOf(it))} dB` : "")],
            kids: () => details(it),
            onHover: (on) => { lit = on ? idOf(it) : null; map?.light(); },
          }); n.dataset.case = String(idOf(it)); cases.set(String(idOf(it)), n); return n; }),
        }); });
      },
    })));
  }

  /* ---------- the table: the rows of report.csv ---------- */
  let csv = null, filter = "all", shown = 200;
  function parseCsv(t) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < t.length; i++) { const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
      if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c; }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function table(host) {
    if (!csv) {
      host.replaceChildren(el("div", { class: "rp-tsk" }, ...Array.from({ length: 8 }, () => el("span", { class: "sk line" }))));
      fetch(`/api/runs/${ctx.runId()}/report/report.csv?view`).then((r) => r.ok ? r.text() : Promise.reject()).then((t) => { csv = parseCsv(t); if (mode === "table") table(host); })
        .catch(() => host.replaceChildren(el("div", { class: "rp-none" }, "The table could not be read.")));
      return;
    }
    const [head, ...rows] = csv, L = head.indexOf("Level");
    const count = (lv) => rows.filter((r) => r[L] === lv).length;
    const pick = rows.filter((r) => filter === "all" || r[L] === filter);
    const chip = (k, label, n) => el("button", { class: "rp-chip" + (filter === k ? " on" : ""), onclick: () => { filter = k; shown = 200; table(host); } }, k !== "all" ? el("i", { class: `rp-dot ${k}` }) : null, label, el("span", {}, fmt(n)));
    host.replaceChildren(...[
      el("div", { class: "rp-chips" }, chip("all", "Every row", rows.length), chip("crit", LEVEL_WORDS.crit, count("crit")), chip("warn", LEVEL_WORDS.warn, count("warn"))),
      el("div", { class: "rp-tw" }, el("table", { class: "rp-table" },
        el("thead", {}, el("tr", {}, ...head.map((h) => el("th", {}, h)))),
        el("tbody", {}, ...pick.slice(0, shown).map((r) => el("tr", {}, ...r.map((v, j) => el("td", { class: j === L ? "lv" : /^-?\d+(\.\d+)?$/.test(v) ? "n" : "" }, j === L && v !== "none" ? el("i", { class: `rp-dot ${v}` }) : null, v))))))),
      pick.length > shown ? el("button", { class: "btn rp-more", onclick: () => { shown = pick.length; table(host); } }, `Show all ${fmt(pick.length)} rows`) : null].filter(Boolean));
  }

  /* ---------- the map ---------- */
  function spaceMap(host, items) {
    const globe = ctx.finland ? makeGlobe(el, ctx.finland) : null;
    if (!globe) return null;
    host.append(globe.svg);
    const tip = el("div", { class: "ttip", hidden: true });
    const level = new Map(items.map((it) => [it.ntc_id, it.why?.level]));
    const reach = new Map((run.reach?.notices ?? []).map((r) => [r.ntc_id, r]));
    const byId = new Map(items.map((it) => [it.ntc_id, it]));
    // every filing Finland can see, faint for context; the reported ones on top, in their level's colour
    const ids = [...reach.values()].filter((r) => r.seen).map((r) => r.ntc_id).sort((a, b) => (level.has(a) - level.has(b)));
    const dots = ids.map((id) => { const lv = level.get(id), e = el("i", { class: "rp-sat" + (lv ? ` ${lv}` : ""), "data-ntc": String(id) }); host.append(e); return { id, e, lv }; });
    host.append(tip);
    let W = 0, H = 0;
    function place() {
      for (const d of dots) { const at = ctx.skyAt(reach.get(d.id)), s = d.lv ? 11 : 6, p = globe.place(at.az, at.el, s); if (!p) continue;
        d.e.style.transform = `translate(${p.x}px, ${p.y}px)`; d.e.style.opacity = d.lv ? (p.far ? "0.7" : "1") : (p.far ? "0.2" : "0.35"); }
    }
    function layout() {
      W = host.clientWidth; H = host.clientHeight;
      globe.layout({ x0: W * 0.12, x1: W * 0.88, y0: H * 0.08, y1: H * 0.95 }); globe.show(1, 0); place();
    }
    // drag to turn the sky, double-click to go back; hover a satellite for its case, click to open it above
    let drag = null;
    const at = (ev) => { const b = host.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
    host.addEventListener("pointerdown", (ev) => { const p = at(ev); if (ev.button !== 0 || ev.target.closest(".rp-sat") || !globe.over(p.x, p.y)) return; drag = { ...p, id: ev.pointerId }; host.setPointerCapture(ev.pointerId); host.classList.add("turning"); });
    host.addEventListener("pointermove", (ev) => {
      const p = at(ev);
      if (drag && ev.pointerId === drag.id) { globe.turn(-(p.x - drag.x) * 0.4, -(p.y - drag.y) * 0.3); drag.x = p.x; drag.y = p.y; place(); return; }
      const d = ev.target.closest(".rp-sat"), it = d && byId.get(Number(d.dataset.ntc));
      if (!d) { tip.hidden = true; return; }
      const name = it ? nameOf(it) : ctx.filings?.[d.dataset.ntc]?.name ?? `Filing ${d.dataset.ntc}`;
      tip.replaceChildren(el("div", { class: "tt-h" }, el("b", {}, name), el("code", {}, d.dataset.ntc)),
        it ? el("div", { class: it.why.level === "crit" ? "tt-bad" : "tt-warn" }, `${it.why.wording}: ${headline(it)}`) : el("div", { class: "tt-s" }, "Not in the report"),
        it ? el("div", { class: "tt-s" }, "Click to open it in the report") : null);
      tip.hidden = false;
      tip.style.left = `${clamp(p.x + 14, 4, W - tip.offsetWidth - 4)}px`; tip.style.top = `${clamp(p.y + 14, 4, H - tip.offsetHeight - 4)}px`;
    });
    const end = (ev) => { if (drag && ev.pointerId === drag.id) { drag = null; host.classList.remove("turning"); } };
    host.addEventListener("pointerup", end); host.addEventListener("pointercancel", end);
    host.addEventListener("pointerleave", () => { tip.hidden = true; });
    host.addEventListener("dblclick", () => { globe.reset(); place(); });
    host.addEventListener("click", (ev) => { const d = ev.target.closest(".rp-sat"); if (d && byId.has(Number(d.dataset.ntc))) openCase(d.dataset.ntc); });
    return { layout, light() { for (const d of dots) d.e.classList.toggle("lit", lit != null && d.id === lit); } };
  }
  function terraMap(host, items) {
    const focus = new Map(items.map((it) => [it.terrakey, it.why?.level]));
    const T = makeTerra({ el, stage: host, out: run.out, fmt, region: ctx.region, bare: true, focus, lit: () => lit, get stations() { return ctx.stations; } });
    const tip = el("div", { class: "ttip", hidden: true }); host.append(tip);
    const ALL = { mobile: 1, range: 1, tdata: 1, field: 1, threshold: 1, tstations: 1 };
    const draw = () => T.frame(ALL, 1, 1);
    let W = 0, H = 0, over = null;
    const at = (ev) => { const b = host.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
    host.addEventListener("pointermove", (ev) => {
      const p = at(ev), lines = T.hover(p.x, p.y);
      draw();
      if (!lines) { tip.hidden = true; over = null; host.style.cursor = ""; return; }
      const k = Number(lines[0]?.querySelector?.("b")?.textContent?.replace(/\D/g, ""));
      over = focus.has(k) ? k : null; host.style.cursor = over ? "pointer" : "";
      if (over) lines.push(el("div", { class: "tt-s" }, "Click to open it in the report"));
      tip.replaceChildren(...lines); tip.hidden = false;
      tip.style.left = `${clamp(p.x + 14, 4, W - tip.offsetWidth - 4)}px`; tip.style.top = `${clamp(p.y + 14, 4, H - tip.offsetHeight - 4)}px`;
    });
    host.addEventListener("pointerleave", () => { tip.hidden = true; T.hover(-999, -999); draw(); });
    host.addEventListener("click", () => { if (over) openCase(String(over)); });
    return { layout() { W = host.clientWidth; H = host.clientHeight; if (W < 10 || H < 10) return; T.layout({ W, H }, null); draw(); }, light: () => { if (W >= 10) draw(); } };
  }
  function openCase(id) {
    const n = cases.get(String(id));
    if (mode !== "outline") setMode("outline");
    const target = cases.get(String(id)) ?? n;
    if (!target) return;
    for (let p = target.parentElement; p && p !== box; p = p.parentElement) if (p.classList.contains("rp-node")) p.open?.();
    target.open();
    const head = parseFloat(getComputedStyle(box).getPropertyValue("--flowhead")) || 90;
    scrollTo({ top: scrollY + target.getBoundingClientRect().top - head - 16, behavior: "smooth" });
    target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash");
  }

  /* ---------- the section ---------- */
  let views, bOutline, bTable;
  function setMode(m) {
    mode = m; store("tosi.reportView", m);
    bOutline.classList.toggle("on", m === "outline"); bTable.classList.toggle("on", m === "table");
    if (m === "outline") { cases.clear(); views.replaceChildren(outline(built.items)); } else table(views);
  }
  function build(r) {
    const o = r.out[rid], items = o.items ?? [], c = o.counts ?? {}, what = space ? "filings" : "stations";
    built = { items };
    const base = `/api/runs/${r.id}/report/`;
    bOutline = el("button", { class: "rp-vb", "aria-label": "Show as an outline", title: "As an outline", html: icon("list-ul"), onclick: () => setMode("outline") });
    bTable = el("button", { class: "rp-vb", "aria-label": "Show as a table", title: "As a table", html: icon("table"), onclick: () => setMode("table") });
    const dl = (file, ic, label, tip) => el("a", { class: "btn", href: base + file, download: "", title: tip, html: icon(ic) }, label);
    const cites = [...new Set(items.flatMap((x) => x.why?.cites ?? []))];
    views = el("div", { class: "rp-view" });
    const mapHost = el("div", { class: "rp-map" + (space ? " sky" : " land") });
    box.replaceChildren(
      el("div", { class: "rp-head" },
        el("div", { class: "rp-title" }, el("h2", {}, "The notification"),
          el("p", {}, el("b", {}, `${fmt(c.crit ?? 0)} ${space ? "filing" : "station"}${c.crit === 1 ? " needs" : "s need"} attention`), ` · ${fmt(c.warn ?? 0)} worth a look · of ${fmt(c.notices ?? 0)} ${what} screened`)),
        el("div", { class: "rp-tools" },
          el("div", { class: "rp-views", role: "group", "aria-label": "View" }, bOutline, bTable),
          dl("report.csv", "file-csv", "CSV", "Every " + (space ? "filing" : "station") + " as one row (report.csv)"),
          dl("report.xlsx", "file-excel", "Excel", "The same rows as a spreadsheet"),
          dl("report.md", "file-lines", "Notification", "The short notification as text (report.md)"))),
      el("p", { class: "rp-basis" }, `Each case on the highest rung that applies, worst first. Based on ${cites.length ? `the guidebook (${cites.join(", ")}) and ` : ""}Finland's frequency table (Traficom Radio Frequency Regulation 4).`),
      views,
      el("div", { class: "rp-maph" }, el("h3", {}, space ? "In the sky above Finland" : "Where they stand"),
        el("p", {}, space ? "Each reported satellite where you would look to find it from the middle of Finland; the others Finland can see, faint. Not to scale. Drag to turn it." : "Each reported station where it stands, with its strongest path to Finland's border; every other station faint.")),
      mapHost);
    setMode(mode);
    map = space ? spaceMap(mapHost, items) : terraMap(mapHost, items);
    requestAnimationFrame(() => map?.layout());
  }

  return {
    update(r) {
      run = r;
      if (!built && r.out?.[rid] && (space || r.out?.mobile)) build(r);
    },
    layout() { map?.layout(); },
    cleanup() {},
  };
}
