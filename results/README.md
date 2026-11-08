# Results for evaluation

The two issues Traficom asked for, processed by Tosi, each in its own folder:

| Issue | Folder | Read first | Summary |
|---|---|---|---|
| **Space IFIC 3074** (23 June 2026) | [space-3074/](space-3074/) | [report.pdf](space-3074/report.pdf) or [report.xlsx](space-3074/report.xlsx) | 196 filings screened. **47 need attention, 44 are worth a look.** 69 filings reach the frequencies of 386 listed Finnish stations |
| **Terrestrial IFIC 3076** (21 July 2026) | [terrestrial-3076/](terrestrial-3076/) | [report.pdf](terrestrial-3076/report.pdf) or [report.xlsx](terrestrial-3076/report.xlsx) | 4,057 stations screened. **1 needs attention** (KRL Lyaskelya, Russia, 152.9 MHz, 8.98 dB over the trigger at the border), **5 worth a look** (over the trigger but recorded as coordinated with Finland: to verify) |

## What is in each folder

| File | What it is |
|---|---|
| `report.pdf` | The notification: counts per concern, then every case that needs attention or is worth a look, with why, by how much, and what to do next |
| `report.xlsx` | Sheet **Needs attention**: the crit and warn cases. Sheet **All rows**: every filing or station in the issue, one row each. Same rows as `report.csv` |
| `report.csv` | One row per filing (space, by `ntc_id`) or per station (terrestrial, by `terrakey`), with its concern, level and the stage that decided it. The machine-readable result |
| `report.md` | The notification as text; the PDF is this file printed |
| `stages/*.json` | The output of every pipeline stage, in order. Every number in the report can be traced back through these to a record in the ITU file, a rule in `spec/rulebook/` and a reference table in `spec/tables/` |

Columns: `Level` is `crit` (needs attention), `warn` (worth a look) or `none`. `Concern` names the rung of the concern ladder ([spec/rulebook/ladder.json](../spec/rulebook/ladder.json), [tladder.json](../spec/rulebook/tladder.json)). `Decided by` names the stage whose test placed it there.

## Inputs

| Input | Source | SHA-256 |
|---|---|---|
| Space IFIC 3074 | `https://www.itu.int/sns/ific10/ific3074.zip` | `c8adf75044bca9d6a2be4213d051805f1b0a88d716fb184bcb1cd812216da721` |
| Terrestrial IFIC 3076 | `https://www.itu.int/en/ITU-R/terrestrial/brific/BRIFIC/MDB/brific3076.zip` | `ba9d0605a4a5494162e17650c290401d84deaef29030cbdbb61e4b00c834c4c2` |
| Finnish stations to protect | Traficom, `Traficom_SinceAI_Frequencies_of_interest_v05112026.xlsx` (synthetic data, per the sheet). Cleaned by `dev/tools/tables.py --stations`: 873 rows, 872 station numbers; blank licence class read as MUUT; the smaller of channel and transmission bandwidth used. Not committed | `bb7f481f085fb6c457efc04b9b6bb8250c42ea81bab4b4a0e518c93834e03c8a` |
| PFD limits (RR Article 21, Appendix 5) | ITU BR PFD Technical Annexes, `PFD.mdb` → [spec/tables/pfd.json](../spec/tables/pfd.json) | `2a4bbb47…a35631` |
| Propagation curves (P.1546-6) | ITU-R WP 3K reference implementation v6.2 → [spec/tables/p1546.json](../spec/tables/p1546.json) | `a3271824…8da3b` |
| Finland's border, 12 nm sea limit, test points | Natural Earth 1:50m → [spec/tables/finland.json](../spec/tables/finland.json) | `3e458fc0…b7fdeb` |
| Finnish frequency allocation table (M4 annex) | Traficom open data → [spec/tables/m4.json](../spec/tables/m4.json) | `41ffdd0e…4871fb` |

Each stage file records the SHA-256 of the input file, of the reference tables it read, and of the rulebook version it applied.

## Main assumptions (as Traficom ruled in the channel)

- **Space:** worst case always. Peak antenna gain towards Finland, whatever the beam's pointing. A filing is checked against the ITU PFD limit for its band. Within 3 dB of the limit counts as near. A favourable ITU finding never clears a case on its own.
- **Terrestrial:** land mobile only. Field strength by ITU-R P.1546-6 at 10 % of time and 50 % of locations, no terrain profile, at several points along the land border and the 12 nm territorial-sea limit; the strongest counts. Trigger levels from ECC T/R 25-08 Annex 1, A1.2.3, using the 400–470 MHz level above 470 MHz. Stations recorded as coordinated with Finland are shown as "to verify", never as closed.
- **Both:** being over the limit counts even where Finland's only use of the band is licence-exempt (M4 annex), and the report says so.

The full list of rules, with the regulation or recommendation behind each, is in [spec/rulebook/](../spec/rulebook/) and the guidebook ([spec/guidebook/guidebook.json](../spec/guidebook/guidebook.json), also in the app under Guidebook).

## Reproduce

These files were produced on 8 November 2026 by the Rust engine, then by the Python engine, from the same inputs. `report.csv` and `report.md` are byte-identical between the two, and every stage JSON has the same content (the Python run on Windows adds a CRLF at the end of the file).

```bash
python dev/tools/tables.py --stations Traficom_SinceAI_Frequencies_of_interest_v05112026.xlsx
cd engines/python
python -m tosi intake --file ific3074.zip --out ../../runs/space-3074
for s in downlink reach limit data power compare stations ladder report; do python -m tosi $s --in ../../runs/space-3074; done
python -m tosi intake --file brific3076.zip --out ../../runs/terrestrial-3076
for s in mobile range tdata field threshold tstations tladder treport; do python -m tosi $s --in ../../runs/terrestrial-3076; done
cd ../..
python dev/tools/export.py runs/space-3074
python dev/tools/export.py runs/terrestrial-3076
```

The Rust (`engines/rust/target/release/tosi`) and TypeScript (`node engines/ts/src/main.ts`) engines take the same commands. The stage order is in [engines/chain.json](../engines/chain.json). The app (`node ui/server.ts`) runs the same chain when a file is dropped on it.
