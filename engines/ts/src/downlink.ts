// Stage 2, downlink. See spec/stages/downlink/README.md.
// Which space filings send signals down towards the ground: a satellite with at least one transmitting group goes on,
// with only its transmitting groups. Progress goes to stderr as JSON lines; the result to stdout and downlink.json.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// The sources a rulebook cites: its "method", "basis" and "*_basis" entries, in rulebook order. Every result carries them.
const citesOf = (rules: Record<string, unknown>) => Object.fromEntries(Object.entries(rules).filter(([k]) => k === "method" || k === "basis" || k.endsWith("_basis")));

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const RULES_BYTES = readFileSync(join(root, "spec", "rulebook", "downlink.json"));
const RULES = JSON.parse(RULES_BYTES.toString("utf8"));
const RULEBOOK = { version: RULES.version, sha256: createHash("sha256").update(RULES_BYTES).digest("hex"), cites: citesOf(RULES) };
const emit = (step: string, state: string, fields: Record<string, unknown> = {}) => process.stderr.write(JSON.stringify({ event: "step", step, state, ...fields }) + "\n");

export async function downlink(folder: string): Promise<string> {
  const intake = JSON.parse(readFileSync(join(folder, "intake.json"), "utf8"));
  if (intake.kind !== "space" || intake.check.status !== "accepted") throw new Error("Downlink needs an accepted space filing");
  const { default: MDBReader } = await import("mdb-reader");
  emit("downlink", "start");
  const db = new MDBReader(readFileSync(join(folder, "database.mdb")));
  const n = db.getTable("notice").getData({ columns: ["ntc_id", "ntc_type"] }) as { ntc_id: number; ntc_type: string }[];
  emit("downlink", "progress", { table: "notice", rows: n.length });
  const g = db.getTable("grp").getData({ columns: ["grp_id", "ntc_id", "emi_rcp"] }) as { grp_id: number; ntc_id: number; emi_rcp: string }[];
  emit("downlink", "progress", { table: "grp", rows: g.length });

  const tx = new Map<number, number>(), rx = new Map<number, number>(), by = new Map<number, number[]>();
  for (const r of g) {
    if (r.emi_rcp === RULES.transmit) { tx.set(r.ntc_id, (tx.get(r.ntc_id) ?? 0) + 1); (by.get(r.ntc_id) ?? by.set(r.ntc_id, []).get(r.ntc_id)!).push(r.grp_id); }
    else if (r.emi_rcp === RULES.receive) rx.set(r.ntc_id, (rx.get(r.ntc_id) ?? 0) + 1);
  }
  const left: Record<string, number> = Object.fromEntries(Object.keys(RULES.reasons).map((k) => [k, 0]));
  const notices: unknown[] = [];
  let groups: number[] = [];
  for (const r of n.slice().sort((a, b) => a.ntc_id - b.ntc_id)) {
    const t = tx.get(r.ntc_id) ?? 0, v = rx.get(r.ntc_id) ?? 0;
    const reason = !(r.ntc_type in RULES.satellite_types) ? "not_satellite" : t === 0 && v === 0 ? "nothing_filed" : t === 0 ? "receive_only" : null;
    if (reason) left[reason]++; else groups = groups.concat(by.get(r.ntc_id)!);
    notices.push({ ntc_id: r.ntc_id, type: r.ntc_type, kept: reason === null, reason, transmit: t, receive: v });
  }
  groups.sort((a, b) => a - b);
  const kept = n.length - Object.values(left).reduce((a, b) => a + b, 0);
  const result = { schema: "downlink/1", rulebook: RULEBOOK, file: intake.file.sha256, counts: { notices: notices.length, kept, left, groups: g.length, groups_kept: groups.length }, notices, groups };
  emit("downlink", "done", { kept, notices: notices.length, left });
  const text = JSON.stringify(result);
  writeFileSync(join(folder, "downlink.json"), text + "\n");
  return text;
}
