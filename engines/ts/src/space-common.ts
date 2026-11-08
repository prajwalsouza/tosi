// Shared by the space stages after Reach (limit, data, power, compare, stations): reading the database, the published
// limit tables and the stage rulebooks, and the exact numeric helpers every engine must match.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them.
const citesOf = (rules: Record<string, unknown>) => Object.fromEntries(Object.entries(rules).filter(([k]) => k === "method" || k === "basis" || k.endsWith("_basis")));

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export type Row = Record<string, any>;

export function rulebook(stage: string) {
  const bytes = readFileSync(join(root, "spec", "rulebook", `${stage}.json`));
  const rules = JSON.parse(bytes.toString("utf8"));
  return { rules, stamp: { version: rules.version, sha256: createHash("sha256").update(bytes).digest("hex"), cites: citesOf(rules) } };
}
export function table(name: string): Row { return JSON.parse(readFileSync(join(root, "spec", "tables", `${name}.json`), "utf8")); }
export const emitter = (step: string) => (state: string, fields: Record<string, unknown> = {}) =>
  process.stderr.write(JSON.stringify({ event: "step", step, state, ...fields }) + "\n");

// Exactly as in every engine: degrees and radians, rounding to two decimals half up, never -0.
export const RAD = Math.PI / 180, DEG = 180 / Math.PI;
export const round2 = (x: number) => { const v = Math.floor(x * 100 + 0.5) / 100; return v === 0 ? 0 : v; };
export const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
export const log10 = (x: number) => Math.log10(x);
// A date column as YYYYMMDD, or null for no date (the ITU writes 1900-01-01 or earlier for none).
export function ymd(v: unknown): number | null {
  if (!(v instanceof Date) || Number.isNaN(v.getTime())) return null;
  const y = v.getUTCFullYear();
  return y > 1900 ? y * 10000 + (v.getUTCMonth() + 1) * 100 + v.getUTCDate() : null;
}

export function readJson(folder: string, name: string) { return JSON.parse(readFileSync(join(folder, name), "utf8")); }
export function write(folder: string, name: string, result: unknown) {
  const text = JSON.stringify(result);
  writeFileSync(join(folder, name), text + "\n");
  return text;
}
export function requireSpace(folder: string, stage: string) {
  const intake = readJson(folder, "intake.json");
  if (intake.kind !== "space" || intake.check.status !== "accepted") throw new Error(`${stage} needs an accepted space filing`);
  return intake;
}

export async function openDb(folder: string, emit: (s: string, f?: Record<string, unknown>) => void) {
  const { default: MDBReader } = await import("mdb-reader");
  const db = new MDBReader(readFileSync(join(folder, "database.mdb")));
  const names = new Set(db.getTableNames());
  // A table that is missing counts as filing nothing.
  return (t: string, columns: string[]): Row[] => {
    if (!names.has(t)) return [];
    const have = new Set(db.getTable(t).getColumnNames());
    const rows = db.getTable(t).getData({ columns: columns.filter((c) => have.has(c)) }) as Row[];
    emit("progress", { table: t, rows: rows.length });
    return rows;
  };
}

export type Group = { grp_id: number; ntc_id: number; type: string; beam: string | null; lo: number | null; hi: number | null; classes: string[]; date: number | null };
export type Orbit = { incl: number | null; apog: number | null; perig: number | null };

// The transmitting groups of the filings Reach saw, with what the limit tables are matched on.
export function groups(read: (t: string, c: string[]) => Row[], reach: Row, down: Row) {
  const seen = new Map<number, string>(reach.notices.filter((n: Row) => n.seen).map((n: Row) => [n.ntc_id, n.type]));
  const want = new Set<number>(reach.groups);
  const rcv = new Map<number, number | null>(read("notice", ["ntc_id", "d_rcv"]).map((r) => [r.ntc_id, ymd(r.d_rcv)]));
  const span = new Map<number, [number, number]>();
  for (const r of read("freq", ["grp_id", "freq_mhz", "freq_min", "freq_max"])) {
    if (!want.has(r.grp_id)) continue;
    const lo = num(r.freq_min) ?? num(r.freq_mhz), hi = num(r.freq_max) ?? num(r.freq_mhz);
    if (lo === null || hi === null) continue;
    const s = span.get(r.grp_id);
    span.set(r.grp_id, s ? [Math.min(s[0], lo), Math.max(s[1], hi)] : [lo, hi]);
  }
  const cls = new Map<number, Set<string>>();
  for (const r of read("srv_cls", ["grp_id", "stn_cls"])) {
    if (!want.has(r.grp_id) || typeof r.stn_cls !== "string") continue;
    (cls.get(r.grp_id) ?? cls.set(r.grp_id, new Set()).get(r.grp_id)!).add(r.stn_cls.trim());
  }
  const out: Group[] = [];
  for (const r of read("grp", ["grp_id", "ntc_id", "beam_name", "d_prot_eff"])) {
    if (!want.has(r.grp_id) || !seen.has(r.ntc_id)) continue;
    const s = span.get(r.grp_id);
    out.push({ grp_id: r.grp_id, ntc_id: r.ntc_id, type: seen.get(r.ntc_id)!, beam: typeof r.beam_name === "string" ? r.beam_name : null,
      lo: s ? s[0] : null, hi: s ? s[1] : null, classes: [...(cls.get(r.grp_id) ?? [])].sort(), date: ymd(r.d_prot_eff) ?? rcv.get(r.ntc_id) ?? null });
  }
  out.sort((a, b) => a.grp_id - b.grp_id);
  return { groups: out, seen };
}

