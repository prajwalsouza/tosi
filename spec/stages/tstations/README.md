# Terrestrial stage 6: Stations

**The question:** which listed Finnish stations could this station affect?

## The rule

Traficom's list of stations to protect is cleaned into `state/reference/stations.json` (kept on this computer only; `dev/tools/tables.py`). Each Finnish station protects its receive frequency, and its transmit frequency when different, because whatever it transmits is received by someone in Finland (guidebook C-4). Each is a band as wide as the station's channel (the smaller of its two widths, D-1).

For every foreign station that reached the Threshold step, each listed station within 1,000 km whose band overlaps the foreign channel is checked: the field strength is worked out at the Finnish station, with the same method and parameters as the Field strength step, and compared with the same trigger level.

- **Exposed:** over the level at one or more listed stations.
- **Not exposed:** listed stations share the channel, but it is under the level at all of them.
- **No station:** no listed station within 1,000 km shares the channel.
- **No list:** this computer has no station list. The step still runs and says so.

## In Terrestrial 3076 (with the 873-station list)

| | Stations |
|---|---|
| Exposed | 3 |
| Not exposed | 27 |
| No listed station on the channel | 27 |

The station that is over the border level is also over at two listed Finnish stations, the worst by 4.5 dB at 57 km.

## What goes in, what comes out

- **In:** `threshold.json`, `tdata.json`, the database and the station list if present.
- **Out:** `tstations.json` ([schema](../../schemas/tstations.schema.json)): per station, how many listed stations were checked, those over the level, and the worst one with its field strength, margin and distance. The list's fingerprint is recorded.
