// Stage 7, compare. See spec/stages/compare/README.md.
// Whether the worst-case power arriving in Finland goes over the limit. The power spreads over the distance (it falls
// with the square of the distance); the limit depends on the angle the signal arrives from. Every angle at which the
// satellite can appear from Finland is tried, and the one closest to breaking the limit is kept.
import { rulebook, emitter, openDb, orbits, readJson, requireSpace, write, num, round2, limits, maskAt, gsoFrom, table, RAD, log10, type Row } from "./space-common.ts";

const emit = emitter("compare");

export async function compare(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Compare");
  const { rules, stamp } = rulebook("compare");
  const reach = readJson(folder, "reach.json"), pow = readJson(folder, "power.json");
  emit("start");
  const read = await openDb(folder, emit);
  const want = new Set<number>(pow.rows.map((r: any[]) => r[0]));
  const span = new Map<number, [number, number]>();
  for (const r of read("freq", ["grp_id", "freq_mhz", "freq_min", "freq_max"])) {
    if (!want.has(r.grp_id)) continue;
    const lo = num(r.freq_min) ?? num(r.freq_mhz), hi = num(r.freq_max) ?? num(r.freq_mhz);
    if (lo === null || hi === null) continue;
    const s = span.get(r.grp_id);
    span.set(r.grp_id, s ? [Math.min(s[0], lo), Math.max(s[1], hi)] : [lo, hi]);
  }
  const orb = orbits(read);
  const lon = new Map<number, number>(reach.notices.filter((n: Row) => n.longitude != null).map((n: Row) => [n.ntc_id, n.longitude]));
  const L = limits();
  const RE = rules.earth_radius_km, RG = rules.geostationary_radius_km;
  // Every test point, and every point on Finland's outer limit, so the lowest arrival angle at its edge is never missed.
  const fin = table("finland");
  const points: number[][] = [...fin.test_points.map((p: number[]) => [p[0], p[1]]), ...fin.border.map((p: any[]) => [p[0], p[1]])];
  const spread = (dKm: number) => 10 * log10(4 * Math.PI * (dKm * 1000) ** 2);

  // The geometry: pairs of arrival angle (degrees) and distance (km).
  const geo = new Map<string, { a: number; d: number }[]>();
  function geometry(t: string, ntc: number) {
    const key = t === "G" ? `G${lon.get(ntc)}` : `N${orb.get(ntc)!.perig}`;
    if (geo.has(key)) return { key, g: geo.get(key)! };
    let g: { a: number; d: number }[] = [];
    if (t === "G") {
      const all = points.map(([x, y]) => { const q = gsoFrom(x, y, lon.get(ntc)!, RE, RG); return { a: q.el, d: q.d }; });
      g = all.filter((q) => q.a >= 0);
      // Reach can see a satellite at the edge of its box that no test point sees: take the highest point, at the horizon.
      if (!g.length) { const top = all.reduce((b, q) => q.a > b.a ? q : b); g = [{ a: 0, d: top.d }]; }
    } else {
      const h = orb.get(ntc)!.perig!;
      for (let i = 0; i * rules.ngso_angle_step_deg <= 90 + 1e-9; i++) {
        const a = i * rules.ngso_angle_step_deg, s = Math.sin(a * RAD);
        g.push({ a, d: -RE * s + Math.sqrt((RE * s) ** 2 + 2 * RE * h + h * h) });
      }
    }
    geo.set(key, g);
    return { key, g };
  }
  // The smallest margin (limit plus spreading) over the geometry, for one mask. Cached per mask and geometry.
  const worst = new Map<string, { m: number; lim: number; a: number; d: number } | null>();
  function margin(t: string, mask: number, gk: string, g: { a: number; d: number }[]) {
    const k = `${t}|${mask}|${gk}`;
    if (worst.has(k)) return worst.get(k)!;
    const segs = L.mask[t].get(mask) ?? [];
    let best: { m: number; lim: number; a: number; d: number } | null = null;
    for (const q of g) {
      const lim = maskAt(segs, q.a);
      if (lim === null) continue;
      const m = lim + spread(q.d);
      if (best === null || m < best.m) best = { m, lim, a: q.a, d: q.d };
    }
    worst.set(k, best);
    return best;
  }

  const near = -rules.near_db;
  const keep: any[][] = [];
  const per = new Map<number, Row>();
  let nogeo = 0;
  for (const r of pow.rows) {
    const [grp, ntc, t, ixf, provn, eirp] = r;
    const pv = L.provision[t].get(provn)!;
    const { key, g } = geometry(t, ntc);
    const w = margin(t, pv.mask_code, key, g);
    if (!w) { nogeo++; continue; }
    const excess = eirp - w.m;
    const cur = per.get(ntc);
    if (!cur || excess > cur.x) per.set(ntc, { x: excess, grp, t, ixf, provn, pfd: eirp - spread(w.d), lim: w.lim, a: w.a, d: w.d });
    if (excess > near) {
      const x = L.exam[t].find((e) => e.ix_freq === ixf)!, s = span.get(grp)!;
      keep.push([grp, ntc, t, ixf, provn, round2(excess), Math.max(s[0], x.freq_min), Math.min(s[1], x.freq_max)]);
    }
  }
  const outcome = (x: number) => x > 0 ? "over" : x > near ? "near" : "under";
  const how: Record<string, number> = Object.fromEntries(Object.keys(rules.outcomes).map((k) => [k, 0]));
  const notices: Row[] = [];
  for (const n of pow.notices) {
    const w = per.get(n.ntc_id);
    if (!w) { how.no_result++; notices.push({ ntc_id: n.ntc_id, type: n.type, outcome: "no_result", excess: null, pfd: null, limit: null, angle: null, distance_km: null, grp_id: null, table: null, provision: null, provn: null, finding: null }); continue; }
    const o = outcome(w.x), pv = L.provision[w.t].get(w.provn)!;
    how[o]++;
    notices.push({ ntc_id: n.ntc_id, type: n.type, outcome: o, excess: round2(w.x), pfd: round2(w.pfd), limit: round2(w.lim), angle: round2(w.a), distance_km: round2(w.d),
      grp_id: w.grp, table: w.t, provision: w.provn, provn: String(pv.provn ?? "").trim(), finding: String(pv.fndg ?? "").trim() });
  }
  const result = { schema: "compare/1", rulebook: stamp, file: intake.file.sha256,
    counts: { notices: notices.length, how, rows: pow.rows.length, rows_kept: keep.length, rows_without_angle: nogeo }, notices, rows: keep };
  emit("done", { notices: notices.length, ...how });
  return write(folder, "compare.json", result);
}
