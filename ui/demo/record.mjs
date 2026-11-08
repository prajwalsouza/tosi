// Turns a recorded Codex run (codex exec --json, each line stamped with its arrival time) into the demo file the
// interface replays: ui/demo/codex-demo.json. Keeps the agent's messages and its calls to Tosi's MCP server with
// their results (trimmed), drops anything private (paths under /Users or /Volumes, emails, ids, tokens).
//   node ui/demo/record.mjs <stamped-events.jsonl> <prompt.txt> <meta.json> > ui/demo/codex-demo.json
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Where each event shows on the pages ("target"), so the replay can follow the agent. Derived from the real tool calls
// and Tosi's own step map (spec/guidebook/guidebook.json); none of the agent's words or calls are changed.
const gbook = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "spec", "guidebook", "guidebook.json"), "utf8"));
const STAGE_STEP = { downlink: "s1", reach: "s2", limit: "s3", data: "s4", power: "s5", compare: "s6", stations: "s7", mobile: "t1", range: "t2", tdata: "t3", field: "t4", threshold: "t5", tstations: "t6" };
const kindSteps = (kind) => gbook.steps.filter((s) => s.family.includes(kind) && (s.id[0] === kind[0])).map((s) => s.id);
function target(tool, args, phase, proposal) {
  if (tool === "tosi_get_algorithm") return { page: "algorithm", kind: args.kind, steps: kindSteps(args.kind), label: `the ${args.kind} steps` };
  if (tool === "tosi_get_parameters") {
    if (args.stage) return { page: "algorithm", kind: STAGE_STEP[args.stage][0] === "t" ? "terrestrial" : "space", step: STAGE_STEP[args.stage], label: `${args.stage} parameters` };
    // By hand: the call read every step's parameters; the replay shows the terrestrial ones, which the prompt is about.
    const steps = Object.values(STAGE_STEP).filter((id) => id[0] === "t");
    return { page: "algorithm", kind: "terrestrial", steps, params: true, label: "the terrestrial steps' parameters", by_hand: "the tool read every step; the replay shows the terrestrial steps the prompt asks about" };
  }
  if (tool === "tosi_get_guidebook") {
    if (args.id) return { page: "guidebook", entries: [args.id], label: args.id };
    // By hand: the call read the whole guidebook; the replay shows the entries the terrestrial steps apply.
    const entries = [...new Set(gbook.steps.filter((s) => s.id[0] === "t").flatMap((s) => s.cites))];
    return { page: "guidebook", entries, label: "the entries the terrestrial steps apply", by_hand: "the tool read the whole guidebook; the replay shows the entries the terrestrial steps apply" };
  }
  if (tool === "tosi_propose_parameter" && phase === "start") return { page: "guidebook", entries: args.cites ?? [], cite: true, label: (args.cites ?? []).join(", ") };
  if (tool === "tosi_propose_parameter" && proposal) return { page: "algorithm", kind: proposal.step[0] === "t" ? "terrestrial" : "space", step: proposal.step, stage: proposal.stage, parameter: proposal.parameter, label: `${proposal.step_name}, ${proposal.parameter}` };
  return null;
}

