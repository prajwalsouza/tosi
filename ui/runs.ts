// Runs: one file going through the pipeline. The server starts engines and relays what they report;
// it never computes anything itself. Each run is processed by the chosen engine first (that is what the
// Flow shows as it happens), then by the other two, so their results can be compared byte for byte.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type Engine = { id: string; name: string; cwd: string; cmd: string; args: string[] };
type EngineRun = { state: "idle" | "waiting" | "running" | "done" | "failed"; started?: number; ms?: number; sha256?: string; error?: string };
export type Run = {
  id: string;
  file: { name: string; bytes: number; source: "sample" | "dropped"; path: string };
  engine: string;
  stage: "intake";
  state: "running" | "done" | "failed";
  events: unknown[];
  result: unknown | null;
  engines: Record<string, EngineRun>;
  started: number;
};

export function makeRuns(root: string, engines: Engine[], runsDir: string) {
  const runs = new Map<string, Run>();
  // One engine at a time, across all runs, so the times shown are the engine's own and not shared with others.
  let chain: Promise<unknown> = Promise.resolve();
  const queue = <T,>(job: () => Promise<T>): Promise<T> => { const p = chain.then(job); chain = p.catch(() => {}); return p; };
  mkdirSync(runsDir, { recursive: true });

  function exec(e: Engine, run: Run, onEvent?: (ev: unknown) => void): Promise<EngineRun> {
    const out = join(runsDir, run.id, e.id);
    const cwd = join(root, e.cwd);
    const cmd = e.cmd.includes("/") ? join(cwd, e.cmd) : e.cmd;
    return new Promise((resolve) => {
      const t0 = performance.now();
      const p = spawn(cmd, [...e.args, "intake", "--file", run.file.path, "--name", run.file.name, "--out", out], { cwd });
      let buf = "", err = "";
      p.stderr.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          try { const ev = JSON.parse(line); if (ev.event) onEvent?.({ ...ev, t: Math.round(performance.now() - t0) }); else err += line; } catch { err += line; }
        }
      });
      p.stdout.on("data", () => {});
      p.on("error", (x) => resolve({ state: "failed", error: x.message }));
      p.on("close", (code) => {
        const ms = Math.round(performance.now() - t0);
        const f = join(out, "intake.json");
        if (code !== 0 || !existsSync(f)) return resolve({ state: "failed", ms, error: err.trim() || `exited with code ${code}` });
        resolve({ state: "done", ms, sha256: createHash("sha256").update(readFileSync(f)).digest("hex") });
      });
    });
  }

  // A run uses one engine: the one chosen. The others stay idle unless an agreement check is asked for.
  async function process(run: Run) {
    const first = engines.find((e) => e.id === run.engine) ?? engines[0];
    run.engines[first.id] = { state: "waiting" };
    const r = await queue(() => { run.engines[first.id] = { state: "running", started: Date.now() }; return exec(first, run, (ev) => run.events.push(ev)); });
    run.engines[first.id] = r;
    if (r.state !== "done") { run.state = "failed"; return; }
    run.result = JSON.parse(readFileSync(join(runsDir, run.id, first.id, "intake.json"), "utf8"));
    run.state = "done";
  }

  // On request: run the same file through the other engines, one at a time, and keep their result fingerprints.
  async function agree(run: Run) {
    for (const e of engines) {
      if (e.id === run.engine || run.engines[e.id]?.state === "running" || run.engines[e.id]?.state === "done") continue;
      run.engines[e.id] = { state: "waiting" };
    }
    for (const e of engines) {
      if (run.engines[e.id]?.state !== "waiting" || e.id === run.engine) continue;
      run.engines[e.id] = await queue(() => { run.engines[e.id] = { state: "running", started: Date.now() }; return exec(e, run); });
      rmSync(join(runsDir, run.id, e.id, "database.mdb"), { force: true });
    }
  }

  return {
    list: () => [...runs.values()].map(summary),
    get: (id: string) => runs.get(id),
    start(path: string, name: string, source: Run["file"]["source"], engine: string, fresh = false): Run {
      // A sample already loaded (and not failed) is reused rather than processed twice.
      if (source === "sample" && !fresh) { const same = [...runs.values()].find((r) => r.file.path === path && r.engine === engine && r.state !== "failed"); if (same) return same; }
      const id = randomBytes(5).toString("hex");
      const run: Run = {
        id, file: { name: name || basename(path), bytes: statSync(path).size, source, path },
        engine, stage: "intake", state: "running", events: [], result: null,
        engines: Object.fromEntries(engines.map((e) => [e.id, { state: "idle" }])), started: Date.now(),
      };
      runs.set(id, run);
      process(run).catch((x) => { run.state = "failed"; run.events.push({ event: "error", error: String(x) }); });
      return run;
    },
    // Process the same file again, for example after the rulebook changed. Always a fresh run.
    agree(r: Run) { if (r.state === "done") agree(r).catch(() => {}); return r; },
    again(r: Run, engine: string): Run { return this.start(r.file.path, r.file.name, r.file.source, engine, true); },
    clear() { runs.clear(); rmSync(runsDir, { recursive: true, force: true }); mkdirSync(runsDir, { recursive: true }); },
  };
}

export function summary(r: Run) {
  return { id: r.id, file: { name: r.file.name, bytes: r.file.bytes, source: r.file.source }, engine: r.engine, state: r.state, started: r.started };
}

// What the page sees: everything except the server's own file paths.
export function view(r: Run, since = 0) {
  // A dropped file is kept until the server stops, so it can be processed again.
  return { ...summary(r), stage: r.stage, events: r.events.slice(since), eventCount: r.events.length, result: r.result, engines: r.engines };
}
