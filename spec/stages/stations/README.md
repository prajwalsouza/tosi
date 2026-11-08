# Stage 8: Stations

**The question:** which Finnish stations could a satellite over or near the limit affect?

## Why it comes here

Being over the limit is a concern whether or not a listed station uses the frequency (Traficom: over the limit counts even with only licence-exempt use). What Finnish use changes is **how serious** a case is, so this step finds who would be hit, and the Ladder ranks on it.

## The rule

The stations are Traficom's list (`state/reference/stations.json`, kept on this computer only). A station counts for a satellite if:

1. **Frequency:** its receive band, or its transmit band when different, overlaps what the satellite transmits inside the limit's band, for any row over or near the limit. Transmit bands count because someone in Finland receives them (guidebook C-4). A band is the frequency plus and minus half its width.
2. **Sight:** a satellite fixed in the sky must be above the station's horizon. A moving satellite is taken to pass over every station at some point.

**Evidence stays with its transmission.** Each of Compare's rows is one transmission in one limit band, with its own margin. Stations are matched to each row on its own. Besides every station on any over or near row (`stations`), a filing records the stations on a row over the limit (`over`), the ones only on rows near it (`near`), and the strongest over row and the strongest near row that reach a listed station (`at_over`, `at_near`: margin, band in MHz and the station numbers). The Ladder says "Exceeds at a listed station" only from `at_over`: the same transmission is over the limit and on the station's frequencies.

When the list is not on the computer, every filing is marked **no list** and nothing fails.

The rules are in [`spec/rulebook/stations.json`](../../rulebook/stations.json).

## In Space 3074

| | Filings |
|---|---|
| Listed Finnish stations on those frequencies | 69 |
| No listed station | 21 |

386 of the 873 listed stations are on a frequency some satellite over or near the limit transmits on.

## What goes in, what comes out

- **In:** `intake.json`, `reach.json`, `compare.json` and the station list. The database is not read.
- **Out:** `stations.json`, matching [`spec/schemas/stations.schema.json`](../../schemas/stations.schema.json): each filing over or near the limit with the station numbers it could affect, in ascending order, plus which list was used (its fingerprint) and the counts.

All three engines must write identical files, given the same station list.
