// Finland's national frequency allocation table (Traficom Radio Frequency Regulation 4), as spec/tables/m4.json.
// Used by both ladders to say which Finnish uses, and which licence-exempt uses, share a case's frequencies.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { root } from "./space-common.ts";

export type M4 = { rows: [number, number, string, boolean][]; sha256: string };
export type Use = { uses: string[]; exempt: string[] };

export function m4Table(): M4 {
  const bytes = readFileSync(join(root, "spec", "tables", "m4.json"));
  return { rows: JSON.parse(bytes.toString("utf8")).rows, sha256: createHash("sha256").update(bytes).digest("hex") };
}

// Every use whose sub-band touches any of the ranges (lo, hi in MHz, ends included), each once, in table order;
// and, of those, the ones the table marks licence-exempt.
export function finnishUse(t: M4, ranges: [number, number][]): Use {
  const uses: string[] = [], exempt: string[] = [];
  for (const [lo, hi, use, ex] of t.rows) {
    if (!ranges.some(([a, b]) => lo <= b && hi >= a)) continue;
    if (!uses.includes(use)) uses.push(use);
    if (ex && !exempt.includes(use)) exempt.push(use);
  }
  return { uses, exempt };
}
