// Shared by the terrestrial stages: rulebooks, the database tables they read, Finland's outline, land and sea along a path,
// and the number conventions every engine follows. See spec/stages/mobile ... tstations.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them.
const citesOf = (rules: Record<string, unknown>) => Object.fromEntries(Object.entries(rules).filter(([k]) => k === "method" || k === "basis" || k.endsWith("_basis")));

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const emit = (step: string, state: string, fields: Record<string, unknown> = {}) =>
  process.stderr.write(JSON.stringify({ event: "step", step, state, ...fields }) + "\n");

export function rulebook(stage: string) {
  const bytes = readFileSync(join(root, "spec", "rulebook", `${stage}.json`));
  const rules = JSON.parse(bytes.toString("utf8"));
  return { rules, stamp: { version: rules.version, sha256: createHash("sha256").update(bytes).digest("hex"), cites: citesOf(rules) } };
}
const tableBytes = (name: string) => readFileSync(join(root, "spec", "tables", `${name}.json`));
export const tableSha = (name: string) => createHash("sha256").update(tableBytes(name)).digest("hex");

// Numbers: two decimals, floor(x * 100 + 0.5) / 100, never -0; coordinates three decimals the same way.
export const round2 = (x: number) => { const v = Math.floor(x * 100 + 0.5) / 100; return v === 0 ? 0 : v; };
export const round3 = (x: number) => { const v = Math.floor(x * 1000 + 0.5) / 1000; return v === 0 ? 0 : v; };
export const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;
const RAD = Math.PI / 180;

export function readJson(folder: string, name: string) { return JSON.parse(readFileSync(join(folder, `${name}.json`), "utf8")); }
export function writeResult(folder: string, name: string, result: unknown) {
  const text = JSON.stringify(result);
  writeFileSync(join(folder, `${name}.json`), text + "\n");
  return text;
}
export function needTerrestrial(folder: string) {
  const intake = readJson(folder, "intake");
  if (intake.kind !== "terrestrial" || intake.check.status !== "accepted") throw new Error("This stage needs an accepted terrestrial filing");
  return intake;
}

// The database: named columns of a table, or nothing if the table or a column is missing.
export async function openDb(folder: string) {
  const { default: MDBReader } = await import("mdb-reader");
  const db = new MDBReader(readFileSync(join(folder, "database.mdb")));
  const names = new Set(db.getTableNames());
  return (step: string, t: string, columns: string[]): Record<string, any>[] => {
    if (!names.has(t)) return [];
    const have = new Set(db.getTable(t).getColumnNames());
    const rows = db.getTable(t).getData({ columns: columns.filter((c) => have.has(c)) }) as Record<string, any>[];
    emit(step, "progress", { table: t, rows: rows.length });
    return rows;
  };
}

// Station records joined from fxm_terra and fxm_geo, in ascending terrakey order.
export type Station = { terrakey: number; adm: string; cls: string; stage: string; intent: string; f: number | null; bw: string; bwKhz: number | null;
  lon: number | null; lat: number | null; radius: number; geo: string };
export function stations(read: ReturnType<typeof openDb> extends Promise<infer R> ? R : never, step: string): Station[] {
  const geo = new Map(read(step, "fxm_geo", ["geo_key", "geo_type", "long_dec", "lat_dec", "radius"]).map((g) => [g.geo_key, g]));
  return read(step, "fxm_terra", ["terrakey", "adm", "stn_cls", "stage", "intent", "freq_assgn", "bdwdth_cde", "bdwdth", "geo_key"])
    .map((r) => {
      const g = geo.get(r.geo_key);
      return { terrakey: r.terrakey, adm: (r.adm ?? "").trim(), cls: (r.stn_cls ?? "").trim(), stage: (r.stage ?? "").trim(), intent: (r.intent ?? "").trim(),
        f: num(r.freq_assgn), bw: (r.bdwdth_cde ?? "").trim(), bwKhz: bandwidthKhz(r.bdwdth_cde, r.bdwdth),
        lon: num(g?.long_dec), lat: num(g?.lat_dec), radius: num(g?.radius) ?? 0, geo: (g?.geo_type ?? "").trim() };
    })
    .sort((a, b) => a.terrakey - b.terrakey);
}

