// The terrestrial scenes: a map seen from above, Finland and its neighbours, every foreign station a point where it
// stands. Each stage filters in place: stations out of scope fade, the map draws in towards Finland as the range
// narrows, field strength draws each path to the border, the threshold colours the concerns, and Finland's own listed
// stations light up where a foreign signal is too strong. Drawn on a canvas so thousands of stations stay smooth.
// The ladder then lifts every station off the map onto its rung. The same map, drawn "bare" with a focus set,
// is the report's map: only the reported stations stand out.
// Reads stage outputs only; draws nothing it must decide.
import { scatterSize } from "../dots.js";
import { makeRungs, LEVEL_WORDS } from "./ladder.js";

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const rows = (o) => o.fields ? o.notices.map((r) => Object.fromEntries(o.fields.map((f, i) => [f, r[i]]))) : o.notices;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const WIDE = { lon0: 4, lon1: 46, lat0: 52, lat1: 72 };      // the region
const NEAR = { lon0: 14, lon1: 38, lat0: 56.5, lat1: 71 };   // Finland and its near neighbours
const SHORT = {
  mobile: { recorded: "Already recorded", finnish: "Finnish", not_land_mobile: "Not land mobile" },
  range: { too_far: "Over 1,000 km away", withdrawn: "Withdrawn", out_of_band: "Outside 30–4,000 MHz" },
  tdata: { no_power: "No power filed", no_height: "No antenna height", no_position: "No position" },
  threshold: { over: "Over the trigger level", over_coordinated: "Over, already coordinated: to verify", near: "Within 3 dB", under: "Under" },
  tstations: { exposed: "Too strong at a listed station", not_exposed: "Under at every listed station", no_station: "No listed station on the channel", no_list: "No station list" },
};

