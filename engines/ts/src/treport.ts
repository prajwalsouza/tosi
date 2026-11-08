// Terrestrial stage 8, report. See spec/stages/treport/README.md.
// The notification for a terrestrial file: the stations on crit and warn rungs, each with who filed it, where, its
// frequency, its distance to Finland, its field strength against the trigger level, its coordination with Finland and the
// listed Finnish stations it exposes. Also report.csv (every station) and report.md (the short notification).
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rulebook, emit, readJson, writeResult, needTerrestrial, openDb, root, BORDER } from "./terra-common.ts";

type Row = Record<string, any>;
const n2s = (v: number | null | undefined) => v === null || v === undefined ? "" : String(v);
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "number" ? n2s(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const yesNo = (b: boolean | null | undefined) => b === null || b === undefined ? "" : b ? "yes" : "no";

// Finnish use in a sentence: the first few uses the frequency table (M4) lists, then the licence-exempt ones.
const useText = (u: { uses: string[]; exempt: string[] } | null | undefined, n: number) => {
  if (!u) return "";
  if (!u.uses.length) return " Finland's frequency table (M4) lists no use on these frequencies.";
  const few = (l: string[]) => l.slice(0, n).join(", ") + (l.length > n ? ", …" : "");
  return ` Finland's frequency table (M4) lists ${few(u.uses)}${u.exempt.length ? `; licence-exempt: ${few(u.exempt)}` : ""}.`;
};
const useCells = (u: { uses: string[]; exempt: string[] } | null | undefined) => u ? [u.uses.join("; "), u.exempt.join("; ")] : [null, null];

export async function treport(folder: string): Promise<string> {
  const intake = needTerrestrial(folder);
  const { rules, stamp } = rulebook("treport");
  const ladBytes = readFileSync(join(root, "spec", "rulebook", "tladder.json"));
  const lad = JSON.parse(ladBytes.toString("utf8"));
  const adm = JSON.parse(readFileSync(join(root, "spec", "reference", "administrations.json"), "utf8"));
  const mob = readJson(folder, "mobile"), rng = readJson(folder, "range"), tda = readJson(folder, "tdata"), fld = readJson(folder, "field");
  const thr = readJson(folder, "threshold"), tst = readJson(folder, "tstations"), lad2 = readJson(folder, "tladder");
  emit("treport", "start");
  const read = await openDb(folder);
  const geo = new Map<number, Row>(read("treport", "fxm_geo", ["geo_key", "site_name", "ctry"]).map((g) => [g.geo_key, g]));
  const site = new Map<number, Row>();
  for (const r of read("treport", "fxm_terra", ["terrakey", "geo_key"])) { const g = geo.get(r.geo_key); if (g) site.set(r.terrakey, g); }
  const coord = new Map<number, Set<string>>();
  for (const c of read("treport", "fxm_coord", ["terrakey", "adm", "coord_prov", "coord_st"])) {
    if ((c.adm ?? "").trim() !== rules.administration) continue;
    (coord.get(c.terrakey) ?? coord.set(c.terrakey, new Set()).get(c.terrakey)!).add(`${String(c.coord_prov ?? "").trim()}:${String(c.coord_st ?? "").trim()}`);
  }

  const rows = (o: Row) => { const f = o.fields as string[]; return new Map<number, Row>(o.notices.map((r: any[]) => [r[f.indexOf("terrakey")], Object.fromEntries(f.map((k, i) => [k, r[i]]))])); };
  const byKey = (o: Row) => new Map<number, Row>(o.notices.map((n: Row) => [n.terrakey, n]));
  const M = rows(mob), R = rows(rng), D = byKey(tda), F = byKey(fld), T = byKey(thr), S = byKey(tst), L = rows(lad2);
  const rung = new Map<string, Row>(lad.rungs.map((r: Row) => [r.key, r]));
  const describe = (key: number) => {
    const m = M.get(key)!, g = site.get(key), a = (m.adm ?? "").trim();
    return { administration: a, country: adm.administrations[a] ?? a, site: g?.site_name ? String(g.site_name).trim() : null, site_country: g?.ctry ? String(g.ctry).trim() : null,
      class: m.cls, f_mhz: m.f_mhz, lon: m.lon, lat: m.lat };
  };

  // The reported stations, in ladder order.
  const items: Row[] = [];
  for (const p of L.values()) {
    const rg = rung.get(p.rung);
    if (!rules.levels_reported.includes(rg.level)) continue;
    const key = p.terrakey, d = describe(key), r = R.get(key), f = F.get(key), t = T.get(key), s = S.get(key), dt = D.get(key);
    const b = f ? BORDER[f.border] : null;
    items.push({
      terrakey: key, ...d, distance_km: r?.km ?? null,
      field: f ? { e: f.e, limit: t?.limit ?? null, excess: t?.excess ?? null, bandwidth_correction: t?.bc ?? null, at: b ? { lon: b[0], lat: b[1], kind: b[2] } : null, km: f.km, land: f.land } : null,
      power: dt ? { erp_dbw: dt.erp_dbw, heff_m: dt.heff_m, heff_from: dt.heff_from, assumptions: dt.assumptions } : null,
      coordination: { completed: !!t?.coordinated, records: [...(coord.get(key) ?? [])].sort() },
      stations: { over: s?.over?.length ?? 0, first: (s?.over ?? []).slice(0, rules.stations_listed), worst: s?.worst ?? null },
      finnish_use: p.m4 ?? null,
      why: { rung: p.rung, level: rg.level, wording: rg.rung, means: rg.means, cites: rg.cites },
      next: rules.next[p.rung] ?? null,
    });
  }

  // Every station as one row of the processed file, in ascending terrakey order.
  const head = ["Station (terrakey)", "Administration", "Country", "Site", "Class", "Frequency (MHz)", "Longitude", "Latitude", "In scope",
    "Distance to Finland (km)", "e.r.p. (dBW)", "Effective height (m)", "Field strength at the border (dBuV/m)", "Trigger level (dBuV/m)",
    "Over the trigger by (dB)", "Coordinated with Finland", "Listed stations over the trigger", "Finnish use (M4)", "Licence-exempt use (M4)", "Concern", "Level", "Decided by"];
  const lines = [head.map(csvCell).join(",")];
  for (const key of [...M.keys()].sort((a, b) => a - b)) {
    const d = describe(key), m = M.get(key)!, r = R.get(key), dt = D.get(key), f = F.get(key), t = T.get(key), s = S.get(key), p = L.get(key)!;
    const rg = rung.get(p.rung);
    lines.push([key, d.administration, d.country, d.site, d.class, d.f_mhz, d.lon, d.lat, m.reason === null ? "yes" : `no: ${m.reason}`,
      r?.km ?? null, dt?.erp_dbw ?? null, dt?.heff_m ?? null, f?.e ?? null, t?.limit ?? null, t?.excess ?? null, t ? yesNo(t.coordinated) : "",
      s ? (s.over?.length ?? 0) : null, ...useCells(p.m4), rg.rung, rg.level, p.by].map(csvCell).join(","));
  }
  const csv = lines.join("\n") + "\n";

  const crit = items.filter((x) => x.why.level === "crit"), warn = items.filter((x) => x.why.level === "warn");
  const md: string[] = [`# Terrestrial notification: ${intake.file.name}`, "",
    `${lad2.counts.notices} stations screened. ${crit.length} need attention, ${warn.length} are worth a look.`, "",
    "| Concern | Level | Stations |", "|---|---|---|",
    ...lad.rungs.map((r: Row) => `| ${r.rung} | ${r.level} | ${lad2.counts.rungs[r.key] ?? 0} |`), ""];
  const line = (x: Row, i: number) => [
    `${i + 1}. **${x.site ?? `Station ${x.terrakey}`}** (${x.terrakey}), ${x.country}, class ${x.class}, ${n2s(x.f_mhz)} MHz, ${n2s(x.distance_km)} km from Finland.`,
    `   ${x.why.wording}: ${x.field ? `${n2s(x.field.e)} dB(µV/m) at the ${x.field.at?.kind === "sea" ? "territorial-sea limit" : "border"} against a trigger of ${n2s(x.field.limit)}, ${x.field.excess > 0 ? `${n2s(x.field.excess)} dB over` : `${n2s(Math.abs(x.field.excess))} dB under`}` : "no field strength"}${x.stations.over ? `; over the trigger at ${x.stations.over} listed station${x.stations.over === 1 ? "" : "s"} (${x.stations.first.join(", ")})` : ""}${x.coordination.completed ? "; coordination with Finland completed" : ""}.${useText(x.finnish_use, rules.uses_listed)}`,
    `   Next: ${x.next}`];
  if (crit.length) md.push("## Needs attention", "", ...crit.flatMap(line), "");
  if (warn.length) md.push("## Worth a look", "", ...warn.flatMap(line), "");
  const text = md.join("\n");

  writeFileSync(join(folder, "report.csv"), csv);
  writeFileSync(join(folder, "report.md"), text);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const result = { schema: "treport/1", rulebook: stamp, uses: { tladder: sha(ladBytes.toString("utf8")) }, file: intake.file.sha256, name: intake.file.name,
    counts: { notices: lad2.counts.notices, items: items.length, crit: crit.length, warn: warn.length, rungs: lad2.counts.rungs },
    files: { csv: { name: "report.csv", rows: lines.length - 1, sha256: sha(csv) }, md: { name: "report.md", sha256: sha(text) } }, items };
  emit("treport", "done", { items: items.length, crit: crit.length, warn: warn.length });
  return writeResult(folder, "treport", result);
}
