// Stage 3, reach. See spec/stages/reach/README.md.
// Which transmitting satellites can ever be seen from Finland: a fixed satellite must rise above the horizon somewhere
// in the box around Finland; a moving one must pass far enough north. Every choice leans to "seen".
// Progress goes to stderr as JSON lines; the result to stdout and reach.json.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them.
const citesOf = (rules: Record<string, unknown>) => Object.fromEntries(Object.entries(rules).filter(([k]) => k === "method" || k === "basis" || k.endsWith("_basis")));

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES_BYTES = readFileSync(join(root, "spec", "rulebook", "reach.json"));
const RULES = JSON.parse(RULES_BYTES.toString("utf8"));
const RULEBOOK = { version: RULES.version, sha256: createHash("sha256").update(RULES_BYTES).digest("hex"), cites: citesOf(RULES) };
const emit = (step: string, state: string, fields: Record<string, unknown> = {}) => process.stderr.write(JSON.stringify({ event: "step", step, state, ...fields }) + "\n");

// Shared with the other engines, exactly: degrees to radians and back, wrapping, rounding to two decimals.
const RAD = Math.PI / 180, DEG = 180 / Math.PI;
const wrap = (x: number) => ((x % 360) + 360) % 360;
const round2 = (x: number) => { const v = Math.floor(x * 100 + 0.5) / 100; return v === 0 ? 0 : v; };
const num = (v: unknown): number | null => typeof v === "number" && Number.isFinite(v) ? v : null;

type Out = { ntc_id: number; type: string; seen: boolean; how: string; longitude: number | null; elevation: number | null; north: number | null; orbit: number | null; body: string | null };

export async function reach(folder: string): Promise<string> {
  const intake = JSON.parse(readFileSync(join(folder, "intake.json"), "utf8"));
  if (intake.kind !== "space" || intake.check.status !== "accepted") throw new Error("Reach needs an accepted space filing");
  const down = JSON.parse(readFileSync(join(folder, "downlink.json"), "utf8"));
  const { default: MDBReader } = await import("mdb-reader");
  emit("reach", "start");
  const db = new MDBReader(readFileSync(join(folder, "database.mdb")));
  const names = new Set(db.getTableNames());
  // A table that is missing counts as filing nothing.
  const read = (t: string, columns: string[]): Record<string, any>[] => {
    if (!names.has(t)) return [];
    const rows = db.getTable(t).getData({ columns }) as Record<string, any>[];
    emit("reach", "progress", { table: t, rows: rows.length });
    return rows;
  };
  const geo = new Map(read("geo", ["ntc_id", "long_nom", "tol_east", "tol_west"]).map((r) => [r.ntc_id, r]));
  const ngeo = new Map(read("non_geo", ["ntc_id", "ref_body"]).map((r) => [r.ntc_id, r]));
  const orbits = new Map<number, Record<string, any>[]>();
  for (const r of read("orbit", ["ntc_id", "orb_id", "inclin_ang", "apog_km"])) (orbits.get(r.ntc_id) ?? orbits.set(r.ntc_id, []).get(r.ntc_id)!).push(r);
  const owner = new Map(read("grp", ["grp_id", "ntc_id"]).map((r) => [r.grp_id, r.ntc_id]));

  const R = RULES.earth.radius_km, RG = RULES.geostationary_radius_km, F = RULES.finland, H = RULES.horizon_deg;
  const how: Record<string, number> = Object.fromEntries([...Object.keys(RULES.outcomes.seen), ...Object.keys(RULES.outcomes.clear)].map((k) => [k, 0]));
  const notices: Out[] = [];
  for (const n of down.notices.filter((x: any) => x.kept).sort((a: any, b: any) => a.ntc_id - b.ntc_id)) {
    const o: Out = { ntc_id: n.ntc_id, type: n.type, seen: true, how: "assumed", longitude: null, elevation: null, north: null, orbit: null, body: null };
    if (RULES.satellite_types[n.type] === "geostationary") {
      const g = geo.get(n.ntc_id), L = num(g?.long_nom);
      if (L !== null) {
        const te = num(g!.tol_east) ?? 0, tw = num(g!.tol_west) ?? 0;
        const inBox = wrap(L - F.west) <= F.east - F.west;
        const gap = inBox ? 0 : Math.min(180, Math.max(0, Math.min(wrap(F.west - L) - te, wrap(L - F.east) - tw)));
        const c = Math.cos(F.south * RAD) * Math.cos(gap * RAD);
        const el = Math.atan2(c - R / RG, Math.sqrt(1 - c * c)) * DEG;
        o.seen = el >= H; o.how = o.seen ? "above_horizon" : "below_horizon"; o.longitude = round2(L); o.elevation = round2(el);
      }
    } else {
      const body = ngeo.get(n.ntc_id)?.ref_body ?? null;
      if (body !== null && body !== RULES.earth_body) { o.how = "beyond_earth"; o.body = body; }
      else {
        let best: number | null = null, at: number | null = null;
        for (const r of (orbits.get(n.ntc_id) ?? []).slice().sort((a, b) => a.orb_id - b.orb_id)) {
          const i = num(r.inclin_ang), a = num(r.apog_km);
          if (i === null || a === null || a < 0) continue;
          const north = Math.min(i, 180 - i) + Math.acos(R / (R + a)) * DEG;
          if (best === null || north > best) { best = north; at = r.orb_id; }
        }
        if (best !== null) { o.seen = best >= F.south; o.how = o.seen ? "reaches_north" : "too_far_south"; o.north = round2(best); o.orbit = at; }
      }
    }
    how[o.how]++;
    notices.push(o);
  }
  const seenIds = new Set(notices.filter((x) => x.seen).map((x) => x.ntc_id));
  const groups = (down.groups as number[]).filter((g) => seenIds.has(owner.get(g))).sort((a, b) => a - b);
  const seen = seenIds.size;
  const result = { schema: "reach/1", rulebook: RULEBOOK, file: intake.file.sha256,
    counts: { notices: notices.length, seen, clear: notices.length - seen, how, groups: down.groups.length, groups_kept: groups.length }, notices, groups };
  emit("reach", "done", { seen, clear: notices.length - seen, notices: notices.length });
  const text = JSON.stringify(result);
  writeFileSync(join(folder, "reach.json"), text + "\n");
  return text;
}
