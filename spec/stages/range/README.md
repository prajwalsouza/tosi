# Terrestrial stage 2: Range

**The question:** is the station close enough, and on a frequency, for the propagation method to apply?

## The rule

Recommendation ITU-R P.1546-6 works out field strength for paths up to 1,000 km, from 30 to 4,000 MHz. A station **goes on** if it is within 1,000 km of Finland's outer limit and its frequency is in that range.

Distance is to the nearest point of Finland's outer limit: its land border and its 12-nautical-mile territorial sea ([`spec/tables/finland.json`](../../tables/finland.json), about every 10 km). It is 0 inside Finland. A station filed as a circle is measured from the edge of its circle (worst case). A station without a position goes on, and the Data step asks for it.

Otherwise it **leaves**, with the first reason that is true:

1. **Withdrawn:** the filing withdraws the station (`SUPPRESS`).
2. **Too far:** more than 1,000 km from Finland.
3. **Out of band:** below 30 MHz or above 4,000 MHz.

## In Terrestrial 3076

| | Stations |
|---|---|
| Within 1,000 km and 30–4,000 MHz | 57 go on (12 km to 923 km from Finland) |
| More than 1,000 km away | 1,801 leave |

**57 of 1,858 go on.** None of the land mobile stations in this issue is a withdrawal or outside the band.

## What goes in, what comes out

- **In:** `mobile.json` and the database.
- **Out:** `range.json` ([schema](../../schemas/range.schema.json)): every station that came in, as a compact row (`terrakey`, distance in km, index of the nearest border point in `spec/tables/finland.json`, reason or null).
- **Reads:** `fxm_terra.intent`, `freq_assgn`; `fxm_geo.long_dec`, `lat_dec`, `radius`.

Distances use a sphere of radius 6,371 km and are rounded to two decimals.
