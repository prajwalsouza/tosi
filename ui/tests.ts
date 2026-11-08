// Tests: time every engine on the sample files, step by step, and keep the result on this computer.
// The Tests page reads it to compare engines and to estimate how long a larger file might take.
import { cpus, totalmem } from "node:os";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Engine } from "./runs.ts";

const REPEAT = 3;
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

type Bench = (path: string, engineId: string) => Promise<{ state: string; ms?: number; error?: string; events: any[]; times: Record<string, { ms: number }> }>;

export function makeTests(root: string, engines: Engine[], samples: string[], bench: Bench) {
  const dir = join(root, "bench"), file = join(dir, "results.json");
  let last = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  let progress: null | { done: number; total: number; now: string } = null;

  // Each step's time is the gap between its start and done events, as the engine reported them.
  function steps(events: any[]) {
    const open: Record<string, number> = {}, out: Record<string, number> = {};
    for (const ev of events) {
      if (ev.event !== "step") continue;
      if (ev.state === "start") open[ev.step] = ev.t;
      if (ev.state === "done" && open[ev.step] != null) out[ev.step] = (out[ev.step] ?? 0) + ev.t - open[ev.step];
    }
    return out;
  }

  async function run() {
    const jobs = samples.flatMap((s) => engines.map((e) => ({ s, e })));
    progress = { done: 0, total: jobs.length, now: "" };
    const results = [];
    for (const { s, e } of jobs) {
      // Three runs; each step keeps its middle time, so one slow moment on the disk does not decide the result.
      const tries = [];
      for (let k = 0; k < REPEAT; k++) { progress.now = `${e.name} · ${basename(s)} · run ${k + 1} of ${REPEAT}`; tries.push(await bench(s, e.id)); }
      const r = tries.find((t) => t.state !== "done") ?? tries[0];
      const each = tries.map((t) => ({ st: steps(t.events), total: Object.values(t.times).reduce((a, b) => a + b.ms, 0) }));
      const names = [...new Set(each.flatMap((x) => Object.keys(x.st)))];
      const st = Object.fromEntries(names.map((n) => [n, median(each.map((x) => x.st[n] ?? 0))]));
      const total = median(each.map((x) => x.total));
      const dbBytes = r.events.find((x) => x.step === "database-fingerprint" && x.state === "start")?.total ?? null;
      const work = Object.values(st).reduce((a, b) => a + b, 0);
      results.push({ engine: e.id, runs: REPEAT, file: { name: basename(s), bytes: readSize(s), dbBytes }, state: r.state, error: r.error, total, steps: { ...st, start: Math.max(0, total - work) } });
      progress.done++;
    }
    last = { at: new Date().toISOString(), machine: { cpu: cpus()[0]?.model ?? "", cores: cpus().length, ram: totalmem() }, results };
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, JSON.stringify(last, null, 2));
    progress = null;
  }
  const readSize = (p: string) => { try { return statSync(p).size; } catch { return 0; } };

  return {
    view: () => ({ running: progress, last }),
    start() { if (!progress) run().catch((x) => { progress = null; console.error("tests:", x); }); return { running: progress, last }; },
  };
}
