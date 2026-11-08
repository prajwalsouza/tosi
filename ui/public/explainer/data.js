// The Play demo's data: real runs of the two sample issues, and the rulebooks and guidebook they cite.
// Nothing here is made up. A finished run of each sample is reused if the server has one; otherwise it is started,
// with the Rust engine, and the film waits on the scenes that need it (showing skeletons) until it is done.
const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
const SAMPLE = { sp: "ific3074.zip", te: "brific3076.zip" };

export function loadData(onChange) {
  const D = { sp: null, te: null, spRun: null, teRun: null, gb: null, rb: {}, changes: [], engines: [], finland: null, error: null };
  const changed = () => onChange?.(D);
  let stopped = false;

  // the rulebooks, the guidebook, the engines and Finland's outline: quick, and the same for every run
  const statics = Promise.all([
    get("/api/guidebook").then((g) => { D.gb = g; }),
    ...["ladder", "tladder", "intake", "limit", "power", "compare", "reach", "threshold", "field"].map((n) => get(`/api/rulebook/${n}`).then((r) => { D.rb[n] = r; })),
    get("/api/rulebook/intake/changes").then((c) => { D.changes = Array.isArray(c) ? c : []; }),
    get("/api/engines").then((e) => { D.engines = Array.isArray(e) ? e.map(({ id, name }) => ({ id, name })) : []; }),
    get("/finland.json").then((f) => { D.finland = f; }),
  ]).then(changed);

  // one run per sample: reuse a finished one, else one still working, else start one
  async function pick(key) {
    const list = (await get("/api/runs")) ?? [];
    const mine = list.filter((r) => r.file?.name === SAMPLE[key] && r.state !== "failed");
    let run = mine.find((r) => r.state === "done") ?? mine.find((r) => r.state === "running");
    if (!run) {
      run = await fetch(`/api/runs?engine=rust&sample=${encodeURIComponent(SAMPLE[key])}`, { method: "POST" }).then((r) => r.json()).catch(() => null);
      if (!run?.id) { D.error = "The sample files are not on this computer."; changed(); return; }
    }
    D[key + "Run"] = { id: run.id, state: run.state, stage: run.stage };
    changed();
    // follow it until it is done; `since` skips the event log, which the film does not need
    for (;;) {
      if (stopped) return;
      const v = await get(`/api/runs/${run.id}?since=1000000000`);
      if (v) {
        D[key + "Run"] = { id: v.id, state: v.state, stage: lastStage(v), engines: v.engines, engine: v.engine };
        if (v.state === "done") { D[key] = v; changed(); return v; }
        if (v.state === "failed") { D.error = "A sample could not be processed."; changed(); return; }
        changed();
      }
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  const lastStage = (v) => Object.keys(v.out ?? {}).pop() ?? v.stage;

  // The terrestrial sample is small, so its byte-for-byte check across the three engines is asked for when it is not done yet.
  // The film's engine scene shows what that check finds, as it finds it.
  async function agreement(v) {
    if (!v) return;
    const pending = () => Object.values(D.te?.engines ?? {}).some((e) => e.state !== "done");
    if (pending() && !Object.values(v.engines ?? {}).some((e) => e.state === "running" || e.state === "waiting")) {
      await fetch(`/api/runs/${v.id}/agree`, { method: "POST" }).catch(() => {});
    }
    while (!stopped && pending()) {
      await new Promise((r) => setTimeout(r, 1500));
      const w = await get(`/api/runs/${v.id}?since=1000000000`);
      if (w) { D.te = { ...D.te, engines: w.engines }; changed(); }
    }
  }

  const sp = pick("sp"), te = pick("te").then(agreement);
  D.ready = Promise.all([statics, sp, te]);
  D.stop = () => { stopped = true; };
  return D;
}

/* ---------- small readers over the real results ---------- */
export const out = (v, stage) => v?.out?.[stage] ?? null;
export const counts = (v, stage) => out(v, stage)?.counts ?? null;
/** a rulebook stamp, short: "version 2 · 951c9280" */
export const stamp = (r) => (r ? `version ${r.version} · ${String(r.sha256 ?? "").slice(0, 8)}` : "");
/** A rulebook's source in a few words: the part before its colon. */
export function citeShort(t) {
  const s = String(t ?? ""), m = s.match(/^As in spec\/rulebook\/[\w.]+ \((.+)\)\.?$/);
  if (m) return m[1];
  const i = s.indexOf(":");
  return (i > 0 && i < 110 ? s.slice(0, i) : s.split(/\.\s/)[0]).replace(/\.$/, "").trim();
}
