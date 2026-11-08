// Stage 4, limit. See spec/stages/limit/README.md.
// Which international power limits apply to each transmitting group of a satellite Finland can see: the ITU's limit
// tables matched on frequency, kind of station, date, orbit and whether the limit protects Finland's area.
import { rulebook, emitter, openDb, groups, orbits, limits, tableOf, readJson, requireSpace, write, num, type Row } from "./space-common.ts";

const emit = emitter("limit");

export async function limit(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Limit");
  const { rules, stamp } = rulebook("limit");
  const reach = readJson(folder, "reach.json"), down = readJson(folder, "downlink.json");
  emit("start");
  const read = await openDb(folder, emit);
  const { groups: gs, seen } = groups(read, reach, down);
  const orb = orbits(read);
  const L = limits();
  const finland = new Set<string>(rules.areas_protecting_finland);
  const named = (a: string) => a.includes(rules.named_countries_marker);

  const rows: (number | string)[][] = [];
  const per = new Map<number, { groups: number; rows: number; named: number; nofreq: number; all: number }>();
  let namedRows = 0;
  for (const g of gs) {
    const p = per.get(g.ntc_id) ?? per.set(g.ntc_id, { groups: 0, rows: 0, named: 0, nofreq: 0, all: 0 }).get(g.ntc_id)!;
    p.all++;
    if (g.lo === null || g.hi === null) { p.nofreq++; continue; }
    const t = tableOf(g.type), o = orb.get(g.ntc_id);
    const cls = new Set(g.classes);
    const mine: (number | string)[][] = [];
    for (const x of L.exam[t]) {
      if (!(x.freq_min < g.hi && x.freq_max > g.lo)) continue;
      if (![...(L.classes.get(x.ix_serv) ?? [])].some((c) => cls.has(c))) continue;
      if (g.date !== null && !(x.date_min <= g.date && g.date <= x.date_max)) continue;
      // A moving satellite's limits depend on its orbit; with no orbit filed, every window is taken to match (worst case).
      if (t === "N" && o?.incl != null && !(x.inclin_fr <= o.incl && o.incl <= x.inclin_to)) continue;
      if (t === "N" && o?.apog != null && !(x.apog_fr <= o.apog && o.apog <= x.apog_to)) continue;
      const area = L.area.get(x.ix_prot_area) ?? "";
      if (!finland.has(area)) { if (named(area)) { p.named++; namedRows++; } continue; }
      const pv = L.provision[t].get(x.ix_provn);
      if (!pv || pv.ang_type === rules.skip_angle_type) continue;
      mine.push([g.grp_id, g.ntc_id, t, x.ix_freq, x.ix_provn]);
    }
    if (mine.length) { p.groups++; p.rows += mine.length; rows.push(...mine); }
  }
  rows.sort((a, b) => (a[0] as number) - (b[0] as number) || String(a[2]).localeCompare(String(b[2])) || (a[3] as number) - (b[3] as number) || (a[4] as number) - (b[4] as number));

  const how: Record<string, number> = Object.fromEntries(Object.keys(rules.outcomes).map((k) => [k, 0]));
  const notices: Row[] = [];
  for (const [ntc, type] of [...seen.entries()].sort((a, b) => a[0] - b[0])) {
    const p = per.get(ntc) ?? { groups: 0, rows: 0, named: 0, nofreq: 0, all: 0 };
    const k = p.rows ? "limited" : p.all === 0 || p.nofreq === p.all ? "no_frequency" : p.named ? "named_countries_only" : "no_limit";
    how[k]++;
    notices.push({ ntc_id: ntc, type, limited: k === "limited", how: k, groups: p.groups, rows: p.rows });
  }
  const limited = notices.filter((n) => n.limited).length;
  const result = { schema: "limit/1", rulebook: stamp, tables: L.source.sha256, file: intake.file.sha256,
    counts: { notices: notices.length, limited, left: notices.length - limited, how, groups: gs.length, groups_limited: notices.reduce((a, n) => a + n.groups, 0), rows: rows.length, named_countries_rows: namedRows },
    notices, rows };
  emit("done", { limited, notices: notices.length, rows: rows.length });
  return write(folder, "limit.json", result);
}
