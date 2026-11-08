# Development decisions

How Tosi is built: engineering choices, why they were made, and what they rule out.

This log is only about building the software. The rules and principles Tosi applies to filings (what counts as a concern, which limits apply, how AI may and may not be used) belong in the guidebook, which will have its own home. Nothing here should repeat or override the guidebook.

New decisions are added at the end. A changed decision gets a new entry that names the one it replaces.

## D-001 The specification comes before code

**Decision:** stage schemas and conformance cases in `spec/` define what each stage does. Engines implement the spec.
**Why:** a deterministic system needs a definition that does not depend on any one implementation.
**Consequence:** no behaviour exists only in code. If an engine needs to do something the spec doesn't say, the spec is updated first.

## D-002 Three engines: TypeScript, Rust, Python

**Decision:** every stage is implemented in all three languages.
**Why:** independent agreement shows the spec decides the result; stages can be switched between engines; performance can be compared per stage.
**Consequence:** more work per stage, accepted. A stage is done only when all three pass and agree.

## D-003 Stages talk only through their outputs

**Decision:** each stage reads and writes defined files. No stage calls into another stage's code.
**Why:** this is what lets engines be mixed, and lets the interface and MCP server work with any engine.
**Consequence:** outputs are versioned, and a schema change is a spec change.

## D-004 Agreement within a stated tolerance

**Decision:** stored numbers are rounded to a fixed precision per field, and engines are compared within a stated tolerance.
**Why:** languages differ in the last digits of some maths functions. Rounding keeps each engine's own output byte-identical across runs; tolerance separates real disagreements from noise.
**Consequence:** every numeric field in a schema states its precision.

## D-005 Every run records its inputs and engines

**Decision:** a run records the input fingerprints, the spec version, and the engine and version used for each stage.
**Why:** any result must be reproducible and attributable.

## D-006 One interface, web and desktop

**Decision:** the interface is written once in TypeScript, served as a web app and packaged with Electron for Windows and macOS.
**Why:** both deployments are needed; one codebase keeps them identical.
**Consequence:** the interface reads stage outputs only, never engine internals.

## D-007 Poppins is the interface font

**Decision:** Poppins is the default typeface. Raleway or Nunito are possible alternates.

## D-008 TypeScript runs on Node directly

**Decision:** the TypeScript engine and the server run as `.ts` files on Node 23.6 or later, with no compile step. Only type annotations that Node can strip are used.
**Why:** fewer tools between the source you review and the code that runs.
**Consequence:** no TypeScript-only runtime features such as enums or namespaces.

## D-009 No dependencies until a stage needs one

**Decision:** the engines, the server and the page start with no third-party dependencies. Each dependency added later gets its own entry here, with its reason.
**Why:** every dependency is code that a reviewer has to trust.

## D-010 Themes are token sets

**Decision:** design tokens (shared) and theme tokens (per theme) live in two separate files; every style uses tokens. Five themes ship; Matte Black is the default.
**Why:** a new theme should be one block of values, not a second stylesheet.
**Consequence:** the Neumorphism and Blackboard themes express their character through shadow, border and texture tokens, so components must use those tokens rather than fixed shadows or borders.

## D-011 Database readers: one independent library per engine

**Decision:** each engine reads Access databases with a different, pure library: `mdb-reader` (TypeScript), `jetdb` (Rust), `access-parser` (Python). Rust also uses `zip`, `sha2`, `serde` and `serde_json` (with `preserve_order`, so rulebook order is kept). TypeScript reads zips with its own small reader on `node:zlib`; Python uses its standard library.
**Why:** the engines must not share an implementation, or their agreement proves nothing. The three readers are by different authors; on Space 3074 and Terrestrial 3076 they agree on every table, row count and column.
**Consequence:** the Python engine runs from its own virtual environment (`engines/python/.venv`, from `requirements.txt`). The mdbtools command-line programs are not used, because all three engines would then share one reader.

## D-012 The guidebook edits the rulebook, and every result names its rulebook

**Decision:** the guidebook is an editor over `spec/rulebook/intake.json`. Each table has a `read` switch, the columns the rules need, and a plain name and description. Every change bumps the rulebook's version and is appended, with its reason, to `spec/rulebook/changes.jsonl`. Every intake result records the rulebook version and the SHA-256 of the rulebook file it read.
**Why:** what Tosi reads must be changeable by experts without code, and a result must stay traceable to the exact rules that produced it.
**Consequence:** marker tables (how a kind is recognised) cannot be switched off in the guidebook. A file processed under an older rulebook is marked in the Flow, with a way to run it again.

## D-013 One engine per run; agreement on request

**Decision:** a file is processed by the engine chosen in Settings, and only that one. The Flow shows that engine's time, live. Running the same file through the other engines, to check they agree, happens only when asked (`tosi_check_agreement`, or `compare/agree.py`).
**Why:** the Flow should show one engine's work as it happens, with honest timing; running three engines for every file triples the wait.

## D-014 The MCP server reads and proposes; the algorithm is read-only for now

