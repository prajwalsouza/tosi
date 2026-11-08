// The space scenes after Reach. The sky above Finland stays on screen (the default view): each scene filters or
// colours the satellites where they are, and the ones that step aside drift to the right, grouped by why. A satellite
// that cannot be calculated is never dropped: it keeps its place in the sky with a ring, because not knowing matters.
// Power draws each satellite's beam down to Finland; Compare colours the concerns; Stations puts Finland's listed
// stations on the ground. The other view (the toggle) shows the same results as a grid or a chart.
// Every scene reads only its stage's result and draws nothing it must decide.
import { plan } from "../dots.js";
import { makeRungs, levelColour, LEVEL_WORDS } from "./ladder.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const NS = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
const num = (v, d = 1) => v.toLocaleString("en-GB", { maximumFractionDigits: d });
const dbText = (v) => v > 0 ? `${num(v)} dB over` : `${num(-v)} dB under`;
const spreadDb = (dkm) => 10 * Math.log10(4 * Math.PI * (dkm * 1000) ** 2);
const CLASS = { BC: "broadcasting", BT: "television", FX: "fixed link", FB: "base station", ML: "land mobile", MUUT: "other", AL: "aeronautical", MO: "mobile", RA: "radio astronomy" };

function layer(ctx, cls) {                                   // an SVG layer under the dots
  const svg = svgEl("svg", { class: `schart ${cls}`, "aria-hidden": "true" });
  ctx.stage.insertBefore(svg, ctx.dots[0]?.e ?? null);
  return svg;
}
const centre = (ctx, p) => ({ x: p.x + ctx.size() / 2, y: p.y + ctx.size() / 2 });

// Right-hand groups for the satellites that step aside, the same in both views.
function sideGroups(ctx, geo, groups, labels) {
  const { W, H } = geo, top = Math.max(H * 0.3, 200), cell = Math.max(ctx.size() * 1.7, 10);
  const rx = W * 0.71, rcols = Math.max(4, Math.floor((W * 0.27) / cell));
  let y = top;
  const at = new Map();
  for (const L of labels) {
    L.e.style.left = `${rx}px`; L.e.style.top = `${y}px`;
    const mine = groups.get(L.k) ?? [];
    mine.forEach((x, i) => at.set(x, { x: rx + (i % rcols) * cell, y: y + 34 + Math.floor(i / rcols) * cell }));
    y += 34 + Math.ceil(mine.length / rcols) * cell + 22;
  }
  return at;
}

// A scene where satellites go on or step aside. In the sky they keep their place or drift to the side; in the grid
// view they line up at the left. unknown(n): stays in the sky with a ring instead of stepping aside.
function filterScene(id, { keptText, shortOf, keep, why, unknown, sub, describe }) {
  return (ctx) => {
    const o = ctx.out[id], by = new Map(o.notices.map((n) => [n.ntc_id, n]));
    const dots = ctx.dots.filter((x) => by.has(x.n.ntc_id));
    for (const x of dots) { x.at ??= {}; x.sky ??= {}; x[id] = by.get(x.n.ntc_id); if (unknown?.(x[id])) x.unknown = true; }
    const kept = dots.filter((x) => keep(x[id])), groups = new Map();
    for (const x of dots) if (!keep(x[id])) { const k = why(x[id]); (groups.get(k) ?? groups.set(k, []).get(k)).push(x); }
    const labels = [...groups.keys()].sort().map((k) => { const e = ctx.el("div", { class: "nleft" }, ctx.el("b", {}, shortOf(k)), ctx.el("span", {}, ctx.fmt(groups.get(k).length))); ctx.stage.append(e); return { k, e }; });
    const keptLabel = ctx.el("div", { class: "nleft kept" }, ctx.el("b", {}, keptText), ctx.el("span", {}, ctx.fmt(kept.length)));
    const subEl = ctx.el("div", { class: "nsub wrap" }, sub ? sub(o) : "");
    ctx.stage.append(keptLabel, subEl);
    return {
      id,
      layout(geo) {
        const { W, H } = geo, top = Math.max(H * 0.3, 200), bottom = H * 0.9, bw = W * 0.56, bx = W * 0.06;
        const pl = plan(Math.max(1, kept.length), bw, bottom - top - 70);
        kept.forEach((x, i) => { x.at[id] = { x: bx + (i % pl.cols) * pl.cell, y: top + 70 + Math.floor(i / pl.cols) * pl.cell }; x.sky[id] = x.gt; });
        const side = sideGroups(ctx, geo, groups, labels);
        for (const [x, p] of side) { x.at[id] = p; x.sky[id] = unknown?.(x[id]) ? x.gt : p; }
        keptLabel.style.left = `${bx}px`; keptLabel.style.top = `${top}px`;
        subEl.style.left = `${bx}px`; subEl.style.top = `${top + 24}px`; subEl.style.maxWidth = `${W * 0.6}px`;
      },
      frame(t, after) { const v = String(clamp((t - 0.75) / 0.25) * after); for (const L of labels) L.e.style.opacity = v; keptLabel.style.opacity = v; subEl.style.opacity = v; },
      colour: (x) => keep(x[id]) ? null : "var(--ink3)",          // stepping aside is not a concern: grey
      describe: (ntc) => { const n = by.get(ntc); return n && describe ? describe(n) : null; },
    };
  };
}

