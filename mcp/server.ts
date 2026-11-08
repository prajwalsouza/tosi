// Tosi's MCP server. It drives Tosi through the local server's API (TOSI_URL, default http://127.0.0.1:5170),
// so an assistant sees exactly what the interface sees. It can read, run and monitor the pipeline and read the
// guidebook, the algorithm and the rulebook. It cannot change the rules directly: it proposes, and a person accepts
// or declines in the Algorithm page (guidebook P-5, rules change by review). It never produces or alters a result.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.TOSI_URL ?? "http://127.0.0.1:5170").replace(/\/$/, "");
const NAMES: Record<string, string> = { ts: "TypeScript", rust: "Rust", python: "Python" };

async function api(path: string, init?: RequestInit): Promise<any> {
  let res: Response;
  try { res = await fetch(BASE + path, init); }
  catch { throw new Error(`Tosi is not running at ${BASE}. Start it with \`npm run dev\` in the Tosi repository.`); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Tosi answered ${res.status}`);
  return body;
}
const text = (v: unknown) => ({ content: [{ type: "text" as const, text: typeof v === "string" ? v : JSON.stringify(v, null, 2) }] });
const fail = (e: unknown) => ({ isError: true, content: [{ type: "text" as const, text: e instanceof Error ? e.message : String(e) }] });
const tool = <T,>(fn: (a: T) => Promise<unknown>) => async (a: T) => { try { return text(await fn(a)); } catch (e) { return fail(e); } };

// A run, summarised for an assistant: what the file is, what was decided, under which rules, how long it took.
async function summary(id: string) {
  const [d, rules] = await Promise.all([api(`/api/runs/${id}`), api("/api/rulebook/intake")]);
  const r = d.result;
  const kind = r?.kind && r.kind !== "unknown" ? rules.kinds[r.kind] : null;
  const present = new Map((r?.database?.tables ?? []).map((t: any) => [t.name, t]));
  const last = d.events?.filter((e: any) => e.event === "step").at(-1);
  const engines = Object.fromEntries(Object.entries(d.engines ?? {}).filter(([, e]: any) => e.state !== "idle")
    .map(([k, e]: any) => [NAMES[k] ?? k, { state: e.state, seconds: e.ms != null ? e.ms / 1000 : e.started ? (Date.now() - e.started) / 1000 : null, result_sha256: e.sha256 ?? null }]));
  const hashes = Object.values(d.engines ?? {}).map((e: any) => e.sha256).filter(Boolean);
  return {
    id: d.id, file: d.file, engine: NAMES[d.engine] ?? d.engine, state: d.state,
    current_step: d.state === "running" && last ? `${last.step} ${last.state}${last.total ? ` (${last.done ?? 0} of ${last.total})` : ""}` : null,
    engines,
    engines_agree: hashes.length > 1 ? new Set(hashes).size === 1 : null,
    result: r ? {
      kind: r.kind, accepted: r.check.status === "accepted", reason: r.check.reason, missing: r.check.missing,
      file_sha256: r.file.sha256, tables: r.database?.tables.length ?? 0, rows: r.database?.rows ?? 0,
      rulebook_version: r.rulebook.version, rulebook_is_current: r.rulebook.version === rules.version,
      relevant_tables: kind ? Object.entries(kind.tables).filter(([, t]: any) => t.read).map(([n, t]: any) => ({ table: n, name: t.alias ?? null, rows: (present.get(n) as any)?.rows ?? null, present: present.has(n) })) : [],
    } : null,
    downlink: d.downlink ? { filings: d.downlink.counts.notices, kept: d.downlink.counts.kept, left: d.downlink.counts.left, rulebook_version: d.downlink.rulebook.version } : null,
    reach: d.reach ? { filings: d.reach.counts.notices, seen_from_finland: d.reach.counts.seen, clear: d.reach.counts.clear, by_outcome: d.reach.counts.how, rulebook_version: d.reach.rulebook.version } : null,
  };
}

const server = new McpServer({ name: "tosi", version: "0.0.1" }, {
  instructions: "Tosi screens ITU filings against a country's spectrum use, deterministically. Use these tools to see what Tosi is doing, run files, read its guidebook (the rules every module follows) and its algorithm (the steps and the tables they need). To change what Tosi reads, propose a change with a reason; a person accepts or declines it. Never present a proposal as applied.",
});

/* ---------- the pipeline ---------- */
server.registerTool("tosi_status", { title: "Tosi status", description: "Engines, which are running, the rulebook and guidebook versions, and how many files are loaded.", annotations: { readOnlyHint: true } },
  tool(async () => {
    const [engines, rules, gb, runs] = await Promise.all([api("/api/engines"), api("/api/rulebook/intake"), api("/api/guidebook"), api("/api/runs")]);
    return { engines: engines.map((e: any) => ({ engine: e.name, running: e.ok, version: e.info?.version, stages: e.info?.stages ?? [], error: e.error ?? null })),
      rulebook_version: rules.version, guidebook_version: gb.version, files_loaded: runs.length };
  }));

server.registerTool("tosi_list_runs", { title: "List files", description: "Every file loaded in this session, with its state.", annotations: { readOnlyHint: true } },
  tool(async () => (await api("/api/runs")).map((r: any) => ({ id: r.id, file: r.file.name, megabytes: +(r.file.bytes / 1e6).toFixed(1), source: r.file.source, engine: NAMES[r.engine] ?? r.engine, state: r.state }))));

server.registerTool("tosi_get_run", { title: "Read a file's result", description: "What intake found in one file: its kind, whether it was accepted and why, the relevant tables, the engine's time and the rulebook version used. Include tables=true for every table in the file.",
  inputSchema: { id: z.string().describe("Run id from tosi_list_runs"), tables: z.boolean().optional().describe("Also list every table with its rows and columns") }, annotations: { readOnlyHint: true } },
  tool(async ({ id, tables }: { id: string; tables?: boolean }) => {
    const s = await summary(id);
    if (!tables) return s;
    const d = await api(`/api/runs/${id}`);
    return { ...s, all_tables: d.result?.database?.tables.map((t: any) => ({ table: t.name, rows: t.rows, columns: t.columns })) ?? [] };
  }));

server.registerTool("tosi_get_stage", { title: "Read a stage, filing by filing", description: "One space stage's decision for every filing: downlink (does it send signals down?) or reach (can it be seen from Finland?), with the reason or outcome and, for reach, the angles behind it. Includes the plain wording of every reason or outcome.",
  inputSchema: { id: z.string().describe("Run id from tosi_list_runs"), stage: z.enum(["downlink", "reach"]).describe("Which stage") }, annotations: { readOnlyHint: true } },
  tool(async ({ id, stage }: { id: string; stage: "downlink" | "reach" }) => {
    const [d, rules] = await Promise.all([api(`/api/runs/${id}`), api(`/api/rulebook/${stage}`)]);
    if (!d[stage]) return `No ${stage} result for this file: it runs only on an accepted space filing, after the stages before it.`;
    return { counts: d[stage].counts, rulebook: d[stage].rulebook, wording: rules.reasons ?? rules.outcomes, filings: d[stage].notices };
  }));

const engineArg = z.enum(["ts", "rust", "python"]).optional().describe("Engine to use: ts, rust or python. Defaults to rust.");
server.registerTool("tosi_list_samples", { title: "List samples", description: "The sample files this machine offers.", annotations: { readOnlyHint: true } },
  tool(async () => api("/api/samples")));
server.registerTool("tosi_run_sample", { title: "Run a sample", description: "Process one of the sample files. Returns the run id; use tosi_wait_run to follow it.",
  inputSchema: { name: z.string().describe("Sample file name, e.g. ific3074.zip"), engine: engineArg } },
  tool(async ({ name, engine }: { name: string; engine?: string }) => { const r = await api(`/api/runs?sample=${encodeURIComponent(name)}&engine=${engine ?? "rust"}`, { method: "POST" }); return { id: r.id, file: r.file.name, state: r.state }; }));
server.registerTool("tosi_run_file", { title: "Run a file", description: "Process an IFIC .zip or .mdb from this computer, given its full path.",
  inputSchema: { path: z.string().describe("Full path to a .zip or .mdb"), engine: engineArg } },
  tool(async ({ path, engine }: { path: string; engine?: string }) => { const r = await api(`/api/runs?path=${encodeURIComponent(path)}&engine=${engine ?? "rust"}`, { method: "POST" }); return { id: r.id, file: r.file.name, state: r.state }; }));
server.registerTool("tosi_run_again", { title: "Run a file again", description: "Process the same file again, for example after the rulebook changed, or in another engine.",
  inputSchema: { id: z.string(), engine: engineArg } },
  tool(async ({ id, engine }: { id: string; engine?: string }) => { const r = await api(`/api/runs/${id}/again${engine ? `?engine=${engine}` : ""}`, { method: "POST" }); return { id: r.id, file: r.file.name, state: r.state }; }));
server.registerTool("tosi_check_agreement", { title: "Check engines agree", description: "Run the same finished file through the other two engines, one at a time, so their results can be compared byte for byte. Follow it with tosi_wait_run.",
  inputSchema: { id: z.string() } },
  tool(async ({ id }: { id: string }) => { await api(`/api/runs/${id}/agree`, { method: "POST" }); return "Started. The other engines run one at a time; tosi_wait_run with agreement=true waits for them."; }));
server.registerTool("tosi_wait_run", { title: "Follow a run", description: "Wait until a run finishes (or until timeout), then return its summary. With agreement=true, also wait for an agreement check.",
  inputSchema: { id: z.string(), timeout_seconds: z.number().min(1).max(600).optional(), agreement: z.boolean().optional() }, annotations: { readOnlyHint: true } },
  tool(async ({ id, timeout_seconds, agreement }: { id: string; timeout_seconds?: number; agreement?: boolean }) => {
    const until = Date.now() + (timeout_seconds ?? 120) * 1000;
    for (;;) {
      const d = await api(`/api/runs/${id}`);
      const busy = d.state === "running" || (agreement && Object.values(d.engines).some((e: any) => e.state === "running" || e.state === "waiting"));
      if (!busy || Date.now() > until) return { ...(await summary(id)), timed_out: busy };
      await new Promise((r) => setTimeout(r, 1000));
    }
  }));

/* ---------- the rules ---------- */
server.registerTool("tosi_get_guidebook", { title: "Read the guidebook", description: "The rules every module follows: principles (P), concerns (C), methods (M), data rules (D), known limits (L) and the concern ladder. Filter by section letter or entry id.",
  inputSchema: { section: z.enum(["P", "C", "M", "D", "L"]).optional(), id: z.string().optional().describe("An entry id, e.g. C-2") }, annotations: { readOnlyHint: true } },
  tool(async ({ section, id }: { section?: string; id?: string }) => {
    const gb = await api("/api/guidebook");
    const entries = gb.entries.filter((e: any) => (!section || e.section === section) && (!id || e.id === id));
    return { version: gb.version, entries, ladder: id || section ? undefined : gb.ladder };
  }));
server.registerTool("tosi_get_algorithm", { title: "Read the algorithm", description: "The steps a filing goes through, in order, for space or terrestrial filings: what each asks, the guidebook entries it applies, the tables it needs, and whether it is built yet.",
  inputSchema: { kind: z.enum(["space", "terrestrial"]) }, annotations: { readOnlyHint: true } },
  tool(async ({ kind }: { kind: string }) => {
    const [gb, rules] = await Promise.all([api("/api/guidebook"), api("/api/rulebook/intake")]);
    return gb.steps.filter((s: any) => s.family.includes(kind)).map((s: any) => ({ step: s.id, name: s.short, asks: s.title, built: s.built, applies: s.cites, exit: s.exit ?? null,
      needs: s.reads.map((t: any) => ({ table: t, read_by_intake: !!rules.kinds[kind].tables[t]?.read })) }));
  }));
server.registerTool("tosi_get_rulebook", { title: "Read what intake reads", description: "For space or terrestrial filings: every table intake knows, whether it is read, its columns, its plain name, and the steps that need it; plus tables later steps need that are not read yet.",
  inputSchema: { kind: z.enum(["space", "terrestrial"]) }, annotations: { readOnlyHint: true } },
  tool(async ({ kind }: { kind: string }) => {
    const [gb, rules] = await Promise.all([api("/api/guidebook"), api("/api/rulebook/intake")]);
    const k = rules.kinds[kind], steps = gb.steps.filter((s: any) => s.family.includes(kind));
    const needBy = (t: string) => steps.filter((s: any) => s.reads.includes(t)).map((s: any) => s.short);
    const known = Object.entries(k.tables).map(([n, t]: any) => ({ table: n, name: t.alias ?? null, about: t.about ?? null, read: t.read, marker: k.markers.includes(n), columns: t.columns, needed_by: needBy(n) }));
    const wanted = [...new Set(steps.flatMap((s: any) => s.reads))].filter((t: any) => !k.tables[t]).map((t: any) => ({ table: t, needed_by: needBy(t) }));
    return { version: rules.version, recognised_by: k.markers, tables: known, needed_but_not_read: wanted };
  }));
server.registerTool("tosi_rulebook_history", { title: "Rulebook history", description: "Every change made to what intake reads, newest first, with its reason.", annotations: { readOnlyHint: true } },
  tool(async () => api("/api/rulebook/intake/changes")));

/* ---------- proposing changes: a person decides ---------- */
server.registerTool("tosi_propose_change", {
  title: "Propose a change to what Tosi reads",
  description: "Propose a change to the rulebook. It is NOT applied: it appears in Tosi's Algorithm page, where a person accepts or declines it. Fields: add (start reading a table), read (true or false), columns (the full list of required columns), alias (a plain name), about (a one-line description). A reason is required.",
  inputSchema: {
    kind: z.enum(["space", "terrestrial"]),
    table: z.string().regex(/^[A-Za-z0-9_]+$/),
    field: z.enum(["add", "read", "columns", "alias", "about"]),
    value: z.union([z.boolean(), z.string(), z.array(z.string())]).optional().describe("true/false for read; a list for columns; text for alias and about; omit for add"),
    why: z.string().min(3).describe("Why this change is needed. Kept with the change."),
    by: z.string().optional().describe("Who or what is proposing, e.g. the assistant's name"),
  },
}, tool(async ({ kind, table, field, value, why, by }: any) => {
  const p = await api("/api/proposals", { method: "POST", body: JSON.stringify({ change: { kind, table, field, value: field === "add" ? true : value }, why, by: by ?? "assistant via MCP" }) });
  return { proposal: p.id, state: p.state, note: "Waiting for a person to accept or decline it in Tosi's Algorithm page." };
}));
server.registerTool("tosi_list_proposals", { title: "List proposals", description: "Proposed rulebook changes and whether each was accepted, declined or is still waiting.", annotations: { readOnlyHint: true } },
  tool(async () => api("/api/proposals")));

await server.connect(new StdioServerTransport());
