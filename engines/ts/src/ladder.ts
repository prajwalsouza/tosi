// Stage 9, ladder. See spec/stages/ladder/README.md.
// Every space filing that entered the screen goes on exactly one rung of the concern ladder: the first rung that applies,
// in ladder order. The ladder reads the earlier stages' results, plus the filing's own records for "ITU names Finland".
import { rulebook, emitter, readJson, requireSpace, write, openDb, stations as list, gsoFrom, type Row } from "./space-common.ts";
import { m4Table, finnishUse } from "./m4.ts";

const emit = emitter("ladder");

export async function ladder(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Ladder");
  const { rules, stamp } = rulebook("ladder");
  const down = readJson(folder, "downlink.json"), reach = readJson(folder, "reach.json"), lim = readJson(folder, "limit.json");
  const data = readJson(folder, "data.json"), cmp = readJson(folder, "compare.json"), sta = readJson(folder, "stations.json");
  emit("start");
  const read = await openDb(folder, emit);

  // The filing's own records naming Finland: coordination with FIN, an affected Finnish network, Finland in its service area.
  const FIN = rules.itu_finland.administration;
  const owner = new Map<number, number>(read("grp", ["grp_id", "ntc_id"]).map((r) => [r.grp_id, r.ntc_id]));
  const itu = new Map<number, Set<string>>();
  const mark = (ntc: number | undefined, src: string) => { if (ntc !== undefined) (itu.get(ntc) ?? itu.set(ntc, new Set()).get(ntc)!).add(src); };
  for (const r of read("provn", ["grp_id", "adm"])) if ((r.adm ?? "").trim() === FIN) mark(owner.get(r.grp_id), "provn");
  for (const r of read("tr_aff_ntw", ["ntc_id", "adm"])) if ((r.adm ?? "").trim() === FIN) mark(r.ntc_id, "tr_aff_ntw");
  for (const r of read("srv_area", ["grp_id", "ctry"])) if ((r.ctry ?? "").trim() === FIN) mark(owner.get(r.grp_id), "srv_area");

  // Listed stations within the guard band of what an over or near satellite transmits (Near frequency).
  const st = list(), G = rules.geostationary;
  const bands: { id: string; lo: number; hi: number; w: number; lon: number | null; lat: number | null }[] = [];
  for (const s of st.list) {
    const w = s.bw_mhz ?? 0, fs: number[] = [];
    if (s.rx_mhz != null) fs.push(s.rx_mhz);
    if (s.tx_mhz != null && (s.rx_mhz == null || Math.abs(s.tx_mhz - s.rx_mhz) > rules.same_frequency_mhz)) fs.push(s.tx_mhz);
    for (const f of fs) bands.push({ id: String(s.station), lo: f - w / 2, hi: f + w / 2, w, lon: s.lon ?? null, lat: s.lat ?? null });
  }
  const lon = new Map<number, number>(reach.notices.filter((n: Row) => n.longitude != null).map((n: Row) => [n.ntc_id, n.longitude]));
  const rows = new Map<number, any[][]>();
  for (const r of cmp.rows) (rows.get(r[1]) ?? rows.set(r[1], []).get(r[1])!).push(r);
  function nearFrequency(ntc: number, hit: Set<string>): number {
    const L = lon.get(ntc), near = new Set<string>();
    const sees = (b: (typeof bands)[number]) => L === undefined || b.lon === null || b.lat === null || gsoFrom(b.lon, b.lat, L, G.earth_radius_km, G.geostationary_radius_km).el >= G.horizon_deg;
    for (const r of rows.get(ntc) ?? []) {
      const lo = r[6], hi = r[7];
      for (const b of bands) {
        if (hit.has(b.id) || near.has(b.id)) continue;
        const guard = Math.max(b.w, rules.near_frequency_min_mhz);
        if (b.lo <= hi + guard && b.hi >= lo - guard && sees(b)) near.add(b.id);
      }
    }
    return near.size;
  }

  // Finnish use on what an over or near satellite transmits, from the national frequency table (M4).
  const freqTable = m4Table();

  const by = (o: Row) => new Map<number, Row>(o.notices.map((n: Row) => [n.ntc_id, n]));
  const R = by(reach), Lm = by(lim), D = by(data), C = by(cmp), S = by(sta);
  const order = rules.rungs.map((r: Row) => r.key) as string[];
  const placed: Row[] = [];
  for (const n of down.notices.slice().sort((a: Row, b: Row) => a.ntc_id - b.ntc_id)) {
    const id = n.ntc_id, c = C.get(id), s = S.get(id);
    const excess = c?.excess ?? null, hits = s?.stations?.length ?? 0;
    const o: Row = { ntc_id: id, rung: "clear", by: "downlink", excess, stations: hits, stations_over: s?.over?.length ?? 0, stations_near: s?.near?.length ?? 0,
      near_frequency: 0, itu: [] as string[], worst: null as Row | null, margin: null as Row | null };
    if (!n.kept) { placed.push(o); continue; }
    if (!R.get(id)?.seen) { o.by = "reach"; placed.push(o); continue; }
    o.itu = [...(itu.get(id) ?? [])].sort();
    const outcome = c?.outcome ?? null;
    if (outcome === "over" || outcome === "near") {
      o.near_frequency = st.present && hits === 0 ? nearFrequency(id, new Set(s?.stations ?? [])) : 0;
      // its worst transmission (the first, if two are equal), with the Finnish use (M4) on that band only
      let w: any[] | null = null;
      for (const r of rows.get(id) ?? []) if (!w || r[5] > w[5]) w = r;
      if (w) o.worst = { grp_id: w[0], excess: w[5], lo_mhz: w[6], hi_mhz: w[7], m4: finnishUse(freqTable, [[w[6], w[7]]]) };
    }
    // The station evidence: the strongest transmission over the limit that reaches a listed station, else the strongest
    // near one, with its own margin, band and Finnish use (M4). A station rung rests on exactly this transmission.
    const ev = outcome === "over" && s?.at_over ? s.at_over : s?.at_near ?? null;
    if (ev) o.margin = { ...ev, m4: finnishUse(freqTable, [[ev.lo_mhz, ev.hi_mhz]]) };
    // the first rung that applies, in ladder order
    if (outcome === "over" && s?.at_over) { o.rung = "exceeds_station"; o.by = "stations"; }
    else if (o.itu.length) { o.rung = "itu_names_finland"; o.by = "ladder"; }
    else if (s?.at_near) { o.rung = "near_station"; o.by = "stations"; }
    else if ((outcome === "over" || outcome === "near") && o.near_frequency > 0) { o.rung = "near_frequency"; o.by = "ladder"; }
    else if (outcome === "over") { o.rung = "exceeds_no_station"; o.by = "stations"; }
    else if (!Lm.get(id)?.limited) { o.rung = "no_limit"; o.by = "limit"; }
    else if (!D.get(id)?.complete) { o.rung = "cannot_calculate"; o.by = "data"; }
    else if (!c || outcome === "no_result") { o.rung = "cannot_calculate"; o.by = "compare"; }
    else { o.rung = "clear"; o.by = "compare"; }
    placed.push(o);
  }
  // within a rung: worst excess first (none last), then the lowest ntc_id
  placed.sort((a, b) => order.indexOf(a.rung) - order.indexOf(b.rung) || (b.excess ?? -Infinity) - (a.excess ?? -Infinity) || a.ntc_id - b.ntc_id);
  const rungs: Record<string, number> = Object.fromEntries(order.map((k) => [k, 0]));
  for (const p of placed) rungs[p.rung]++;
  const level = (k: string) => rules.rungs.find((r: Row) => r.key === k).level as string;
  const levels: Record<string, number> = { crit: 0, warn: 0, none: 0 };
  for (const p of placed) levels[level(p.rung)]++;
  const result = { schema: "ladder/1", rulebook: stamp, file: intake.file.sha256, list: { present: st.present, sha256: st.sha256 }, tables: { m4: freqTable.sha256 },
    counts: { notices: placed.length, levels, rungs }, notices: placed };
  emit("done", { notices: placed.length, ...levels });
  return write(folder, "ladder.json", result);
}
