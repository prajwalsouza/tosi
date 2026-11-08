// Proposed rulebook changes. Anything other than a person in the interface (the MCP server, a chat model)
// can only propose. A person accepts or declines; an accepted proposal becomes an ordinary, logged rulebook change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import type { Change } from "./rulebook.ts";

export type Proposal = { id: string; change: Change; why: string; by: string; at: string; state: "pending" | "accepted" | "declined"; decided?: string; version?: number; error?: string };

export function makeProposals(root: string, apply: (c: Change) => { ok: true; version: number } | { ok: false; error: string }) {
  const dir = join(root, "state");
  const file = join(dir, "proposals.json");
  mkdirSync(dir, { recursive: true });
  const load = (): Proposal[] => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : []);
  const save = (list: Proposal[]) => writeFileSync(file, JSON.stringify(list, null, 2) + "\n");

  return {
    list: () => load().reverse(),
    add(change: Change, why: string, by: string): Proposal | { error: string } {
      if (!why?.trim()) return { error: "A proposal needs a reason." };
      if (!change?.kind || !change?.table || !change?.field) return { error: "A proposal needs kind, table and field." };
      const p: Proposal = { id: randomBytes(4).toString("hex"), change: { ...change, why: undefined }, why: why.trim().slice(0, 500), by: String(by || "unknown").slice(0, 60), at: new Date().toISOString(), state: "pending" };
      const list = load(); list.push(p); save(list);
      return p;
    },
    decide(id: string, accept: boolean): Proposal | { error: string } {
      const list = load(), p = list.find((x) => x.id === id);
      if (!p) return { error: "No such proposal" };
      if (p.state !== "pending") return { error: `Already ${p.state}` };
      if (accept) {
        const r = apply({ ...p.change, why: `${p.why} (proposed by ${p.by})` });
        if (!r.ok) { p.error = r.error; save(list); return { error: r.error }; }
        p.version = r.version;
      }
      p.state = accept ? "accepted" : "declined"; p.decided = new Date().toISOString();
      save(list);
      return p;
    },
  };
}