// Beams from each satellite in the sky down to the middle of Finland. width/opacity/colour come from the scene.
function drawBeams(ctx, svg, dots, style) {
  svg.replaceChildren();
  const g = ctx.globe?.toGround();
  if (!g) return;
  for (const x of dots) {
    if (!x.gt) continue;
    const s = style(x); if (!s) continue;
    const a = centre(ctx, x.gt);
    svg.append(svgEl("line", { class: `sb ${s.cls ?? ""}`, x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: g.x.toFixed(1), y2: g.y.toFixed(1), "stroke-width": s.w.toFixed(2), "stroke-opacity": s.o.toFixed(2) }));
  }
  svg.append(svgEl("circle", { class: "sb-ground", cx: g.x.toFixed(1), cy: g.y.toFixed(1), r: 3 }));
}

// Axes without a y line: only the x axis and faint horizontal lines at the levels that matter.
// Charts keep at least this much height, so a stage laid out before it has a size never draws inverted axes or negative rects.
const MIN_PLOT = 120;

function hgrid(svg, box, levels, Y, label) {
  for (const v of levels) {
    svg.append(svgEl("path", { class: "sc-grid", d: `M${box.x0},${Y(v)}H${box.x1}` }));
    const t = svgEl("text", { class: "sc-tick", x: box.x0 - 6, y: Y(v) + 4, "text-anchor": "end" }); t.textContent = label(v); svg.append(t);
  }
  svg.append(svgEl("path", { class: "sc-axis", d: `M${box.x0},${box.y1}H${box.x1}` }));
}

