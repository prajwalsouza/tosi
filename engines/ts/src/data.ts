// Stage 5, data. See spec/stages/data/README.md.
// Whether everything needed to work out the power is filed, for each pair of a group and its limit: the antenna's
// gain, a power, where the satellite is, and a limit the filing's numbers can be put into.
import { rulebook, emitter, openDb, orbits, limits, readJson, requireSpace, write, num, usable, type Row } from "./space-common.ts";

const emit = emitter("data");

export async function data(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Data");
  const { rules, stamp } = rulebook("data");
  const reach = readJson(folder, "reach.json"), lim = readJson(folder, "limit.json");
  emit("start");
  const read = await openDb(folder, emit);
  const want = new Set<number>(lim.rows.map((r: any[]) => r[0]));
  const ntcs = new Set<number>(lim.rows.map((r: any[]) => r[1]));
  const beam = new Map<number, string | null>();
  for (const r of read("grp", ["grp_id", "beam_name"])) if (want.has(r.grp_id)) beam.set(r.grp_id, typeof r.beam_name === "string" ? r.beam_name : null);
  // The antenna gain of each transmitting beam: the highest filed for it.
  const gain = new Map<string, number>();
  for (const r of read("s_beam", ["ntc_id", "beam_name", "emi_rcp", "gain"])) {
    if (!ntcs.has(r.ntc_id) || r.emi_rcp !== rules.transmit) continue;
    const g = num(r.gain), k = `${r.ntc_id}|${r.beam_name}`;
    if (g !== null) gain.set(k, Math.max(gain.get(k) ?? -Infinity, g));
  }
  // Whether a group files a peak power and a power density at all.
  const pw = new Map<number, { pep: boolean; dens: boolean }>();
  for (const r of read("emiss", ["grp_id", "pep_max", "pwr_ds_max"])) {
    if (!want.has(r.grp_id)) continue;
    const p = pw.get(r.grp_id) ?? pw.set(r.grp_id, { pep: false, dens: false }).get(r.grp_id)!;
    if (num(r.pep_max) !== null) p.pep = true;
    if (num(r.pwr_ds_max) !== null) p.dens = true;
  }
  const orb = orbits(read);
  const lon = new Map<number, number | null>(reach.notices.map((n: Row) => [n.ntc_id, n.longitude]));
  const L = limits();

  const order: string[] = rules.reasons_order;
  const ok: any[][] = [];
  const per = new Map<number, { ok: number; rows: number; reasons: Set<string> }>();
  const byReason: Record<string, number> = Object.fromEntries(order.map((k) => [k, 0]));
  for (const r of lim.rows) {
    const [grp, ntc, t, , provn] = r;
    const p = per.get(ntc) ?? per.set(ntc, { ok: 0, rows: 0, reasons: new Set() }).get(ntc)!;
    p.rows++;
    const pv = L.provision[t].get(provn)!;
    const segs = L.mask[t].get(pv.mask_code) ?? [];
    const e = pw.get(grp);
    const where = t === "G" ? lon.get(ntc) != null : (orb.get(ntc)?.perig ?? null) !== null && orb.get(ntc)!.perig! >= 0;
    const fails: Record<string, boolean> = {
      no_orbit: !where,
      no_gain: !gain.has(`${ntc}|${beam.get(grp)}`),
      // Total-power limits (no reference bandwidth) need the peak power; the others can use either.
      no_power: !e || (pv.bw > 0 ? !(e.pep || e.dens) : !e.pep),
      needs_xy: !segs.some(usable),
    };
    const why = order.find((k) => fails[k]);
    if (why) { byReason[why]++; p.reasons.add(why); }
    else { p.ok++; ok.push(r); }
  }

  const how: Record<string, number> = Object.fromEntries(["complete", ...order].map((k) => [k, 0]));
  const notices: Row[] = [];
  for (const n of lim.notices.filter((x: Row) => x.limited)) {
    const p = per.get(n.ntc_id)!;
    const k = p.ok ? "complete" : order.find((x) => p.reasons.has(x))!;
    how[k]++;
    notices.push({ ntc_id: n.ntc_id, type: n.type, complete: k === "complete", how: k, rows: p.rows, rows_ok: p.ok });
  }
  const complete = how.complete;
  const result = { schema: "data/1", rulebook: stamp, file: intake.file.sha256,
    counts: { notices: notices.length, complete, left: notices.length - complete, how, rows: lim.rows.length, rows_ok: ok.length, rows_missing: byReason },
    notices, rows: ok };
  emit("done", { complete, notices: notices.length, rows: ok.length });
  return write(folder, "data.json", result);
}
