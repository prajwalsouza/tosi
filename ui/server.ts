// Tosi local server. Serves the interface and starts engines as separate processes.
// It holds no stage logic: it asks an engine and passes on what the engine printed.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, createWriteStream, writeFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeRuns, view } from "./runs.ts";
import { makeRulebook } from "./rulebook.ts";
import { makeTests } from "./tests.ts";
import { makeProposals } from "./proposals.ts";
import { makeLibrary } from "./library.ts";
import { makeFilings } from "./filings.ts";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { crc32, deflateRawSync, gunzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5170);
const hosted = process.env.TOSI_HOSTED === "1";
if (hosted) {
  const stations = process.env.TOSI_STATIONS_GZIP_BASE64;
  if (!stations) throw new Error("Set TOSI_STATIONS_GZIP_BASE64 in the hosting environment");
  const bytes = gunzipSync(Buffer.from(stations, "base64"), { maxOutputLength: 1_048_576 });
  if (!Array.isArray(JSON.parse(bytes.toString("utf8")).stations)) throw new Error("Invalid station list");
  const folder = join(root, "state", "reference");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "stations.json"), bytes, { mode: 0o600 });
  delete process.env.TOSI_STATIONS_GZIP_BASE64;
}

type Engine = { id: string; name: string; cwd: string; cmd: string; args: string[]; build?: string };
const configuredEngines: Engine[] = JSON.parse(readFileSync(join(root, "engines", "engines.json"), "utf8")).engines;
const engines = hosted ? configuredEngines.filter((engine) => engine.id === "rust") : configuredEngines;

// This machine's settings (dev/local.json, never committed): sample files and where runs go.
const local = existsSync(join(root, "dev", "local.json")) ? JSON.parse(readFileSync(join(root, "dev", "local.json"), "utf8")) : {};
const samplePaths: string[] = hosted
  ? ["ific3074.zip", "brific3076.zip"].map((name) => join(root, "samples", name))
  : local.samples ?? [];
const samples = samplePaths.filter((path) => existsSync(path));
// TOSI_RUNS lets a second server on another PORT keep its own runs, so neither clears the other's.
const runsDir = process.env.TOSI_RUNS ?? join(root, local.runs ?? "runs");
const library = makeLibrary(root, local.library ?? "library");
const runs = makeRuns(root, engines, runsDir, (run) => { try { library.add(run, JSON.parse(readFileSync(join(root, "spec", "rulebook", "intake.json"), "utf8"))); } catch (e) { console.error("library:", e); } });
const tests = makeTests(root, engines, samples, (p, e) => runs.bench(p, e));
const referenceBenchmarks = hosted
  ? JSON.parse(readFileSync(join(root, "spec", "reference", "benchmark-2026-11-08.json"), "utf8"))
  : null;
const rulebook = makeRulebook(root);
const proposals = makeProposals(root, rulebook.apply);
const filings = makeFilings(root);
const MAX_UPLOAD = 2_000_000_000;
const DEMO_POST_WINDOW_MS = 60_000;
const DEMO_POST_LIMIT = 20;
const DEMO_BENCH_COOLDOWN_MS = 5 * 60_000;
let demoPostWindowStarted = 0;
let demoPosts = 0;
let demoBenchmarkStarted = 0;
// The algorithm is read-only unless this machine's settings say otherwise. Editing comes back with drafts and Save.
const EDITING = !hosted && local.editing === true;
const LOCKED = JSON.stringify({ ok: false, error: "The algorithm is read-only. Editing will return with drafts and a Save button." });

type Answer = { available?: boolean; id: string; name: string; ok: boolean; ms: number; info?: unknown; error?: string; hint?: string };

// Fields every engine-info document must have (spec/schemas/engine-info.schema.json).
const required = JSON.parse(readFileSync(join(root, "spec", "schemas", "engine-info.schema.json"), "utf8")).required as string[];

