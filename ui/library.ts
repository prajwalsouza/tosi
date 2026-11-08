// The library: one record for every file processed, kept on disk so it outlasts the server.
// A record says what the file was, which engine processed it and how long it took, which rulebook decided it,
// and what was found. It copies what the engine wrote; it never computes anything itself.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

export function makeLibrary(root: string, dir = "library") {
  const base = join(root, dir), files = join(base, "files");
  mkdirSync(files, { recursive: true });

  function add(run: any, rules: any) {
    const r = run.result, e = run.engines?.[run.engine] ?? {};
    // Keep the file itself, once per fingerprint, so it can be processed again later.
    let path = run.file.path;
    if (r?.file?.sha256 && run.file.source === "dropped" && existsSync(path)) {
      const keep = join(files, r.file.sha256 + extname(run.file.name).toLowerCase());
      if (!existsSync(keep)) copyFileSync(path, keep);
      path = keep;
    }
    const kind = r?.kind && rules.kinds?.[r.kind];
    const present = new Map((r?.database?.tables ?? []).map((t: any) => [t.name, t]));
    const record = {
      schema: "library/1",
      id: run.id,
      at: new Date(run.started).toISOString(),
      file: { name: run.file.name, bytes: run.file.bytes, sha256: r?.file?.sha256 ?? null, source: run.file.source },
      path,
      engine: run.engine,
      ms: e.ms ?? null,
      state: run.state,
      error: run.state === "failed" ? e.error ?? "failed" : null,
      rulebook: r?.rulebook ?? null,
      kind: r?.kind ?? "unknown",
      accepted: r?.check?.status === "accepted",
      reason: r?.check?.reason ?? null,
      tables: r?.database?.tables.length ?? 0,
      rows: r?.database?.rows ?? 0,
      relevant: kind ? Object.entries(kind.tables).filter(([, t]: any) => t.read).map(([n, t]: any) => ({ table: n, alias: t.alias ?? null, rows: (present.get(n) as any)?.rows ?? null, present: present.has(n) })) : [],
      stages: run.stages ?? {},
      downlink: run.downlink ? { counts: run.downlink.counts, rulebook: run.downlink.rulebook } : null,
      result: r ?? null,
    };
    writeFileSync(join(base, `${run.id}.json`), JSON.stringify(record, null, 2) + "\n");
    return record;
  }

  function list() {
    return readdirSync(base).filter((f) => f.endsWith(".json")).map((f) => {
      const { result, path, ...rest } = JSON.parse(readFileSync(join(base, f), "utf8"));
      return rest;
    }).sort((a, b) => b.at.localeCompare(a.at));
  }
  function get(id: string) {
    const f = join(base, `${id}.json`);
    if (!/^[0-9a-f]+$/.test(id) || !existsSync(f)) return null;
    return JSON.parse(readFileSync(f, "utf8"));
  }
  return { add, list, get };
}
