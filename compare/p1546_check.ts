// Check Tosi's P.1546-6 port against the ITU-R WP 3K validation examples.
//
//   node compare/p1546_check.ts "<folder with the validation_results *_log.csv files>"
//
// Each example logs its inputs and the field strength after step 11 (curves, interpolation and mixed paths), before the
// terrain, clutter and location corrections Tosi does not use. Feeding the logged frequency, distance, land and sea
// lengths, time percentage, transmitter height and maximum field strength into Tosi's step 11 should give the same value.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { e11 } from "../engines/ts/src/p1546.ts";

const dir = process.argv[2];
if (!dir) { console.error("Give the folder with the ITU validation_results files."); process.exit(2); }
const files = readdirSync(dir).filter((f) => f.endsWith("_log.csv")).sort();
let ok = 0, n = 0;
for (const f of files) {
  const lines = readFileSync(join(dir, f), "utf8").split(/\r?\n/).map((l) => l.split(","));
  const get = (k: string) => lines.find((l) => l[0].startsWith(k));
  const num = (k: string) => Number(get(k)?.[3]);
  const sea = get("Sea path");
  const want = num("Field strength (dBuV/m)");
  if (!Number.isFinite(want)) continue;
  const got = e11({ f: num("Frequency f"), t: num("Percentage time"), h1: num("Tx antenna height h1"), dland: num("Land path"), dsea: num("Sea path"),
    sea: sea?.[1]?.toLowerCase() === "warm" ? "warm" : "cold", emax: num("Maximum field strength Emax") });
  const dev = got - want; n++;
  const pass = Math.abs(dev) <= 0.1; ok += pass ? 1 : 0;
  console.log(`${pass ? "ok  " : "DIFF"} ${f.padEnd(44)} want ${want.toFixed(4).padStart(9)}  got ${got.toFixed(4).padStart(9)}  ${dev >= 0 ? "+" : ""}${dev.toFixed(4)}`);
}
console.log(`\n${ok} of ${n} ITU validation examples match within 0.1 dB at step 11.`);
process.exit(ok === n ? 0 : 1);
