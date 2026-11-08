// Stage 8, stations. See spec/stages/stations/README.md.
// Which listed Finnish stations a satellite over or near the limit could affect: stations whose frequencies overlap
// what it transmits within the limit's band, and that can see it (a fixed satellite must be above their horizon).
import { rulebook, emitter, readJson, requireSpace, write, stations as list, gsoFrom, type Row } from "./space-common.ts";

const emit = emitter("stations");
const sortIds = (s: Iterable<string>) => [...s].sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));

export async function stations(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Stations");
  const { rules, stamp } = rulebook("stations");
  const reach = readJson(folder, "reach.json"), cmp = readJson(folder, "compare.json");
  emit("start");
  const st = list();
  emit("progress", { table: "stations", rows: st.list.length });
  // Each station protects what it receives, and what it transmits too, because someone in Finland receives that
  // (guidebook C-4). A band is the frequency plus and minus half the width.
  const bands: { id: string; lo: number; hi: number; lon: number | null; lat: number | null }[] = [];
  for (const s of st.list) {
    const w = (s.bw_mhz ?? 0) / 2;
    const fs: number[] = [];
    if (s.rx_mhz != null) fs.push(s.rx_mhz);
    if (s.tx_mhz != null && (s.rx_mhz == null || Math.abs(s.tx_mhz - s.rx_mhz) > rules.same_frequency_mhz)) fs.push(s.tx_mhz);
    for (const f of fs) bands.push({ id: String(s.station), lo: f - w, hi: f + w, lon: s.lon ?? null, lat: s.lat ?? null });
  }
  const lon = new Map<number, number>(reach.notices.filter((n: Row) => n.longitude != null).map((n: Row) => [n.ntc_id, n.longitude]));
  const rows = new Map<number, any[][]>();
  for (const r of cmp.rows) (rows.get(r[1]) ?? rows.set(r[1], []).get(r[1])!).push(r);

  const how: Record<string, number> = Object.fromEntries(Object.keys(rules.outcomes).map((k) => [k, 0]));
  const notices: Row[] = [];
  for (const n of cmp.notices.filter((x: Row) => x.outcome === "over" || x.outcome === "near")) {
    const L = lon.get(n.ntc_id);
    // A fixed satellite is seen only by stations where it is above the horizon; with no position, a station is
    // assumed to see a moving one at some point (worst case).
    const sees = (b: (typeof bands)[number]) => L === undefined || b.lon === null || b.lat === null || gsoFrom(b.lon, b.lat, L, rules.earth_radius_km, rules.geostationary_radius_km).el >= rules.horizon_deg;
    // Evidence stays with its transmission: a station is matched to each row (one transmission in one limit band) on its
    // own, so "over at a station" means that same transmission is over the limit and on the station's frequencies.
    const hit = new Set<string>(), over = new Set<string>();
    let atOver: Row | null = null, atNear: Row | null = null;
    for (const r of rows.get(n.ntc_id) ?? []) {
      const [grp, , , , , excess, lo, hi] = r, here = new Set<string>();
      for (const b of bands) if (b.lo <= hi && b.hi >= lo && sees(b)) here.add(b.id);
      for (const id of here) hit.add(id);
      const isOver = excess > 0;
      if (isOver) for (const id of here) over.add(id);
      // the strongest transmission of each kind that reaches a listed station (the first, if two are equal)
      const best = isOver ? atOver : atNear;
      if (here.size && (!best || excess > best.excess)) {
        const ev = { grp_id: grp, excess, lo_mhz: lo, hi_mhz: hi, stations: sortIds(here) };
        if (isOver) atOver = ev; else atNear = ev;
      }
    }
    const ids = sortIds(hit);
    const k = !st.present ? "no_list" : ids.length ? "stations" : "no_station";
    how[k]++;
    notices.push({ ntc_id: n.ntc_id, type: n.type, outcome: n.outcome, how: k, stations: ids,
      over: sortIds(over), near: ids.filter((id) => !over.has(id)), at_over: atOver, at_near: atNear });
  }
  const result = { schema: "stations/1", rulebook: stamp, file: intake.file.sha256,
    list: { present: st.present, sha256: st.sha256, stations: st.list.length },
    counts: { notices: notices.length, how, stations_hit: new Set(notices.flatMap((n) => n.stations)).size }, notices };
  emit("done", { notices: notices.length, ...how });
  return write(folder, "stations.json", result);
}