**Decision:** the MCP server (`mcp/`, on the official SDK) drives Tosi through the local server's API. It can read, run and monitor the pipeline and read the guidebook, algorithm and rulebook. Changes to what Tosi reads are proposals, accepted or declined by a person. For now the algorithm is read-only: the server refuses rulebook changes and refuses to accept proposals, unless `"editing": true` is set in `dev/local.json`.
**Why:** rules change only by review (guidebook P-5). Editing will return as drafts that become a version only when saved.
**Consequence:** the chat panel (`ui/public/assistant.js`) is written but not loaded until a model is connected.

## D-015 Downlink is the second stage, and stages run back to back in one engine

**Decision:** after intake, an accepted space filing goes through Downlink (`spec/rulebook/downlink.json`): a filing goes on if it is a satellite with at least one transmitting group, and only those groups go on with it. The engine that ran intake runs Downlink straight after, reading the unpacked database intake left on disk; the run's fingerprint covers both outputs.
**Why:** every later space step (reach, limits, power) works on downlink groups only, so this is the smallest stage that narrows the work for all of them. Reading from disk, not memory, keeps large files within an ordinary computer's RAM.
**Consequence:** the Flow gains a fourth scene for space filings: one dot per filing, the ones that go on kept together, the rest grouped by reason. Leaving is not a concern, so the leavers are grey.

## D-016 Tests give estimates, and say they are estimates

**Decision:** Settings has a Tests page. It runs every engine three times on each sample file, through the same stages and queue as a real run (but not kept as a run or in the Library), and keeps each step's middle time in `bench/results.json` on this computer. It then estimates how long a file of any size would take by scaling each step's time in proportion to file size, from the largest sample; starting the engine is not scaled.
**Why:** people need a rough idea of the wait for large files and of which engine to pick. A straight-line estimate from real timings is honest about what it is; the page says so at the top.
**Consequence:** results depend on the computer and its disk, so they are never committed. The same size card (`ui/public/metric.js`) is used for the file size limit on the Algorithm page, a parameter shown as a draft that cannot be saved while the algorithm is read-only.

## D-017 Reach is the third stage, and it leans to the worst case

**Decision:** after Downlink, a space filing goes through Reach (`spec/rulebook/reach.json`): can the satellite ever be seen from Finland? A fixed satellite is seen if it rises above 0° somewhere in a box around Finland's land and territorial sea (59.3–70.1° N, 19.0–31.6° E), moved towards Finland by its filed tolerance. A moving satellite is seen if, for any orbit, its folded tilt plus how far it sees over the horizon from apogee reaches the box's south edge. A satellite around another body (the Moon, the Sun, Jupiter) is seen. A filing without a usable position is assumed seen and left for the Data step. A satellite never seen is clear (guidebook M-9).
**Why:** Traficom ruled that the worst case always applies. Each choice can only add satellites, never drop one that could be seen. A box and two closed-form tests need no map file, so the three engines can agree byte for byte.
**Consequence:** angles are rounded to two decimals as `floor(x · 100 + 0.5) / 100` and written in shortest form, which every engine must match. The box edges are estimates from the outermost points plus 12 nautical miles; they should be checked against the official territorial-sea limits. Intake does not yet require `geo`, `non_geo` or `orbit`; a missing table counts as nothing filed, so its filings are assumed seen. The Flow gains a fifth scene; the MCP server gains `tosi_get_stage`.

## D-018 What a filing is, for people, comes from the server, not the engines

**Decision:** hovering a filing in the Flow shows its name, the administration that filed it (with any partners and organisation), where it flies, what it sends and listens on, the kind of filing and when the ITU received it. The server reads these from the run's database (`ui/filings.ts`) with names from `spec/reference/administrations.json`.
**Why:** this is description, not a result. Keeping it out of stage outputs keeps those outputs small and the three engines' agreement about decisions only.
**Consequence:** no rule may read `spec/reference/`. A live position cannot be shown: filings give orbits but no epoch.

## D-019 Reach is drawn as the sky above Finland, by default

**Decision:** the Reach scene opens on a 2.5D picture (`ui/public/reachglobe.js`): Finland on the curve of the globe with the sky above it as a dome. Each satellite Finland can see sits where you would look for it, seen from the middle of Finland. Fixed satellites are purple and placed truthfully. Moving satellites are pink, deeper for a steeper orbit, and placed at their highest pass. Satellites around other bodies are a soft blue. The clear ones go grey to the side, as in the grid. A toggle switches to the grid and back, and the dots move smoothly between the two. The picture can be turned and tilted by dragging, and a double-click resets it.
**Why:** a picture of the sky shows what Reach means: what Finland can see and what is hidden below its horizon.
**Consequence:** it is not to scale and says so. The filing gives no time, so where a moving satellite sits is illustrative. The Reach result decides, not the picture. It is plain projection maths in SVG with no 3D library, and Finland's outline (`ui/public/finland.json`, Natural Earth, public domain) is for display only.
