# Stage 9: Ladder

**The question:** how worried should Finland be about each filing?

## What it does

Every space filing that entered the screen (all of Downlink's filings) goes on exactly one rung of the concern ladder from the guidebook. The rungs are tried in order, and the first one that applies wins. Three rungs are red (crit), three amber (warn), and three need nothing (none).

| Rung | Level | Applies when |
|---|---|---|
| Exceeds at a listed station | crit | Compare says over, and Stations found a listed Finnish station on its frequencies |
| Raised by a Finnish antenna | crit | Not applied yet: the Antennas step is not built, so this rung stays empty |
| ITU names Finland | crit | The filing's own records name Finland: coordination with FIN (`provn`), an affected Finnish network (`tr_aff_ntw`), or Finland in its service area (`srv_area`) |
| Near limit at a listed station | warn | Compare says near (within 3 dB), with a listed station on its frequencies |
| Near frequency | warn | Over or near, no listed station on its frequencies, but one within the guard: the larger of the station's width and 1 MHz |
| Exceeds, no listed station | warn | Compare says over, and no listed station is on or near its frequencies |
| Cannot calculate | none | Data: something needed is missing (or Compare found no result) |
| No applicable limit | none | Limit: no limit covers it |
| Clear | none | It left at Downlink or Reach, or it is under the limit, or near with no station on or near its frequencies |

ITU names Finland is tried only for filings that reached Limit; one that left at Downlink or Reach is Clear, with the stage it left at recorded. Within a rung the worst excess comes first, then the lowest `ntc_id`.

Rungs, wording, levels and the guard are in [`spec/rulebook/ladder.json`](../../rulebook/ladder.json).

## In Space 3074

| Rung | Filings |
|---|---|
| Exceeds at a listed station | 46 |
| Raised by a Finnish antenna | 0 |
| ITU names Finland | 5 |
| Near limit at a listed station | 23 |
| Near frequency | 7 |
| Exceeds, no listed station | 10 |
| Cannot calculate | 9 |
| No applicable limit | 17 |
| Clear | 79 |

**51 crit, 40 warn, 105 need nothing.**

## What goes in, what comes out

- **In:** `downlink.json`, `reach.json`, `limit.json`, `data.json`, `compare.json` (with its rows), `stations.json`, the station list (`state/reference/stations.json`, for Near frequency), Finland's national frequency allocation table (`spec/tables/m4.json`, Traficom Radio Frequency Regulation 4), and from the database `grp.grp_id`, `grp.ntc_id`, `provn.grp_id`, `provn.adm`, `tr_aff_ntw.ntc_id`, `tr_aff_ntw.adm`, `srv_area.grp_id`, `srv_area.ctry`.
- **Out:** `ladder.json`, matching [`spec/schemas/ladder.schema.json`](../../schemas/ladder.schema.json): every filing in ladder order with its rung, the stage that decided it, its worst excess, the listed stations on its frequencies, the stations near them, which ITU records name Finland, and, for every filing over or near the limit, the Finnish uses the frequency table lists on what it transmits, with the licence-exempt ones on their own (`m4`). The table's hash is in `tables.m4`.

## Finnish use (M4)

Traficom said on 7 November 2026 that being over the limit is a concern even where only licence-exempt use exists, and that the report should cite the frequency table's use. So for every filing over or near the limit, the ladder lists each use in the national frequency allocation table whose sub-band touches any frequency range the filing transmits (from Compare's rows, ends included), once each, in table order, and separately the ones the table marks licence-exempt (its own note says exempt from licensing, or it is a short range device). The rungs themselves do not change.