// ITU bandwidth codes: '16K8' is 16.8 kHz, '100H' is 0.1 kHz, '5M00' is 5000 kHz. Falls back to the bdwdth column (kHz).
const UNIT_KHZ: Record<string, number> = { H: 1e-3, K: 1, M: 1e3, G: 1e6, T: 1e9 };
export function bandwidthKhz(code: unknown, fallback: unknown): number | null {
  const m = /^(\d*)([HKMGT])(\d*)/.exec(String(code ?? "").trim().toUpperCase());
  if (m && (m[1] || m[3])) return Number(`${m[1] || 0}.${m[3] || 0}`) * UNIT_KHZ[m[2]];
  return num(fallback);
}

// Great-circle distance on a sphere of the given radius (km).
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number, r: number) {
  const a = Math.sin((lat2 - lat1) * RAD / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin((lon2 - lon1) * RAD / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

// Finland's outer limit and the land nearby (spec/tables/finland.json).
type Ring = { pts: number[][]; box: [number, number, number, number] };
const FIN = JSON.parse(tableBytes("finland").toString("utf8"));
export const BORDER: [number, number, string][] = FIN.border;
const ringOf = (pts: number[][]): Ring => ({ pts, box: [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))] });
const LAND: Ring[] = FIN.land.map(ringOf);
const OUTER = ringOf(BORDER.map((p) => [p[0], p[1]]));
// Even-odd rule over the rings: holes (lakes) count as not land.
function inRing(r: Ring, x: number, y: number) {
  if (x < r.box[0] || x > r.box[2] || y < r.box[1] || y > r.box[3]) return false;
  let c = false;
  const p = r.pts;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) c = !c;
  }
  return c;
}
export const isLand = (lon: number, lat: number) => LAND.reduce((c, r) => inRing(r, lon, lat) ? !c : c, false);
export const insideFinland = (lon: number, lat: number) => inRing(OUTER, lon, lat);

/** Nearest point of Finland's outer limit: its index in the border table and the distance (0 inside Finland). */
export function nearestBorder(lon: number, lat: number, r: number) {
  let best = -1, bd = Infinity;
  for (let i = 0; i < BORDER.length; i++) { const d = distanceKm(lat, lon, BORDER[i][1], BORDER[i][0], r); if (d < bd) { bd = d; best = i; } }
  return { index: best, km: insideFinland(lon, lat) ? 0 : bd };
}
/** Border points to evaluate: the n nearest; every stride-th point (by index along the border) within spreadKm of the
 *  nearest distance; and the nearest land-border and sea-limit points. Ascending index. */
export function candidates(lon: number, lat: number, n: number, spreadKm: number, stride: number, r: number) {
  const d = BORDER.map((p) => distanceKm(lat, lon, p[1], p[0], r));
  const order = d.map((x, i) => i).sort((a, b) => d[a] - d[b] || a - b);
  const pick = new Set(order.slice(0, n));
  const dmin = d[order[0]];
  for (let i = 0; i < BORDER.length; i += stride) if (d[i] <= dmin + spreadKm) pick.add(i);
  const land = order.find((i) => BORDER[i][2] === "land"), sea = order.find((i) => BORDER[i][2] === "sea");
  if (land !== undefined) pick.add(land);
  if (sea !== undefined) pick.add(sea);
  return [...pick].sort((a, b) => a - b).map((i) => ({ i, d: d[i] }));
}
/** Land and sea along the straight path: the share of `samples` midpoints that fall on land, applied to the distance. */
export function landSea(lon1: number, lat1: number, lon2: number, lat2: number, km: number, samples: number) {
  let land = 0;
  for (let k = 0; k < samples; k++) {
    const t = (k + 0.5) / samples;
    if (isLand(lon1 + (lon2 - lon1) * t, lat1 + (lat2 - lat1) * t)) land++;
  }
  return { dland: km * land / samples, dsea: km * (samples - land) / samples, landShare: land / samples };
}

// Traficom's station list, cleaned (state/reference/stations.json). Local only: absent on most computers.
export function finnishStations(): { present: boolean; sha256: string | null; stations: any[] } {
  const p = join(root, "state", "reference", "stations.json");
  if (!existsSync(p)) return { present: false, sha256: null, stations: [] };
  const bytes = readFileSync(p);
  return { present: true, sha256: createHash("sha256").update(bytes).digest("hex"), stations: JSON.parse(bytes.toString("utf8")).stations };
}
