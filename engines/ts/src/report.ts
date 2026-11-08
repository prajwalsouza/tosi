// Stage 10, report. See spec/stages/report/README.md.
// The notification for a space file: the filings on crit and warn rungs, each with what it is, whether Finland can see
// it, which listed stations it touches, why and by how much, and what to do next. Also report.csv (every filing) and
// report.md (the short notification). Everything here comes from earlier stage results and the filing's own records.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rulebook, emitter, readJson, requireSpace, write, openDb, root, round2, num, type Row } from "./space-common.ts";

const emit = emitter("report");

// Numbers in shortest form, as in the JSON; text quoted for CSV when it needs it (RFC 4180).
const n2s = (v: number | null | undefined) => v === null || v === undefined ? "" : String(v);
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "number" ? n2s(v) : String(v); return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
const yesNo = (b: boolean | null | undefined) => b === null || b === undefined ? "" : b ? "yes" : "no";
const deg = (v: number) => `${n2s(Math.abs(v))}° ${v < 0 ? "W" : "E"}`;
const useCells = (u: { uses: string[]; exempt: string[] } | null | undefined) => u ? [u.uses.join("; "), u.exempt.join("; ")] : [null, null];
// A transmission's band and margin, and the Finnish use on that band: every number beside a margin is about that band.
const band = (e: Row) => `${n2s(e.lo_mhz)}–${n2s(e.hi_mhz)} MHz`;
const margin = (x: number) => x > 0 ? `${n2s(x)} dB over` : `${n2s(round2(-x))} dB under`;
const bandUse = (u: { uses: string[]; exempt: string[] } | null | undefined, n: number, at: string) => {
  if (!u) return "";
  if (!u.uses.length) return ` At ${at}, Finland's frequency table (M4) lists no use.`;
  const few = (l: string[]) => l.slice(0, n).join(", ") + (l.length > n ? ", …" : "");
  return ` At ${at}, Finland's frequency table (M4) lists ${few(u.uses)}${u.exempt.length ? `; licence-exempt: ${few(u.exempt)}` : ""}.`;
};
const fill = (s: string, o: Row) => s.replace(/\{(\w+)\}/g, (_, k) => String(o[k] ?? ""));

