// Tosi local server. Serves the interface and starts engines as separate processes.
// It holds no stage logic: it asks an engine and passes on what the engine printed.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, createWriteStream } from "node:fs";
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT ?? 5170);

type Engine = { id: string; name: string; cwd: string; cmd: string; args: string[]; build?: string };
const engines: Engine[] = JSON.parse(readFileSync(join(root, "engines", "engines.json"), "utf8")).engines;

// This machine's settings (dev/local.json, never committed): sample files and where runs go.
const local = existsSync(join(root, "dev", "local.json")) ? JSON.parse(readFileSync(join(root, "dev", "local.json"), "utf8")) : {};
const samples: string[] = (local.samples ?? []).filter((p: string) => existsSync(p));
const runsDir = join(root, local.runs ?? "runs");
const library = makeLibrary(root, local.library ?? "library");
const runs = makeRuns(root, engines, runsDir, (run) => { try { library.add(run, JSON.parse(readFileSync(join(root, "spec", "rulebook", "intake.json"), "utf8"))); } catch (e) { console.error("library:", e); } });
const tests = makeTests(root, engines, samples, (p, e) => runs.bench(p, e));
const rulebook = makeRulebook(root);
const proposals = makeProposals(root, rulebook.apply);
const filings = makeFilings(root);
runs.clear();
const MAX_UPLOAD = 2_000_000_000;
// The algorithm is read-only unless this machine's settings say otherwise. Editing comes back with drafts and Save.
const EDITING = local.editing === true;
const LOCKED = JSON.stringify({ ok: false, error: "The algorithm is read-only. Editing will return with drafts and a Save button." });

type Answer = { id: string; name: string; ok: boolean; ms: number; info?: unknown; error?: string; hint?: string };

// Fields every engine-info document must have (spec/schemas/engine-info.schema.json).
const required = JSON.parse(readFileSync(join(root, "spec", "schemas", "engine-info.schema.json"), "utf8")).required as string[];

function ask(e: Engine, command: string): Promise<Answer> {
  const base = { id: e.id, name: e.name };
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

if (process.argv.includes("--check")) {
  const all = await Promise.all(engines.map((e) => ask(e, "info")));
  for (const a of all) console.log(`${a.ok ? "ok  " : "FAIL"} ${a.name.padEnd(10)} ${String(a.ms).padStart(4)} ms  ${a.ok ? JSON.stringify(a.info) : a.error}`);
  process.exit(all.every((a) => a.ok) ? 0 : 1);
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/api/engines") {
    return send(res, 200, JSON.stringify(await Promise.all(engines.map((e) => ask(e, "info")))));
  }
  if (url.pathname === "/api/about") {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return send(res, 200, JSON.stringify({ tosi: pkg.version, editing: EDITING, spec: readFileSync(join(root, "spec", "VERSION"), "utf8").trim(), server: `Node ${process.versions.node}`, engines: engines.map((e) => ({ id: e.id, name: e.name })) }));
  }
  // Proposals: how anything but a person changes the rulebook. A person accepts or declines.
  const readBody = (cb: (v: any) => void) => { let b = ""; req.on("data", (d) => { b += d; if (b.length > 50000) req.destroy(); }); req.on("end", () => { try { cb(JSON.parse(b || "{}")); } catch { send(res, 400, JSON.stringify({ error: "Not valid JSON" })); } }); };
  if (url.pathname === "/api/proposals" && req.method === "GET") return send(res, 200, JSON.stringify(proposals.list()));
  if (url.pathname === "/api/proposals" && req.method === "POST") {
    return readBody((b) => { const p = proposals.add(b.change, b.why, b.by); send(res, "error" in p ? 400 : 200, JSON.stringify(p)); });
  }
  const pd = url.pathname.match(/^\/api\/proposals\/([0-9a-f]+)\/(accept|decline)$/);
  if (pd && req.method === "POST" && pd[2] === "accept" && !EDITING) { req.resume(); return send(res, 423, LOCKED); }
  if (pd && req.method === "POST") { req.resume(); const p = proposals.decide(pd[1], pd[2] === "accept"); return send(res, "error" in p ? 400 : 200, JSON.stringify(p)); }
  // The assistant: a chat model that can only propose. Not connected yet; the interface says so.
  if (url.pathname === "/api/assistant" && req.method === "POST") {
    return readBody(() => send(res, 200, JSON.stringify({ connected: false, reply: "No model is connected yet. You can already drive Tosi from an assistant through its MCP server (see mcp/README.md); anything it wants to change appears below as a proposal for you to accept or decline.", proposals: [] })));
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
  if (url.pathname === "/api/tests" && req.method === "GET") return send(res, 200, JSON.stringify(tests.view()));
  if (url.pathname === "/api/tests/run" && req.method === "POST") return send(res, 200, JSON.stringify(tests.start()));
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
      if (!/\.(zip|mdb)$/i.test(local) || !existsSync(local) || !statSync(local).isFile()) return send(res, 400, JSON.stringify({ error: "Give the full path of an existing .zip or .mdb file." }));
      return send(res, 200, JSON.stringify(view(runs.start(local, local.split("/").pop() ?? local, "dropped", engine))));
    }
    const sample = url.searchParams.get("sample");
    if (sample) {
      const p = samples.find((x) => x.split("/").pop() === sample);
      req.resume();
      return p ? send(res, 200, JSON.stringify(view(runs.start(p, sample, "sample", engine)))) : send(res, 404, JSON.stringify({ error: "No such sample" }));
    }
    // A dropped file: stream it to disk as it arrives, then start the run.
    const name = decodeURIComponent(String(req.headers["x-file-name"] ?? "upload")).replace(/[\\/]/g, "_").slice(0, 200) || "upload";
    const dir = join(runsDir, "uploads", randomBytes(5).toString("hex"));
    mkdirSync(dir, { recursive: true });
    const path = join(dir, name);
    let size = 0, tooBig = false;
    const out = createWriteStream(path);
    req.on("data", (d) => { size += d.length; if (size > MAX_UPLOAD && !tooBig) { tooBig = true; req.destroy(); } });
    req.pipe(out);
    out.on("finish", () => tooBig ? send(res, 413, JSON.stringify({ error: "The file is larger than 2 GB." })) : send(res, 200, JSON.stringify(view(runs.start(path, name, "dropped", engine)))));
    req.on("error", () => send(res, 400, JSON.stringify({ error: "The upload did not finish." })));
    return;
  }
  const rm = url.pathname.match(/^\/api\/runs\/([0-9a-f]+)$/);
  if (rm) {
    const r = runs.get(rm[1]);
    return r ? send(res, 200, JSON.stringify(view(r, Number(url.searchParams.get("since") ?? 0)))) : send(res, 404, JSON.stringify({ error: "No such run" }));
  }
  const m = url.pathname.match(/^\/api\/engines\/([a-z]+)\/info$/);
  if (m) {
    const e = engines.find((x) => x.id === m[1]);
    return e ? send(res, 200, JSON.stringify(await ask(e, "info"))) : send(res, 404, JSON.stringify({ error: "No such engine" }));
  }
  const file = join(root, "ui", "public", url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(join(root, "ui", "public")) || !existsSync(file)) return send(res, 404, "Not found", "text/plain");
  send(res, 200, readFileSync(file, "utf8"), types[extname(file)] ?? "application/octet-stream");
}).listen(PORT, "127.0.0.1", () => console.log(`Tosi on http://127.0.0.1:${PORT}`));
