// Stage 6, power. See spec/stages/power/README.md.
// The most power each group could send towards Finland, in each limit's reference bandwidth: its power in that
// bandwidth plus the full gain of its antenna, as if the antenna pointed straight at Finland (worst case).
import { rulebook, emitter, openDb, readJson, requireSpace, write, num, round2, limits, bandwidthHz, powerIn, type Row } from "./space-common.ts";

const emit = emitter("power");

export async function power(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Power");
  const { rules, stamp } = rulebook("power");
  const dat = readJson(folder, "data.json");
  emit("start");
  const read = await openDb(folder, emit);
  const want = new Set<number>(dat.rows.map((r: any[]) => r[0]));
  const ntcs = new Set<number>(dat.rows.map((r: any[]) => r[1]));
  const grp = new Map<number, string | null>();
  for (const r of read("grp", ["grp_id", "beam_name"])) if (want.has(r.grp_id)) grp.set(r.grp_id, typeof r.beam_name === "string" ? r.beam_name : null);
  const gain = new Map<string, number>();
  for (const r of read("s_beam", ["ntc_id", "beam_name", "emi_rcp", "gain"])) {
    if (!ntcs.has(r.ntc_id) || r.emi_rcp !== rules.transmit) continue;
    const g = num(r.gain), k = `${r.ntc_id}|${r.beam_name}`;
    if (g !== null) gain.set(k, Math.max(gain.get(k) ?? -Infinity, g));
  }
  const span = new Map<number, [number, number]>();
  for (const r of read("freq", ["grp_id", "freq_mhz", "freq_min", "freq_max"])) {
    if (!want.has(r.grp_id)) continue;
    const lo = num(r.freq_min) ?? num(r.freq_mhz), hi = num(r.freq_max) ?? num(r.freq_mhz);
    if (lo === null || hi === null) continue;
    const s = span.get(r.grp_id);
    span.set(r.grp_id, s ? [Math.min(s[0], lo), Math.max(s[1], hi)] : [lo, hi]);
  }
  const emis = new Map<number, { pep: number | null; dens: number | null; b: number | null }[]>();
  for (const r of read("emiss", ["grp_id", "design_emi", "pep_max", "pwr_ds_max"])) {
    if (!want.has(r.grp_id)) continue;
    (emis.get(r.grp_id) ?? emis.set(r.grp_id, []).get(r.grp_id)!).push({ pep: num(r.pep_max), dens: num(r.pwr_ds_max), b: bandwidthHz(r.design_emi) });
  }
  const L = limits();

  const rows: any[][] = [];
  const per = new Map<number, { eirp: number; rows: number }>();
  let skipped = 0;
  for (const r of dat.rows) {
    const [g, ntc, t, , provn] = r;
    const pv = L.provision[t].get(provn)!;
    const s = span.get(g)!, f = (s[0] + s[1]) / 2, bref = pv.bw * rules.mhz_to_hz;
    let best: number | null = null;
    for (const e of emis.get(g) ?? []) {
      const p = powerIn(e.pep, e.dens, e.b, f, bref, rules);
      if (p !== null && (best === null || p > best)) best = p;
    }
    if (best === null) { skipped++; continue; }
    const eirp = best + gain.get(`${ntc}|${grp.get(g)}`)!;
    rows.push([...r, round2(eirp)]);
    const n = per.get(ntc) ?? per.set(ntc, { eirp: -Infinity, rows: 0 }).get(ntc)!;
    n.rows++; n.eirp = Math.max(n.eirp, eirp);
  }
  const notices: Row[] = [];
  for (const n of dat.notices.filter((x: Row) => x.complete)) {
    const p = per.get(n.ntc_id);
    notices.push({ ntc_id: n.ntc_id, type: n.type, rows: p?.rows ?? 0, eirp: p ? round2(p.eirp) : null });
  }
  const result = { schema: "power/1", rulebook: stamp, file: intake.file.sha256,
    counts: { notices: notices.length, rows: rows.length, rows_without_power: skipped }, notices, rows };
  emit("done", { notices: notices.length, rows: rows.length });
  return write(folder, "power.json", result);
}
