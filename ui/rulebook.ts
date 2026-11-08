// Rulebook edits. The rulebook (spec/rulebook/intake.json) is the source of truth that every engine reads.
// A change here is a change to the spec: it bumps the version and is recorded, with its reason, in changes.jsonl.
// This file only edits the rulebook; it never computes a result.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Change = { kind: string; table: string; field: "read" | "columns" | "alias" | "about" | "add"; value: unknown; why?: string };

export function makeRulebook(root: string) {
  const file = join(root, "spec", "rulebook", "intake.json");
  const log = join(root, "spec", "rulebook", "changes.jsonl");
  const read = () => JSON.parse(readFileSync(file, "utf8"));

  function apply(c: Change): { ok: true; version: number } | { ok: false; error: string } {
    const r = read();
    const kind = r.kinds?.[c.kind];
    if (!kind) return { ok: false, error: `No kind "${c.kind}"` };
    if (!/^[A-Za-z0-9_]+$/.test(c.table)) return { ok: false, error: "Table names are letters, digits and underscores" };
    const tables = (kind.tables ??= {});
    const before = tables[c.table] ? structuredClone(tables[c.table]) : null;
    if (c.field === "add") {
      if (tables[c.table]) return { ok: false, error: "Already in the rulebook" };
      tables[c.table] = { read: true, columns: [] };
    } else {
      const t = tables[c.table];
      if (!t) return { ok: false, error: `"${c.table}" is not in the rulebook` };
      if (c.field === "read") t.read = Boolean(c.value);
      else if (c.field === "columns") {
        if (!Array.isArray(c.value) || !c.value.every((x) => typeof x === "string" && /^[A-Za-z0-9_]+$/.test(x))) return { ok: false, error: "Columns are a list of names" };
        t.columns = c.value;
      } else if (c.field === "alias" || c.field === "about") {
        const v = String(c.value ?? "").trim().slice(0, c.field === "alias" ? 60 : 300);
        if (v) t[c.field] = v; else delete t[c.field];
      } else return { ok: false, error: "Unknown change" };
    }
    if (kind.markers?.includes(c.table) && c.field === "read" && !c.value) return { ok: false, error: `"${c.table}" is how a ${c.kind} filing is recognised, so it cannot be switched off here` };
    r.version = (r.version ?? 0) + 1;
    writeFileSync(file, JSON.stringify(r, null, 2) + "\n");
    appendFileSync(log, JSON.stringify({ version: r.version, at: new Date().toISOString(), kind: c.kind, table: c.table, field: c.field, from: before, to: r.kinds[c.kind].tables[c.table], why: c.why?.trim() || null }) + "\n");
    return { ok: true, version: r.version };
  }

  function changes() {
    if (!existsSync(log)) return [];
    return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse();
  }

  return { read, apply, changes };
}
