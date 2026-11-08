// Tosi engine, TypeScript. Commands print one JSON document on stdout; see dev/docs/modules.md.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const VERSION = "0.0.1";
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

type EngineInfo = {
  schema: "engine-info/1";
  engine: "ts";
  language: string;
  version: string;
  runtime: string;
  spec: string;
  stages: string[];
};

function info(): EngineInfo {
  return {
    schema: "engine-info/1",
    engine: "ts",
    language: "TypeScript",
    version: VERSION,
    runtime: `Node ${process.versions.node}`,
    spec: readFileSync(join(root, "spec", "VERSION"), "utf8").trim(),
    stages: ["intake", "downlink", "reach", "limit", "data", "power", "compare", "stations", "mobile", "range", "tdata", "field", "threshold", "tstations", "ladder", "report", "tladder", "treport"],
  };
}

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    process.stderr.write(JSON.stringify({ error: `missing ${name}` }) + "\n");
    process.exit(2);
  }
  return process.argv[i + 1];
}

const commands: Record<string, () => unknown> = {
  info,
  downlink: async () => { const { downlink } = await import("./downlink.ts"); return downlink(arg("--in")); },
  reach: async () => { const { reach } = await import("./reach.ts"); return reach(arg("--in")); },
  limit: async () => { const m = await import("./limit.ts"); return m.limit(arg("--in")); },
  data: async () => { const m = await import("./data.ts"); return m.data(arg("--in")); },
  power: async () => { const m = await import("./power.ts"); return m.power(arg("--in")); },
  compare: async () => { const m = await import("./compare.ts"); return m.compare(arg("--in")); },
  stations: async () => { const m = await import("./stations.ts"); return m.stations(arg("--in")); },
  mobile: async () => { const m = await import("./mobile.ts"); return m.mobile(arg("--in")); },
  range: async () => { const m = await import("./range.ts"); return m.range(arg("--in")); },
  tdata: async () => { const m = await import("./tdata.ts"); return m.tdata(arg("--in")); },
  field: async () => { const m = await import("./field.ts"); return m.field(arg("--in")); },
  threshold: async () => { const m = await import("./threshold.ts"); return m.threshold(arg("--in")); },
  tstations: async () => { const m = await import("./tstations.ts"); return m.tstations(arg("--in")); },
  ladder: async () => { const m = await import("./ladder.ts"); return m.ladder(arg("--in")); },
  report: async () => { const m = await import("./report.ts"); return m.report(arg("--in")); },
  tladder: async () => { const m = await import("./tladder.ts"); return m.tladder(arg("--in")); },
  treport: async () => { const m = await import("./treport.ts"); return m.treport(arg("--in")); },
  intake: async () => { const { intake } = await import("./intake.ts"); const f = arg("--file"); return intake(f, process.argv.includes("--name") ? arg("--name") : basename(f), arg("--out")); },
};
const command = process.argv[2];
const run = command ? commands[command] : undefined;
if (!run) {
  process.stderr.write(JSON.stringify({ error: "unknown command", command: command ?? null, known: Object.keys(commands) }) + "\n");
  process.exit(2);
}
try {
  const out = await run();
  process.stdout.write((typeof out === "string" ? out : JSON.stringify(out)) + "\n");
} catch (e) {
  process.stderr.write(JSON.stringify({ error: String(e) }) + "\n");
  process.exit(1);
}
