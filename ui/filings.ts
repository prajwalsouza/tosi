// What each filing is, for people: its name, the country that filed it, where it flies and on which frequencies.
// Read straight from the run's database for display only. No stage reads this and no result depends on it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Row = Record<string, any>;
export type Filing = {
  name: string | null;
  adm: string; country: string;
  with: string[];                                  // other administrations filing together with it
  org: string | null;                              // the intergovernmental organisation it files for, if any
  stage: string | null; stageCode: string | null;  // advance publication, coordination, notification…
  received: string | null;                         // when the ITU received it (YYYY-MM-DD)
  where: string | null;                            // "Fixed over 66.0° E", "Up to 36 satellites · 600 km up · tilted 89–93°"
  sends: string | null; listens: string | null;    // frequency ranges, with band names
  note: string | null;                             // the administration's own remark, if any
  tilt: number | null; apogee: number | null;      // moving satellite: steepest orbit tilt (folded to 0–90°) and highest apogee, km
};

const BANDS: [string, number, number][] = [["VHF", 30, 300], ["UHF", 300, 1000], ["L", 1e3, 2e3], ["S", 2e3, 4e3], ["C", 4e3, 8e3], ["X", 8e3, 12e3],
  ["Ku", 12e3, 18e3], ["K", 18e3, 27e3], ["Ka", 27e3, 40e3], ["V", 40e3, 75e3], ["W", 75e3, 110e3]];
const mhz = (v: number) => v >= 1000 ? `${+(v / 1000).toFixed(3)} GHz` : `${+v.toFixed(3)} MHz`;
// The overall span, and the band names of the frequencies actually filed (not every band inside the span).
type Span = { lo: number; hi: number; bands: Set<string> };
function range(f: Span) {
  const names = BANDS.map(([n]) => n).filter((n) => f.bands.has(n));
  return `${f.lo === f.hi ? mhz(f.lo) : `${mhz(f.lo)} to ${mhz(f.hi)}`}${names.length ? ` (${names.length > 1 ? names.join(", ") + " bands" : names[0] + " band"})` : ""}`;
}
const deg = (v: number, pos: string, neg: string) => `${Math.abs(+v.toFixed(2))}° ${v < 0 ? neg : pos}`;
const day = (d: unknown) => d instanceof Date && d.getUTCFullYear() > 1900 ? d.toISOString().slice(0, 10) : null;
const r2 = (v: number) => +v.toFixed(2);
const span = (a: number, b: number, unit: string) => r2(a) === r2(b) ? `${r2(a)}${unit}` : `${r2(a)}–${r2(b)}${unit}`;
const BODY: Record<string, string> = { L: "the Moon", S: "the Sun", J: "Jupiter", M: "Mars", V: "Venus" };

