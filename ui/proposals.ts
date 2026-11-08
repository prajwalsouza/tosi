// Proposed rulebook changes. Anything other than a person in the interface (the MCP server, a chat model)
// can only propose. A person accepts or declines; an accepted proposal becomes an ordinary, logged rulebook change.
// Two kinds: a change to what intake reads (Change), and a new value for one parameter of a step's rulebook (ParamChange).
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Change } from "./rulebook.ts";

export type ParamChange = { stage: string; parameter: string; value: number };
export type Proposal = { id: string; change: Change | ParamChange; why: string; by: string; at: string; state: "pending" | "accepted" | "declined"; decided?: string; version?: number; error?: string; cites?: string[]; source?: string | null };

const isParam = (c: any): c is ParamChange => c && typeof c.stage === "string" && typeof c.parameter === "string";

// A parameter change, applied to spec/rulebook/<stage>.json: the next version, logged with its reason in changes.jsonl.
// Only reached when a person accepts a proposal and the algorithm is editable.
export function applyParam(root: string, c: ParamChange, why: string): { ok: true; version: number } | { ok: false; error: string } {
  if (!/^[a-z]+$/.test(c.stage) || c.stage === "intake") return { ok: false, error: "No such stage" };
  const file = join(root, "spec", "rulebook", `${c.stage}.json`);
  if (!existsSync(file)) return { ok: false, error: "No such stage" };
  const r = JSON.parse(readFileSync(file, "utf8"));
  if (typeof r[c.parameter] !== "number" || c.parameter === "version") return { ok: false, error: `${c.stage} has no parameter ${c.parameter}` };
  if (!Number.isFinite(c.value)) return { ok: false, error: "The value must be a number" };
  const from = r[c.parameter];
  r[c.parameter] = c.value;
  r.version = (r.version ?? 0) + 1;
  writeFileSync(file, JSON.stringify(r, null, 2) + "\n");
  appendFileSync(join(root, "spec", "rulebook", "changes.jsonl"), JSON.stringify({ version: r.version, at: new Date().toISOString(), stage: c.stage, field: "parameter", parameter: c.parameter, from, to: c.value, why: why.trim() || null }) + "\n");
  return { ok: true, version: r.version };
}

export function makeProposals(root: string, apply: (c: Change) => { ok: true; version: number } | { ok: false; error: string }) {
  const dir = join(root, "state");
  const file = join(dir, "proposals.json");
  mkdirSync(dir, { recursive: true });
  const load = (): Proposal[] => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
  const save = (list: Proposal[]) => writeFileSync(file, JSON.stringify(list, null, 2) + "\n");
  const stamp = () => ({ id: randomBytes(4).toString("hex"), at: new Date().toISOString(), state: "pending" as const });

  return {
    list: () => load().reverse(),
    add(change: Change, why: string, by: string): Proposal | { error: string } {
      if (!why?.trim()) return { error: "A proposal needs a reason." };
      if (!change?.kind || !change?.table || !change?.field) return { error: "A proposal needs kind, table and field." };
      const p: Proposal = { ...stamp(), change: { ...change, why: undefined }, why: why.trim().slice(0, 500), by: String(by || "unknown").slice(0, 60) };
      const list = load(); list.push(p); save(list);
      return p;
    },
    addParam(change: ParamChange, why: string, by: string, cites: string[] = [], source: string | null = null): Proposal | { error: string } {
      if (!why?.trim()) return { error: "A proposal needs a reason." };
      if (!isParam(change) || !/^[a-z]+$/.test(change.stage) || !/^[a-z0-9_]+$/.test(change.parameter) || !Number.isFinite(change.value)) return { error: "A parameter proposal needs stage, parameter and a number." };
      if (!existsSync(join(root, "spec", "rulebook", `${change.stage}.json`))) return { error: "No such stage" };
      const p: Proposal = { ...stamp(), change: { stage: change.stage, parameter: change.parameter, value: change.value }, why: why.trim().slice(0, 500), by: String(by || "unknown").slice(0, 60),
        cites: (Array.isArray(cites) ? cites : []).filter((x) => typeof x === "string").slice(0, 10), source: source ? String(source).slice(0, 200) : null };
      const list = load(); list.push(p); save(list);
      return p;
    },
    decide(id: string, accept: boolean): Proposal | { error: string } {
      const list = load(), p = list.find((x) => x.id === id);
      if (!p) return { error: "No such proposal" };
      if (p.state !== "pending") return { error: `Already ${p.state}` };
      if (accept) {
        const why = `${p.why} (proposed by ${p.by})`;
        const r = isParam(p.change) ? applyParam(root, p.change, why) : apply({ ...p.change, why });
        if (!r.ok) { p.error = r.error; save(list); return { error: r.error }; }
        p.version = r.version;
      }
      p.state = accept ? "accepted" : "declined"; p.decided = new Date().toISOString();
      save(list);
      return p;
    },
  };
}
