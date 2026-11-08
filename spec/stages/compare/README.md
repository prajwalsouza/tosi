# Stage 7: Compare

**The question:** in the worst case, does the power arriving in Finland go over the limit?

## The rule

The power spreads out on its way down: arriving in Finland, it is spread over a sphere as large as the distance, so it falls with the **square of the distance**:

```
power-flux density = e.i.r.p. − 10·log10(4π d²)      d in metres
```

The limit depends on the **angle the signal arrives from**, because ground antennas mostly look towards the horizon. So every angle at which the satellite can appear from Finland is tried:

- **Fixed in the sky:** from each test point inside Finland and each point on its outer limit where the satellite is above the horizon. The angle is its elevation there; the distance, the slant range.
- **Moving:** every angle from 0° to 90° in half-degree steps, at the lowest perigee of its orbits (closest approach).

At each angle, the margin is the limit plus the spreading; the smallest margin is kept, and **excess = e.i.r.p. − smallest margin**. Above 0 dB, the limit is broken.

Each filing keeps its worst row:

- **over:** excess above 0 dB;
- **near:** within 3 dB under (administration policy, as Traficom asked for near misses);
- **under:** more than 3 dB under.

The constants, the geometry and the reading of a mask are in [`spec/rulebook/compare.json`](../../rulebook/compare.json).

## In Space 3074

| | Fixed | Moving | Filings |
|---|---|---|---|
| Over the limit | 20 | 42 | 62 |
| Within 3 dB | 7 | 21 | 28 |
| Under | 3 | 18 | 21 |

The largest excess is 42.8 dB, a moving satellite seen straight overhead, against RR 21.16.

## What goes in, what comes out

- **In:** the database, `intake.json`, `reach.json` and `power.json`.
- **Out:** `compare.json`, matching [`spec/schemas/compare.schema.json`](../../schemas/compare.schema.json): each filing's outcome with its worst row: excess, power-flux density, limit, angle, distance, group and provision. Also every row over or near the limit, with the frequencies it shares with the limit's band, for Stations.
- **Reads:** `freq.grp_id`, `freq.freq_mhz`, `freq.freq_min`, `freq.freq_max`, `orbit.ntc_id`, `orbit.perig_km`, Reach's longitude, and `spec/tables/finland.json`.

Numbers are rounded to two decimals; ties go to the lowest `grp_id`. All three engines must write identical files.
