// Terrestrial stage 5, threshold. See spec/stages/threshold/README.md.
// The field strength at Finland's outer limit against the ECC T/R 25-08 trigger level for the band, corrected for channel
// width. Coordination completed with Finland is marked as a case to verify, never cleared.
import { emit, needTerrestrial, openDb, readJson, round2, rulebook, stations, writeResult } from "./terra-common.ts";

export function triggerLevel(rules: any, f: number, bwKhz: number | null) {
  const band = rules.bands.find((b: any) => f >= b.from_mhz && (f < b.to_mhz || (b.to_mhz === rules.bands[rules.bands.length - 1].to_mhz && f <= b.to_mhz)));
  if (!band) return null;
  const bc = bwKhz !== null && bwKhz > rules.reference_khz ? 10 * Math.log10(bwKhz / rules.reference_khz) : 0;
  return { limit: band.dbuvm + bc, bc };
}

export async function threshold(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const prev = readJson(folder, "field");
  const { rules, stamp } = rulebook("threshold");
  emit("threshold", "start");
  const read = await openDb(folder);
  const by = new Map(stations(read, "threshold").map((s) => [s.terrakey, s]));
  const coord = new Map<number, string[]>();
  for (const c of read("threshold", "fxm_coord", ["terrakey", "adm", "coord_st"])) if ((c.adm ?? "").trim() === "FIN") (coord.get(c.terrakey) ?? coord.set(c.terrakey, []).get(c.terrakey)!).push(String(c.coord_st ?? ""));
  const how: Record<string, number> = Object.fromEntries(Object.keys(rules.outcomes).map((k) => [k, 0]));
  const notices = prev.notices.map((n: any) => {
    const s = by.get(n.terrakey)!;
    const t = triggerLevel(rules, s.f!, s.bwKhz)!;
    const limit = round2(t.limit), excess = round2(n.e - limit);
    const st = coord.get(n.terrakey) ?? [];
    const coordinated = st.some((x) => x.includes("COMPLETED")) && !st.some((x) => x.includes("REQUIRED"));
    const outcome = excess > 0 ? (coordinated ? "over_coordinated" : "over") : excess > -rules.near_db ? "near" : "under";
    how[outcome]++;
    return { terrakey: n.terrakey, limit, bc: round2(t.bc), excess, outcome, coordinated };
  });
  const result = { schema: "threshold/1", rulebook: stamp, file: intake.file.sha256, counts: { notices: notices.length, how }, notices };
  emit("threshold", "done", { notices: notices.length, how });
  return writeResult(folder, "threshold", result);
}
