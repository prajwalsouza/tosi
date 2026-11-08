// A quick end-to-end check of the MCP server with the SDK's own client.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const c = new Client({ name: "check", version: "0" });
await c.connect(new StdioClientTransport({ command: "node", args: ["server.ts"], cwd: import.meta.dirname }));
const call = async (name: string, args: Record<string, unknown> = {}) => { const r: any = await c.callTool({ name, arguments: args }); return (r.isError ? "ERROR " : "") + r.content[0].text; };
console.log("tools:", (await c.listTools()).tools.map((t) => t.name).join(", "));
console.log("\n# status\n" + (await call("tosi_status")));
const run = JSON.parse(await call("tosi_run_sample", { name: "brific3076.zip", engine: "rust" }));
console.log("\n# run", run.id);
console.log("\n# wait\n" + (await call("tosi_wait_run", { id: run.id, timeout_seconds: 120 })).slice(0, 1500));
console.log("\n# algorithm (first 2 steps)\n" + JSON.stringify(JSON.parse(await call("tosi_get_algorithm", { kind: "space" })).slice(3, 5), null, 1));
console.log("\n# guidebook C-2\n" + (await call("tosi_get_guidebook", { id: "C-2" })).slice(0, 500));
const prop = await call("tosi_propose_change", { kind: "space", table: "orbit", field: "add", why: "Reach needs orbit inclination and apogee", by: "check script" });
console.log("\n# propose\n" + prop);
console.log("\n# proposals\n" + (await call("tosi_list_proposals")).slice(0, 400));
await c.close();