const [eventsFile, promptFile, metaFile] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(metaFile, "utf8"));
const lines = readFileSync(eventsFile, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const clean = (s) => String(s)
  .replace(/\/Users\/[^\s"'`)\]]*/g, "<path>").replace(/\/Volumes\/[^\s"'`)\]]*/g, "<path>").replace(/\/private\/[^\s"'`)\]]*/g, "<path>")
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
  .replace(/\b(sk|ghp|gho|xox[abp])-[A-Za-z0-9_-]{10,}/g, "<token>");
const TRIM = 1500;
const trim = (s) => (s.length > TRIM ? s.slice(0, TRIM) + `\n… (${s.length - TRIM} more characters, trimmed)` : s);

function summary(tool, args, text) {
  let v; try { v = JSON.parse(text); } catch { return null; }
  if (tool === "tosi_get_algorithm") return `${v.length} steps for ${args.kind} filings, ${v.filter((s) => s.built).length} built`;
  if (tool === "tosi_get_parameters") return v.stages ? `${v.stages.length} steps with parameters, ${v.stages.reduce((n, s) => n + s.parameters.filter((p) => !p.fixed).length, 0)} that can change` : `${v.parameters.length} parameters of ${v.stage}`;
  if (tool === "tosi_get_guidebook") return `Guidebook version ${v.version}, ${v.entries.length} entries`;
  if (tool === "tosi_status") return `Rulebook version ${v.rulebook_version}`;
  return null;
}

const t0 = lines.find((l) => l.event.type === "turn.started")?.t ?? 0;
const steps = [];
let usage = null;
for (const { t, event: e } of lines) {
  const it = e.item, at = Math.max(0, t - t0);
  if (e.type === "turn.completed") usage = e.usage;
  if (!it) continue;
  if (it.type === "agent_message" && e.type === "item.completed") steps.push({ t: at, kind: "message", text: clean(it.text) });
  if (it.type === "reasoning" && e.type === "item.completed" && it.text) steps.push({ t: at, kind: "reasoning", text: clean(it.text) });
  if (it.type === "mcp_tool_call") {
    const args = JSON.parse(clean(JSON.stringify(it.arguments ?? {})));
    if (e.type === "item.started") steps.push({ t: at, kind: "tool", id: it.id, server: it.server, tool: it.tool, args, target: target(it.tool, args, "start") });
    if (e.type === "item.completed") {
      const text = clean(it.result?.content?.map((c) => c.text ?? "").join("\n") ?? "");
      const ok = !it.error && !it.result?.isError;
      const step = { t: at, kind: "tool_done", id: it.id, server: it.server, tool: it.tool, args, ok, result: trim(text), error: it.error ? clean(it.error.message) : ok ? null : trim(text) };
      if (ok) step.summary = summary(it.tool, args, text);
      if (ok && it.tool === "tosi_propose_parameter") {
        const p = JSON.parse(text);
        step.proposal = { id: p.id, stage: p.stage, step: p.step, step_name: p.step_name, parameter: p.parameter, from: p.from, to: p.to, why: p.why, cites: p.cites, source: p.source,
          stage_version: p.stage_version, test_version: p.test_version, saved: p.saved,
          // "what" and "where" are in the MCP answer from now on; this recording predates them, so the recorder adds them.
          what: p.what ?? `${p.step_name} step, ${p.parameter}: ${p.from} → ${p.to}`, where: p.where ?? { page: "Algorithm", step: p.step, step_name: p.step_name, section: "Parameters", rulebook: `spec/rulebook/${p.stage}.json`, parameter: p.parameter, added_by: "recorder" } };
      }
      step.target = target(it.tool, args, "done", step.proposal);
      steps.push(step);
    }
  }
}

const out = {
  about: "A recorded session of Codex CLI using Tosi's MCP server in test-run mode (TOSI_TEST_RUN=1). Replayed by the interface as a demo run. Nothing in it was saved: the MCP server checked each proposal against a scratch copy and wrote nothing under spec/. The agent's messages, tool calls and results are as recorded (trimmed, private paths removed). Added by the recorder, not by the agent: 'target' on each tool event (where the replay shows it, derived from the tool call and Tosi's step map; entries marked by_hand are a display choice) and 'what'/'where' on proposals (the MCP server returns these itself since this recording).",
  recorded_at: meta.recorded_at, finished_at: meta.finished_at, duration_ms: lines.at(-1)?.t - t0,
  agent: meta.agent, model: meta.model, reasoning_effort: meta.reasoning_effort,
  mcp: { server: "tosi", mode: "test-run", sandbox: "read-only; shell disabled, so the agent could only use Tosi's tools" },
  command: meta.command,
  prompt: readFileSync(promptFile, "utf8").trim(),
  usage,
  steps,
};
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