export function makeFilings(root: string) {
  const names = JSON.parse(readFileSync(join(root, "spec", "reference", "administrations.json"), "utf8"));
  const cache = new Map<string, Record<string, Filing>>();

  async function read(folder: string): Promise<Record<string, Filing> | null> {
    const file = join(folder, "database.mdb");
    if (!existsSync(file)) return null;
    const { default: MDBReader } = await import(join(root, "engines", "ts", "node_modules", "mdb-reader", "lib", "node", "index.js"));
    const db = new MDBReader(readFileSync(file));
    const has = new Set(db.getTableNames());
    const rows = (t: string, columns: string[]): Row[] => has.has(t) ? db.getTable(t).getData({ columns: columns.filter((c) => db.getTable(t).getColumnNames().includes(c)) }) : [];
    const byNtc = (rs: Row[]) => { const m = new Map<number, Row[]>(); for (const r of rs) (m.get(r.ntc_id) ?? m.set(r.ntc_id, []).get(r.ntc_id)!).push(r); return m; };

    const geo = new Map(rows("geo", ["ntc_id", "sat_name", "long_nom"]).map((r) => [r.ntc_id, r]));
    const ngeo = new Map(rows("non_geo", ["ntc_id", "sat_name", "ref_body"]).map((r) => [r.ntc_id, r]));
    const orbit = byNtc(rows("orbit", ["ntc_id", "orbit_set_id", "nbr_sat_pl", "inclin_ang", "apog_km", "perig_km"]));
    const stn = new Map(rows("e_stn", ["ntc_id", "stn_name", "sat_name", "lat_dec", "long_dec"]).map((r) => [r.ntc_id, r]));
    const assoc = byNtc(rows("adm_assoc", ["ntc_id", "adm"]));
    const memo = new Map(rows("ntc_memo", ["ntc_id", "adm_remark"]).map((r) => [r.ntc_id, r]));
    const freq = new Map<number, { E?: Span; R?: Span }>();
    for (const r of rows("freq", ["ntc_id", "emi_rcp", "freq_mhz", "freq_min", "freq_max"])) {
      const lo = r.freq_min ?? r.freq_mhz, hi = r.freq_max ?? r.freq_mhz, k = r.emi_rcp as "E" | "R";
      if (lo == null || hi == null || (k !== "E" && k !== "R")) continue;
      const f = freq.get(r.ntc_id) ?? freq.set(r.ntc_id, {}).get(r.ntc_id)!, cur = f[k];
      const x = cur ?? (f[k] = { lo, hi, bands: new Set() });
      x.lo = Math.min(x.lo, lo); x.hi = Math.max(x.hi, hi);
      for (const [b, a, z] of BANDS) if (lo < z && hi > a || (lo === hi && lo >= a && lo < z)) x.bands.add(b);
    }

    const out: Record<string, Filing> = {};
    for (const n of rows("notice", ["ntc_id", "adm", "ntwk_org", "prov", "d_rcv", "ntc_type"])) {
      const g = geo.get(n.ntc_id), ng = ngeo.get(n.ntc_id), s = stn.get(n.ntc_id), o = orbit.get(n.ntc_id) ?? [], f = freq.get(n.ntc_id) ?? {};
      let where: string | null = null;
      if (s) where = `On the ground at ${deg(s.lat_dec, "N", "S")}, ${deg(s.long_dec, "E", "W")}${s.sat_name ? `, working with ${s.sat_name}` : ""}`;
      else if (g?.long_nom != null) where = `Fixed in the sky over ${deg(g.long_nom, "E", "W")}`;
      else if (ng?.ref_body && BODY[ng.ref_body]) where = `Travels around ${BODY[ng.ref_body]}, far beyond Earth`;
      else if (o.length) {
        const sets = new Map<number, number>();
        for (const r of o) sets.set(r.orbit_set_id ?? 0, (sets.get(r.orbit_set_id ?? 0) ?? 0) + (r.nbr_sat_pl ?? 0));
        const sats = Math.max(...sets.values());
        const alt = o.flatMap((r) => [r.perig_km, r.apog_km]).filter((x) => x != null) as number[];
        const inc = o.map((r) => r.inclin_ang).filter((x) => x != null) as number[];
        where = [sats ? `Up to ${sats.toLocaleString("en-GB")} satellite${sats === 1 ? "" : "s"}` : `${o.length} orbits`,
          alt.length ? `${span(Math.min(...alt), Math.max(...alt), " km")} up` : null,
          inc.length ? `orbit tilted ${span(Math.min(...inc), Math.max(...inc), "°")}` : null].filter(Boolean).join(" · ");
      }
      const tilts = o.map((r) => r.inclin_ang).filter((x) => x != null).map((i: number) => Math.min(i, 180 - i));
      const apogs = o.map((r) => r.apog_km).filter((x) => x != null) as number[];
      const prov = n.prov ? String(n.prov).trim() : null;
      out[n.ntc_id] = {
        name: g?.sat_name ?? ng?.sat_name ?? s?.stn_name ?? null,
        adm: n.adm, country: names.administrations[n.adm] ?? n.adm,
        with: (assoc.get(n.ntc_id) ?? []).map((r) => names.administrations[r.adm] ?? r.adm).filter((x) => x !== (names.administrations[n.adm] ?? n.adm)),
        org: n.ntwk_org ? names.organisations[n.ntwk_org] ?? n.ntwk_org : null,
        stage: prov ? names.stages[prov] ?? null : null, stageCode: prov,
        received: day(n.d_rcv),
        where,
        sends: f.E ? range(f.E) : null, listens: f.R ? range(f.R) : null,
        note: memo.get(n.ntc_id)?.adm_remark?.trim() || null,
        tilt: tilts.length ? r2(Math.max(...tilts)) : null, apogee: apogs.length ? Math.max(...apogs) : null,
      };
    }
    return out;
  }

  return {
    // The first engine's folder keeps the database while the server runs.
    async get(runsDir: string, id: string, engine: string) {
      const key = `${id}/${engine}`;
      if (!cache.has(key)) { const r = await read(join(runsDir, id, engine)); if (!r) return null; cache.set(key, r); }
      return cache.get(key)!;
    },
  };
}
