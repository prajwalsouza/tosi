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

**Decision:** after Downlink, a space filing goes through Reach (`spec/rulebook/reach.json`): can the satellite ever be seen from Finland? A fixed satellite is seen if it rises above 0° somewhere in a box around Finland's land and territorial sea (59.3–70.1° N, 19.0–31.6° E), moved towards Finland by its filed tolerance. A moving satellite is seen if, for any orbit, its folded tilt plus how far it sees over the horizon from apogee reaches the box's south edge. A satellite around another body (the Moon, the Sun, Jupiter) is seen. A filing without a usable position is assumed seen and left for the Data step. A satellite never seen is clear (guidebook MD-9).
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

## D-020 Reference tables are built once, from named sources, by one script

**Decision:** `dev/tools/tables.py` builds every reference table the rules read: `spec/tables/pfd.json` (the ITU power-flux-density limits), `spec/tables/p1546.json` (Recommendation ITU-R P.1546-6 curves, from the ITU-R WP 3K reference implementation v6.2), and `spec/tables/finland.json` (test points, Finland's outer limit as land border plus 12 nautical miles of sea stopped short of neighbours, and nearby land outlines, from Natural Earth). Each table records its source file and hash. The Traficom station list becomes `state/reference/stations.json`, which stays on this computer. `ui/public/region.json` (display only) is built by the same script.
**Why:** rules must read tables, never fetch or guess them, and every number must trace back to a published source.
**Consequence:** changing a table means rerunning the script and checking the agreement again. The display outlines cover more than any map view (46–76° N, 2° W–56° E), so maps fade out instead of ending at a cut; that change left `finland.json` byte for byte the same.

## D-021 Space screening: Limit, Data, Power, Compare, Stations

**Decision:** after Reach, a space filing goes through five more stages: Limit (is there an international power limit that protects Finland?), Data (does it file everything the calculation needs?), Power (worst-case power, every antenna pointed at Finland), Compare (against the limit at every arrival angle; within 3 dB is near), and Stations (which listed Finnish stations work on its frequencies). All three engines agree byte for byte on both space samples.
**Why:** this follows how the Radiocommunication Bureau checks power-flux density, with the worst case always applied, as Traficom ruled.
**Consequence:** on ific3074: 120 of 138 have a limit, 111 can be calculated, 62 are over, 28 near and 21 under; 69 filings touch 386 listed stations.

## D-022 Terrestrial screening: Land mobile, Range, Data, Field strength, Threshold, Stations

**Decision:** a terrestrial filing goes through six stages: foreign land mobile stations only; within 1,000 km and 30–4,000 MHz (the range of P.1546-6); power and height filed; field strength at Finland's land border and sea limit by P.1546-6 (10% of time, 50% of locations, 10 m receiver); the trigger level of ECC T/R 25-08 for the band, adjusted for channel width; and the same at each listed Finnish station. Coordination completed with Finland is shown as a case to verify, never as closed.
**Why:** Traficom's answers of 7 November 2026: land mobile only, flag any exceedance including at sea-limit points, and they verify coordination against their own register.
**Consequence:** the P.1546-6 port matches all 52 ITU validation cases (`compare/p1546_check.ts`). On brific3076: 4,057 stations, 1,858 land mobile, 57 in range, 1 over, 5 over but coordinated.

## D-023 The ladder places every case; the report is the notification

**Decision:** Ladder (space) and Tladder (terrestrial) put every filing or station on the first concern rung that is true, from the top, then order by rung, by how far over, and by number. Report and Treport write the notification: `report.json` (the crit and warn cases, each with what, where, why, how much and what to do next), `report.csv` (every filing or station, one row each: the processed file Traficom asked for) and `report.md` (the short notification). All four agree byte for byte in the three engines and are in `engines/chain.json`.
**Why:** the notification is the product (Traficom, 7 November 2026). Being over a limit is a concern even with no listed station, because licence-exempt use does not appear in the station list.
**Consequence:** the Flow lists Ladder and Report as steps; their own scenes are still to build. The Report scene will be an expandable outliner on top with the map below it, at the end of the story.

## D-024 Every result cites its sources

**Decision:** every stage result's `rulebook` stamp carries `cites`: the rulebook entries named `method`, `basis` or ending in `_basis`, copied in rulebook order. The Flow shows them under each scene's summary line, in a few words with the full text on hover, and the Threshold scene lists the trigger levels by band for the stations in the file.
**Why:** a reader must see which guideline or policy sets each acceptable level, and a result file must say so on its own, without the rulebook beside it.
**Consequence:** results changed shape but not values. The schemas require `cites`. A rulebook's source that is administration policy says so in its own words, so policy is never presented as an external rule.

## D-025 Method definitions are MD-n, not M-n

**Decision:** the guidebook's methods section is `MD` (method definitions) and its entries are MD-1 to MD-9. Every reference in the rulebooks, stage specs, the guidebook's steps and the MCP server's guidebook tool uses the new ids. The guidebook, compare, data, ladder and tladder rulebooks went up one version.
**Why:** "M4", "M5" and so on are Traficom's regulations (M4 is the Radio Frequency Regulation and its national frequency allocation table). A guidebook entry called M-4 would be read as one of them.
**Consequence:** results carry the new rulebook hashes; values are unchanged.

## D-026 Finnish use comes from the national frequency table (M4)

**Decision:** `dev/tools/tables.py --m4` builds `spec/tables/m4.json` from Traficom's open-data frequency allocation table (in English), the annex to Radio Frequency Regulation 4: each sub-band in MHz with a use in Finland, and whether that use is licence-exempt (the table's own note says exempt from licensing, or it is a short range device, which the table refers to Traficom Regulation 15 for). Identical rows are merged: 1,401 uses, 184 licence-exempt. Both ladders record, for every case over or near the level, the uses whose sub-band touches the case's frequencies and the licence-exempt ones among them (`m4`), with the table's hash. Both reports carry them as `finnish_use`, name the first four in the notification, and add two CSV columns. Guidebook D-4.
**Why:** Traficom asked for files to be processed using Finnish usage data, and said an exceedance counts even where only licence-exempt use exists, citing the frequency table's use. The station list has no licence-exempt use; the table does.
**Consequence:** the rungs and their levels do not change: the table adds evidence, not a new rule. Raising "Exceeds, no listed station" to crit where the table shows licence-exempt use would be a policy change for the administration to decide. All three engines agree byte for byte on both samples.

