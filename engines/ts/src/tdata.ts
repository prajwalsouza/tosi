// Terrestrial stage 3, data. See spec/stages/tdata/README.md.
// Whether each station in range files a position, transmit power and an antenna height; gives e.r.p. and effective height.
import { emit, needTerrestrial, num, openDb, readJson, round2, rulebook, stations, writeResult } from "./terra-common.ts";

export async function tdata(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const prev = readJson(folder, "range");
  const { rules, stamp } = rulebook("tdata");
  emit("tdata", "start");
  const read = await openDb(folder);
  const by = new Map(stations(read, "tdata").map((s) => [s.terrakey, s]));
  const ants = new Map<number, Record<string, any>[]>();
  for (const a of read("tdata", "fxm_ant", ["terrakey", "ant_key", "pwr_dbw", "pwr_eiv", "tx_rx", "hgt_agl", "eff_hgtmax"])) (ants.get(a.terrakey) ?? ants.set(a.terrakey, []).get(a.terrakey)!).push(a);
  const hgt = new Map<number, number>();
  for (const h of read("tdata", "fxm_ant_hgt", ["terrakey", "eff_hgt"])) { const v = num(h.eff_hgt); if (v !== null) hgt.set(h.terrakey, Math.max(hgt.get(h.terrakey) ?? -Infinity, v)); }
  const left: Record<string, number> = Object.fromEntries(Object.keys(rules.reasons).map((k) => [k, 0]));
  const notices = prev.notices.filter((n: any[]) => n[3] === null).map((r: any[]) => {
    const n = { terrakey: r[0] as number };
    const s = by.get(n.terrakey)!;
    const tx = (ants.get(n.terrakey) ?? []).filter((a) => a.tx_rx === "TX" || a.tx_rx === null || a.tx_rx === "").sort((a, b) => (a.ant_key ?? 0) - (b.ant_key ?? 0));
    // the highest filed power; on a tie, the lowest antenna key
    let top: Record<string, any> | null = null;
    for (const a of tx) { const p = num(a.pwr_dbw); if (p !== null && (top === null || p > num(top.pwr_dbw)!)) top = a; }
    const maxOf = (k: string) => tx.reduce<number | null>((m, a) => { const v = num(a[k]); return v === null ? m : m === null ? v : Math.max(m, v); }, null);
    const assumptions: string[] = [];
    let heff: number | null = maxOf("eff_hgtmax"), from: string | null = heff !== null ? "eff_hgtmax" : null;
    if (heff === null && hgt.has(n.terrakey)) { heff = hgt.get(n.terrakey)!; from = "fxm_ant_hgt"; }
    if (heff === null) { heff = maxOf("hgt_agl"); if (heff !== null) { from = "hgt_agl"; assumptions.push("height_above_ground"); } }
    if (heff === null && s.cls === "ML") { heff = rules.mobile_default_m; from = "default"; assumptions.push("mobile_default_height"); }
    let erp: number | null = null;
    if (top) {
      erp = num(top.pwr_dbw)!;
      const ref = (top.pwr_eiv ?? "").trim();
      if (ref === "I") { erp -= rules.eirp_to_erp_db; assumptions.push("eirp_to_erp"); }
      else if (ref !== "E") assumptions.push("power_reference_taken_as_erp");
    }
    if (s.radius > 0) assumptions.push("area_station_edge");
    const reason = s.lon === null || s.lat === null ? "no_position" : erp === null ? "no_power" : heff === null ? "no_height" : null;
    if (reason) left[reason]++;
    return { terrakey: n.terrakey, kept: reason === null, reason, erp_dbw: erp === null ? null : round2(erp), heff_m: heff === null ? null : round2(heff), heff_from: from, assumptions };
  });
  const kept = notices.filter((n: any) => n.kept).length;
  const result = { schema: "tdata/1", rulebook: stamp, file: intake.file.sha256, counts: { notices: notices.length, kept, left }, notices };
  emit("tdata", "done", { kept, notices: notices.length, left });
  return writeResult(folder, "tdata", result);
}