// Steepest tilt, highest apogee and lowest perigee over every orbit a filing gives.
export function orbits(read: (t: string, c: string[]) => Row[]) {
  const m = new Map<number, Orbit>();
  for (const r of read("orbit", ["ntc_id", "inclin_ang", "apog_km", "perig_km"])) {
    const o = m.get(r.ntc_id) ?? m.set(r.ntc_id, { incl: null, apog: null, perig: null }).get(r.ntc_id)!;
    const i = num(r.inclin_ang), a = num(r.apog_km), p = num(r.perig_km);
    if (i !== null) o.incl = o.incl === null ? i : Math.max(o.incl, i);
    if (a !== null) o.apog = o.apog === null ? a : Math.max(o.apog, a);
    if (p !== null) o.perig = o.perig === null ? p : Math.min(o.perig, p);
  }
  return m;
}

// The published limit tables, by table: G for satellites fixed in the sky, N for those that move.
export function limits() {
  const t = table("pfd");
  const area = new Map<number, string>(t.prot_area.map((r: Row) => [r.ix_prot_area, String(r.area_name).trim()]));
  const classes = new Map<number, Set<string>>();
  for (const r of t.classes_of_stn) {
    const s = classes.get(r.ix_serv) ?? classes.set(r.ix_serv, new Set()).get(r.ix_serv)!;
    const c = String(r.class_of_stn ?? "");
    for (let i = 0; i + 2 <= c.length; i += 2) s.add(c.slice(i, i + 2));
  }
  const byProvn = (rows: Row[]) => { const m = new Map<number, Row>(); for (const r of rows) m.set(r.ix_provn, r); return m; };
  const masks = (rows: Row[]) => {
    const m = new Map<number, Row[]>();
    for (const r of rows) (m.get(r.mask_code) ?? m.set(r.mask_code, []).get(r.mask_code)!).push(r);
    for (const v of m.values()) v.sort((a, b) => a.mask_segment - b.mask_segment);
    return m;
  };
  return {
    source: t.source, area, classes,
    exam: { G: t.freq_exam as Row[], N: t.ngso_freq_exam as Row[] } as Record<string, Row[]>,
    provision: { G: byProvn(t.provisions), N: byProvn(t.ngso_provisions) } as Record<string, Map<number, Row>>,
    mask: { G: masks(t.pfd_mask), N: masks(t.ngso_pfd_mask) } as Record<string, Map<number, Row[]>>,
  };
}
export const tableOf = (type: string) => type === "G" ? "G" : "N";

// A mask segment needs values the filing does not give (the NGSO tables' C4 and C5) when either is set.
export const usable = (s: Row) => !(num(s.c4) ?? 0) && !(num(s.c5) ?? 0);

// The limit at arrival angle delta (degrees), or null where the mask gives none. Later segments win at shared edges.
export function maskAt(segs: Row[], delta: number): number | null {
  let out: number | null = null;
  for (const s of segs) {
    if (!usable(s)) continue;
    const x = Math.max(delta + (num(s.c3) ?? 0), 1e-9);
    const term = s.ang_log ? log10(x) : s.ang_square ? x * x : s.ang ? x : 0;
    const flat = s.ang_min === 0 && s.ang_max === 0;          // an angle-independent limit is stored as a 0–0 segment
    if (flat || (delta >= s.ang_min && delta <= s.ang_max)) out = s.c1 + (num(s.c2) ?? 0) * term;
  }
  return out;
}

// '14M0F2D--' -> 14e6 Hz, '2K70J3E' -> 2700, '100H' -> 100; null when the designation gives no width.
const UNIT: Record<string, number> = { H: 1, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
export function bandwidthHz(design: unknown): number | null {
  const m = /^(\d*)([HKMGT])(\d*)/.exec(String(design ?? "").trim().toUpperCase());
  if (!m || !(m[1] || m[3])) return null;
  return Number(`${m[1] || "0"}.${m[3] || "0"}`) * UNIT[m[2]];
}

// Power in the reference bandwidth (dBW), by the rule of Recommendation ITU-R SF.675 as the BR's GSO PFD annex
// applies it: peak power, or density times the reference bandwidth, whichever the rule picks.
export function powerIn(pep: number | null, dens: number | null, bHz: number | null, fMhz: number, brefHz: number, rules: Row): number | null {
  if (brefHz <= 0) return pep;
  const d = dens === null ? null : dens + 10 * log10(brefHz);
  if (d === null) return pep;
  if (pep === null || bHz === null) return d;
  const bavg = fMhz < rules.averaging.below_mhz ? rules.averaging.below_hz : rules.averaging.above_hz;
  if (bavg === brefHz) return d;
  if (bavg < brefHz) return bHz >= brefHz ? Math.min(d, pep) : pep;
  return bHz < brefHz ? pep : d;
}

export function stations(): { present: boolean; sha256: string | null; list: Row[] } {
  const f = join(root, "state", "reference", "stations.json");
  if (!existsSync(f)) return { present: false, sha256: null, list: [] };
  const bytes = readFileSync(f);
  return { present: true, sha256: createHash("sha256").update(bytes).digest("hex"), list: JSON.parse(bytes.toString("utf8")).stations };
}

// Where a fixed satellite at longitude L appears from a point: elevation (degrees) and slant range (km).
export function gsoFrom(lon: number, lat: number, L: number, re: number, rg: number) {
  const c = Math.cos(lat * RAD) * Math.cos((lon - L) * RAD);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  return { el: Math.atan2(c - re / rg, s) * DEG, d: Math.sqrt(re * re + rg * rg - 2 * re * rg * c) };
}
