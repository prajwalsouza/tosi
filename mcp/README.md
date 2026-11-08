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
| `tosi_get_parameters` | The numbers each step's rulebook holds (margins, distances, heights, sample counts), with their basis; constants are marked fixed |
| `tosi_propose_change`, `tosi_list_proposals` | Propose a change to what intake reads, with a reason; see proposals and their state |
| `tosi_propose_parameter` | Propose a new value for one step parameter, as the next version of that step's rulebook, with a reason and its source (guidebook entries and/or a published source). The answer says what changes, where (page, step, section, rulebook file), from what to what, and why |

## Test runs: show what an assistant would do, change nothing

Set `TOSI_TEST_RUN=1` (or pass `test_run: true` to `tosi_propose_parameter`) and proposals are checked against a scratch copy of the rulebook held in memory, numbered as the next version of it (each one builds on the ones before), and written to a demo log only (`TOSI_TEST_LOG`, default `state/test-runs/<time>.jsonl`; never under `spec/`). Nothing reaches the server's proposals and nothing is saved. In this mode `tosi_propose_parameter` says it is read-only, so a client can run it without asking. Use it to demonstrate the capability on a server where no assistant can run for real.

The real path (no test run) is propose-only too: `tosi_propose_parameter` posts to `/api/proposals/parameter`, and the change is applied only when a person accepts it in Tosi, as the next version of that step's rulebook, logged in `spec/rulebook/changes.jsonl`. While the algorithm is read-only, nothing can be accepted.

### The recorded demo run

`ui/demo/codex-demo.json` is a real Codex CLI session against this server in test-run mode, replayed by the Algorithm and Guidebook pages as the "Demo run". To record a new one (a Tosi server on a spare port, an empty folder, read-only sandbox, shell off so the agent can only use Tosi's tools):

```
PORT=5172 TOSI_RUNS=$PWD/runs-demo node ui/server.ts &
codex exec --json --ephemeral --ignore-user-config --skip-git-repo-check -s read-only -C <empty folder> \
  --disable shell_tool --disable unified_exec --disable apps --disable plugins --disable memories \
  -c 'mcp_servers.tosi.command="node"' -c 'mcp_servers.tosi.args=["<tosi>/mcp/server.ts"]' \
  -c 'mcp_servers.tosi.startup_timeout_sec=60' \
  -c 'mcp_servers.tosi.env={TOSI_TEST_RUN="1",TOSI_URL="http://127.0.0.1:5172"}' "<prompt>" < /dev/null \
  | node <stamp each line with its arrival time> > events.jsonl
node ui/demo/record.mjs events.jsonl prompt.txt meta.json > ui/demo/codex-demo.json
```

`record.mjs` keeps the agent's messages and tool calls as recorded (results trimmed, private paths removed) and adds, marked as its own, where each event shows on the pages.

## Check it

`node smoke.ts` (with Tosi running) connects with the SDK's own client, runs Terrestrial 3076, reads the algorithm and guidebook, and makes one proposal.
