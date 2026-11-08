# How Tosi works

This is the core idea and the shape of the system.

- **Development decisions** (how the software is built) are logged in [dev/docs/decisions.md](../dev/docs/decisions.md).
- **The guidebook** (the rules and principles Tosi applies to filings) will be written separately. Its home is not decided yet. The principles below are a summary; the guidebook will be their authoritative source.

## The problem

The ITU publishes a new issue of filings every two weeks. Each one lists new and changed claims on the radio spectrum, from satellites and from terrestrial stations. When a claim clashes with how a country already uses the spectrum, that country has a limited time to object.

An objection goes to another administration's engineers, who will check every number. You can't send another country a probability. So the system that finds these clashes must be deterministic: the same file always gives the same answer, and every answer can be proved.

## Principles

1. **Results come only from rules.** Every number in a finding comes from a filed record, a published table or a stated formula. No language model or learned model takes part in any result.
2. **A glass box.** Every step can be seen and questioned: what came in, what the test was, why each case passed or stopped, and what the others looked like at the same step.
3. **The rulebook is the system.** The checks are written down as a versioned rulebook. Code implements the rulebook and names the rules it applies.
4. **AI writes rules, never results.** AI may help an expert propose a rule change, and an optional audit track may look for gaps over many issues. Every change is reviewed and tested before it counts. Neither ever decides a case.
5. **People decide.** Tosi proposes and shows its evidence. Nothing is sent automatically.

## The shape of the system

```
spec/        the rulebook, the stage schemas, the conformance cases
engines/     three implementations of every stage: TypeScript, Rust, Python
compare/     runs one file through every engine and diffs the results
bench/       times each stage in each engine
ui/          the web interface: the Story, the report, the views
app/         the desktop app (Electron) for Windows and macOS
mcp/         an MCP server over every stage
docs/        this design
dev/docs/    development decisions
experimental/visualization/   spatial views: the sky above you, the globe, the spectrum landscape
```

### The specification comes first

`spec/` holds what Tosi means, independent of any language:

- **The rulebook:** each step, rule, threshold and data requirement, with its source (a regulation, a recommendation, a published table, or a choice the administration owns).
- **Schemas:** what each stage reads and writes.
- **Conformance cases:** small, fixed tests with an input and the output every engine must produce. They define each stage, prove the engines agree, and show what a rule change would alter before it is approved.

### Three engines, one answer

Every stage is implemented three times: in TypeScript, Rust and Python. This is deliberate:

- **Verifiability.** Three independent implementations that agree on the same rulebook show that the rules decide, not the code.
- **Switching.** Stages talk only through their outputs, so any stage can be run by any engine, and a pipeline can mix them.
- **Performance.** The same stage can be timed in each language on the same files.

Every engine has the same command-line shape and writes the same outputs. Each run records which engine and version produced each stage. Small floating-point differences between languages are expected; results are compared to a stated tolerance, and anything beyond it is a real disagreement.

A stage is done only when all three engines pass its conformance cases and agree with each other.

### What happens when a file arrives

1. **Arrival.** A file is dropped into the interface, chosen from a menu, fetched when a new issue is published, or sent through MCP. All routes lead to the same intake.
2. **Fingerprint.** The bytes are hashed. A file seen before reuses its earlier run.
3. **Recognise.** The file's kind (space, terrestrial, or something else) is worked out from its contents.
4. **Check.** The tables and columns present are compared with what the rulebook needs. If something is missing, the file is refused with the exact reason.
5. **Run.** Each stage writes its output, and the interface shows progress.
6. **Report.** The outline, the notification and the exports are written, and the results open in the interface.

### The interface

The same interface runs as a web server and, packaged with Electron, as a desktop app on Windows and macOS. It reads stage outputs only, never engine internals, so it works with any engine.

- **The Story:** a vertical walk through the pipeline on the real file. Each step says what it does and what its test is, and you can follow any case through it.
- **The report:** the outline is the page. Each finding opens down to why, then to the rule, then to the pipeline step that decided it, with its picture in place.
- **Views:** the same results as an outline, a table or a map, with more data views to come. Every view can be exported.

### MCP

An MCP server exposes every stage, so the same results can be reached from other tools and assistants. It can read anything and propose rule changes. It cannot change a result.

## How it gets built

One stage at a time, in pipeline order. For each stage:

1. Write it into the spec: rule, schemas, conformance cases.
2. Implement it in all three engines.
3. Pass the conformance cases and agree across engines.
4. Benchmark it.
5. Show it in the interface and expose it through MCP.

Then the next stage.
