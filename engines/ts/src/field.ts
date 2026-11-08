// Terrestrial stage 4, field strength. See spec/stages/field/README.md.
// The signal of each station at Finland's outer limit by Recommendation ITU-R P.1546-6 without terrain, at several border
// points (the 5 nearest, every third within 100 km of the nearest, the nearest land and sea points), keeping the strongest.
import { fieldStrength, P1546_SHA } from "./p1546.ts";
import { BORDER, candidates, distanceKm, emit, insideFinland, landSea, needTerrestrial, openDb, readJson, round2, rulebook, stations, tableSha, writeResult } from "./terra-common.ts";

export async function field(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const prev = readJson(folder, "tdata");
  const { rules, stamp } = rulebook("field");
  emit("field", "start");
  const read = await openDb(folder);
  const by = new Map(stations(read, "field").map((s) => [s.terrakey, s]));
  const R = rules.earth_radius_km;
  const notices = prev.notices.filter((n: any) => n.kept).map((n: any) => {
    const s = by.get(n.terrakey)!;
    const inside = insideFinland(s.lon!, s.lat!);
    let best: { e: number; border: number; km: number; land: number } | null = null;
    for (const c of candidates(s.lon!, s.lat!, rules.nearest_points, rules.spread_km, rules.stride, R)) {
      const p = BORDER[c.i];
      const km = Math.max(rules.min_km, inside ? 0 : Math.max(0, distanceKm(s.lat!, s.lon!, p[1], p[0], R) - (s.radius > 0 ? s.radius : 0)));
      const path = landSea(s.lon!, s.lat!, p[0], p[1], km, rules.samples);
      const { e } = fieldStrength({ f: s.f!, t: rules.time_percent, h1: n.heff_m, h2: rules.receiver_height_m, dland: path.dland, dsea: path.dsea, erp_dbw: n.erp_dbw });
      if (best === null || e > best.e) best = { e, border: c.i, km, land: path.landShare };
    }
    return { terrakey: n.terrakey, e: round2(best!.e), border: best!.border, km: round2(best!.km), land: round2(best!.land) };
  });
  const result = { schema: "field/1", rulebook: stamp, tables: { p1546: P1546_SHA, finland: tableSha("finland") }, file: intake.file.sha256,
    counts: { notices: notices.length }, notices };
  emit("field", "done", { notices: notices.length });
  return writeResult(folder, "field", result);
}
