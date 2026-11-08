// Terrestrial stage 1, mobile. See spec/stages/mobile/README.md.
// Which filings are new foreign land mobile stations (base FB or mobile ML). Every station is listed, with its position,
// administration and frequency, so the map can show the whole file.
import { emit, needTerrestrial, openDb, rulebook, round3, stations, writeResult } from "./terra-common.ts";

const FIELDS = ["terrakey", "adm", "cls", "f_mhz", "lon", "lat", "reason"];

export async function mobile(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const { rules, stamp } = rulebook("mobile");
  emit("mobile", "start");
  const read = await openDb(folder);
  const all = stations(read, "mobile");
  const left: Record<string, number> = Object.fromEntries(Object.keys(rules.reasons).map((k) => [k, 0]));
  const notices = all.map((s) => {
    const reason = s.stage !== rules.notice_stage ? "recorded" : s.adm === rules.own_administration ? "finnish" : !(s.cls in rules.classes) ? "not_land_mobile" : null;
    if (reason) left[reason]++;
    // compact rows, in the order of FIELDS: a file can hold tens of thousands of stations
    return [s.terrakey, s.adm, s.cls, s.f, s.lon === null ? null : round3(s.lon), s.lat === null ? null : round3(s.lat), reason];
  });
  const kept = notices.filter((n) => n[6] === null).length;
  const result = { schema: "mobile/1", rulebook: stamp, file: intake.file.sha256, counts: { notices: notices.length, kept, left }, fields: FIELDS, notices };
  emit("mobile", "done", { kept, notices: notices.length, left });
  return writeResult(folder, "mobile", result);
}
