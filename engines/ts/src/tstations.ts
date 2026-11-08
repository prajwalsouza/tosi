// Terrestrial stage 6, stations. See spec/stages/tstations/README.md.
// The signal of each foreign station worked out at every listed Finnish station within 1,000 km that shares its channel
// (receive frequency, and transmit frequency when different), against the same trigger level.
import { fieldStrength } from "./p1546.ts";
import { distanceKm, emit, finnishStations, landSea, needTerrestrial, openDb, readJson, round2, rulebook, stations, writeResult } from "./terra-common.ts";

export async function tstations(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const thr = readJson(folder, "threshold"), data = readJson(folder, "tdata");
  const { rules, stamp } = rulebook("tstations");
  const field = rulebook("field").rules;
  emit("tstations", "start");
  const read = await openDb(folder);
  const by = new Map(stations(read, "tstations").map((s) => [s.terrakey, s]));
  const dat = new Map(data.notices.map((n: any) => [n.terrakey, n]));
  const list = finnishStations();
  // One band per protected frequency: receive, and transmit when different (guidebook C-4), each the station's width.
  const bands: { id: string; lo: number; hi: number; lon: number; lat: number }[] = [];
  for (const st of list.stations) {
    if (st.lon === null || st.lat === null) continue;
    const half = (st.bw_mhz ?? 0) / 2;
    const fs = [st.rx_mhz, st.tx_mhz !== null && st.tx_mhz !== st.rx_mhz ? st.tx_mhz : null].filter((x) => x !== null);
    for (const f of fs) bands.push({ id: st.station, lo: f - half, hi: f + half, lon: st.lon, lat: st.lat });
  }
  const how: Record<string, number> = Object.fromEntries(Object.keys(rules.outcomes).map((k) => [k, 0]));
  const notices = thr.notices.map((n: any) => {
    const s = by.get(n.terrakey)!, d: any = dat.get(n.terrakey);
    if (!list.present) { how.no_list++; return { terrakey: n.terrakey, outcome: "no_list", checked: 0, over: [], worst: null }; }
    const half = (s.bwKhz ?? 0) / 2000, lo = s.f! - half, hi = s.f! + half;
    const seen = new Map<string, { e: number; excess: number; km: number }>();
    for (const b of bands) {
      if (b.hi < lo || b.lo > hi || seen.has(b.id)) continue;
      const km = distanceKm(s.lat!, s.lon!, b.lat, b.lon, field.earth_radius_km);
      if (km > rules.max_km) continue;
      const k = Math.max(field.min_km, km);
      const path = landSea(s.lon!, s.lat!, b.lon, b.lat, k, field.samples);
      const { e } = fieldStrength({ f: s.f!, t: field.time_percent, h1: d.heff_m, h2: rules.receiver_height_m, dland: path.dland, dsea: path.dsea, erp_dbw: d.erp_dbw });
      seen.set(b.id, { e: round2(e), excess: round2(round2(e) - n.limit), km: round2(k) });
    }
    const ids = [...seen.keys()].sort((a, b) => Number(a) - Number(b));
    const over = ids.filter((id) => seen.get(id)!.excess > 0);
    let worst: string | null = null;
    for (const id of ids) if (worst === null || seen.get(id)!.excess > seen.get(worst)!.excess) worst = id;
    const outcome = ids.length === 0 ? "no_station" : over.length ? "exposed" : "not_exposed";
    how[outcome]++;
    return { terrakey: n.terrakey, outcome, checked: ids.length, over, worst: worst === null ? null : { station: worst, ...seen.get(worst)! } };
  });
  const result = { schema: "tstations/1", rulebook: stamp, list: { present: list.present, sha256: list.sha256, stations: list.stations.length }, file: intake.file.sha256,
    counts: { notices: notices.length, how }, notices };
  emit("tstations", "done", { notices: notices.length, how });
  return writeResult(folder, "tstations", result);
}
