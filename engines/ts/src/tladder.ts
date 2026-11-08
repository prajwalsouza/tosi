// Terrestrial stage 7, ladder. See spec/stages/tladder/README.md.
// Every station in the file goes on exactly one rung: the first that applies, in ladder order. Reads only the earlier
// terrestrial stages' results. Rows are compact (see "fields"), so a file ten times larger stays small.
import { rulebook, emit, readJson, writeResult, needTerrestrial } from "./terra-common.ts";
import { m4Table, finnishUse, type Use } from "./m4.ts";

type Row = Record<string, any>;

export async function tladder(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const { rules, stamp } = rulebook("tladder");
  const mob = readJson(folder, "mobile"), rng = readJson(folder, "range"), tda = readJson(folder, "tdata");
  const thr = readJson(folder, "threshold"), tst = readJson(folder, "tstations");
  emit("tladder", "start");
  const col = (o: Row, name: string) => o.fields.indexOf(name);
  const freqTable = m4Table(), CHECKED = ["over", "over_coordinated", "near"];
  const mk = col(mob, "terrakey"), mf = col(mob, "f_mhz"), mr = col(mob, "reason"), rk = col(rng, "terrakey"), rr = col(rng, "reason");
  const R = new Map<number, any[]>(rng.notices.map((r: any[]) => [r[rk], r]));
  const D = new Map<number, Row>(tda.notices.map((n: Row) => [n.terrakey, n]));
  const T = new Map<number, Row>(thr.notices.map((n: Row) => [n.terrakey, n]));
  const S = new Map<number, Row>(tst.notices.map((n: Row) => [n.terrakey, n]));
  const order = rules.rungs.map((r: Row) => r.key) as string[];
  const placed: { key: number; rung: string; by: string; excess: number | null; stations: number; m4: Use | null }[] = [];
  for (const m of mob.notices.slice().sort((a: any[], b: any[]) => a[mk] - b[mk])) {
    const key = m[mk], t = T.get(key), s = S.get(key), excess = t?.excess ?? null, over = s?.over?.length ?? 0;
    let rung = "clear", by = "threshold";
    if (m[mr] !== null) { rung = "out_of_scope"; by = "mobile"; }
    else if (R.get(key)?.[rr] !== null) { rung = "clear"; by = "range"; }
    else if (!D.get(key)?.kept) { rung = "cannot_calculate"; by = "tdata"; }
    else if (t?.outcome === "over") { rung = "exceeds"; by = "threshold"; }
    else if (s?.outcome === "exposed" && t?.outcome !== "over_coordinated") { rung = "station_exposed"; by = "tstations"; }
    else if (t?.outcome === "near") { rung = "near_threshold"; by = "threshold"; }
    else if (t?.outcome === "over_coordinated") { rung = "exceeds_coordinated"; by = "threshold"; }
    // Finnish use on its frequency, from the national frequency table (M4), for every station over or near the trigger
    const m4 = t && CHECKED.includes(t.outcome) && m[mf] != null ? finnishUse(freqTable, [[m[mf], m[mf]]]) : null;
    placed.push({ key, rung, by, excess, stations: over, m4 });
  }
  // within a rung: worst excess first (none last), then the lowest terrakey
  placed.sort((a, b) => order.indexOf(a.rung) - order.indexOf(b.rung) || (b.excess ?? -Infinity) - (a.excess ?? -Infinity) || a.key - b.key);
  const rungs: Record<string, number> = Object.fromEntries(order.map((k) => [k, 0]));
  const levels: Record<string, number> = { crit: 0, warn: 0, none: 0 };
  const level = new Map<string, string>(rules.rungs.map((r: Row) => [r.key, r.level]));
  for (const p of placed) { rungs[p.rung]++; levels[level.get(p.rung)!]++; }
  const result = { schema: "tladder/1", rulebook: stamp, file: intake.file.sha256, tables: { m4: freqTable.sha256 }, counts: { notices: placed.length, levels, rungs },
    fields: ["terrakey", "rung", "by", "excess", "stations_over", "m4"], notices: placed.map((p) => [p.key, p.rung, p.by, p.excess, p.stations, p.m4]) };
  emit("tladder", "done", { notices: placed.length, ...levels });
  return writeResult(folder, "tladder", result);
}