export function makeTerra(ctx) {
  const o = ctx.out, all = rows(o.mobile);
  const by = new Map(all.map((s) => [s.terrakey, s]));
  for (const id of ["range", "tdata", "field", "threshold", "tstations"]) if (o[id]) for (const r of rows(o[id])) { const s = by.get(r.terrakey); if (s) s[id] = r; }
  const pts = all.filter((s) => s.lon != null && s.lat != null);
  // The near view: Finland and its neighbours, stretched so every station in range stays on the map.
  const inRange = pts.filter((s) => s.range && !s.range.reason && !s.reason), pad = 0.6;
  const near = inRange.length ? {
    lon0: Math.min(NEAR.lon0, ...inRange.map((s) => s.lon - pad)), lon1: Math.max(NEAR.lon1, ...inRange.map((s) => s.lon + pad)),
    lat0: Math.min(NEAR.lat0, ...inRange.map((s) => s.lat - pad)), lat1: Math.max(NEAR.lat1, ...inRange.map((s) => s.lat + pad)),
  } : NEAR;
  const canvas = ctx.el("canvas", { class: "tmap", "aria-hidden": "true" });
  ctx.stage.insertBefore(canvas, ctx.stage.firstChild?.nextSibling ?? null);
  const g = canvas.getContext("2d");
  // labels at the right: what each stage set aside, and the title of the scene
  const side = ctx.el("div", { class: "tside" }), title = ctx.el("div", { class: "nleft kept tt-title" }), sub = ctx.el("div", { class: "nsub wrap" });
  if (!ctx.bare) ctx.stage.append(side, title, sub);
  // The ladder: each station's rung (tladder.json), and the rows it is drawn on.
  let rungs = null, levelOf = {}, ladIdx = new Map();
  function addLadder(out) {
    if (rungs || !out?.tladder || ctx.bare) return;
    o.tladder ??= out.tladder;
    const rb = ctx.rulebooks?.tladder;
    levelOf = Object.fromEntries((rb?.rungs ?? []).map((r) => [r.key, r]));
    const seen = {};
    for (const r of rows(out.tladder)) { const st = by.get(r.terrakey); if (!st) continue; st.tladder = r; ladIdx.set(st, seen[r.rung] = (seen[r.rung] ?? -1) + 1); }
    rungs = makeRungs({ el: ctx.el, stage: ctx.stage, rulebook: rb, counts: out.tladder.counts?.rungs ?? {}, guide: ctx.guide });
    if (geo) layout(geo, from);
  }
  let geo = null, view = WIDE, box = null, from = null, size = 3, colours = {}, shown = null;
  // The trigger levels this file's stations are judged against, from the Threshold rulebook (read-only).
  let levels = null;
  fetch("/api/rulebook/threshold").then((r) => r.json()).then((rb) => { levels = rb; if (shown === "threshold") words("threshold"); }).catch(() => {});
  function levelRows() {
    if (!levels?.bands) return [];
    const used = levels.bands.filter((b) => all.some((st) => st.threshold && st.f_mhz >= b.from_mhz && st.f_mhz < b.to_mhz));
    const mhz = (v) => ctx.fmt(v);
    return [ctx.el("div", { class: "tside-h" }, "Trigger level at the border"),
      ...used.map((b) => ctx.el("div", { class: "tside-level" }, ctx.el("b", {}, `${b.dbuvm} dB(µV/m)`), ` at ${mhz(b.from_mhz)}–${mhz(b.to_mhz)} MHz`)),
      ctx.el("div", { class: "tside-note" }, `Per ${levels.reference_khz} kHz; more for wider channels. Within ${levels.near_db} dB under is near.`)];
  }
  const border = ctx.region?.sea_limit ?? [];

  function project(lon, lat, v = view) {
    const k = Math.cos(62 * Math.PI / 180), w = (v.lon1 - v.lon0) * k, h = v.lat1 - v.lat0;
    // fit the view inside the fully opaque part of the area, so no station sits in the soft edge
    const F = fade(), b = { x0: box.x0 + F, x1: box.x1 - F, y0: box.y0 + F, y1: box.y1 - F };
    const s = Math.min((b.x1 - b.x0) / w, (b.y1 - b.y0) / h), ox = b.x0 + ((b.x1 - b.x0) - w * s) / 2, oy = b.y0 + ((b.y1 - b.y0) - h * s) / 2;
    return [ox + (lon - v.lon0) * k * s, oy + (v.lat1 - lat) * s];
  }
  function layout(gg, src) {
    geo = gg; from = src;
    const dpr = Math.min(2, devicePixelRatio || 1);
    canvas.width = geo.W * dpr; canvas.height = geo.H * dpr; canvas.style.width = `${geo.W}px`; canvas.style.height = `${geo.H}px`;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const top = Math.max(geo.H * 0.3, 200);
    if (ctx.bare) {
      // the report's map: a box shaped like the near view, centred, so the map never runs past the region it has
      const k = Math.cos(62 * Math.PI / 180), asp = ((near.lon1 - near.lon0) * k) / (near.lat1 - near.lat0);
      const h = Math.min(geo.H, geo.W / asp), w = h * asp;
      box = { x0: (geo.W - w) / 2, x1: (geo.W + w) / 2, y0: (geo.H - h) / 2, y1: (geo.H + h) / 2 };
    } else box = { x0: geo.W * 0.04, x1: geo.W * 0.68, y0: top + 56, y1: geo.H * 0.97 };
    size = Math.max(2, Math.min(6, scatterSize(pts.length, box.x1 - box.x0, box.y1 - box.y0)));
    title.style.left = `${geo.W * 0.06}px`; title.style.top = `${top}px`; sub.style.left = `${geo.W * 0.06}px`; sub.style.top = `${top + 24}px`; sub.style.maxWidth = `${geo.W * 0.9}px`;
    side.style.left = `${geo.W * 0.71}px`; side.style.top = `${top}px`; side.style.width = `${geo.W * 0.26 - 12}px`;
    colours = { ink: css("--ink"), ink3: css("--ink3"), accent: css("--accent"), bad: css("--bad"), warn: css("--warn"), surface: css("--surface") };
    if (rungs) {
      rungs.layout({ x0: geo.W * 0.06, x1: geo.W * 0.97, y0: top + 62, y1: geo.H * 0.985 }, { minCell: 2.6, maxCell: 9, fill: 0.72, concernCell: 14 });
      for (const s of all) if (s.tladder) s.lp = rungs.pos(s.tladder.rung, ladIdx.get(s));
    }
  }
  // where each station is in the current scene: its state decides colour, alpha and size
  function state(s, t) {
    if (ctx.focus) {                                   // the report's map: the reported stations, and the rest faint
      const lv = ctx.focus.get(s.terrakey);
      return lv ? { a: 1, c: lv === "crit" ? colours.bad : colours.warn, r: Math.max(7, size * 2.4), focus: true } : { a: s.reason || s.range?.reason ? 0.06 : 0.16, c: colours.ink3, r: size };
    }
    let a = 1, c = colours.accent, r = size;
    if (s.reason) { a = 1 - 0.85 * t.mobile; c = colours.ink3; }
    else if (s.range?.reason) { a = 1 - 0.9 * t.range; c = colours.ink3; }
    else if (s.tdata?.reason) { a = 1 - 0.8 * t.tdata; c = colours.ink3; }
    else if (s.range) { r = lerp(size, size * 1.8, t.range); }
    const th = s.threshold;
    if (th && t.threshold > 0.5) { c = th.outcome === "over" ? colours.bad : th.outcome === "over_coordinated" || th.outcome === "near" ? colours.warn : colours.accent; if (th.outcome !== "under") r *= 1.25; }
    return { a, c, r };
  }
  let T = {}, hovered = null;
  function frame(t, appear, after) {
    T = t;
    const vis = appear * after, tl = rungs ? ease(t.tladder ?? 0) : 0, mapA = 1 - tl;
    canvas.style.opacity = String(vis); side.style.opacity = title.style.opacity = sub.style.opacity = String(clamp(appear * 1.2 - 0.2) * after);
    side.style.opacity = String(Number(side.style.opacity) * (1 - clamp(tl * 3)));
    rungs?.frame(clamp(((t.tladder ?? 0) - 0.6) / 0.4) * after);
    if (!geo || vis <= 0.001) return;
    view = { lon0: lerp(WIDE.lon0, near.lon0, ease(t.range)), lon1: lerp(WIDE.lon1, near.lon1, ease(t.range)), lat0: lerp(WIDE.lat0, near.lat0, ease(t.range)), lat1: lerp(WIDE.lat1, near.lat1, ease(t.range)) };
    g.clearRect(0, 0, geo.W, geo.H);
    g.save();
    // the land: neighbours faint, Finland in the accent
    for (const sh of ctx.region?.shapes ?? []) {
      g.beginPath(); sh.ring.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath();
      const fin = sh.name === "Finland" || sh.name === "Aland";
      g.fillStyle = fin ? colours.accent : colours.ink; g.globalAlpha = (fin ? 0.16 : 0.05) * mapA; g.fill();
      g.strokeStyle = fin ? colours.accent : colours.ink; g.globalAlpha = (fin ? 0.5 : 0.14) * mapA; g.lineWidth = 1; g.stroke();
    }
    // Finland's outer limit (land border and 12-nautical-mile sea limit), where field strength is worked out
    g.globalAlpha = 0.6 * clamp(t.range * 2) * mapA; g.setLineDash([2, 3]); g.strokeStyle = colours.accent; g.beginPath();
    border.forEach(([lon, lat], i) => { const [x, y] = project(lon, lat); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke(); g.setLineDash([]);
    // field strength: each station in range draws its strongest path to the border
    if (t.field > 0) for (const s of pts) {
      if (!s.field || s.range?.reason || s.reason) continue;
      if (ctx.focus && !ctx.focus.has(s.terrakey)) continue;
      const b = border[s.field.border]; if (!b) continue;
      const [x0, y0] = project(s.lon, s.lat), [x1, y1] = project(b[0], b[1]);
      g.globalAlpha = 0.45 * t.field * mapA * (ctx.focus ? 1.6 : 1) * (s.threshold && t.threshold > 0.5 && s.threshold.outcome === "under" ? 0.5 : 1);
      g.strokeStyle = state(s, t).c; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y0); g.lineTo(lerp(x0, x1, ease(t.field)), lerp(y0, y1, ease(t.field))); g.stroke();
    }
    // Finland's listed stations, lit where a foreign signal is too strong
    if (t.tstations > 0 && ctx.stations?.length) {
      const exposed = new Map();
      for (const s of pts) for (const id of s.tstations?.over ?? []) exposed.set(id, s);
      for (const fs of ctx.stations) {
        if (fs.lon == null || fs.lat == null) continue;
        const [x, y] = project(fs.lon, fs.lat), hit = exposed.get(fs.station);
        if (ctx.focus && hit && !ctx.focus.has(hit.terrakey)) continue;
        g.globalAlpha = (hit ? 1 : 0.35) * t.tstations * mapA; g.fillStyle = hit ? colours.bad : colours.ink3;
        g.beginPath(); g.arc(x, y, hit ? 3 : 1.2, 0, Math.PI * 2); g.fill();
        if (hit) { const [x0, y0] = project(hit.lon, hit.lat); g.strokeStyle = colours.bad; g.globalAlpha = 0.6 * t.tstations * mapA; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke(); }
      }
    }
    g.restore(); g.globalAlpha = 1;
    feather();
    // the stations themselves, flying in from the table they came from, and on to their rung on the ladder.
    // On the map they fade softly at its edges, like the map; on the ladder they are whole.
    const F = fade(), soft = (x, y) => clamp(Math.min(x - box.x0, box.x1 - x, y - box.y0, box.y1 - y) / F);
    const list = rungs ? all : pts, n = list.length, focusLast = [];
    for (let i = 0; i < n; i++) {
      const s = list[i], st = state(s, t), d = clamp(t.mobile * 1.6 - (i / n) * 0.6), has = s.lon != null && s.lat != null;
      let x, y, a = st.a, c = st.c, r = st.r;
      if (has) {
        [x, y] = project(s.lon, s.lat);
        if (from && d < 1) { x = lerp(from.x, x, ease(d)); y = lerp(from.y, y, ease(d)); }
        a *= clamp(d * 3) * lerp(soft(x, y), 1, tl);
      } else { x = s.lp?.x ?? 0; y = s.lp?.y ?? 0; a = tl; }
      if (tl > 0 && s.lp) {
        const lv = levelOf[s.tladder.rung]?.level;
        x = lerp(x, s.lp.x + s.lp.size / 2, tl); y = lerp(y, s.lp.y + s.lp.size / 2, tl);
        r = lerp(r, s.lp.size, tl);
        if (tl > 0.5) { c = lv === "crit" ? colours.bad : lv === "warn" ? colours.warn : colours.ink3; }
        a = lerp(a, lv === "none" ? 0.55 : 1, tl);
      }
      s._x = x; s._y = y; s._a = a;
      if (st.focus) { focusLast.push([s, x, y, a, c, r]); continue; }
      g.globalAlpha = a; g.fillStyle = s === hovered ? colours.ink : c;
      g.beginPath(); g.arc(x, y, r / 2, 0, Math.PI * 2); g.fill();
    }
    for (const [s, x, y, a, c, r] of focusLast) {        // the reported stations on top, each with a soft halo
      g.globalAlpha = 0.22 * a; g.fillStyle = c; g.beginPath(); g.arc(x, y, r * 1.1, 0, Math.PI * 2); g.fill();
      g.globalAlpha = a; g.fillStyle = s === hovered || s.terrakey === ctx.lit?.() ? colours.ink : c; g.beginPath(); g.arc(x, y, r / 2, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
  }
  // No hard crop: the map fades out softly towards every edge of its area.
  function fade() { return Math.min(48, (box.x1 - box.x0) * 0.1, (box.y1 - box.y0) * 0.1); }
  function feather() {
    const F = fade();
    if (!(F > 0) || box.x1 - box.x0 < 4 || box.y1 - box.y0 < 4) return;
    g.save(); g.globalCompositeOperation = "destination-in";
    for (const [a0, a1, horizontal] of [[box.x0, box.x1, true], [box.y0, box.y1, false]]) {
      const lg = horizontal ? g.createLinearGradient(a0, 0, a1, 0) : g.createLinearGradient(0, a0, 0, a1), span = a1 - a0;
      lg.addColorStop(0, "rgba(0,0,0,0)"); lg.addColorStop(F / span, "rgba(0,0,0,1)");
      lg.addColorStop(1 - F / span, "rgba(0,0,0,1)"); lg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = lg; g.fillRect(0, 0, geo.W, geo.H);
    }
    g.restore();
  }
  // The words for the scene that is showing: its title, a line under it, and what it set aside, with counts.
  function words(id) {
    const c = o[id]?.counts ?? {};
    const list = (m) => Object.entries(m ?? {}).filter(([, v]) => v).map(([k, v]) => ctx.el("div", { class: "nleft tside-row" }, ctx.el("b", {}, SHORT[id]?.[k] ?? k.replaceAll("_", " ")), ctx.el("span", {}, ctx.fmt(v))));
    const T2 = {
      mobile: ["Foreign land mobile stations", c.kept, `${ctx.fmt(c.notices)} stations in the file, each where it stands`, list(c.left)],
      range: ["Close enough to matter", c.kept, "Within 1,000 km of Finland, between 30 and 4,000 MHz", list(c.left)],
      tdata: ["Power and height filed", c.kept, "Everything the calculation needs", list(c.left)],
      field: ["Strongest signal at the border", c.notices, "ITU-R P.1546-6, 10% of the time, at Finland's land border and sea limit", []],
      threshold: ["Against the trigger level", c.notices, "ECC T/R 25-08, adjusted for channel width", [...list(c.how), ...levelRows()]],
      tstations: ["At Finland's listed stations", c.notices, "The signal worked out at each listed station on the channel", list(c.how)],
      tladder: ["The concern ladder", c.notices, `Every station on one rung: the first that applies, from the top. ${ctx.fmt(c.levels?.crit ?? 0)} ${c.levels?.crit === 1 ? "needs" : "need"} attention, ${ctx.fmt(c.levels?.warn ?? 0)} ${c.levels?.warn === 1 ? "is" : "are"} worth a look.`, []],
    }[id];
    shown = id;
    if (!T2) return;
    title.replaceChildren(ctx.el("b", {}, T2[0]), ctx.el("span", {}, ctx.fmt(T2[1] ?? 0)));
    sub.textContent = T2[2]; side.replaceChildren(...T2[3]);
  }
  function hover(px, py) {
    let best = null, bd = 64;
    for (const s of (rungs ? all : pts)) { if (!(s._a > 0.3)) continue; const d = (s._x - px) ** 2 + (s._y - py) ** 2; if (d < bd) { bd = d; best = s; } }
    hovered = best;
    if (!best) return null;
    const e = ctx.el, lines = [e("div", { class: "tt-h" }, e("b", {}, `Station ${best.terrakey}`), e("code", {}, best.adm)),
      e("div", { class: "tt-s" }, `${best.cls} · ${best.f_mhz?.toLocaleString("en-GB")} MHz`)];
    const lad = best.tladder && (T.tladder ?? 0) > 0.3 ? levelOf[best.tladder.rung] : null;
    if (lad) lines.push(e("div", { class: lad.level === "crit" ? "tt-bad" : lad.level === "warn" ? "tt-warn" : "tt-s" }, `On the ladder: ${lad.rung} (${LEVEL_WORDS[lad.level]})`));
    if (best.reason) lines.push(e("div", { class: "tt-a" }, SHORT.mobile[best.reason] ?? best.reason));
    else if (best.range?.reason) lines.push(e("div", { class: "tt-a" }, `${SHORT.range[best.range.reason] ?? best.range.reason}: ${Math.round(best.range.km).toLocaleString("en-GB")} km from Finland`));
    else {
      if (best.range) lines.push(e("div", { class: "tt-s" }, `${Math.round(best.range.km).toLocaleString("en-GB")} km from Finland`));
      if (best.field && T.field > 0.3) lines.push(e("div", { class: "tt-s" }, `${best.field.e.toLocaleString("en-GB")} dB(µV/m) at the border, ${Math.round(best.field.km)} km, ${Math.round((1 - best.field.land) * 100)}% over sea`));
      const th = best.threshold;
      if (th && T.threshold > 0.3) lines.push(e("div", { class: th.outcome === "under" ? "tt-r" : "tt-a" }, `${SHORT.threshold[th.outcome] ?? th.outcome}: ${th.excess > 0 ? "+" : ""}${th.excess.toLocaleString("en-GB")} dB against ${th.limit.toLocaleString("en-GB")} dB(µV/m)`));
      const ts = best.tstations;
      if (ts && T.tstations > 0.3) lines.push(e("div", { class: "tt-s" }, ts.over?.length ? `Too strong at listed station${ts.over.length === 1 ? "" : "s"} ${ts.over.join(", ")}` : SHORT.tstations[ts.outcome] ?? ts.outcome));
    }
    return lines;
  }
  addLadder(o);
  return { layout, frame, words, hover, addLadder, get hasLadder() { return !!rungs; }, station: (k) => by.get(k) };
}