## D-027 Station and frequency-table evidence stays with its transmission

**Decision:** Stations matches listed stations to each of Compare's rows on its own (one transmission in one limit band, with its own margin) and records, besides every station on any over or near row, the stations on a row over the limit, the ones only on near rows, and the strongest over and near row that reach a station, with margin, band and station numbers. The Ladder says "Exceeds at a listed station" only when the same transmission is over the limit and on a listed station's frequencies, and "Near limit at a listed station" when a near transmission reaches one, even if another transmission of the filing is over. Each case carries its worst transmission and the station evidence separately, each with the Finnish use (M4) on its own band only. The report states the worst margin with its band and, when different, the station evidence with its own margin and band. The CSV adds the worst band and the over and near station counts, and its M4 columns are for the worst band.
**Why:** the earlier rule pooled a filing's stations across all its transmissions, so a filing over the limit on one band and near it on another, where the stations were, read as exceeding at those stations. On ific3074, TIANQI-3E-2 (124545392) is 22.48 dB over at 32,300–32,380 MHz, where no listed station works, while its 329 station matches come from transmissions 0.06 to 2.76 dB under the limit.
**Consequence:** the power calculation and every margin are unchanged; only matching, rungs and wording change. On ific3074, four filings move from "Exceeds at a listed station" to "Near limit at a listed station" (crit 51 → 47, warn 40 → 44). The regression case is 124545392.