function ask(e: Engine, command: string): Promise<Answer> {
  const base = { id: e.id, name: e.name };
  if (hosted && e.id !== "rust") {
    return Promise.resolve({ ...base, available: false, ok: false, ms: 0, error: "Unavailable on this deployment" });
  }
  const cwd = join(root, e.cwd);
  const local = e.cmd.includes("/");
  if (local && !existsSync(join(cwd, e.cmd))) {
    return Promise.resolve({ ...base, ok: false, ms: 0, error: "Not built yet", hint: e.build ? `cd ${e.cwd} && ${e.build}` : undefined });
  }
  return new Promise((resolve) => {
    const t0 = performance.now();
    const p = spawn(local ? join(cwd, e.cmd) : e.cmd, [...e.args, command], { cwd });
    let out = "", err = "";
    const timer = setTimeout(() => p.kill(), 10_000);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (x) => { clearTimeout(timer); resolve({ ...base, ok: false, ms: 0, error: `Could not start: ${x.message}` }); });
    p.on("close", (code) => {
      clearTimeout(timer);
      const ms = Math.round(performance.now() - t0);
      if (code !== 0) return resolve({ ...base, ok: false, ms, error: err.trim() || `Exited with code ${code}` });
      try {
        const info = JSON.parse(out);
        const missing = required.filter((k) => !(k in info));
        if (missing.length) return resolve({ ...base, ok: false, ms, info, error: `Missing fields: ${missing.join(", ")}` });
        if (info.engine !== e.id) return resolve({ ...base, ok: false, ms, info, error: `Says it is "${info.engine}", expected "${e.id}"` });
        resolve({ ...base, ok: true, ms, info });
      } catch {
        resolve({ ...base, ok: false, ms, error: "Did not print valid JSON" });
      }
    });
  });
}

const types: Record<string, string> = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

function send(res: import("node:http").ServerResponse, code: number, body: string, type = "application/json") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