export async function report(folder: string): Promise<string> {
  const intake = requireSpace(folder, "Report");
  const { rules, stamp } = rulebook("report");
  const ladBytes = readFileSync(join(root, "spec", "rulebook", "ladder.json"));
  const lad = JSON.parse(ladBytes.toString("utf8"));
  const adm = JSON.parse(readFileSync(join(root, "spec", "reference", "administrations.json"), "utf8"));
  const down = readJson(folder, "downlink.json"), reach = readJson(folder, "reach.json"), lim = readJson(folder, "limit.json");
  const data = readJson(folder, "data.json"), pow = readJson(folder, "power.json"), cmp = readJson(folder, "compare.json");
  const sta = readJson(folder, "stations.json"), ladder = readJson(folder, "ladder.json");
  emit("start");
  const read = await openDb(folder, emit);
  const notice = new Map<number, Row>(read("notice", ["ntc_id", "adm"]).map((r) => [r.ntc_id, r]));
  const names = new Map<number, string>();
  for (const r of read("geo", ["ntc_id", "sat_name"])) if (r.sat_name) names.set(r.ntc_id, String(r.sat_name).trim());
  for (const r of read("non_geo", ["ntc_id", "sat_name"])) if (r.sat_name && !names.has(r.ntc_id)) names.set(r.ntc_id, String(r.sat_name).trim());
  const orbit = new Map<number, { tilt: number | null; apogee: number | null }>();
  for (const r of read("orbit", ["ntc_id", "inclin_ang", "apog_km"])) {
    const o = orbit.get(r.ntc_id) ?? orbit.set(r.ntc_id, { tilt: null, apogee: null }).get(r.ntc_id)!;
    const i = num(r.inclin_ang), a = num(r.apog_km);
    if (i !== null) o.tilt = o.tilt === null ? i : Math.max(o.tilt, i);   // the filed inclination, as a reader would expect
    if (a !== null) o.apogee = o.apogee === null ? a : Math.max(o.apogee, a);
  }

  const by = (o: Row) => new Map<number, Row>(o.notices.map((n: Row) => [n.ntc_id, n]));
  const D = by(down), R = by(reach), Lm = by(lim), Dt = by(data), P = by(pow), C = by(cmp), S = by(sta);
  const rung = new Map<string, Row>(lad.rungs.map((r: Row) => [r.key, r]));
  const W = rules.words;

  function describe(id: number) {
    const n = notice.get(id), r = R.get(id), o = orbit.get(id), dn = D.get(id);
    const a = (n?.adm ?? "").trim();
    const kind = dn?.type === "G" ? "fixed" : dn?.type === "N" ? "moving" : dn?.type ?? "";
    const where = r?.how === "beyond_earth" ? fill(W.beyond, { body: rules.bodies[r.body] ?? r.body })
      : dn?.type === "G" ? (r?.longitude != null ? fill(W.fixed, { longitude: deg(r.longitude) }) : W.moving_unknown.replace("Moving", "Fixed"))
      : o && o.tilt !== null && o.apogee !== null ? fill(W.moving, { tilt: n2s(round2(o.tilt)), apogee: n2s(round2(o.apogee)) }) : W.moving_unknown;
    return { name: names.get(id) ?? null, administration: a, country: adm.administrations[a] ?? a, kind, where, tilt: o?.tilt != null ? round2(o.tilt) : null, apogee: o?.apogee != null ? round2(o.apogee) : null };
  }

  // The reported items, in ladder order.
  const items: Row[] = [];
  for (const p of ladder.notices) {
    const rg = rung.get(p.rung);
    if (!rules.levels_reported.includes(rg.level)) continue;
    const d = describe(p.ntc_id), r = R.get(p.ntc_id), c = C.get(p.ntc_id), s = S.get(p.ntc_id);
    const ids: string[] = s?.stations ?? [];
    items.push({
      ntc_id: p.ntc_id, name: d.name, administration: d.administration, country: d.country, kind: d.kind, where: d.where,
      seen: { seen: !!r?.seen, how: r?.how ?? null, elevation: r?.elevation ?? null, north: r?.north ?? null },
      stations: { count: ids.length, over: p.stations_over, near: p.stations_near, near_frequency: p.near_frequency },
      // the transmission the station evidence rests on, with its own margin, band and Finnish use
      evidence: p.margin ? { excess: p.margin.excess, lo_mhz: p.margin.lo_mhz, hi_mhz: p.margin.hi_mhz, count: p.margin.stations.length,
        first: p.margin.stations.slice(0, rules.stations_listed), finnish_use: p.margin.m4 } : null,
      why: { rung: p.rung, level: rg.level, wording: rg.rung, means: rg.means, cites: rg.cites, itu: p.itu },
      how_much: c && c.excess != null ? { excess: c.excess, provision: c.provn ?? null, finding: c.finding ?? null, angle: c.angle, distance_km: c.distance_km, pfd: c.pfd, limit: c.limit,
        lo_mhz: p.worst?.lo_mhz ?? null, hi_mhz: p.worst?.hi_mhz ?? null, finnish_use: p.worst?.m4 ?? null } : null,
      next: rules.next[p.rung] ?? null,
    });
  }

  // Every filing as one row of the processed file, in ascending ntc_id order.
  const head = ["Filing (ntc_id)", "Satellite", "Administration", "Country", "Kind", "Where", "Sends signals down", "Seen from Finland", "Has a limit",
    "Calculable", "Worst e.i.r.p. (dBW)", "Over the limit by (dB)", "Provision", "Arrival angle (deg)", "Distance (km)", "Outcome",
    "Worst band (MHz)", "Listed stations", "At a transmission over the limit", "Only at a transmission near the limit", "Near-frequency stations",
    "Finnish use in the worst band (M4)", "Licence-exempt use in the worst band (M4)", "ITU names Finland", "Concern", "Level", "Decided by"];
  const L = by(ladder);
  const lines = [head.map(csvCell).join(",")];
  for (const n of down.notices.slice().sort((a: Row, b: Row) => a.ntc_id - b.ntc_id)) {
    const id = n.ntc_id, d = describe(id), r = R.get(id), lm = Lm.get(id), dt = Dt.get(id), pw = P.get(id), c = C.get(id), s = S.get(id), p = L.get(id)!;
    const rg = rung.get(p.rung);
    lines.push([id, d.name, d.administration, d.country, d.kind, d.where, yesNo(n.kept), r ? yesNo(r.seen) : "", lm ? yesNo(lm.limited) : "",
      dt ? yesNo(dt.complete) : "", pw?.eirp ?? null, c?.excess ?? null, c?.provn ?? null, c?.angle ?? null, c?.distance_km ?? null, c?.outcome ?? null,
      p.worst ? `${n2s(p.worst.lo_mhz)}–${n2s(p.worst.hi_mhz)}` : null, s ? s.stations.length : null, s ? s.over.length : null, s ? s.near.length : null,
      p.near_frequency || (c && (c.outcome === "over" || c.outcome === "near") ? 0 : null), ...useCells(p.worst?.m4), p.itu.join(" "), rg.rung, rg.level, p.by].map(csvCell).join(","));
  }
  const csv = lines.join("\n") + "\n";

  // The short notification.
  const crit = items.filter((x) => x.why.level === "crit"), warn = items.filter((x) => x.why.level === "warn");
  const md: string[] = [`# Space notification: ${intake.file.name}`, "",
    `${ladder.counts.notices} filings screened. ${crit.length} need attention, ${warn.length} are worth a look.`, "",
    "| Concern | Level | Filings |", "|---|---|---|",
    ...lad.rungs.map((r: Row) => `| ${r.rung} | ${r.level} | ${ladder.counts.rungs[r.key] ?? 0} |`), ""];
  const line = (x: Row, i: number) => {
    const head = `${i + 1}. **${x.name ?? `Filing ${x.ntc_id}`}** (${x.ntc_id}), ${x.country}. ${x.where}. ${x.seen.seen ? W.seen : W.clear}.`;
    const h = x.how_much, ev = x.evidence;
    const much = h ? `${margin(h.excess)} the limit${h.provision ? ` (${h.provision})` : ""} at ${n2s(h.angle)}° above the horizon${h.lo_mhz != null ? `, at ${band(h)}` : ""}` : "No calculated margin";
    // station evidence stays with its own transmission: said apart when it is not the worst one
    const same = !!(h && ev && ev.lo_mhz === h.lo_mhz && ev.hi_mhz === h.hi_mhz && ev.excess === h.excess);
    const on = ev ? `on the frequencies of ${ev.count} listed station${ev.count === 1 ? "" : "s"} (${ev.first.join(", ")}${ev.count > ev.first.length ? ", …" : ""})` : "";
    const st = ev ? (same ? on : `${margin(ev.excess)} the limit at ${band(ev)}, ${on}${h && h.excess > 0 && ev.excess <= 0 ? "; no listed station is on a transmission over the limit" : ""}`)
      : x.stations.near_frequency ? `${x.stations.near_frequency} listed station${x.stations.near_frequency === 1 ? "" : "s"} near its frequencies` : "no listed station on its frequencies";
    const uses = (h?.lo_mhz != null ? bandUse(h.finnish_use, rules.uses_listed, band(h)) : "") + (ev && !same ? bandUse(ev.finnish_use, rules.uses_listed, band(ev)) : "");
    return [head, `   ${x.why.wording}: ${much}; ${st}.${x.why.itu.length ? ` The ITU's records name Finland (${x.why.itu.join(", ")}).` : ""}${uses}`, `   Next: ${x.next}`];
  };
  if (crit.length) md.push("## Needs attention", "", ...crit.flatMap(line), "");
  if (warn.length) md.push("## Worth a look", "", ...warn.flatMap((x, i) => line(x, i)), "");
  const text = md.join("\n");

  writeFileSync(join(folder, "report.csv"), csv);
  writeFileSync(join(folder, "report.md"), text);
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  const result = { schema: "report/1", rulebook: stamp, uses: { ladder: createHash("sha256").update(ladBytes).digest("hex") }, file: intake.file.sha256, name: intake.file.name,
    counts: { notices: ladder.counts.notices, items: items.length, crit: crit.length, warn: warn.length, rungs: ladder.counts.rungs },
    files: { csv: { name: "report.csv", rows: lines.length - 1, sha256: sha(csv) }, md: { name: "report.md", sha256: sha(text) } }, items };
  emit("done", { items: items.length, crit: crit.length, warn: warn.length });
  return write(folder, "report.json", result);
}
