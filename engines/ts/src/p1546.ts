// ITU-R P.1546-6 field strength, without terrain. A port of the steps Tosi needs from the ITU-R WP 3K reference
// implementation (P1546FieldStrMixed.m, version 6.2): steps 6 to 11 (curves, interpolation in height, distance,
// frequency and time; heights below 10 m; mixed land and sea paths by the RRC-06 method), step 14 (receiving antenna
// height, rural or sea) and step 19 (maximum field strength). Tables: spec/tables/p1546.json.
// Steps that need terrain or clutter (12, 13, 15, 16, 17, 18) are not used: P.1546 without terrain is the accepted basis.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BYTES = readFileSync(join(root, "spec", "tables", "p1546.json"));
type Row = { d: number; e: number[]; emax: number };
type Curve = { figure: number; time: number; path: string; f_mhz: number; h1: number[]; rows: Row[] };
const CURVES: Curve[] = JSON.parse(BYTES.toString("utf8")).curves;
export const P1546_SHA = createHash("sha256").update(BYTES).digest("hex");

const DIST = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100,
  110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 225, 250, 275, 300, 325, 350, 375, 400, 425, 450, 475, 500, 525, 550, 575, 600, 625, 650, 675,
  700, 725, 750, 775, 800, 825, 850, 875, 900, 925, 950, 975, 1000];
const HEIGHTS = [10, 20, 37.5, 75, 150, 300, 600, 1200];
const FREQS = [100, 600, 2000];
const TIMES = [1, 10, 50];
const log10 = Math.log10;
const atand = (x: number) => Math.atan(x) * 180 / Math.PI;

// The two tabulated values around v, as the reference's searchclosest: beyond the ends, the last (or first) two.
function closest(x: number[], v: number): [number, number] {
  if (x[x.length - 1] < v) return [x[x.length - 2], x[x.length - 1]];
  if (x[0] > v) return [x[0], x[1]];
  for (let i = 0; i < x.length; i++) {
    if (x[i] === v) return [v, v];
    if (x[i] > v) return [x[i - 1], x[i]];
  }
  return [x[x.length - 2], x[x.length - 1]];
}
const nominals = (d: number) => closest(DIST, d);

// Step 19: maximum field strength, eq (2), (3), (42).
export function emax(t: number, dland: number, dsea: number) {
  const d = dland + dsea;
  const efs = 106.9 - 20 * log10(d);
  const ese = 2.38 * (1 - Math.exp(-d / 8.94)) * log10(50 / t);
  return efs + dsea * ese / d;
}
// Eq (41): the distance that matters for low sea paths.
function d06(f: number, h1: number, h2: number) {
  if (h1 < 0) h1 = 0;
  const df = 0.0000389 * f * h1 * h2, dh = 4.1 * (Math.sqrt(h1) + Math.sqrt(h2));
  return Math.max(0.001, df * dh / (df + dh));
}
// Eq (39): inverse complementary normal, for interpolating in time.
function qi(x: number) {
  const T = (y: number) => Math.sqrt(-2 * Math.log(y));
  const C = (z: number) => { const t = T(z); return ((0.010328 * t + 0.802853) * t + 2.515517) / (((0.001308 * t + 0.189269) * t + 1.432788) * t + 1); };
  return x <= 0.5 ? T(x) - C(x) : -(T(1 - x) - C(1 - x));
}
function v(fnom: number, h1: number) {
  const k = fnom === 100 ? 1.35 : fnom === 600 ? 3.31 : 6;
  return k * atand(-h1 / 9000);
}
const jOf = (nu: number) => nu > -0.7806 ? 6.9 + 20 * log10(Math.sqrt((nu - 0.1) ** 2 + 1) + nu - 0.1) : 0;

