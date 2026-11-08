# MCP server

Tosi's MCP server lets an assistant (Claude Code, Claude Desktop, or any MCP client) work with Tosi: read, run and monitor the pipeline, read the guidebook and the algorithm, and **propose** changes to what Tosi reads. It talks to the running Tosi server, so it sees exactly what the interface sees.

It never produces or changes a result, and it cannot change the rules: a proposal waits for a person to accept or decline it (guidebook P-5). While the algorithm is read-only, proposals cannot be accepted at all.

## Set up

```
cd mcp && npm install
npm run dev            # in the repository root: Tosi must be running
```

Then add it to your assistant. For Claude Code:

```
claude mcp add tosi -- node /full/path/to/tosi/mcp/server.ts
```

For Claude Desktop, add to its MCP settings:

```json
{ "mcpServers": { "tosi": { "command": "node", "args": ["/full/path/to/tosi/mcp/server.ts"] } } }
```

`TOSI_URL` changes where it looks for Tosi (default `http://127.0.0.1:5170`).

## Tools

| Tool | What it does |
|---|---|
| `tosi_status` | Engines and whether they run, rulebook and guidebook versions, files loaded |
| `tosi_list_runs`, `tosi_get_run` | The files loaded, and one file's result: kind, accepted or not and why, relevant tables, engine time, rulebook version |
| `tosi_list_samples`, `tosi_run_sample`, `tosi_run_file`, `tosi_run_again` | Process a sample, a file on this computer, or the same file again |
| `tosi_wait_run` | Follow a run until it finishes, then summarise it |
| `tosi_check_agreement` | Run a finished file through the other two engines, so their results can be compared |
| `tosi_get_guidebook` | Principles, concerns, methods, data rules, known limits, the concern ladder |
| `tosi_get_algorithm` | The steps for space or terrestrial filings: what each asks, applies and needs |
| `tosi_get_rulebook`, `tosi_rulebook_history` | What intake reads, which steps need each table, what is needed but not read; past changes |
| `tosi_propose_change`, `tosi_list_proposals` | Propose a change with a reason; see proposals and their state |

## Check it

`node smoke.ts` (with Tosi running) connects with the SDK's own client, runs Terrestrial 3076, reads the algorithm and guidebook, and makes one proposal.
