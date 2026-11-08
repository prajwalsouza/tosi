// The Play demo's drawing kit: SVG helpers and the time-based choreography engine.
// Every element enters on a beat and leaves on a beat, so any moment of the film can be drawn from the time alone,
// which is what makes it seekable. Adapted from the explainer template (show, pose, dim, kf, tick).
export const NS = "http://www.w3.org/2000/svg";
export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const eo = (t) => { t = clamp(t); return 1 - Math.pow(1 - t, 3); };              // ease-out, for entrances
export const eio = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };   // moves
export const fmt = (n) => Number(n).toLocaleString("en-GB");
export const num = (n, d = 2) => Number(n).toLocaleString("en-GB", { maximumFractionDigits: d });

/** An SVG element. Keys that are CSS properties go to style, so colours can be CSS variables. */
const STY = new Set(["fill", "stroke", "opacity", "font-size", "font-weight", "letter-spacing", "stroke-width", "stroke-dasharray", "stroke-linecap", "text-anchor", "dominant-baseline", "filter"]);
export function S(tag, a = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(a)) {
    if (v == null) continue;
    if (k === "text") e.textContent = v;
    else if (k === "cls") e.setAttribute("class", v);
    else if (STY.has(k)) e.style.setProperty(k, typeof v === "number" && (k === "font-size" || k === "stroke-width") ? `${v}px` : String(v));
    else e.setAttribute(k, v);
  }
  parent?.appendChild(e);
  return e;
}
export const G = (p, cls) => S("g", cls ? { cls } : {}, p);
/** Text. o: size, w (weight), fill, anchor, cls. */
export function T(p, x, y, s, o = {}) {
  return S("text", { x, y, text: s, "font-size": o.size ?? 24, "font-weight": o.w ?? 400, fill: o.fill ?? "var(--x-ink)", "text-anchor": o.anchor ?? "start",
    "dominant-baseline": "central", cls: "xt" + (o.cls ? " " + o.cls : ""), "letter-spacing": o.ls }, p);
}
/** A two-part line: "Same file. | Same answer." with the second half in the accent. */
export function T2(p, x, y, s, o = {}) {
  const [a, b] = String(s).split("|").map((v) => v.trim());
  const t = T(p, x, y, "", o);
  S("tspan", { text: a + (b ? " " : "") }, t);
  if (b) S("tspan", { text: b, fill: "var(--x-acc)" }, t);
  return t;
}
export function rng(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export function path(p, d, o = {}) { return S("path", { d, fill: o.fill ?? "none", stroke: o.stroke ?? "var(--x-ink3)", "stroke-width": o.w ?? 1.5, "stroke-linecap": "round", "stroke-dasharray": o.dash, cls: o.cls }, p); }

/** Mark an element as something to point at: hover shows a tip, a click pins it (and pauses). */
export function hot(e, title, body) { e.classList.add("x-hot"); e.__tip = { title, body }; return e; }

/**
 * The choreography for one scene. s.bs: beat start times (s), s.bd: beat lengths, s.dur: scene length.
 * show(el, from, to, o): enter on beat `from`, leave on beat `to` (fractional beats allowed, {s: secs} for absolute).
 * pose(el, [[beat, x, y, scale], ...]): camera-like moves. dim(el, [[beat, level], ...]): focus.
 * draw(pathEl, from, d): a stroke draws itself. tick(fn(t)): per-frame code for continuous motion.
 */
export function makeA(s) {
  const reg = [], ticks = [];
  const bt = (b) => {
    if (b === Infinity) return 1e9;
    if (typeof b === "object") return b.s;
    const i = Math.floor(b), f = b - i;
    if (i >= s.bs.length) return s.dur;
    if (i < 0) return 0;
    return s.bs[i] + f * s.bd[i];
  };
  const entry = (el) => { let r = reg.find((q) => q.el === el); if (!r) { r = { el, from: -1, to: Infinity, o: {} }; reg.push(r); } return r; };
  const A = {
    st: {}, bt,
    show(el, from, to = Infinity, o = {}) { const r = entry(el); r.from = from; r.to = to; r.o = o; return el; },
    pose(el, kf, d = 1.1) { const r = entry(el); r.kf = kf; r.kd = d; return el; },
    dim(el, kf) { const r = entry(el); r.dk = kf; return el; },
    draw(el, from, d = 1.2) {
      const len = el.getTotalLength?.() || 1000;
      el.style.strokeDasharray = `${len} ${len}`;
      ticks.push((t) => { el.style.strokeDashoffset = String(len * (1 - eo((t - bt(from)) / d))); });
      return el;
    },
    tick(fn) { ticks.push(fn); },
    /** a scalar that moves between keyframes [[beat, value], ...] */
    kf(t, k, d = 1) { let v = k[0][1]; for (let i = 1; i < k.length; i++) { const p = eio((t - bt(k[i][0])) / d); if (p <= 0) break; v = lerp(v, k[i][1], p); } return v; },
    /** how far into an entrance at `from` we are, 0..1 */
    at(t, from, d = 0.9) { return eo((t - bt(from)) / d); },
    bi(t) { let k = -1; while (k + 1 < s.bs.length && t >= s.bs[k + 1]) k++; return k; },
    run(t) {
      for (const r of reg) {
        const o = r.o;
        let k = 1, ex = 1;
        if (r.from !== -1) k = eo((t - bt(r.from) - (o.delay || 0)) / (o.d || 0.9));
        if (r.to !== Infinity) ex = 1 - eo((t - bt(r.to) - (o.outDelay || 0)) / (o.out || 0.5));
        let x = 0, y = 0, sc = 1;
        if (r.kf) {
          let cur = r.kf[0].slice(1);
          for (let i = 1; i < r.kf.length; i++) { const [b, ...v] = r.kf[i]; const p = eio((t - bt(b)) / r.kd); if (p <= 0) break; cur = cur.map((c, j) => lerp(c, v[j] ?? c, p)); }
          [x, y] = cur; sc = cur[2] ?? 1;
        }
        let dv = 1;
        if (r.dk) { dv = r.dk[0][1]; for (let i = 1; i < r.dk.length; i++) { const p = eo((t - bt(r.dk[i][0])) / 0.7); if (p <= 0) break; dv = lerp(dv, r.dk[i][1], p); } }
        const fl = o.float ? Math.sin(t * 0.9 + (o.ph || 0)) * o.float : 0, rise = o.rise ?? 16;
        r.el.setAttribute("transform", `translate(${x.toFixed(2)},${(y + (1 - k) * rise - (1 - ex) * 8 + fl).toFixed(2)})${sc !== 1 ? ` scale(${sc.toFixed(4)})` : ""}`);
        const op = k * ex * dv;
        r.el.style.opacity = op.toFixed(3);
        // blur clears as a thing arrives (the "rise" entrance), and returns as it leaves
        const bl = (1 - k) * (o.blur ?? 5) + (1 - ex) * 3;
        r.el.style.filter = bl > 0.15 ? `blur(${bl.toFixed(2)}px)` : "";
        r.el.style.pointerEvents = op < 0.2 ? "none" : "";
        r.el.style.display = op < 0.003 ? "none" : "";
      }
      for (const f of ticks) f(t);
    },
  };
  return A;
}