// Step 8.1.4 / 8.1.5: the curve for one tabulated height, interpolated in distance, eq (13).
function atHeight(c: Curve, h: number, dinf: number, dsup: number, d: number) {
  const k = c.h1.indexOf(h);
  const ei = c.rows.find((r) => r.d === dinf)!.e[k], es = c.rows.find((r) => r.d === dsup)!.e[k];
  return dsup !== dinf ? ei + (es - ei) * log10(d / dinf) / log10(dsup / dinf) : es;
}
// Step 8.1: heights of 10 m and above, eq (8).
function step81(c: Curve, h1: number, dinf: number, dsup: number, d: number, em: number) {
  const [hi, hs] = closest(HEIGHTS, h1);
  const e = hi !== hs ? atHeight(c, hi, dinf, dsup, d) + (atHeight(c, hs, dinf, dsup, d) - atHeight(c, hi, dinf, dsup, d)) * log10(h1 / hi) / log10(hs / hi) : atHeight(c, hs, dinf, dsup, d);
  return Math.min(e, em);
}
// Step 8.2: heights below 10 m, eq (9) to (12).
function step82(c: Curve, h1: number, dinf: number, dsup: number, d: number, sea: boolean, fnom: number, em: number, t: number) {
  const e10 = atHeight(c, 10, dinf, dsup, d), e20 = atHeight(c, 20, dinf, dsup, d);
  const ch = 6.03 - jOf(v(fnom, -10));
  const ezero = e10 + 0.5 * (e10 - e20 + ch);
  if (!sea) return h1 >= 0 ? ezero + 0.1 * h1 * (e10 - ezero) : ezero + 6.03 - jOf(v(fnom, h1));
  const dh1 = d06(fnom, h1, 10), d20 = d06(fnom, 20, 10);
  if (d <= dh1) return em;
  if (d < d20) {
    const [a, b] = nominals(d20);
    const e10d = atHeight(c, 10, a, b, d20), e20d = atHeight(c, 20, a, b, d20);
    const ed20 = e10d + (e20d - e10d) * log10(h1 / 10) / log10(2);
    const edh1 = emax(t, 0, dh1);
    return edh1 + (ed20 - edh1) * log10(d / dh1) / log10(d20 / dh1);
  }
  const e1 = e10 + (e20 - e10) * log10(h1 / 10) / Math.log(2);   // as in the reference (natural log in the denominator)
  const e2 = ezero + 0.1 * h1 * (e10 - ezero);
  const fs = (d - d20) / d;
  return e1 * (1 - fs) + e2 * fs;                                  // eq (11c)
}
// Step 7: interpolate in frequency between the nominal curves, eq (14).
function step7(curves: Curve[], h1: number, dinf: number, dsup: number, d: number, sea: boolean, f: number, em: number, t: number) {
  const [fi, fs] = closest(FREQS, f);
  const at = (fn: number) => {
    const c = curves.find((x) => x.f_mhz === fn)!;
    return h1 >= 10 ? Math.min(step81(c, h1, dinf, dsup, d, em), em) : step82(c, h1, dinf, dsup, d, sea, fn, em, t);
  };
  if (fi === fs) return at(fs);
  let e = at(fi) + (at(fs) - at(fi)) * log10(f / fi) / log10(fs / fi);
  if (f > 2000) e = Math.min(e, em);
  return e;
}
// Steps 6 to 10 for one kind of path: interpolate in time, eq (15), (16).
function step6to10(kind: "land" | "cold" | "warm", h1: number, dinf: number, dsup: number, d: number, f: number, em: number, t: number) {
  const sea = kind !== "land";
  const [ti, ts] = closest(TIMES, t);
  const at = (tn: number) => {
    const set = CURVES.filter((c) => (sea ? c.path !== "land" : c.path === "land") && c.time === tn && (!(kind === "warm" && tn !== 50) || c.path === "warm_sea"));
    const df = d06(f, h1, 10), d600 = d06(600, h1, 10);
    if (sea && f < 100 && d < d600) {
      if (d <= df) return emax(t, 0, d);
      const edf = emax(t, 0, df);
      const [a, b] = nominals(d600);
      const ed600 = step7(set, h1, a, b, d600, sea, f, em, t);
      return edf + (ed600 - edf) * log10(d / df) / log10(d600 / df);
    }
    return step7(set, h1, dinf, dsup, d, sea, f, em, t);
  };
  if (ti === ts) return at(ts);
  const qs = qi(ts / 100), qn = qi(ti / 100), qt = qi(t / 100);
  return at(ts) * (qn - qt) / (qn - qs) + at(ti) * (qt - qs) / (qn - qs);
}

// Step 11 (RRC-06): mixed land and sea paths, eq (22) to (26). Every part uses the field strength at the whole distance.
function mixed(el: number, es: number, dland: number, dsea: number) {
  const d = dland + dsea;
  if (dsea === 0) return el;
  if (dland === 0) return es;
  const fsea = dsea / d, delta = es - el;
  const a = (1 - (1 - fsea) ** (2 / 3)) ** Math.max(1, 1 + delta / 40);
  return (1 - a) * el + a * es;
}

/** Field strength after step 11, for 1 kW e.r.p.: what the ITU validation examples log as "Field strength (§8 (17), step 11)". */
export function e11(o: { f: number; t: number; h1: number; dland: number; dsea: number; sea?: "cold" | "warm"; emax: number }) {
  const d = o.dland + o.dsea;
  const [dinf, dsup] = d < 1 ? [1, 1] : nominals(d);
  const dd = d >= 1 ? d : 1;
  const el = o.dland > 0 ? step6to10("land", o.h1, dinf, dsup, dd, o.f, o.emax, o.t) : 0;
  // A sea path needs at least 3 m (Annex 5, section 3.3), also within a mixed path.
  const es = o.dsea > 0 ? step6to10(o.sea ?? "cold", Math.max(3, o.h1), dinf, dsup, dd, o.f, o.emax, o.t) : 0;
  return mixed(el, es, o.dland, o.dsea);
}

// Step 14: receiving antenna height, rural land or sea (eq 27 to 29).
function step14(h1: number, d: number, h2: number, f: number, area: "rural" | "sea") {
  const k = 3.2 + 6.2 * log10(f);
  if (area === "rural") return k * log10(h2 / 10);
  if (h2 >= 10) return k * log10(h2 / 10);
  const d10 = d06(f, h1, 10), dh2 = d06(f, h1, h2), c10 = k * log10(h2 / 10);
  return d >= d10 ? c10 : d <= dh2 ? 0 : c10 * log10(d / dh2) / log10(d10 / dh2);
}

/** Field strength in dB(µV/m) for a transmitter of the given e.r.p. (dBW), effective height h1 (m), over a path of land and
 *  sea kilometres, at a receiver h2 metres above the ground, without terrain. */
export function fieldStrength(o: { f: number; t: number; h1: number; h2: number; dland: number; dsea: number; erp_dbw: number; area?: "rural" | "sea" }) {
  const d = o.dland + o.dsea;
  const h1 = Math.min(3000, o.dsea > 0 && o.dland === 0 ? Math.max(3, o.h1) : o.h1);
  const em = emax(o.t, o.dland, o.dsea);
  let e = e11({ f: o.f, t: o.t, h1, dland: o.dland, dsea: o.dsea, emax: em });
  e += step14(h1, Math.max(d, 1), o.h2, o.f, o.area ?? "rural");
  if (e > em) e = em;
  return { e: e + o.erp_dbw - 30, emax: em + o.erp_dbw - 30 };
}
