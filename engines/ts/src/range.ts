// Terrestrial stage 2, range. See spec/stages/range/README.md.
// Which land mobile stations are within 1,000 km of Finland's outer limit and between 30 and 4,000 MHz. Withdrawals leave first.
import { emit, needTerrestrial, nearestBorder, openDb, readJson, round2, rulebook, stations, writeResult } from "./terra-common.ts";

export async function range(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const prev = readJson(folder, "mobile");
  const { rules, stamp } = rulebook("range");
  emit("range", "start");
  const read = await openDb(folder);
  const by = new Map(stations(read, "range").map((s) => [s.terrakey, s]));
  const left: Record<string, number> = Object.fromEntries(Object.keys(rules.reasons).map((k) => [k, 0]));
  const notices = prev.notices.filter((n: any[]) => n[6] === null).map((n: any[]) => {
    const s = by.get(n[0])!;
    let km: number | null = null, border: number | null = null;
    if (s.lon !== null && s.lat !== null) {
      const b = nearestBorder(s.lon, s.lat, rules.earth_radius_km);
      km = Math.max(0, b.km - (s.radius > 0 ? s.radius : 0)); border = b.index;
    }
    const reason = s.intent === rules.withdrawn_intent ? "withdrawn" : km !== null && km > rules.max_km ? "too_far"
      : s.f === null || s.f < rules.f_min_mhz || s.f > rules.f_max_mhz ? "out_of_band" : null;
    if (reason) left[reason]++;
    return [s.terrakey, km === null ? null : round2(km), border, reason];
  });
  const kept = notices.filter((n: any[]) => n[3] === null).length;
  const result = { schema: "range/1", rulebook: stamp, file: intake.file.sha256, counts: { notices: notices.length, kept, left }, fields: ["terrakey", "km", "border", "reason"], notices };
  emit("range", "done", { kept, notices: notices.length, left });
  return writeResult(folder, "range", result);
}