// A small spreadsheet writer for the report download: one sheet, the CSV's rows as they are, numbers kept as numbers,
// the header row bold and frozen, with a filter. An .xlsx is a zip of a few XML files.
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
function zip(files: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [], dir: Buffer[] = []; let off = 0;
  for (const [name, data] of files) {
    const n = Buffer.from(name), z = deflateRawSync(data), crc = crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(z.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(z.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, n, z); dir.push(c, n); off += 30 + n.length + z.length;
  }
  const d = Buffer.concat(dir), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(d.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, d, e]);
}
function xlsxFromCsv(text: string, sheet: string): Buffer {
  const rows = parseCsv(text), x = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const col = (i: number) => { let s = ""; for (let k = i + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };
  const width = (rows[0] ?? []).map((_, j) => Math.min(60, Math.max(8, ...rows.slice(0, 400).map((r) => (r[j] ?? "").length + 2))));
  const cells = rows.map((r, i) => `<row r="${i + 1}">` + r.map((v, j) => {
    const ref = `${col(j)}${i + 1}`;
    if (v === "") return "";
    if (i > 0 && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v) && !/^-?0\d/.test(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${i === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  }).join("") + "</row>").join("");
  const last = `${col(Math.max(0, (rows[0]?.length ?? 1) - 1))}${Math.max(1, rows.length)}`;
  const ws = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${width.map((w, j) => `<col min="${j + 1}" max="${j + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${cells}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
  const f = (s: string): Buffer => Buffer.from(s, "utf8");
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  return zip([
    ["[Content_Types].xml", f(`${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)],
    ["_rels/.rels", f(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
    ["xl/workbook.xml", f(`${X}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", f(`${X}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)],
    ["xl/styles.xml", f(`${X}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`)],
    ["xl/worksheets/sheet1.xml", f(ws)],
  ]);
}

if (process.argv.includes("--check")) {
  const all = await Promise.all(engines.map((e) => ask(e, "info")));
  for (const a of all) console.log(`${a.ok ? "ok  " : "FAIL"} ${a.name.padEnd(10)} ${String(a.ms).padStart(4)} ms  ${a.ok ? JSON.stringify(a.info) : a.error}`);
  process.exit(all.every((a) => a.ok) ? 0 : 1);
}

if (!hosted) runs.clear();

const getEngineInfo = () => Promise.all(configuredEngines.map((engine) => ask(engine, "info")));
let hostedEngineInfo: ReturnType<typeof getEngineInfo> | undefined;
const engineInfo = () => hosted ? (hostedEngineInfo ??= getEngineInfo()) : getEngineInfo();

createServer(hosted ? { headersTimeout: 10_000, requestTimeout: 15_000, maxHeaderSize: 8192 } : {}, async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/healthz") return send(res, 200, "ok", "text/plain");
  if (hosted && req.method === "POST") {
    req.resume();
    const sampleRun = url.pathname === "/api/runs" && url.searchParams.has("sample") && !url.searchParams.has("path");
    const benchmark = url.pathname === "/api/tests/run";
    if (req.headers["sec-fetch-site"] === "cross-site") {
      return send(res, 403, JSON.stringify({ error: "Cross-site requests are disabled" }));
    }
    if (!sampleRun && !benchmark) {
      return send(res, 403, JSON.stringify({ error: "The public demo accepts only the supplied samples and the Rust benchmark." }));
    }
    const now = Date.now();
    if (now - demoPostWindowStarted >= DEMO_POST_WINDOW_MS) {
      demoPostWindowStarted = now;
      demoPosts = 0;
    }
    const retryAfter = benchmark && tests.view().running ? 30
      : benchmark && now - demoBenchmarkStarted < DEMO_BENCH_COOLDOWN_MS
        ? Math.ceil((demoBenchmarkStarted + DEMO_BENCH_COOLDOWN_MS - now) / 1000)
        : demoPosts >= DEMO_POST_LIMIT
          ? Math.ceil((demoPostWindowStarted + DEMO_POST_WINDOW_MS - now) / 1000)
          : 0;
    if (retryAfter) {
      res.setHeader("Retry-After", String(retryAfter));
      return send(res, 429, JSON.stringify({ error: `The demo is busy. Try again in ${retryAfter} seconds.` }));
    }
    demoPosts++;
    if (benchmark) demoBenchmarkStarted = now;
  }
  if (url.pathname === "/api/engines") {
    return send(res, 200, JSON.stringify(await engineInfo()));
  }
  if (url.pathname === "/api/about") {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return send(res, 200, JSON.stringify({ tosi: pkg.version, demo: hosted, editing: EDITING, spec: readFileSync(join(root, "spec", "VERSION"), "utf8").trim(), server: `Node ${process.versions.node}`, engines: configuredEngines.map((e) => ({ id: e.id, name: e.name, available: engines.includes(e) })) }));
  }
  // Proposals: how anything but a person changes the rulebook. A person accepts or declines.
  const readBody = (cb: (v: any) => void) => { let b = ""; req.on("data", (d) => { b += d; if (b.length > 50000) req.destroy(); }); req.on("end", () => { try { cb(JSON.parse(b || "{}")); } catch { send(res, 400, JSON.stringify({ error: "Not valid JSON" })); } }); };
  if (url.pathname === "/api/proposals" && req.method === "GET") return send(res, 200, JSON.stringify(proposals.list()));
  if (url.pathname === "/api/proposals" && req.method === "POST") {
    return readBody((b) => { const p = proposals.add(b.change, b.why, b.by); send(res, "error" in p ? 400 : 200, JSON.stringify(p)); });
  }
  // A new value for one parameter of a step's rulebook: also only a proposal.
  if (url.pathname === "/api/proposals/parameter" && req.method === "POST") {
    return readBody((b) => { const p = proposals.addParam(b.change, b.why, b.by, b.cites, b.source); send(res, "error" in p ? 400 : 200, JSON.stringify(p)); });
  }
  const pd = url.pathname.match(/^\/api\/proposals\/([0-9a-f]+)\/(accept|decline)$/);
  if (pd && req.method === "POST" && pd[2] === "accept" && !EDITING) { req.resume(); return send(res, 423, LOCKED); }
  if (pd && req.method === "POST") { req.resume(); const p = proposals.decide(pd[1], pd[2] === "accept"); return send(res, "error" in p ? 400 : 200, JSON.stringify(p)); }
  // The assistant: a chat model that can only propose. Not connected yet; the interface says so.
  if (url.pathname === "/api/assistant" && req.method === "POST") {
    return readBody(() => send(res, 200, JSON.stringify({ connected: false, reply: "No model is connected yet. You can already drive Tosi from an assistant through its MCP server (see mcp/README.md); anything it wants to change appears below as a proposal for you to accept or decline.", proposals: [] })));
  }
  // The demo run: a recorded session of an assistant using the MCP server in test-run mode, replayed by the interface.
  if (url.pathname === "/api/demo/codex") {
    const f = join(root, "ui", "demo", "codex-demo.json");
    return existsSync(f) ? send(res, 200, readFileSync(f, "utf8")) : send(res, 404, JSON.stringify({ error: "No recorded demo" }));
  }
  // The library: every file processed, with its record.
  if (url.pathname === "/api/library") return send(res, 200, JSON.stringify(library.list()));
  const lb = url.pathname.match(/^\/api\/library\/([0-9a-f]+)(\/again)?$/);
  if (lb) {
    const rec = library.get(lb[1]);
    if (!rec) { req.resume(); return send(res, 404, JSON.stringify({ error: "No such record" })); }
    if (!lb[2]) { const { path, ...rest } = rec; return send(res, 200, JSON.stringify(rest)); }
    req.resume();
    if (req.method !== "POST" || !rec.path || !existsSync(rec.path)) return send(res, 400, JSON.stringify({ error: "The original file is no longer available." }));
    return send(res, 200, JSON.stringify(view(runs.start(rec.path, rec.file.name, rec.file.source, url.searchParams.get("engine") ?? rec.engine, true))));
  }
  // Finland's listed stations, for the maps (this computer's copy of the list; absent means none to show).
  if (url.pathname === "/api/stations") {
    const f = join(root, "state", "reference", "stations.json");
    if (!existsSync(f)) return send(res, 200, JSON.stringify({ present: false, stations: [] }));
    const d = JSON.parse(readFileSync(f, "utf8"));
    return send(res, 200, JSON.stringify({ present: true, stations: d.stations.map((x: any) => ({ station: x.station, lon: x.lon, lat: x.lat, class: x.class, tx_mhz: x.tx_mhz, rx_mhz: x.rx_mhz })) }));
  }
  if (url.pathname === "/api/chain") { const { about, ...c } = JSON.parse(readFileSync(join(root, "engines", "chain.json"), "utf8")); return send(res, 200, JSON.stringify(c)); }
  if (url.pathname === "/api/guidebook") return send(res, 200, readFileSync(join(root, "spec", "guidebook", "guidebook.json"), "utf8"));
  if (url.pathname === "/api/rulebook/intake/changes") return send(res, 200, JSON.stringify(rulebook.changes()));
  if (url.pathname === "/api/rulebook/intake" && req.method === "POST" && !EDITING) { req.resume(); return send(res, 423, LOCKED); }
  if (url.pathname === "/api/rulebook/intake" && req.method === "POST") {
    let body = "";
    req.on("data", (d) => { body += d; if (body.length > 20000) req.destroy(); });
    req.on("end", () => {
      try { const out = rulebook.apply(JSON.parse(body)); send(res, out.ok ? 200 : 400, JSON.stringify(out)); }
      catch { send(res, 400, JSON.stringify({ ok: false, error: "Not a valid change" })); }
    });
    return;
  }
  // What each filing is (name, country, orbit, frequencies), for people. Display only; no result depends on it.
  const fl = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)\/filings$/);
  if (fl) {
    const r = runs.get(fl[1]);
    if (!r) return send(res, 404, JSON.stringify({ error: "No such run" }));
    try { const f = await filings.get(runsDir, r.id, r.engine); return f ? send(res, 200, JSON.stringify(f)) : send(res, 404, JSON.stringify({ error: "The database is not kept for this run" })); }
    catch (e) { return send(res, 500, JSON.stringify({ error: String(e) })); }
  }
  // The report's files, to download: report.csv and report.md as the engine wrote them, and report.xlsx, the same
  // rows as report.csv in a spreadsheet (built here from the CSV; nothing is added or worked out).
  const rf = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)\/report\/(report\.(?:csv|md|xlsx))$/);
  if (rf) {
    const r = runs.get(rf[1]);
    if (!r) return send(res, 404, JSON.stringify({ error: "No such run" }));
    const csv = join(runsDir, r.id, r.engine, "report.csv"), want = join(runsDir, r.id, r.engine, rf[2]);
    const base = r.file.name.replace(/\.(zip|mdb)$/i, "").replace(/[^\w.-]+/g, "_");
    const head = (type: string, ext: string) => ({ "content-type": type, "cache-control": "no-store", "content-disposition": `${url.searchParams.has("view") ? "inline" : "attachment"}; filename="${base}-report.${ext}"` });
    if (rf[2] === "report.xlsx") {
      if (!existsSync(csv)) return send(res, 404, JSON.stringify({ error: "This run has no report yet" }));
      res.writeHead(200, head("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"));
      return res.end(xlsxFromCsv(readFileSync(csv, "utf8"), (r.result as any)?.kind === "terrestrial" ? "Stations" : "Filings"));
    }
    if (!existsSync(want)) return send(res, 404, JSON.stringify({ error: "This run has no report yet" }));
    res.writeHead(200, head(rf[2].endsWith(".csv") ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8", rf[2].split(".").pop()!));
    return res.end(readFileSync(want));
  }
  const ag = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)\/agree$/);
  if (ag && req.method === "POST") { const r = runs.get(ag[1]); req.resume(); return r ? send(res, 200, JSON.stringify(view(runs.agree(r)))) : send(res, 404, JSON.stringify({ error: "No such run" })); }
  const again = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)\/again$/);
  if (again && req.method === "POST") {
    const r = runs.get(again[1]);
    req.resume();
    return r ? send(res, 200, JSON.stringify(view(runs.again(r, url.searchParams.get("engine") ?? r.engine)))) : send(res, 404, JSON.stringify({ error: "No such run" }));
  }
  const rb = url.pathname.match(/^\/api\/rulebook\/([a-z-]+)$/);
  if (rb) {
    const f = join(root, "spec", "rulebook", `${rb[1]}.json`);
    return existsSync(f) ? send(res, 200, readFileSync(f, "utf8")) : send(res, 404, JSON.stringify({ error: "No such rulebook" }));
  }
  // Tests: timed runs of every engine on the samples, kept on this computer.
  if (url.pathname === "/api/tests" && req.method === "GET") return send(res, 200, JSON.stringify({ ...tests.view(), reference: referenceBenchmarks }));
  if (url.pathname === "/api/tests/run" && req.method === "POST") return send(res, 200, JSON.stringify({ ...tests.start(), reference: referenceBenchmarks }));
  if (url.pathname === "/api/samples") {
    return send(res, 200, JSON.stringify(samples.map((p) => ({ name: p.split("/").pop(), bytes: statSync(p).size }))));
  }
  if (url.pathname === "/api/runs" && req.method === "GET") return send(res, 200, JSON.stringify(runs.list()));
  if (url.pathname === "/api/runs" && req.method === "POST") {
    const engine = url.searchParams.get("engine") ?? engines[0].id;
    if (!engines.some((e) => e.id === engine)) return send(res, 400, JSON.stringify({ error: "No such engine" }));
    const local = url.searchParams.get("path");
    if (local) {
      req.resume();
      if (hosted) return send(res, 403, JSON.stringify({ error: "Server file paths are disabled in the hosted app" }));
      if (!/\.(zip|mdb)$/i.test(local) || !existsSync(local) || !statSync(local).isFile()) return send(res, 400, JSON.stringify({ error: "Give the full path of an existing .zip or .mdb file." }));
      return send(res, 200, JSON.stringify(view(runs.start(local, local.split("/").pop() ?? local, "dropped", engine))));
    }
    const sample = url.searchParams.get("sample");
    if (sample) {
      const p = samples.find((x) => x.split("/").pop() === sample);
      req.resume();
      return p ? send(res, 200, JSON.stringify(view(runs.start(p, sample, "sample", engine)))) : send(res, 404, JSON.stringify({ error: "No such sample" }));
    }
    // Store uploads under an internal filename. The supplied name is display metadata only.
    let name: string;
    try {
      name = decodeURIComponent(String(req.headers["x-file-name"] ?? "upload")).slice(0, 200);
    } catch {
      req.resume();
      return send(res, 400, JSON.stringify({ error: "Invalid filename" }));
    }
    if (Number(req.headers["content-length"]) > MAX_UPLOAD) {
      req.resume();
      return send(res, 413, JSON.stringify({ error: `Upload exceeds ${Math.floor(MAX_UPLOAD / 1048576)} MiB` }));
    }
    const dir = join(runsDir, "uploads", randomBytes(8).toString("hex"));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, "input.zip");
    const out = createWriteStream(path);
    let size = 0;
    let failed = false;
    const fail = (status: number, error: string) => {
      if (failed) return;
      failed = true;
      req.unpipe(out);
      out.destroy();
      req.resume();
      if (!res.destroyed) send(res, status, JSON.stringify({ error }));
    };
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD) fail(413, "Upload exceeds the size limit");
    });
    req.on("error", () => fail(400, "The upload did not finish"));
    req.on("aborted", () => fail(400, "The upload was interrupted"));
    out.on("error", () => fail(500, "The server could not save the upload"));
    out.on("close", () => {
      if (failed) rmSync(dir, { recursive: true, force: true });
    });
    out.on("finish", () => {
      if (!failed) send(res, 200, JSON.stringify(view(runs.start(path, name || "upload.zip", "dropped", engine))));
    });
    req.pipe(out);
    return;
  }
  const rm = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)$/);
  if (rm) {
    const r = runs.get(rm[1]);
    return r ? send(res, 200, JSON.stringify(view(r, Number(url.searchParams.get("since") ?? 0)))) : send(res, 404, JSON.stringify({ error: "No such run" }));
  }
  const m = url.pathname.match(/^\/api\/engines\/([a-z]+)\/info$/);
  if (m) {
    const e = configuredEngines.find((x) => x.id === m[1]);
    if (!e) return send(res, 404, JSON.stringify({ error: "No such engine" }));
    const info = hosted ? (await engineInfo()).find((answer) => answer.id === e.id) : await ask(e, "info");
    return send(res, 200, JSON.stringify(info));
  }
  const file = join(root, "ui", "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(join(root, "ui", "public")) || !existsSync(file)) return send(res, 404, "Not found", "text/plain");
  send(res, 200, readFileSync(file, "utf8"), types[extname(file)] ?? "application/octet-stream");
}).listen(PORT, hosted ? "0.0.0.0" : "127.0.0.1", () => console.log(`Tosi listening on port ${PORT}`));