export const SCENES = {
  limit: filterScene("limit", {
    keptText: "A limit applies",
    shortOf: (k) => ({ no_limit: "No applicable limit", no_frequency: "No frequency filed", named_countries_only: "Limit only for named countries" }[k] ?? k.replaceAll("_", " ")),
    keep: (n) => n.limited, why: (n) => n.how,
    sub: (o) => `${num(o.counts.rows, 0)} limits matched to ${num(o.counts.groups_limited, 0)} transmitting groups. Without a limit there is nothing to break, so those satellites step aside.`,
    describe: (n) => n.limited ? `An international power limit applies to ${n.groups} of its transmitting groups.` : "No international power limit covers its frequencies and kind of station.",
  }),
  data: filterScene("data", {
    keptText: "Everything needed is filed",
    shortOf: (k) => ({ no_orbit: "Cannot calculate, no usable orbit: ringed in the sky", no_gain: "Cannot calculate, no antenna gain: ringed in the sky", no_power: "Cannot calculate, no power: ringed in the sky", needs_xy: "Cannot calculate, limit needs more: ringed in the sky" }[k] ?? k.replaceAll("_", " ")),
    keep: (n) => n.complete, why: (n) => n.how, unknown: (n) => !n.complete,
    sub: () => "A satellite that cannot be calculated stays in the sky with a ring: not knowing is not the same as clear.",
    describe: (n) => n.complete ? `Power, gain and orbit are filed for ${n.rows_ok} of ${n.rows} limit checks.` : "Something the calculation needs is missing, so it cannot be calculated. A person should look.",
  }),

  // Power: worst case, each antenna points straight at Finland. In the sky, each satellite's beam lands on Finland:
  // the thicker and brighter, the more power per square metre. The chart shows the inverse-square fall-off itself.
  power(ctx) {
    const o = ctx.out.power, cmp = ctx.out.compare, by = new Map(o.notices.map((n) => [n.ntc_id, n]));
    const cby = new Map((cmp?.notices ?? []).map((n) => [n.ntc_id, n]));
    const dots = ctx.dots.filter((x) => by.get(x.n.ntc_id)?.eirp != null);
    for (const x of dots) { x.at ??= {}; x.sky ??= {}; x.power = by.get(x.n.ntc_id); }
    const chart = layer(ctx, "power"), beams = layer(ctx, "beams");
    const title = ctx.el("div", { class: "nleft kept" }, ctx.el("b", {}, "Power that could arrive"), ctx.el("span", {}, ctx.fmt(dots.length)));
    const sub = ctx.el("div", { class: "nsub wrap" }, "Worst case: every antenna points straight at Finland. Power per square metre falls with the square of the distance: twice as far, a quarter of the power.");
    ctx.stage.append(title, sub);
    const D0 = 300, D1 = 50000;
    const at = (x) => { const c = cby.get(x.n.ntc_id), d = c?.distance_km ?? (x.n.type === "G" ? 38500 : 1000); return { d, p: x.power.eirp - spreadDb(d) }; };
    const pts = new Map(dots.map((x) => [x, at(x)])), ps = [...pts.values()].map((q) => q.p).filter(Number.isFinite);
    const pLo = Math.min(...ps), pHi = Math.max(...ps);
    return {
      id: "power",
      layout(geo) {
        const { W, H } = geo, top = Math.max(H * 0.3, 200);
        const box = { x0: W * 0.1, x1: W * 0.6, y0: top + 104, y1: Math.max(H * 0.86, top + 104 + MIN_PLOT) };
        title.style.left = `${W * 0.06}px`; title.style.top = `${top}px`;
        sub.style.left = `${W * 0.06}px`; sub.style.top = `${top + 24}px`; sub.style.maxWidth = `${W * 0.6}px`;
        const pMin = Math.floor((pLo - 5) / 10) * 10, pMax = Math.ceil((pHi + 5) / 10) * 10;
        const X = (d) => box.x0 + (Math.log10(d / D0) / Math.log10(D1 / D0)) * (box.x1 - box.x0);
        const Y = (p) => box.y1 - ((p - pMin) / (pMax - pMin)) * (box.y1 - box.y0);
        for (const x of dots) { const q = pts.get(x); x.at.power = { x: X(clamp(q.d, D0, D1)) - ctx.size() / 2, y: Y(clamp(q.p, pMin, pMax)) - ctx.size() / 2 }; x.sky.power = x.gt; }
        chart.replaceChildren();
        const levels = []; for (let p = pMin; p <= pMax; p += 20) levels.push(p);
        hgrid(chart, box, levels, Y, (v) => `${v}`);
        for (const e of [0, 20, 40, 60]) {                         // the fall-off for a few powers, labelled at the right
          const d = []; for (let k = 0; k <= 40; k++) { const dk = D0 * (D1 / D0) ** (k / 40), p = e - spreadDb(dk); if (p >= pMin && p <= pMax) d.push(`${d.length ? "L" : "M"}${X(dk).toFixed(1)},${Y(p).toFixed(1)}`); }
          if (!d.length) continue;
          chart.append(svgEl("path", { class: "sc-ref", d: d.join("") }));
          const pe = e - spreadDb(D1); if (pe >= pMin) { const t = svgEl("text", { class: "sc-tick", x: box.x1 + 6, y: Y(pe) + 4 }); t.textContent = `${e} dBW`; chart.append(t); }
        }
        for (const d of [1000, 10000, 36000]) { const t = svgEl("text", { class: "sc-tick", x: X(d), y: box.y1 + 16, "text-anchor": "middle" }); t.textContent = `${d.toLocaleString("en-GB")} km`; chart.append(t); }
        const yl = svgEl("text", { class: "sc-tick", x: box.x0, y: box.y0 - 14 }); yl.textContent = "power per square metre at Finland, dB(W/m²)"; chart.append(yl);
        drawBeams(ctx, beams, dots, (x) => { const k = clamp((pts.get(x).p - pLo) / Math.max(1, pHi - pLo)); return { w: 0.4 + 3.2 * k, o: 0.12 + 0.6 * k }; });
      },
      frame(t, after, view) {
        const v = clamp((t - 0.6) / 0.4) * after;
        chart.style.opacity = String(v * (1 - view)); beams.style.opacity = String(v * view);
        title.style.opacity = sub.style.opacity = String(v);
      },
      colour: () => null,
      describe: (ntc) => { const n = by.get(ntc), x = dots.find((d) => d.n.ntc_id === ntc); return n?.eirp != null ? `Worst-case power: ${num(n.eirp)} dBW towards Finland, about ${num(pts.get(x).p)} dB(W/m²) on the ground.` : null; },
    };
  },

  // Compare: how far over or under the limit each satellite comes, at the angle where it comes closest.
  compare(ctx) {
    const o = ctx.out.compare, by = new Map(o.notices.map((n) => [n.ntc_id, n]));
    const dots = ctx.dots.filter((x) => by.get(x.n.ntc_id)?.excess != null);
    for (const x of dots) { x.at ??= {}; x.sky ??= {}; x.cmp = by.get(x.n.ntc_id); }
    const chart = layer(ctx, "compare"), beams = layer(ctx, "beams");
    const c = o.counts.how ?? {};
    const title = ctx.el("div", { class: "nleft kept" }, ctx.el("b", {}, "Against the limit"), ctx.el("span", {}, ctx.fmt(dots.length)));
    const sub = ctx.el("div", { class: "nsub wrap" }, [c.over ? `${ctx.fmt(c.over)} over` : null, c.near ? `${ctx.fmt(c.near)} within 3 dB` : null, c.under ? `${ctx.fmt(c.under)} under` : null].filter(Boolean).join(" · ") + ". Checked at every angle the signal could arrive from.");
    ctx.stage.append(title, sub);
    const LO = -60, HI = 30;
    return {
      id: "compare",
      layout(geo) {
        const { W, H } = geo, top = Math.max(H * 0.3, 200);
        const box = { x0: W * 0.1, x1: W * 0.62, y0: top + 104, y1: Math.max(H * 0.86, top + 104 + MIN_PLOT) };
        title.style.left = `${W * 0.06}px`; title.style.top = `${top}px`;
        sub.style.left = `${W * 0.06}px`; sub.style.top = `${top + 24}px`; sub.style.maxWidth = `${W * 0.6}px`;
        const X = (a) => box.x0 + (clamp(a, 0, 90) / 90) * (box.x1 - box.x0), Y = (e) => box.y1 - ((clamp(e, LO, HI) - LO) / (HI - LO)) * (box.y1 - box.y0);
        for (const x of dots) { x.at.compare = { x: X(x.cmp.angle ?? 0) - ctx.size() / 2, y: Y(x.cmp.excess) - ctx.size() / 2 }; x.sky.compare = x.gt; }
        chart.replaceChildren(
          svgEl("rect", { class: "sc-over", x: box.x0, y: box.y0, width: box.x1 - box.x0, height: Y(0) - box.y0 }),
          svgEl("rect", { class: "sc-near", x: box.x0, y: Y(0), width: box.x1 - box.x0, height: Y(-3) - Y(0) }));
        hgrid(chart, box, [20, -20, -40, -60], Y, (v) => v > 0 ? `+${v}` : `${v}`);
        chart.append(svgEl("path", { class: "sc-limit", d: `M${box.x0},${Y(0)}H${box.x1}` }));
        const lab = (x, y, s, cls = "sc-tick", anchor = "start") => { const t = svgEl("text", { class: cls, x, y, "text-anchor": anchor }); t.textContent = s; chart.append(t); };
        lab(box.x1 + 6, Y(0) + 4, "the limit", "sc-tick sc-lim");
        lab(box.x1 + 6, Y(-3) + 10, "near", "sc-tick sc-nearl");
        for (const a of [0, 30, 60, 90]) lab(X(a), box.y1 + 16, `${a}°`, "sc-tick", "middle");
        lab((box.x0 + box.x1) / 2, box.y1 + 32, "angle the signal arrives from, above the horizon", "sc-tick", "middle");
        lab(box.x0, box.y0 - 14, "dB over the limit");
        drawBeams(ctx, beams, dots, (x) => x.cmp.outcome === "over" ? { w: 1.6, o: 0.7, cls: "over" } : x.cmp.outcome === "near" ? { w: 1.2, o: 0.6, cls: "near" } : { w: 0.6, o: 0.14 });
      },
      frame(t, after, view) { const v = clamp((t - 0.6) / 0.4) * after; chart.style.opacity = String(v * (1 - view)); beams.style.opacity = String(v * view); title.style.opacity = sub.style.opacity = String(v); },
      colour: (x) => !x.cmp ? null : x.cmp.outcome === "over" ? "var(--bad)" : x.cmp.outcome === "near" ? "var(--warn)" : null,
      describe: (ntc) => {
        const n = by.get(ntc);
        if (!n || n.excess == null) return null;
        return `${dbText(n.excess)} the limit (${n.provision ?? "limit"}), at ${num(n.angle)}° above the horizon, ${num(n.distance_km, 0)} km away.`;
      },
    };
  },

  // Stations: Finland's listed stations on the ground (on the globe in the sky view, on a flat map in the other).
  // A station lights up when a satellite over or near the limit works on its frequencies. Hover a station to see
  // which satellites reach it and why; hover a satellite to see its stations.
  stations(ctx) {
    const o = ctx.out.stations, cmp = ctx.out.compare, by = new Map(o.notices.map((n) => [n.ntc_id, n]));
    const cby = new Map((cmp?.notices ?? []).map((n) => [n.ntc_id, n]));
    const dots = ctx.dots.filter((x) => by.has(x.n.ntc_id));
    for (const x of dots) { x.at ??= {}; x.sky ??= {}; x.st = by.get(x.n.ntc_id); }
    const reaches = new Map();                                    // station id -> satellites that reach it
    for (const n of o.notices) for (const s of n.stations ?? []) (reaches.get(s) ?? reaches.set(s, []).get(s)).push(n);
    const worst = (id) => (reaches.get(id) ?? []).some((n) => n.outcome === "over") ? "over" : reaches.has(id) ? "near" : null;
    const flat = layer(ctx, "stmap"), sky = layer(ctx, "stsky");
    const hits = dots.filter((x) => x.st.stations?.length), none = dots.filter((x) => !x.st.stations?.length);
    const tHit = ctx.el("div", { class: "nleft kept" }, ctx.el("b", {}, "On a listed station's frequencies"), ctx.el("span", {}, ctx.fmt(hits.length)));
    const tNone = ctx.el("div", { class: "nleft" }, ctx.el("b", {}, "No listed station"), ctx.el("span", {}, ctx.fmt(none.length)));
    const sub = ctx.el("div", { class: "nsub wrap" }, o.counts.how?.no_list ? "The station list is not on this computer." : `${ctx.fmt(o.counts.stations_hit ?? 0)} of Finland's listed stations are on their frequencies. Hover a station to see why.`);
    ctx.stage.append(tHit, tNone, sub);
    let pos = [], lines = null, view = 1;
    function stationPoints(project) {
      return (ctx.stations ?? []).filter((s) => s.lon != null && s.lat != null).map((s) => ({ s, ...project(s.lon, s.lat), w: worst(s.station) }));
    }
    function paint(svg, pts) {
      svg.replaceChildren();
      for (const p of pts) svg.append(svgEl("circle", { class: `sm-st${p.w ? ` hit ${p.w}` : ""}`, cx: p.x.toFixed(1), cy: p.y.toFixed(1), r: p.w ? 2.6 : 1.3 }));
      lines = svgEl("g", { class: "sm-lines" }); svg.append(lines);
    }
    return {
      id: "stations",
      layout(geo) {
        const { W, H } = geo, top = Math.max(H * 0.3, 200), s = ctx.size(), cell = s * 1.7;
        tHit.style.left = `${W * 0.71}px`; tHit.style.top = `${top}px`;
        sub.style.left = `${W * 0.06}px`; sub.style.top = `${top + 24}px`; sub.style.maxWidth = `${W * 0.6}px`;
        const cols = Math.max(4, Math.floor((W * 0.27) / cell));
        // in both views the satellites line up at the right, grouped; the ground is the picture
        hits.forEach((x, i) => { x.at.stations = { x: W * 0.71 + (i % cols) * cell, y: top + 34 + Math.floor(i / cols) * cell }; });
        const y2 = top + 34 + Math.ceil(hits.length / cols) * cell + 22;
        tNone.style.left = `${W * 0.71}px`; tNone.style.top = `${y2}px`;
        none.forEach((x, i) => { x.at.stations = { x: W * 0.71 + (i % cols) * cell, y: y2 + 34 + Math.floor(i / cols) * cell }; });
        for (const x of dots) x.sky.stations = x.gt;               // in the sky view they stay where they are
        // flat map for the other view
        const box = { x0: W * 0.12, x1: W * 0.6, y0: top + 60, y1: Math.max(H * 0.95, top + 60 + MIN_PLOT) };
        const fin = ctx.finland, k = Math.cos(64 * Math.PI / 180);
        const xs = fin.rings.flat().map((p) => p[0] * k), ys = fin.rings.flat().map((p) => p[1]), mx = Math.min(...xs), my = Math.min(...ys);
        const sc = Math.min((box.x1 - box.x0) / (Math.max(...xs) - mx), (box.y1 - box.y0) / (Math.max(...ys) - my));
        const ox = box.x0 + ((box.x1 - box.x0) - (Math.max(...xs) - mx) * sc) / 2;
        const P = (lon, lat) => ({ x: ox + (lon * k - mx) * sc, y: box.y1 - (lat - my) * sc });
        const flatPts = stationPoints(P);
        paint(flat, flatPts);
        flat.prepend(...fin.rings.map((r) => svgEl("path", { class: "sm-land", d: r.map((p, i) => { const q = P(p[0], p[1]); return `${i ? "L" : "M"}${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join("") + "Z" })));
        flat._pts = flatPts;
        const skyPts = ctx.globe ? stationPoints((lon, lat) => ctx.globe.toGround(lon, lat)) : [];
        paint(sky, skyPts); sky._pts = skyPts;
      },
      frame(t, after, v) {
        view = v;
        const a = clamp((t - 0.6) / 0.4) * after;
        flat.style.opacity = String(a * (1 - v)); sky.style.opacity = String(a * v);
        for (const e of [tHit, tNone, sub]) e.style.opacity = String(a);
        pos = v > 0.5 ? sky._pts ?? [] : flat._pts ?? [];
      },
      colour: (x) => !x.st ? null : x.st.outcome === "over" ? "var(--bad)" : x.st.outcome === "near" ? "var(--warn)" : null,
      // Hover a ground station: which satellites reach it, by how much, and why. Returns tooltip lines or null.
      hoverAt(px, py, el, nameOf) {
        let best = null, bd = 36;
        for (const p of pos) { const d = (p.x - px) ** 2 + (p.y - py) ** 2; if (d < bd) { bd = d; best = p; } }
        this.highlight(null);
        if (!best) return null;
        const st = best.s, list = (reaches.get(st.station) ?? []).slice().sort((a, b) => (cby.get(b.ntc_id)?.excess ?? -99) - (cby.get(a.ntc_id)?.excess ?? -99));
        const freq = [st.rx_mhz != null ? `receives ${num(st.rx_mhz, 3)} MHz` : null, st.tx_mhz != null && st.tx_mhz !== st.rx_mhz ? `transmits ${num(st.tx_mhz, 3)} MHz` : null].filter(Boolean).join(", ");
        const out = [el("div", { class: "tt-h" }, el("b", {}, `Finnish station ${st.station}`), el("code", {}, st.class)),
          el("div", { class: "tt-s" }, `${CLASS[st.class] ?? "licence class " + st.class}${freq ? " · " + freq : ""}`)];
        if (!list.length) out.push(el("div", { class: "tt-r" }, "No satellite over or near the limit works on its frequencies."));
        else {
          out.push(el("div", { class: "tt-a" }, `${list.length} satellite${list.length === 1 ? "" : "s"} over or near the limit work on its frequencies and can reach it:`));
          for (const n of list.slice(0, 6)) { const c = cby.get(n.ntc_id); out.push(el("div", { class: n.outcome === "over" ? "tt-bad" : "tt-warn" }, `${nameOf(n.ntc_id)}: ${c ? dbText(c.excess) : n.outcome} the limit${c?.provision ? ` (${c.provision})` : ""}`)); }
          if (list.length > 6) out.push(el("div", { class: "tt-s" }, `and ${list.length - 6} more`));
          out.push(el("div", { class: "tt-s" }, "Why: its frequencies overlap theirs, and it can see them above its horizon. Both what it receives and what it transmits are protected (guidebook C-4)."));
        }
        this.highlight(null, best);
        return out;
      },
      // draw lines between a satellite and its stations (or a station and its satellites)
      highlight(ntc, stp) {
        if (!lines) return;
        lines.replaceChildren();
        if (ntc != null) {
          const n = by.get(ntc), x = dots.find((d) => d.n.ntc_id === ntc);
          if (!n || !x) return;
          const from = centre(ctx, view > 0.5 ? x.gt : x.at.stations);
          for (const p of pos) if (n.stations?.includes(p.s.station)) lines.append(svgEl("line", { class: `sm-l ${n.outcome}`, x1: from.x, y1: from.y, x2: p.x, y2: p.y }));
        } else if (stp) {
          for (const n of reaches.get(stp.s.station) ?? []) {
            const x = dots.find((d) => d.n.ntc_id === n.ntc_id); if (!x) continue;
            const from = centre(ctx, view > 0.5 ? x.gt : x.at.stations);
            lines.append(svgEl("line", { class: `sm-l ${n.outcome}`, x1: from.x, y1: from.y, x2: stp.x, y2: stp.y }));
          }
        }
      },
      describe: (ntc) => { const n = by.get(ntc); return n ? (n.stations?.length ? `On the frequencies of ${n.stations.length} listed Finnish station${n.stations.length === 1 ? "" : "s"} that can see it: ${n.stations.slice(0, 6).join(", ")}${n.stations.length > 6 ? "…" : ""}.` : "No listed Finnish station uses its frequencies.") : null; },
    };
  },

  // Ladder: every filing on exactly one rung, the most serious at the top. The dots leave the sky (or the chart) and
  // settle onto their rung; the ones that stepped aside earlier come back, because the ladder places every filing.
  ladder(ctx) {
    const o = ctx.out.ladder, by = new Map(o.notices.map((n) => [n.ntc_id, n]));
    const rb = ctx.rulebooks?.ladder, levelOf = Object.fromEntries((rb?.rungs ?? []).map((r) => [r.key, r]));
    const dots = ctx.dots.filter((x) => by.has(x.n.ntc_id));
    const order = new Map(o.notices.map((n, i) => [n.ntc_id, i]));
    dots.sort((a, b) => order.get(a.n.ntc_id) - order.get(b.n.ntc_id));
    const idx = new Map(), seen = {};
    for (const x of dots) { x.at ??= {}; x.sky ??= {}; x.lad = by.get(x.n.ntc_id); const k = x.lad.rung; idx.set(x, seen[k] = (seen[k] ?? -1) + 1); }
    const R = makeRungs({ el: ctx.el, stage: ctx.stage, rulebook: rb, counts: o.counts?.rungs ?? {}, guide: ctx.guide });
    const lv = o.counts?.levels ?? {};
    const title = ctx.el("div", { class: "nleft kept" }, ctx.el("b", {}, "The concern ladder"), ctx.el("span", {}, ctx.fmt(o.notices.length)));
    const sub = ctx.el("div", { class: "nsub wrap" }, `Every filing on one rung: the first that applies, from the top. ${ctx.fmt(lv.crit ?? 0)} ${lv.crit === 1 ? "needs" : "need"} attention, ${ctx.fmt(lv.warn ?? 0)} ${lv.warn === 1 ? "is" : "are"} worth a look.`);
    ctx.stage.append(title, sub);
    return {
      id: "ladder", all: true,
      layout(geo) {
        const { W, H } = geo, top = Math.max(H * 0.3, 200), s = ctx.size();
        title.style.left = `${W * 0.06}px`; title.style.top = `${top}px`;
        sub.style.left = `${W * 0.06}px`; sub.style.top = `${top + 24}px`; sub.style.maxWidth = `${W * 0.88}px`;
        R.layout({ x0: W * 0.06, x1: W * 0.97, y0: top + 62, y1: H * 0.985 }, { minCell: s * 1.1, maxCell: s * 1.7, fixedSize: s });
        for (const x of dots) { const p = R.pos(x.lad.rung, idx.get(x)); x.at.ladder = p; x.sky.ladder = p; }
      },
      frame(t, after) { const v = clamp((t - 0.6) / 0.4) * after; title.style.opacity = sub.style.opacity = String(v); R.frame(v); },
      colour: (x) => x.lad ? levelColour(levelOf[x.lad.rung]?.level) : null,
      describe: (ntc) => {
        const n = by.get(ntc), r = levelOf[n?.rung];
        if (!n) return null;
        const much = n.excess != null ? ` ${dbText(n.excess)} the limit.` : "";
        return `On the ladder: ${r?.rung ?? n.rung} (${LEVEL_WORDS[r?.level] ?? "no concern"}).${much}`;
      },
    };
  },
};
